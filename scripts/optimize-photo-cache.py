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
ALREADY_OPTIMIZED = set()

def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + '.optimize.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, path)

def optimize(relative):
    source = (ROOT / relative).resolve()
    if source.parent != IMAGES.resolve() or '/images/' + source.name in ALREADY_OPTIMIZED or source.stat().st_size < 250_000:
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
    cache_file = ROOT / 'data' / 'photo-cache.json'
    cache = json.loads(cache_file.read_text(encoding='utf-8'))
    ALREADY_OPTIMIZED = {entry['path'] for entry in cache['images'].values() if entry.get('transform')}
    # Only untracked downloads from this collection; existing published assets remain valid.
    paths = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', 'public/images'], cwd=ROOT, text=True).splitlines()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        changes = [result for result in executor.map(optimize, paths) if result]
    mapping = {old: (new, digest) for old, new, digest, _, _ in changes}
    cache.setdefault('optimizedPaths', {}).update({old: {'path': new, 'sha256': digest} for old, (new, digest) in mapping.items()})
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
    def replace_paths(value):
        if isinstance(value, str):
            return mapping.get(value, (value, None))[0]
        if isinstance(value, list):
            return [replace_paths(v) for v in value]
        if isinstance(value, dict):
            return {k: replace_paths(v) for k, v in value.items()}
        return value
    for relative in ['public/data/monthly-catalog.json', 'data/product-photo-analysis.json', 'data/product-photo-reviews.json']:
        target = ROOT / relative
        if target.exists():
            atomic_json(target, replace_paths(json.loads(target.read_text(encoding='utf-8'))))
    print(json.dumps({'optimized': len(changes), 'originalMB': round(sum(r[3] for r in changes)/1048576), 'publishedMB': round(sum(r[4] for r in changes)/1048576)}))
