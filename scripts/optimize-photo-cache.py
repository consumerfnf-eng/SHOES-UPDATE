"""Optimize newly downloaded photos for publication; retain original bytes privately."""
import concurrent.futures
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / 'public' / 'images'
BACKUP = ROOT / 'logs' / 'backups' / 'original-product-photos'

def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + '.optimize.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, path)

def optimize(relative):
    source = (ROOT / relative).resolve()
    if source.parent != IMAGES.resolve() or source.stat().st_size < 250_000:
        return None
    original = source.read_bytes()
    with Image.open(io.BytesIO(original)) as opened:
        picture = ImageOps.exif_transpose(opened)
        picture.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        picture = picture.convert('RGBA' if 'A' in picture.getbands() else 'RGB')
        buffer = io.BytesIO()
        picture.save(buffer, format='WEBP', quality=84, method=4)
    encoded = buffer.getvalue()
    if len(encoded) >= len(original):
        return None
    digest = hashlib.sha256(encoded).hexdigest()
    target = IMAGES / (digest + '.webp')
    target.write_bytes(encoded)
    BACKUP.mkdir(parents=True, exist_ok=True)
    os.replace(source, BACKUP / source.name)
    return ('/images/' + source.name, '/images/' + target.name, digest, len(original), len(encoded))

if __name__ == '__main__':
    # Only untracked downloads from this collection; existing published assets remain valid.
    paths = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', 'public/images'], cwd=ROOT, text=True).splitlines()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        changes = [result for result in executor.map(optimize, paths) if result]
    mapping = {old: (new, digest) for old, new, digest, _, _ in changes}
    cache_file = ROOT / 'data' / 'photo-cache.json'
    cache = json.loads(cache_file.read_text(encoding='utf-8'))
    for entry in cache['images'].values():
        if entry.get('path') in mapping:
            old = entry['path']
            entry['path'], entry['sha256'] = mapping[old]
            entry['transform'] = {'format': 'webp', 'maxEdge': 1280, 'quality': 84, 'originalSha256': Path(old).stem}
    atomic_json(cache_file, cache)
    catalog_file = ROOT / 'public' / 'data' / 'catalog.json'
    catalog = json.loads(catalog_file.read_text(encoding='utf-8'))
    for product in catalog['products']:
        presentation = product.get('presentation') or {}
        if presentation.get('cachedPath') in mapping:
            presentation['cachedPath'] = mapping[presentation['cachedPath']][0]
    atomic_json(catalog_file, catalog)
    print(json.dumps({'optimized': len(changes), 'originalMB': round(sum(r[3] for r in changes)/1048576), 'publishedMB': round(sum(r[4] for r in changes)/1048576)}))
