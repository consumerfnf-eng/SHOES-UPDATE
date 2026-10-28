"""Collect SSENSE's newest sneaker listings.

SSENSE does have a newest-first sort - `?sort=latest-desc` - which this
collector relies on, so "new" here is SSENSE's own ordering rather than a
snapshot delta. Two things about the URL matter and were both confirmed by
hand: the sort only survives on the short category path (`/en-us/women/
sneakers`), because the longer `/en-us/women/shoes/sneakers?sort=...` form
302s to the whole shoes category and starts returning heels, loafers and
flip-flops; and each page carries 120 schema.org Product JSON-LD blocks, so
nothing has to be scraped out of markup.

The `flats` category is walked too, because that is where SSENSE files
ballet and Mary Jane silhouettes, with every title still gated by
footwear_scope.classify so plain flats are dropped.

SSENSE serves this fine to a residential IP but answers 403 to GitHub
Actions' datacenter ranges (confirmed: 1,100 items collected locally, 403 on
every page from CI the same hour), so a hard block escalates to ScrapingBee
when a key is configured. Without a key the 403 stands and is reported.
"""
import argparse
import hashlib
import json
import re
import sys
import time

from curl_cffi import requests as curl_requests

from common import BROWSER_HEADERS, atomic_write_json, canonical_url, derive_colorway, kst_now, short_id
from footwear_scope import classify
from scrapingbee_client import ScrapingBeeClient

CATEGORIES = [
    {'gender': 'men', 'path': 'men/sneakers', 'label': 'sneakers'},
    {'gender': 'women', 'path': 'women/sneakers', 'label': 'sneakers'},
    {'gender': 'women', 'path': 'women/flats', 'label': 'flats'},
]
MAX_PAGES = 16
LDJSON_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


def listing_url(path):
    return f'https://www.ssense.com/en-us/{path}?sort=latest-desc'


def image_url(sku):
    return (f'https://img.ssensemedia.com/image/upload/b_white,c_lpad,g_south,ar_2:3/'
            f'f_auto,c_limit,w_768,q_85/{sku}_1.jpg')


def fetch(url, attempts=3, bee=None):
    last_error = None
    for attempt in range(attempts):
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=30)
            if r.status_code == 200:
                return r.text
            last_error = f'http-{r.status_code}'
            if r.status_code in (401, 403, 407, 429):
                break  # a block will not clear by retrying the same way
        except Exception as e:
            last_error = str(e)
        time.sleep(1.5 * (attempt + 1))
    if bee is not None and bee.has_key:
        try:
            return bee.fetch(url, validate=lambda html: 'application/ld+json' in html)
        except RuntimeError as e:
            raise RuntimeError(f'{last_error}; scrapingbee: {e}')
    raise RuntimeError(last_error or 'unknown-fetch-error')


def parse_products(html):
    out = []
    for block in LDJSON_RE.findall(html):
        try:
            data = json.loads(block)
        except Exception:
            continue
        if data.get('@type') == 'Product':
            out.append(data)
    return out


def collect_category(category, checked_at, bee, diagnostics):
    base = listing_url(category['path'])
    status = {'gender': category['gender'], 'listingUrl': base, 'pages': 0, 'responses': 0,
              'candidates': 0, 'kept': 0, 'dropped': {}, 'errors': []}
    seen_urls = set()
    items = []
    rank = 0
    for page in range(1, MAX_PAGES + 1):
        page_url = base if page == 1 else f'{base}&page={page}'
        try:
            html = fetch(page_url, bee=bee)
            status['responses'] += 1
        except Exception as e:
            status['errors'].append({'url': page_url, 'error': str(e)})
            break
        products = parse_products(html)
        if not products:
            break
        new_this_page = 0
        for product in products:
            url = product.get('url')
            canon = canonical_url(url) if url else ''
            if not canon or canon in seen_urls:
                continue
            seen_urls.add(canon)
            new_this_page += 1
            rank += 1
            status['candidates'] += 1
            name = (product.get('name') or '').strip()
            kind, types, reason = classify(name, category['label'])
            if not kind:
                status['dropped'][reason] = status['dropped'].get(reason, 0) + 1
                continue
            sku = (product.get('sku') or '').strip()
            if not sku:
                status['dropped']['no-sku'] = status['dropped'].get('no-sku', 0) + 1
                continue
            brand = ((product.get('brand') or {}).get('name') or '').strip()
            offers = product.get('offers') or {}
            price = offers.get('price')
            currency = offers.get('priceCurrency') or ''
            colorway = derive_colorway(name)
            content_hash = hashlib.sha256(json.dumps(product, sort_keys=True).encode('utf-8')).hexdigest()
            items.append({
                'id': short_id('weekly-ssense', brand, canon),
                'source': 'retail-ssense',
                'retailer': 'SSENSE',
                'gender': category['gender'],
                'brand': brand,
                'name': name[len(colorway):].strip() if colorway else name,
                'fullName': name,
                'url': url,
                'image': image_url(sku),
                'sku': sku,
                'style': sku,
                'colorway': colorway,
                'priceLabel': (f'{currency} {price}'.strip() if price is not None else ''),
                'category': kind,
                'productType': kind,
                'footwearTypes': types,
                'officialCategory': category['label'],
                'retailerEvidence': {
                    'verified': True,
                    'retailer': 'SSENSE',
                    'productUrl': url,
                    'listingUrl': page_url,
                    'listingBasis': f"SSENSE {category['path']} · 최신순(sort=latest-desc) {rank}번째",
                    'verifiedAt': checked_at,
                    'contentHash': content_hash,
                    'sku': sku,
                    'collectionMethod': 'listing-jsonld',
                },
            })
            status['kept'] += 1
        status['pages'] = page
        if new_this_page == 0:
            break
        time.sleep(1.5)
    diagnostics.append(status)
    return items


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    checked_at = kst_now().isoformat()
    bee = ScrapingBeeClient()
    diagnostics = []
    items, seen = [], set()
    for category in CATEGORIES:
        try:
            collected = collect_category(category, checked_at, bee, diagnostics)
        except Exception as e:
            diagnostics.append({'gender': category['gender'], 'listingUrl': listing_url(category['path']),
                                'errors': [{'error': str(e)}]})
            continue
        for item in collected:
            if item['url'] in seen:
                continue
            seen.add(item['url'])
            items.append(item)

    responded = any(d.get('responses') for d in diagnostics)
    result = {
        'status': 'ok' if responded and items else ('partial' if responded else 'unavailable'),
        'checkedAt': checked_at,
        'items': items,
        'scrapingBeeCreditsUsed': bee.credits_used,
        'diagnostics': diagnostics,
    }
    atomic_write_json(args.out, result)
    print(f"SSENSE collection: {result['status']} - {len(items)} items across "
          f"{sum(d.get('pages', 0) for d in diagnostics)} pages", file=sys.stderr)


if __name__ == '__main__':
    main()
