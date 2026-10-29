"""Give every official-catalog product the colour of its own photograph.

Why
---
A colour chip is drawn from the first of these the product has: a hex a
reviewer recorded in data/product-presentation.json, a colour word in its
colourway, or the colour read off its photo. Forty-six of the catalog's 288
products have none of the first two - Balenciaga and the other luxury houses
publish a product name and nothing else - so they were drawing the neutral
"no colour known" pattern while a perfectly good photograph of the shoe sat
in public/images/ unread.

This reads it. Every published product's photo is already cached locally and
checksummed by `npm run photos`, so this step needs no network and cannot
disagree with what the page actually shows: it reads exactly the file the
browser will load.

A reviewer's hex always outranks this. `bodyColor` is the fallback the view
reaches for when nothing better was ever stated, never an override.
"""
import json
import os
import re
import sys

# body_colour lives with the retail pipeline's image reading. The colour of a
# shoe in a photograph is the same question in both catalogs, so it is read
# with the same code rather than a second copy of it.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'monthly'))

from image_signals import body_colour  # noqa: E402

CATALOG = os.path.join(ROOT, 'public', 'data', 'catalog.json')
PUBLIC = os.path.join(ROOT, 'public')
CACHED_PATH = re.compile(r'^/images/[a-f0-9]{64}\.(?:jpg|png|webp)$')


def cached_photo(product):
    """The local file `npm run photos` wrote for this product, or ''."""
    path = ((product.get('presentation') or {}).get('cachedPath') or '')
    if not CACHED_PATH.match(path):
        return ''
    local = os.path.join(PUBLIC, path.lstrip('/').replace('/', os.sep))
    return local if os.path.exists(local) else ''


def main():
    try:
        from PIL import Image
    except ImportError:
        print('Pillow is not installed; leaving body colours untouched.')
        return 0

    catalog = json.load(open(CATALOG, encoding='utf-8'))
    read, unreadable, missing, changed = 0, 0, 0, 0
    for product in catalog.get('products', []):
        local = cached_photo(product)
        if not local:
            missing += 1
            # A product whose photo is gone keeps whatever it last read: the
            # alternative is a card that loses its chip for a cache miss.
            continue
        try:
            with Image.open(local) as image:
                colour = body_colour(image)
        except Exception as error:
            unreadable += 1
            print(f'  unreadable: {product.get("id")} ({type(error).__name__})')
            continue
        if not colour:
            unreadable += 1
            continue
        read += 1
        if product.get('bodyColor') != colour:
            product['bodyColor'] = colour
            changed += 1

    with open(CATALOG, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write('\n')

    total = len(catalog.get('products', []))
    print(f'Read the body colour of {read}/{total} official photos '
          f'({changed} changed, {unreadable} unreadable, {missing} not cached).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
