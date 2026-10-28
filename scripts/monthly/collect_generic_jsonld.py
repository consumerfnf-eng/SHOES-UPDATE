"""Generic schema.org JSON-LD Product collector for retailers reachable only
through ScrapingBee (Farfetch, Mytheresa - both block curl_cffi and every
Playwright mode tried by hand this session). Unlike collect_ssense.py, this
was NOT built against a real observed page: every direct attempt to view
Farfetch/Mytheresa was blocked before any content came through, so there is
nothing to read selectors off of. schema.org Product JSON-LD is a widely
used, standardized pattern (confirmed working this way for SSENSE and, in
an earlier session, Moncler) - trying it generically is a legitimate first
attempt, not a guess at site-specific markup. If a page has no JSON-LD
Product blocks, that source is honestly reported unavailable; this never
falls back to scraping arbitrary HTML it hasn't verified the shape of.
"""
import argparse
import json
import re
import sys
import time

from common import atomic_write_json, is_kids_item, is_sneaker_title, kst_now
from scrapingbee_client import ScrapingBeeClient

LDJSON_RE = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S)

SOURCES = [
    {'id': 'retail-farfetch', 'label': 'Farfetch', 'gender': 'men',
     'listingUrl': 'https://www.farfetch.com/shopping/men/shoes-2/items.aspx?category=137174', 'maxPages': 4},
    {'id': 'retail-mytheresa', 'label': 'Mytheresa', 'gender': 'women',
     'listingUrl': 'https://www.mytheresa.com/us/en/women/shoes/sneakers', 'maxPages': 4},
]


def extract_products(html):
    out = []
    for block in LDJSON_RE.findall(html):
        try:
            data = json.loads(block)
        except Exception:
            continue
        candidates = data if isinstance(data, list) else [data]
        for node in candidates:
            if not isinstance(node, dict):
                continue
            graph = node.get('@graph') if isinstance(node.get('@graph'), list) else [node]
            for item in graph:
                if isinstance(item, dict) and item.get('@type') in ('Product', ['Product']):
                    out.append(item)
    return out


def to_item(product, source):
    name = (product.get('name') or '').strip()
    if not name:
        return None
    brand = product.get('brand')
    brand_name = brand.get('name') if isinstance(brand, dict) else (brand if isinstance(brand, str) else '')
    image = product.get('image')
    if isinstance(image, list):
        image = image[0] if image else ''
    if isinstance(image, dict):
        image = image.get('url', '')
    offers = product.get('offers')
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    offers = offers if isinstance(offers, dict) else {}
    price, currency = offers.get('price'), offers.get('priceCurrency', '')
    url = product.get('url') or offers.get('url') or ''
    sku = product.get('sku') or product.get('productID') or ''
    if not url or not image:
        return None
    return {
        'brand': brand_name or name.split()[0],
        'name': name,
        'image': image,
        'url': url,
        'sku': sku,
        'priceLabel': f'{currency} {price}'.strip() if price else '',
        'gender': source['gender'],
        'source': source['id'],
        'retailerEvidence': {'verified': True, 'retailer': source['label'], 'productUrl': url,
                              'listingUrl': source['listingUrl'], 'verifiedAt': kst_now().isoformat(),
                              'collectionMethod': 'scrapingbee-jsonld'},
    }


def collect_source(source, client, diagnostics):
    items, seen = [], set()
    status = {'source': source['id'], 'pages': 0, 'responses': 0, 'products': 0, 'errors': []}
    for page in range(1, source['maxPages'] + 1):
        sep = '&' if '?' in source['listingUrl'] else '?'
        page_url = source['listingUrl'] if page == 1 else f"{source['listingUrl']}{sep}page={page}"
        try:
            html = client.fetch(page_url, validate=lambda h: 'application/ld+json' in h)
            status['responses'] += 1
        except RuntimeError as e:
            status['errors'].append({'url': page_url, 'error': str(e)})
            if 'QUOTA' in str(e) or 'NO_KEY' in str(e) or 'BUDGET' in str(e):
                break
            continue
        products = extract_products(html)
        if not products:
            status['errors'].append({'url': page_url, 'error': 'NO_JSONLD_PRODUCTS_FOUND'})
            break
        new_this_page = 0
        for p in products:
            item = to_item(p, source)
            if not item or item['url'] in seen:
                continue
            seen.add(item['url'])
            new_this_page += 1
            if not is_sneaker_title(item['name']) or is_kids_item(item['name'], item['url']):
                continue
            items.append(item)
            status['products'] += 1
        status['pages'] = page
        if new_this_page == 0:
            break
        time.sleep(1.0)
    diagnostics.append(status)
    return items


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    client = ScrapingBeeClient()
    checked_at = kst_now().isoformat()
    diagnostics, items = [], []

    if not client.has_key:
        atomic_write_json(args.out, {'status': 'requires_key', 'checkedAt': checked_at, 'items': [],
                                      'diagnostics': [{'error': 'SCRAPINGBEE_API_KEY not set'}]})
        print('Farfetch/Mytheresa (ScrapingBee JSON-LD) collection: requires_key', file=sys.stderr)
        return

    for source in SOURCES:
        items.extend(collect_source(source, client, diagnostics))

    result = {'status': 'ok' if items else 'unavailable', 'checkedAt': checked_at,
              'items': items, 'diagnostics': diagnostics, 'scrapingBeeCreditsUsed': client.credits_used}
    atomic_write_json(args.out, result)
    print(f"Farfetch/Mytheresa (ScrapingBee JSON-LD) collection: {result['status']} - "
          f"{len(items)} items, {client.credits_used} credits used", file=sys.stderr)


if __name__ == '__main__':
    main()
