"""Content-addressed card renditions; original photos and export assets stay intact."""
import hashlib
import io
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image, ImageOps

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


def build():
    catalog_file = PUBLIC / 'data/catalog.json'
    monthly_file = PUBLIC / 'data/monthly-catalog.json'
    catalog = json.loads(catalog_file.read_text(encoding='utf-8'))
    monthly = json.loads(monthly_file.read_text(encoding='utf-8'))
    cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {'version': 1, 'images': {}}
    jobs = {}
    bindings = []
    for p in catalog['products'] + monthly.get('retail', []):
        presentation = p.get('presentation') or {}
        path = presentation.get('cachedPath', '')
        if not PHOTO.fullmatch(path):
            continue
        frame = presentation.get('frame')
        key = hashlib.sha256(json.dumps([1, path, frame], sort_keys=True).encode()).hexdigest()
        jobs[key] = (path, frame)
        bindings.append((presentation, key))

    def work(pair):
        key, (path, frame) = pair
        source = PUBLIC / path.lstrip('/')
        # Already-small source assets need no second download or re-encoding.
        # Reusing their immutable path also avoids doubling the Pages file count.
        if not frame and source.stat().st_size <= 60_000:
            with Image.open(source) as opened:
                if opened.width <= 800 and opened.height <= 1000:
                    return key, {'path': path, 'width': opened.width, 'height': opened.height}, 0, 0
        known = cache['images'].get(key)
        if known and PHOTO.fullmatch(known.get('path', '')) and (PUBLIC / known['path'].lstrip('/')).exists():
            return key, known, 0, 0
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert('RGBA')
            box = framed_box(image.size, frame)
            if box:
                image = image.crop(box)
            canvas = Image.new('RGBA', image.size, 'white')
            canvas.alpha_composite(image)
            image = canvas.convert('RGB')
            image.thumbnail((800, 1000), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, 'WEBP', quality=83, method=4)
            encoded = buffer.getvalue()
            target = '/images/' + hashlib.sha256(encoded).hexdigest() + '.webp'
            (PUBLIC / target.lstrip('/')).write_bytes(encoded)
            return key, {'path': target, 'width': image.width, 'height': image.height}, source.stat().st_size, len(encoded)

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
