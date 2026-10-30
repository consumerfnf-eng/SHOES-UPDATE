# -*- coding: utf-8 -*-
"""Turn a WGSN catwalk collection into cards this site can show.

Why
---
The runway board published only counts and links. A board of numbers is not
how anyone reads a season: the card is the photograph, with the brand, the
season and the city under it, exactly as WGSN captions it.

What this writes
----------------
  public/catwalk/<id>.webp     a web-sized rendition of each photograph.
  public/data/catwalk.json     one card per photograph.

The originals are 2,000px+ on the long edge and 5.8 GB together, which is not
something to put on a page or in a repository. Each is resized once to 480px
wide - crisp on a 2x display at the card's own size - which is about 12 KB of
WebP, 45 MB for the set.

The city
--------
WGSN captions a look "Brand / Spring/Summer 2027 / City", but the collection
record does not carry the city, so it is resolved from the October rename
records that do, in this order:

  1. the photograph's own SHA-256 appears in that record - the same file, so
     the same city. 726 of 3,648.
  2. every photograph of that brand in the record agrees on one city. 33 of
     the 34 brands.
  3. neither - Roksanda is not in the record at all, and Pronounce (Milan and
     Shanghai) and Ralph Lauren (New York and Milan) showed in two cities, so
     a photograph of theirs that rule 1 did not match has no city. The card
     then shows the brand and the season and no city, rather than the more
     likely of two guesses.
"""
import argparse
import collections
import io
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PUBLIC = os.path.join(ROOT, 'public')
OUT_IMAGES = os.path.join(PUBLIC, 'catwalk')
OUT_DATA = os.path.join(PUBLIC, 'data', 'catwalk.json')
CONFIG = os.path.join(ROOT, 'config', 'wgsn-runway.json')

CARD_WIDTH = 480
WEBP_QUALITY = 80


def read_json(path, fallback=None):
    try:
        with io.open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        if fallback is None:
            raise
        return fallback


def city_index(records):
    """({sha256: city}, {brand_key: city}) from the rename records.

    A brand maps to a city only when every record of that brand agrees. Two
    cities means the brand showed twice and the brand alone cannot say which
    look is which.
    """
    by_sha, by_brand = {}, collections.defaultdict(collections.Counter)
    for row in records:
        brand, city, sha = (row.get('brand') or '').strip(), row.get('city'), row.get('sha256')
        if not city:
            continue
        if sha:
            by_sha[sha] = city
        if brand:
            by_brand[brand.lower()][city] += 1
    agreed = {brand: next(iter(counts)) for brand, counts in by_brand.items() if len(counts) == 1}
    return by_sha, agreed


def resolve_city(image, by_sha, by_brand):
    sha = image.get('sha256')
    if sha and sha in by_sha:
        return by_sha[sha], 'same-file'
    brand = (image.get('brand') or '').strip().lower()
    if brand in by_brand:
        return by_brand[brand], 'brand-showed-in-one-city'
    return '', ''


def card_id(image):
    """The photograph's own SHA-256, shortened - stable across rebuilds."""
    return (image.get('sha256') or '')[:16]


def render(source_root, image, force=False):
    """Write the card-sized rendition; returns (path, width, height) or None."""
    from PIL import Image
    relative = (image.get('file') or '').replace('\\', os.sep).replace('/', os.sep)
    local = os.path.join(source_root, relative)
    if not os.path.exists(local):
        return None
    name = f'{card_id(image)}.webp'
    out = os.path.join(OUT_IMAGES, name)
    if os.path.exists(out) and not force:
        with Image.open(out) as done:
            return f'/catwalk/{name}', done.width, done.height
    with Image.open(local) as original:
        card = original.convert('RGB')
        card.thumbnail((CARD_WIDTH, CARD_WIDTH * 4), Image.LANCZOS)
        card.save(out, 'WEBP', quality=WEBP_QUALITY, method=6)
        return f'/catwalk/{name}', card.width, card.height


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', help="the collection folder (the one holding 브랜드/WOMEN/*.jpg)")
    parser.add_argument('--record', help="the collection's own 저장목록.json; "
                                         'default <source>/_수집기록/저장목록.json')
    parser.add_argument('--cities', action='append', default=[],
                        help='a rename record carrying brand/city/sha256; repeatable')
    parser.add_argument('--force', action='store_true', help='re-render photos already rendered')
    args = parser.parse_args()

    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print('Pillow is not installed; cannot render the cards.')
        return 2

    source_root = os.path.abspath(args.source)
    record = args.record or os.path.join(source_root, '_수집기록', '저장목록.json')
    images = read_json(record)
    if not isinstance(images, list):
        print(f'{record} is not a list of images.')
        return 2

    cities = args.cities or [os.path.join(source_root, '_수집기록',
                                          '27ss_폴더별_연속번호_20261023_130601.json')]
    records = []
    for path in cities:
        rows = read_json(path, [])
        records.extend(rows if isinstance(rows, list) else [])
    by_sha, by_brand = city_index(records)

    config = read_json(CONFIG)
    season_id = next(iter(config['filters']['seasons']))
    season = config['filters']['seasons'][season_id]

    def shelf_of(image):
        try:
            import urllib.parse
            raw = urllib.parse.parse_qs(urllib.parse.urlparse(image['source']).query)['filters'][0]
            filters = json.loads(raw)
        except Exception:
            return None
        for shelf in config['shelves']:
            if all(filters.get(field) == values for field, values in shelf['filters'].items()):
                return shelf['id']
        return None

    def shelf_url(shelf):
        import urllib.parse
        return (config['searchEndpoint'] + '?filters='
                + urllib.parse.quote(json.dumps(shelf['filters'], separators=(',', ':'))))

    os.makedirs(OUT_IMAGES, exist_ok=True)
    looks, skipped, counts = [], 0, collections.Counter()
    for index, image in enumerate(images, 1):
        if image.get('provider') != config['provider'] or not card_id(image):
            skipped += 1
            continue
        rendered = render(source_root, image, force=args.force)
        if not rendered:
            skipped += 1
            continue
        path, width, height = rendered
        city, evidence = resolve_city(image, by_sha, by_brand)
        counts[city or '(미확인)'] += 1
        looks.append({
            'id': card_id(image), 'brand': image.get('brand') or '', 'season': image.get('season') or season,
            'city': city, 'cityEvidence': evidence,
            'market': image.get('category') or '', 'imageType': image.get('image_type') or '',
            'shelf': shelf_of(image) or '',
            'image': path, 'width': width, 'height': height,
        })
        if index % 250 == 0:
            print(f'  {index}/{len(images)} rendered', flush=True)

    looks.sort(key=lambda look: (look['brand'].lower(), look['imageType'], look['id']))
    payload = {
        'schemaVersion': 1, 'provider': config['provider'], 'season': season, 'seasonId': season_id,
        'builtAt': __import__('datetime').datetime.now().astimezone().isoformat(),
        'licence': config['licence'],
        'cardWidth': CARD_WIDTH,
        # The search URL belongs to the shelf, not to each look: the Details
        # filter names all 35 brand ids and is 700 bytes, which repeated over
        # 1,991 looks was 1.4 MB of one identical string.
        'shelves': [{'id': s['id'], 'label': s['label'], 'footwearShelf': bool(s.get('footwearShelf')),
                     'searchUrl': shelf_url(s)}
                    for s in config['shelves']],
        'looks': looks,
    }
    with io.open(OUT_DATA, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')

    brands = len({look['brand'] for look in looks})
    print(f'{len(looks)} catwalk cards from {brands} shows ({skipped} skipped). '
          f'Cities: {dict(counts.most_common())}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
