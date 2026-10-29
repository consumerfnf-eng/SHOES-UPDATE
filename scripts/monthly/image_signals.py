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

`body`   The dominant colour of the shoe itself: the frame is cropped to the
         middle, the near-white studio background and near-black shadow are
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
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

from curl_cffi import requests as curl_requests

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


def body_colour(image):
    """Dominant colour of the shoe itself, as #rrggbb, or '' if unreadable.

    Taking the single most common colour does not work: sneaker photos are
    mostly sole, shadow and neutral panels, so a khaki shoe came back black
    and a red one came back grey. Saturated pixels are therefore counted
    separately, and they win whenever there are enough of them to mean the
    shoe actually has a colour. A genuinely black, white or grey shoe has
    almost none, and falls through to the neutral answer.
    """
    rgb = image.convert('RGB').resize((SAMPLE, SAMPLE))
    margin = int(SAMPLE * (1 - CROP) / 2)
    rgb = rgb.crop((margin, margin, SAMPLE - margin, SAMPLE - margin))
    raw = rgb.tobytes()
    pixels = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]
    saturated, neutral = Counter(), Counter()
    subject = 0
    for r, g, b in pixels:
        if r >= BACKGROUND_MIN and g >= BACKGROUND_MIN and b >= BACKGROUND_MIN:
            continue                      # studio background
        if r <= SHADOW_MAX and g <= SHADOW_MAX and b <= SHADOW_MAX:
            continue                      # shadow, not the shoe
        subject += 1
        high, low = max(r, g, b), min(r, g, b)
        saturation = 0 if high == 0 else (high - low) / high
        bucket = (r // 20, g // 20, b // 20)
        if saturation >= SATURATED_MIN:
            saturated[bucket] += 1
        else:
            neutral[bucket] += 1
    if subject < MIN_COLOUR_PIXELS:
        return ''
    pool = saturated if sum(saturated.values()) >= subject * SATURATED_SHARE else neutral
    if not pool:
        pool = saturated or neutral
    if not pool:
        return ''
    # Average the real pixels in the winning bucket instead of its midpoint,
    # so the answer is a colour that is actually in the photo.
    (br, bg, bb), _ = pool.most_common(1)[0]
    members = [(r, g, b) for r, g, b in pixels
               if (r // 20, g // 20, b // 20) == (br, bg, bb)]
    if not members:
        return ''
    r = sum(m[0] for m in members) // len(members)
    g = sum(m[1] for m in members) // len(members)
    b = sum(m[2] for m in members) // len(members)
    return '#%02x%02x%02x' % (r, g, b)


def read_image(url):
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


def signals_for(urls, status=None, budget=None):
    """{url: {'phash': ..., 'body': ...}} for every readable photo.

    Cached by URL, so a weekly run only fetches photos it has not seen.
    """
    status = status if status is not None else {}
    cache = read_json(CACHE_FILE, {'images': {}})
    known = cache.get('images', {})
    wanted = [u for u in dict.fromkeys(urls) if u and u not in known]
    if budget is not None:
        wanted = wanted[:budget]
    failures = Counter()

    def load(url):
        image, error = read_image(url)
        if image is None:
            failures[error] += 1
            return url, None
        try:
            return url, {'phash': dhash(image), 'body': body_colour(image)}
        except Exception as e:
            failures[type(e).__name__] += 1
            return url, None

    if wanted:
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            for url, value in pool.map(load, wanted):
                known[url] = value or {}
    cache['images'] = known
    atomic_write_json(CACHE_FILE, cache)
    status.update({'requested': len(wanted), 'cached': len(known) - len(wanted),
                   'readable': sum(1 for v in known.values() if v.get('phash')),
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
