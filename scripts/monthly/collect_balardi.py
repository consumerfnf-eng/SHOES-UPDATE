"""Collect Balardi's women's sneaker arrivals from its own Shopify product feed.

balardi.com is a Shopify storefront, so the collection it asks to be read -
/ko-kr/collections/womens-sneakers - publishes its own products.json: the same
records the storefront renders, with the shop's `created_at`, `published_at`,
`vendor`, `product_type`, variant SKUs and image list. Nothing is scraped off
the rendered page and no key is needed.

Three things about this shop decide how it is read.

Its Korean titles are machine-translated and wrong. "랜빈 라이트 연석 운동화"
is the Lanvin Lite Curb - "연석" is a literal translation of the word "curb",
the kerb of a road. The handle carries the real name
(`lanvin-lite-curb-sneakers-3`), so the name is read from there and the
translated title is kept only as `fullName` for reference.

Its catalogue is far larger than its new arrivals: the collection answers with
thousands of products, most of them created in 2024 and re-published since.
A product re-published years after the shop first listed it is the shop
restocking, not a release, so `created_at` - when this record first existed
here - is what the publication window is measured against, and
`published_at` is carried as the day it last went live. That is the same
reading 29CM gets from `visibleBeginTimestamp`.

Its paging does not end: ?page=40 still answers with a full 250 products.
Pages are therefore read until the ids stop being new, and the run keeps the
newest PAGE_CAP * PAGE_SIZE records by creation date - twenty storefront pages
of its own newest-first view, which is what was asked for.
"""
import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request

from common import (COLOR_WORDS, atomic_write_json, canonical_url, derive_colorway,
                    is_kids_item, kst_now, kst_three_months_ago, short_id)
from footwear_scope import classify

COLLECTION = 'womens-sneakers'
FEED = 'https://balardi.com/ko-kr/collections/{collection}/products.json?limit={limit}&page={page}'
LISTING = 'https://balardi.com/ko-kr/collections/{collection}?sort_by=created-descending'
PRODUCT = 'https://balardi.com/ko-kr/products/{handle}'
# A full page is a large chunked response and reading one cost a MemoryError
# once, but halving it doubles the requests and the shop answers 429 after
# fifty of them - which cost a whole run. Full pages, paced, with the read
# retried: forty requests reads the collection out.
FEED_LIMIT = 250
PAGE_SIZE = 48        # the storefront's own grid
PAGE_CAP = 20         # "1~20페이지까지"
MAX_FEED_PAGES = 60
HEADERS = {'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                         '(KHTML, like Gecko) Chrome/129.0 Safari/537.36',
           'accept': 'application/json'}

# The shop's vendor field as it writes it, against the name the catalogue's
# brand policy uses. Anything not listed here is passed through untouched and
# answered for by the policy itself, which refuses brands it does not carry.
VENDORS = {
    'adidas originals': 'adidas', 'adidas': 'adidas', 'on running': 'On',
    'golden goose deluxe brand': 'Golden Goose', 'maison margiela mm6': 'MM6 Maison Margiela',
    'saint laurent paris': 'Saint Laurent', 'tod\'s': "Tod's", 'hogan': 'Hogan',
    'new balance': 'New Balance', 'nike': 'Nike', 'veja': 'Veja', 'autry': 'Autry',
    'premiata': 'Premiata', 'balenciaga': 'Balenciaga', 'lanvin': 'Lanvin',
}
# Words the handle carries that are not part of the model's name.
HANDLE_NOISE = {'women', 'womens', 'woman', 'ladies', 'men', 'mens', 'unisex', 'copy', 'new'}

# This shop writes a listing two ways. Most handles are the model alone
# (`chloe-nama-sneakers-32`), but a few thousand lead with the colour and the
# material the way SSENSE does (`brown-fabric-and-suede-nama-sneakers`). Read
# as model names those are four different Nama cards; read apart they are one
# card with four chips, which is what the colour and material fields are for.
COLORS = {w.replace('-', ' ') for w in COLOR_WORDS} | {
    'offwhite', 'bone', 'sand', 'stone', 'nude', 'blush', 'chocolate', 'espresso',
    'anthracite', 'graphite', 'platinum', 'bronze', 'copper', 'wine', 'plum',
    'lavender', 'turquoise', 'aqua', 'emerald', 'sage', 'mustard', 'ochre', 'ecru',
    'walnut', 'cognac', 'caramel', 'toffee', 'pewter', 'denim'}
MATERIALS = {'leather', 'suede', 'fabric', 'canvas', 'mesh', 'nylon', 'calfskin',
             'nubuck', 'patent', 'velvet', 'knit', 'shearling', 'satin', 'rubber',
             'wool', 'felt', 'tweed', 'raffia', 'cotton', 'nappa', 'lambskin',
             'crinkled', 'quilted', 'embossed', 'printed', 'perforated'}
# A shade's qualifier only counts as one when a shade follows it.
SHADES = {'antiqued', 'off', 'light', 'dark', 'pale', 'bright', 'deep', 'metallic',
          'washed', 'distressed', 'vintage', 'faded', 'burnt', 'dusty', 'icy', 'neon'}
JOINERS = {'and', '&', 'in', 'with'}


def deaccent(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value or '')
                   if not unicodedata.combining(c))


def split_listing_name(name):
    """(model, colorway, material) - the colour and material come off the front."""
    words = [w for w in re.split(r'\s+', name or '') if w]
    colors, materials = [], []
    while words:
        head = words[0].lower()
        if head in JOINERS and (colors or materials) and len(words) > 1:
            words.pop(0)
            continue
        if head in SHADES and len(words) > 1 and words[1].lower() in COLORS:
            colors.append(f'{words[0]} {words[1]}')
            del words[:2]
            continue
        if head in COLORS:
            colors.append(words.pop(0))
            continue
        if head in MATERIALS:
            materials.append(words.pop(0))
            continue
        break
    model = ' '.join(words).strip()
    if not model:          # a listing that is nothing but colours keeps its name
        return name, '', ''
    return model, ' '.join(colors), ' '.join(materials)


def fetch_json(url, attempts=4):
    last = ''
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.loads(response.read().decode('utf-8')), ''
        except (urllib.error.URLError, ValueError, TimeoutError, MemoryError, OSError) as error:
            last = f'{type(error).__name__}: {error}'
            # Being asked to slow down is not a failure; it is an instruction.
            throttled = getattr(error, 'code', None) in (429, 430, 503)
            time.sleep((8 if throttled else 1.5) * (attempt + 1))
    return None, last or 'unknown-fetch-error'


def canonical_brand(vendor):
    vendor = (vendor or '').strip()
    return VENDORS.get(vendor.lower(), vendor)


def model_name(handle, vendor):
    """The English model name, read out of the handle.

    `lanvin-lite-curb-sneakers-3` with vendor Lanvin reads "Lite Curb
    Sneakers": the brand's own name comes off the front, the duplicate index
    Shopify appends comes off the back, and gender words carry no model
    information.
    """
    words = [w for w in (handle or '').split('-') if w]
    while words and words[-1].isdigit():
        words.pop()
    brand_words = [w for w in deaccent(vendor or '').lower().replace("'", '').split() if w]
    while brand_words and words and deaccent(words[0]).lower().replace("'", '') == brand_words[0]:
        words.pop(0)
        brand_words.pop(0)
    words = [w for w in words if w.lower() not in HANDLE_NOISE]
    return ' '.join(w.upper() if len(w) <= 2 and w.isalpha() else w.capitalize() for w in words)


def style_code(product):
    """The SKU without its size, which is the shop's own code for the design.

    "SKDK0BVESU-A2300-35" is size 35 of SKDK0BVESU-A2300; every size and every
    one of its colour variants shares the stem, which is what the catalogue
    groups a card on.
    """
    for variant in product.get('variants') or []:
        sku = (variant.get('sku') or '').strip()
        if not sku:
            continue
        parts = sku.split('-')
        if len(parts) > 2 and parts[-1].replace('.', '').isdigit():
            parts.pop()
        return '-'.join(parts)
    return ''


def tag_colorway(tags, name):
    """The colour out of the shop's own tags.

    Balardi tags each listing with its colour as a tag of its own - 'White',
    'Beige', 'Black' - among its size, country and discount tags. Every one of
    the first twelve listings checked carried one, which is where the colour
    has to come from for the majority whose handle is the model name alone.
    Some shops write it as 'Color_White', so the tail of an underscored tag is
    read too.
    """
    for tag in tags or []:
        word = str(tag or '').strip()
        candidate = word.split('_')[-1] if '_' in word else word
        if candidate.lower() in COLORS:
            return candidate.title() if candidate.islower() else candidate
    return derive_colorway(name)


def price_label(product):
    for variant in product.get('variants') or []:
        raw = str(variant.get('price') or '').strip()
        if not raw:
            continue
        try:
            won = int(round(float(raw)))
        except ValueError:
            return ''
        return f'{won:,}원' if won > 0 else ''
    return ''


def image_src(product):
    for image in product.get('images') or []:
        src = (image.get('src') or '').split('?')[0]
        if src.startswith('http'):
            return src
    return ''


def build_item(product, checked_at):
    vendor = canonical_brand(product.get('vendor'))
    handle = product.get('handle') or ''
    listed = model_name(handle, product.get('vendor'))
    name, listed_color, listed_material = split_listing_name(listed)
    label = product.get('product_type') or "Women's Sneakers"
    tags = product.get('tags') or []
    if is_kids_item(listed, product.get('title'), label, ' '.join(tags)):
        return None, 'kids'
    kind, types, reason = classify(listed, label)
    if not kind:
        return None, reason
    url = canonical_url(PRODUCT.format(handle=handle))
    image = image_src(product)
    if not url or not image:
        return None, 'no-url-or-image'
    created = (product.get('created_at') or '')
    published = (product.get('published_at') or '')
    return {
        'id': short_id('weekly-balardi', handle or url),
        'source': 'retail-balardi',
        'retailer': 'Balardi',
        'brand': vendor,
        'name': name,
        'fullName': (product.get('title') or '').strip(),
        'listedName': listed,
        'url': url,
        'image': image,
        'priceLabel': price_label(product),
        'gender': 'women',
        'colorway': listed_color or tag_colorway(tags, listed),
        'material': listed_material,
        'style': style_code(product),
        'category': kind,
        'productType': kind,
        'footwearTypes': types,
        'officialCategory': label,
        'listedAt': created,
        'retailerEvidence': {
            'verified': True,
            'retailer': 'Balardi',
            'productUrl': url,
            'listingUrl': LISTING.format(collection=COLLECTION),
            'listingBasis': f'Balardi 여성 스니커즈 최신순 · 등록일 {created[:10]}'
                            + (f' · 게시일 {published[:10]}' if published[:10] != created[:10] else ''),
            'listedAt': created,
            'verifiedAt': checked_at,
            'collectionMethod': 'public-shopify-product-feed',
        },
    }, ''


def collect(checked_at, cutoff_day, status):
    seen_ids, items, dropped = set(), [], {}
    for page in range(1, MAX_FEED_PAGES + 1):
        payload, error = fetch_json(FEED.format(collection=COLLECTION, limit=FEED_LIMIT, page=page))
        if error:
            status['errors'].append({'page': page, 'error': error})
            break
        products = (payload or {}).get('products') or []
        fresh = [p for p in products if p.get('id') not in seen_ids]
        if not fresh:
            break
        status['pages'] = page
        for product in fresh:
            seen_ids.add(product.get('id'))
            status['candidates'] += 1
            item, reason = build_item(product, checked_at)
            if not item:
                dropped[reason] = dropped.get(reason, 0) + 1
                continue
            # The shop restocking a 2024 product is not a new arrival. Its own
            # creation date is the only thing here that cannot be refreshed.
            if item['listedAt'][:10] < cutoff_day:
                status['tooOld'] += 1
                continue
            items.append(item)
        if len(products) < FEED_LIMIT:
            break
        time.sleep(1.2)   # the shop answers 429 when the pages come faster
    status['dropped'] = dropped
    # Newest first, then twenty storefront pages of it.
    items.sort(key=lambda x: x['listedAt'], reverse=True)
    cap = PAGE_SIZE * PAGE_CAP
    status['pageCapHit'] = len(items) > cap
    items = items[:cap]
    status['kept'] = len(items)
    return items


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    now = kst_now()
    checked_at = now.isoformat()
    cutoff_day = kst_three_months_ago(now).strftime('%Y-%m-%d')
    status = {'collection': COLLECTION, 'label': '여성 스니커즈 · 최신순', 'pages': 0,
              'candidates': 0, 'kept': 0, 'tooOld': 0, 'dropped': {}, 'errors': [],
              'pageCapHit': False, 'pageSize': PAGE_SIZE, 'pageCap': PAGE_CAP}
    items = collect(checked_at, cutoff_day, status)
    result = {
        'status': 'ok' if items else ('partial' if status['pages'] else 'unavailable'),
        'checkedAt': checked_at,
        'cutoffDay': cutoff_day,
        'items': items,
        'diagnostics': [status],
    }
    atomic_write_json(args.out, result)
    print(f"Balardi new-arrival collection: {result['status']} - {len(items)} items "
          f"since {cutoff_day} (read {status['candidates']} across {status['pages']} feed pages)",
          file=sys.stderr)


if __name__ == '__main__':
    main()
