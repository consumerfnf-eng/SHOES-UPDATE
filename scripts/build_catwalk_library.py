# -*- coding: utf-8 -*-
"""Build the CATWALK cards from a WGSN image-library saved search.

Why this and not build_catwalk.py
---------------------------------
build_catwalk.py reads the October *catwalks* collection: whole collections,
where 1,565 of 3,648 images are head-to-toe looks carrying the shoe at a few
hundred pixels, and where the city had to be reconstructed from rename records
because the collection log never carried one.

This reads the search that was actually wanted - WGSN's Fashion Design image
library narrowed to footwear tags, season Spring/Summer 2027 - where every
result is a shoe shot on its own and the record carries WGSN's own caption:
["Agnes B", "Spring/Summer 2027", "Paris"]. Brand, season and city are taken
from it, so none of the three is inferred.

Where the pictures come from
----------------------------
WGSN serves the 2,574px original only to a signed-in session; the anonymous
response for that same URL is a 508px rendition. So the high-resolution fetch
happens in the browser, which downsizes each original to 1,400px before handing
it over - see docs/wgsn-runway-automation.md. This script indexes what arrived:
it does not download anything itself.

Each card also keeps the WGSN original's URL, so the viewer - who has to be a
subscriber to be looking at this at all - can open the full 2,574px file.

One shoe, one card: a perceptual hash collapses several frames of one look,
within a brand only, the same rule build_catwalk.py uses.
"""
import argparse
import collections
import io
import json
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PUBLIC = os.path.join(ROOT, 'public')
OUT_IMAGES = os.path.join(PUBLIC, 'catwalk')
OUT_DATA = os.path.join(PUBLIC, 'data', 'catwalk.json')
CONFIG = os.path.join(ROOT, 'config', 'wgsn-runway.json')

sys.path.insert(0, os.path.join(ROOT, 'scripts', 'monthly'))
SAME_LOOK = 6


def read_json(path):
    with io.open(path, encoding='utf-8') as f:
        return json.load(f)


def _hamming(a, b):
    if not a or not b or len(a) != len(b):
        return 99
    return bin(int(a, 16) ^ int(b, 16)).count('1')


def original_url(row):
    """The WGSN original for this record, from the rendition URL it carries."""
    url = str(row.get('large') or row.get('detail') or '')
    for rendition in ('/large_', '/media_', '/thumb_'):
        if rendition in url:
            return url.replace(rendition, '/original_')
    return url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('records', help='the JSON array collected from the library search')
    parser.add_argument('images', help='folder of <id>.jpg handed over by the browser')
    parser.add_argument('--season', default='Spring/Summer 2027')
    parser.add_argument('--keep-every-frame', action='store_true')
    parser.add_argument('--fresh', action='store_true',
                        help='clear public/catwalk first - use when replacing a previous collection')
    args = parser.parse_args()

    from PIL import Image
    from image_signals import dhash

    rows = [r for r in read_json(args.records)
            if not args.season or r.get('season') == args.season]
    print(f'{len(rows)} records for {args.season or "every season"}')

    if args.fresh and os.path.isdir(OUT_IMAGES):
        shutil.rmtree(OUT_IMAGES)
    os.makedirs(OUT_IMAGES, exist_ok=True)

    looks, missing = [], []
    for row in rows:
        card_id = str(row.get('id') or '')
        source = os.path.join(args.images, f'{card_id}.jpg')
        if not os.path.exists(source):
            missing.append(row.get('name'))
            continue
        target = os.path.join(OUT_IMAGES, f'{card_id}.jpg')
        if not os.path.exists(target) or os.path.getsize(target) != os.path.getsize(source):
            shutil.copyfile(source, target)
        try:
            with Image.open(target) as im:
                width, height, phash = im.width, im.height, dhash(im)
        except Exception as error:
            missing.append(f"{row.get('name')} ({type(error).__name__})")
            continue
        looks.append({
            'id': card_id, 'brand': row.get('brand') or '', 'season': row.get('season') or '',
            'city': row.get('city') or '', 'cityEvidence': 'wgsn-caption',
            'imageType': '신발 클로즈업', 'shelf': 'library-footwear',
            'image': f'/catwalk/{card_id}.jpg', 'width': width, 'height': height,
            'originalUrl': original_url(row),
            'originalWidth': row.get('width') or 0, 'originalHeight': row.get('height') or 0,
            'phash': phash,
        })

    looks.sort(key=lambda l: (l['brand'].lower(), l['id']))
    collapsed = 0
    if not args.keep_every_frame:
        kept, by_brand = [], collections.defaultdict(list)
        for look in looks:
            twin = next((k for k in by_brand[look['brand']]
                         if _hamming(k['phash'], look['phash']) <= SAME_LOOK), None)
            if twin is None:
                by_brand[look['brand']].append(look)
                kept.append(look)
            else:
                twin.setdefault('alsoShotAs', []).append(look['id'])
                collapsed += 1
        # A collapsed frame's file is no longer referenced by any card.
        referenced = {l['id'] for l in kept}
        for look in looks:
            if look['id'] not in referenced:
                try: os.remove(os.path.join(OUT_IMAGES, f"{look['id']}.jpg"))
                except OSError: pass
        looks = kept
    for look in looks:
        look.pop('phash', None)

    config = read_json(CONFIG)
    library = config.get('librarySearch', {})
    payload = {
        'schemaVersion': 1, 'provider': 'WGSN', 'season': args.season,
        'seasonId': next(iter(config['filters']['seasons'])),
        'builtAt': __import__('datetime').datetime.now().astimezone().isoformat(),
        'licence': config['licence'], 'cardWidth': 480,
        'source': {'kind': 'image-library-saved-search', 'url': library.get('url', ''),
                   'tagCount': len(library.get('tags') or []),
                   'note': "Every result is a shoe photographed on its own; brand, season and "
                           "city are WGSN's own caption."},
        'shelves': [{'id': 'library-footwear', 'label': '신발 클로즈업',
                     'footwearShelf': True, 'searchUrl': library.get('url', '')}],
        'looks': looks,
    }
    with io.open(OUT_DATA, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')

    cities = collections.Counter(l['city'] or '(미확인)' for l in looks)
    widths = sorted({l['width'] for l in looks})
    print(f"\n{len(looks)} cards from {len({l['brand'] for l in looks})} shows "
          f"({collapsed} further frames of one look collapsed, {len(missing)} missing). "
          f"Cities: {dict(cities.most_common())}")
    print(f"  card widths: {widths[:4]}{'...' if len(widths) > 4 else ''}")
    for name in missing[:10]:
        print(f'   missing: {name}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
