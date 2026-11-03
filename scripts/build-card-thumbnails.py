"""Content-addressed card renditions; original photos and export assets stay intact."""
import hashlib
import io
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image, ImageOps, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
CACHE = ROOT / 'data/card-thumbnails.json'
PHOTO = re.compile(r'^/images/[a-f0-9]{64}\.(?:jpg|png|webp)$')


def framed_box(size, frame):
    """Use the reviewed normalized bounds, including their safety margin."""
    if not frame:
        return None
    w, h = size
    x, y, width, height = (frame.get(k) for k in ('x', 'y', 'width', 'height'))
    if not all(isinstance(v, (int, float)) for v in (x, y, width, height)) or width <= 0 or height <= 0:
        return None
    return (max(0, int(x*w)), max(0, int(y*h)), min(w, int((x+width)*w+1)), min(h, int((y+height)*h+1)))


def studio_box(image):
    """Trim a uniform light studio background, keeping a generous shoe margin.

    Only used for SSENSE studio assets. Ambiguous backgrounds and objects
    touching an edge keep that edge; manual reviewed bounds win.
    """
    small = image.copy()
    small.thumbnail((400, 500))
    w, h = small.size
    corners = [small.crop((x, y, x+5, y+5)) for x, y in ((0, 0), (w-5, 0), (0, h-5), (w-5, h-5))]
    means = [ImageStat.Stat(c).mean[:3] for c in corners]
    if any(min(c) < 225 or max(c)-min(c) > 12 for c in means):
        return None
    bg = tuple(round(sum(c[i] for c in means)/4) for i in range(3))
    diff = ImageChops.difference(small.convert('RGB'), Image.new('RGB', small.size, bg))
    mask = diff.convert('L').point(lambda v: 255 if v > 10 else 0)
    box = mask.getbbox()
    if not box:
        return None
    x0, y0, x1, y1 = box
    if y0 < 5 or (x1-x0)*(y1-y0) < w*h*0.035:
        return None
    pad = max(12, round(max(x1-x0, y1-y0)*0.10))
    sx, sy = image.width/w, image.height/h
    return (max(0, int((x0-pad)*sx)), max(0, int((y0-pad)*sy)), min(image.width, int((x1+pad)*sx)), min(image.height, int((y1+pad)*sy)))


def build():
    catalog_file = PUBLIC / 'data/catalog.json'
    monthly_file = PUBLIC / 'data/monthly-catalog.json'
    catalog = json.loads(catalog_file.read_text(encoding='utf-8'))
    monthly = json.loads(monthly_file.read_text(encoding='utf-8'))
    cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {'version': 2, 'images': {}}
    jobs = {}
    bindings = []
    for p in catalog['products'] + monthly.get('retail', []):
        presentation = p.get('presentation') or {}
        path = presentation.get('cachedPath', '')
        if not PHOTO.fullmatch(path):
            continue
        frame = presentation.get('frame')
        studio = not frame and ('ssense' in str(p.get('image', '')) or p.get('source') == 'retail-ssense')
        key = hashlib.sha256(json.dumps([4 if studio else 2, path, frame], sort_keys=True).encode()).hexdigest()
        jobs[key] = (path, frame, studio)
        bindings.append((presentation, key))

    def work(pair):
        key, (path, frame, studio) = pair
        source = PUBLIC / path.lstrip('/')
        # Already-small source assets need no second download or re-encoding.
        # Reusing their immutable path also avoids doubling the Pages file count.
        if not frame and not studio and source.stat().st_size <= 18_000:
            with Image.open(source) as opened:
                if opened.width <= 512 and opened.height <= 640:
                    return key, {'path': path, 'width': opened.width, 'height': opened.height}, 0, 0
        known = cache['images'].get(key)
        if known and PHOTO.fullmatch(known.get('path', '')) and (PUBLIC / known['path'].lstrip('/')).exists():
            return key, known, 0, 0
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert('RGBA')
            canvas = Image.new('RGBA', image.size, 'white')
            canvas.alpha_composite(image)
            image = canvas.convert('RGB')
            box = framed_box(image.size, frame) or (studio_box(image) if studio else None)
            if box:
                image = image.crop(box)
            image.thumbnail((512, 640), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, 'WEBP', quality=78, method=4)
            encoded = buffer.getvalue()
            target = '/images/' + hashlib.sha256(encoded).hexdigest() + '.webp'
            (PUBLIC / target.lstrip('/')).write_bytes(encoded)
            return key, {'path': target, 'width': image.width, 'height': image.height, **({'cropped': True} if box else {})}, source.stat().st_size, len(encoded)

    original = rendered = generated = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for key, result, before, after in pool.map(work, jobs.items()):
            cache['images'][key] = result
            original += before
            rendered += after
            generated += int(before > 0)
    for presentation, key in bindings:
        presentation['thumbnail'] = cache['images'][key]
    CACHE.write_text(json.dumps(cache, separators=(',', ':'))+'\n', encoding='utf-8')
    catalog_file.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    monthly_file.write_text(json.dumps(monthly, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    print(f'Card renditions: {len(jobs)} current, {generated} generated; original {original:,} bytes, cards {rendered:,} bytes', flush=True)


if __name__ == '__main__':
    build()
