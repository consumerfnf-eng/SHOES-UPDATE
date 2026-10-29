"""Read two things off a product photo: who it is, and what colour it is.

Why
---
Retail listings arrive with no colour at all about half the time, and the
same shoe photographed twice - the identical shot re-hosted by another
retailer, or the same shoe at a slightly different angle - was turning into
two cards or two colour chips. Both problems are answerable from the image
itself, so the image is what gets read.

Two signals per photo
---------------------
`phash`  A 64-bit difference hash. Identical or re-encoded/resized copies of
         one photo land on the same (or an almost identical) hash, which is
         what catches the same listing hosted twice. It does NOT survive a
         real change of angle - nothing cheap does - so it is used only to
         merge photos that really are the same shot.

`body`   The dominant colour of the shoe itself: the studio backdrop is
         flood-filled away from the frame's border, near-black shadow is
         discarded, and the most common remaining colour bucket wins. Two
         angles of one shoe agree on this even when their hashes do not,
         which is what lets the colour chips merge them.

Both are cached in data/image-signals.json by image URL, so a weekly run only
downloads photos it has never seen. A photo that cannot be read gets no
signals rather than invented ones.
"""
import json
import os
import re
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

from common import BROWSER_HEADERS, atomic_write_json, read_json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE_FILE = os.path.join(ROOT, 'data', 'image-signals.json')
HASH_SIZE = 8                 # 8x9 greyscale -> 64 comparison bits
SAMPLE = 64                   # colour analysis works on a 64x64 thumbnail
CROP = 0.62                   # keep the middle 62%: the shoe, not the margins
BACKGROUND_MIN = 232          # at or above this on every channel is studio white
SHADOW_MAX = 26               # at or below this on every channel is shadow
MIN_COLOUR_PIXELS = 60        # fewer than this and the read is not trustworthy
CONCURRENCY = 6
TIMEOUT = 25


def _pillow():
    try:
        from PIL import Image
        return Image
    except Exception:
        return None


def subject_box(grey):
    """Bounding box of everything that is not studio background."""
    width, height = grey.size
    raw = grey.tobytes()
    left, top, right, bottom = width, height, -1, -1
    for y in range(height):
        row = y * width
        for x in range(width):
            if raw[row + x] < BACKGROUND_MIN:
                left, right = min(left, x), max(right, x)
                top, bottom = min(top, y), max(bottom, y)
    if right < 0 or right - left < 4 or bottom - top < 4:
        return None
    return (left, top, right + 1, bottom + 1)


def dhash(image, size=HASH_SIZE):
    """Row-wise difference hash of the subject, as 16 hex characters.

    Hashing the whole frame does not work for these feeds: SSENSE pads every
    photo onto a tall white canvas (`b_white,c_lpad,ar_2:3`), so most of the
    image is background and unrelated shoes hash alike - a Tennis Classic
    collided with an Air Force 1. Cropping to the subject first is what makes
    the hash about the shoe.
    """
    grey = image.convert('L').resize((96, 96))
    box = subject_box(grey)
    if box:
        grey = grey.crop(box)
    small = grey.resize((size + 1, size))
    pixels = small.tobytes()
    bits = 0
    for row in range(size):
        base = row * (size + 1)
        for col in range(size):
            bits = (bits << 1) | int(pixels[base + col] < pixels[base + col + 1])
    return f'{bits:016x}'


def hamming(a, b):
    if not a or not b or len(a) != len(b):
        return 64
    return bin(int(a, 16) ^ int(b, 16)).count('1')


SATURATED_MIN = 0.22          # below this a pixel reads as black/white/grey
SATURATED_SHARE = 0.07        # a shoe is "a colour" once this much of it is
BORDER = 2                    # the ring of pixels the backdrop is measured from
CANVAS_TOLERANCE = 10         # this close to the measured backdrop is backdrop
CANVAS_MIN_SHARE = 0.45       # below this the border is not a studio backdrop
CANVAS_MAX_SHARE = 0.97       # above this the fill leaked through the subject


def _border_indices(size):
    return [y * size + x for y in range(size) for x in range(size)
            if x < BORDER or y < BORDER or x >= size - BORDER or y >= size - BORDER]


def _is_canvas(pixel, canvas):
    return (abs(pixel[0] - canvas[0]) <= CANVAS_TOLERANCE
            and abs(pixel[1] - canvas[1]) <= CANVAS_TOLERANCE
            and abs(pixel[2] - canvas[2]) <= CANVAS_TOLERANCE)


def canvas_colour(pixels, size):
    """The backdrop this photo was shot on, measured rather than assumed.

    A fixed "anything above 232 is background" cutoff cannot tell a white
    shoe from a white studio sweep, so it threw the shoe away: every one of
    SSENSE's white sneakers came back with no colour at all. The commonest
    colour around the frame's edge is the backdrop by definition; a photo
    whose border is not mostly one colour has no backdrop to remove.
    """
    ring = [pixels[i] for i in _border_indices(size)]
    if not ring:
        return None
    buckets = Counter((p[0] // 8, p[1] // 8, p[2] // 8) for p in ring)
    bucket, hits = buckets.most_common(1)[0]
    if hits / len(ring) < CANVAS_MIN_SHARE:
        return None
    members = [p for p in ring if (p[0] // 8, p[1] // 8, p[2] // 8) == bucket]
    return tuple(sum(m[c] for m in members) // len(members) for c in range(3))


def canvas_mask(pixels, size, canvas):
    """Backdrop reachable from the border without crossing the subject.

    Flood-filling inwards rather than testing each pixel on its own is what
    keeps a white shoe: its lit panels are the same value as the sweep, but
    they are fenced off from the border by the shoe's own outline, so the
    fill never reaches them.
    """
    filled = bytearray(size * size)
    queue = deque()
    for i in _border_indices(size):
        if not filled[i] and _is_canvas(pixels[i], canvas):
            filled[i] = 1
            queue.append(i)
    while queue:
        i = queue.popleft()
        x, y = i % size, i // size
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < size and 0 <= ny < size:
                j = ny * size + nx
                if not filled[j] and _is_canvas(pixels[j], canvas):
                    filled[j] = 1
                    queue.append(j)
    return filled


def dominant_colour(subject):
    """The colour of a set of subject pixels, as #rrggbb, or ''.

    Taking the single most common colour does not work: sneaker photos are
    mostly sole, shadow and neutral panels, so a khaki shoe came back black
    and a red one came back grey. Saturated pixels are therefore counted
    separately, and they win whenever there are enough of them to mean the
    shoe actually has a colour. A genuinely black, white or grey shoe has
    almost none, and falls through to the neutral answer.
    """
    saturated, neutral = Counter(), Counter()
    for r, g, b in subject:
        high, low = max(r, g, b), min(r, g, b)
        saturation = 0 if high == 0 else (high - low) / high
        bucket = (r // 20, g // 20, b // 20)
        if saturation >= SATURATED_MIN:
            saturated[bucket] += 1
        else:
            neutral[bucket] += 1
    pool = saturated if sum(saturated.values()) >= len(subject) * SATURATED_SHARE else neutral
    if not pool:
        pool = saturated or neutral
    if not pool:
        return ''
    bucket, _ = pool.most_common(1)[0]
    # Average the real pixels in the winning bucket instead of its midpoint,
    # so the answer is a colour that is actually in the photo.
    members = [p for p in subject if (p[0] // 20, p[1] // 20, p[2] // 20) == bucket]
    if not members:
        return ''
    return '#%02x%02x%02x' % tuple(sum(m[c] for m in members) // len(members) for c in range(3))


def _centre_crop_subject(pixels, size):
    """The pre-backdrop reading: the middle of the frame, minus white and black.

    Still the right answer for a photo with no studio backdrop - an on-foot
    or lifestyle shot - where there is nothing to flood-fill away and the
    subject really is in the middle.
    """
    margin = int(size * (1 - CROP) / 2)
    return [p for p in (pixels[y * size + x]
                        for y in range(margin, size - margin)
                        for x in range(margin, size - margin))
            if not (p[0] >= BACKGROUND_MIN and p[1] >= BACKGROUND_MIN and p[2] >= BACKGROUND_MIN)
            and not (p[0] <= SHADOW_MAX and p[1] <= SHADOW_MAX and p[2] <= SHADOW_MAX)]


def body_colour(image):
    """Dominant colour of the shoe itself, as #rrggbb, or '' if unreadable.

    The subject is whatever the studio backdrop is not. Cropping to the
    middle of the frame instead - the previous rule - assumed the shoe is
    centred and darker than its background, and SSENSE's photos are neither:
    `b_white,c_lpad,g_south` pads every shot onto a tall white canvas with
    the shoe sitting along the bottom edge, so the centre crop held almost
    nothing but canvas, and on a white sneaker what little it did hold was
    discarded as background too. 136 photos read a hash but no colour; all
    of them read one now, with the colours of the rest left where they were.
    """
    rgb = image.convert('RGB').resize((SAMPLE, SAMPLE))
    raw = rgb.tobytes()
    pixels = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]

    canvas = canvas_colour(pixels, SAMPLE)
    if canvas is None:
        subject = _centre_crop_subject(pixels, SAMPLE)
        return dominant_colour(subject) if len(subject) >= MIN_COLOUR_PIXELS else ''

    filled = canvas_mask(pixels, SAMPLE, canvas)
    if sum(filled) > len(filled) * CANVAS_MAX_SHARE:
        # The fill escaped through a gap in the subject's outline and ate the
        # photo. Nothing is left to measure, so fall back rather than invent.
        subject = _centre_crop_subject(pixels, SAMPLE)
        return dominant_colour(subject) if len(subject) >= MIN_COLOUR_PIXELS else ''

    lit = [p for i, p in enumerate(pixels) if not filled[i]]
    subject = [p for p in lit
               if not (p[0] <= SHADOW_MAX and p[1] <= SHADOW_MAX and p[2] <= SHADOW_MAX)]
    if len(subject) < MIN_COLOUR_PIXELS:
        subject = lit                 # an almost-black shoe is still a shoe
    if len(subject) < MIN_COLOUR_PIXELS:
        return ''
    return dominant_colour(subject)


def read_image(url):
    # Imported here, not at module load: reading a colour off a file on disk
    # needs no HTTP client, and requiring one made `npm run colors` fail on a
    # runner that had installed only Pillow - taking the whole weekly
    # publication down with it.
    from curl_cffi import requests as curl_requests
    try:
        r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=TIMEOUT)
        if r.status_code != 200 or len(r.content) < 512:
            return None, f'http-{r.status_code}'
        Image = _pillow()
        if Image is None:
            return None, 'pillow-missing'
        return Image.open(BytesIO(r.content)), ''
    except Exception as e:
        return None, type(e).__name__


# Bump when the stored signals would come out different for the same photo,
# so a cached entry written by the previous rule is re-read instead of
# outliving it. Version 2: the backdrop is flood-filled rather than assumed
# to be the frame's bright margins.
SIGNALS_VERSION = 2


def _is_current(entry):
    return bool(entry) and entry.get('v') == SIGNALS_VERSION


def signals_for(urls, status=None, budget=None):
    """{url: {'phash': ..., 'body': ...}} for every readable photo.

    Cached by URL, so a weekly run only fetches photos it has not seen - or
    ones whose cached answer predates the current reading rule. A stale entry
    is kept if its re-read fails, so a flaky host costs accuracy, never the
    duplicate-photo merge that already depends on its hash.
    """
    status = status if status is not None else {}
    cache = read_json(CACHE_FILE, {'images': {}})
    known = cache.get('images', {})
    requested = dict.fromkeys(u for u in urls if u)
    fresh = [u for u in requested if u not in known]
    # New photos first: a budget that cannot cover everything should still
    # leave this week's arrivals with signals.
    stale = [u for u in requested if u in known and not _is_current(known[u])]
    wanted = fresh + stale
    if budget is not None:
        wanted = wanted[:budget]
    failures = Counter()

    def load(url):
        image, error = read_image(url)
        if image is None:
            failures[error] += 1
            return url, None
        try:
            return url, {'phash': dhash(image), 'body': body_colour(image), 'v': SIGNALS_VERSION}
        except Exception as e:
            failures[type(e).__name__] += 1
            return url, None

    refreshed = 0
    if wanted:
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            for url, value in pool.map(load, wanted):
                if value is None:
                    known.setdefault(url, {})
                    continue
                refreshed += url in known
                known[url] = value
    cache['images'] = known
    atomic_write_json(CACHE_FILE, cache)
    status.update({'requested': len(wanted), 'new': len(fresh[:budget] if budget else fresh),
                   'rereadForVersion': refreshed,
                   'cached': len(known) - len(wanted),
                   'readable': sum(1 for v in known.values() if v.get('phash')),
                   'stillOnOldVersion': sum(1 for v in known.values() if v and not _is_current(v)),
                   'failures': dict(failures)})
    return {u: v for u, v in known.items() if v.get('phash')}


HEX_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


def colour_distance(a, b):
    """Plain RGB distance; good enough to tell one shoe's two angles from
    two genuinely different colourways."""
    if not (HEX_RE.match(a or '') and HEX_RE.match(b or '')):
        return 999
    ar, ag, ab = int(a[1:3], 16), int(a[3:5], 16), int(a[5:7], 16)
    br, bg, bb = int(b[1:3], 16), int(b[3:5], 16), int(b[5:7], 16)
    return int(((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2) ** 0.5)
