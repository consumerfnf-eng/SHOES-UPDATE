"""Generic schema.org JSON-LD Product collector for the retailers that are
reachable only through ScrapingBee: Farfetch, Mytheresa and Net-a-Porter.

All three were re-checked directly this session and all three are shut:
Farfetch 403, Net-a-Porter 403 behind Akamai, and Mytheresa answers with a
failover shell that sets `window.isBotPage = true` and carries no product at
all. curl_cffi's Chrome TLS impersonation and every Playwright mode tried by
hand get the same treatment.

Because none of those pages has ever been observed rendered, this collector
deliberately reads only schema.org Product JSON-LD - the standardized pattern
these retailers have to publish for Google Shopping, and the same one that
works for SSENSE - rather than guessing at site-specific markup. When a page
yields no Product block, `markers` in that source's diagnostics records which
data shapes the page *did* contain (JSON-LD of other types, __NEXT_DATA__, an
inline state blob, a bot wall), so the next revision can be written against
something observed instead of guessed at again.
"""
import argparse
import json
import re
import sys
import time

from common import atomic_write_json, canonical_url, derive_colorway, kst_now, short_id
from footwear_scope import classify
from scrapingbee_client import ScrapingBeeClient

LDJSON_RE = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S)

# Each listing URL is the retailer's own newest-first sneaker view, so the
# top pages are its new arrivals rather than an arbitrary slice. W Concept
# used to be in this list; it now has its own collector (collect_wconcept.py)
# built against its real, observed storefront API.
SOURCES = [
    {'id': 'retail-farfetch', 'label': 'Farfetch', 'gender': 'women',
     'listingUrl': 'https://www.farfetch.com/shopping/women/shoes-trainers-1/items.aspx?sortby=3',
     'maxPages': 4},
    {'id': 'retail-farfetch', 'label': 'Farfetch', 'gender': 'men',
     'listingUrl': 'https://www.farfetch.com/shopping/men/shoes-trainers-1/items.aspx?sortby=3',
     'maxPages': 4},
    {'id': 'retail-mytheresa', 'label': 'Mytheresa', 'gender': 'women',
     'listingUrl': 'https://www.mytheresa.com/int/en/women/shoes/sneakers?sortBy=new_items',
     'maxPages': 4},
    {'id': 'retail-mytheresa', 'label': 'Mytheresa', 'gender': 'men',
     'listingUrl': 'https://www.mytheresa.com/int/en/men/shoes/sneakers?sortBy=new_items',
     'maxPages': 4},
    {'id': 'retail-netaporter', 'label': 'Net-a-Porter', 'gender': 'women',
     'listingUrl': 'https://www.net-a-porter.com/en-us/shop/clothing/shoes/sneakers?sortBy=newIn',
     'maxPages': 4},
]

# What a page contained when it yielded no Product block - the input the next
# revision of this collector needs, instead of another blind guess.
MARKERS = {
    'jsonld': re.compile(r'application/ld\+json', re.I),
    'next-data': re.compile(r'__NEXT_DATA__'),
    'nuxt-data': re.compile(r'__NUXT'),
    'initial-state': re.compile(r'__(?:INITIAL_STATE|PRELOADED_STATE|APOLLO_STATE)__'),
    'bot-wall': re.compile(r'isBotPage|Access Denied|Request unsuccessful', re.I),
}


def page_markers(html):
    return sorted(name for name, pattern in MARKERS.items() if pattern.search(html or ''))


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
    colorway = derive_colorway(name)
    return {
        'id': short_id('weekly-' + source['id'], canonical_url(url) or url),
        'brand': brand_name or name.split()[0],
        'name': name[len(colorway):].strip() if colorway else name,
        'fullName': name,
        'image': image,
        'url': url,
        'sku': sku,
        'style': sku,
        'colorway': colorway,
        'priceLabel': f'{currency} {price}'.strip() if price else '',
        'gender': source['gender'],
        'source': source['id'],
        'retailer': source['label'],
        'officialCategory': 'sneakers',
        'retailerEvidence': {'verified': True, 'retailer': source['label'], 'productUrl': url,
                              'listingUrl': source['listingUrl'], 'verifiedAt': kst_now().isoformat(),
                              'listingBasis': source['label'] + ' newest-first listing',
                              'collectionMethod': 'scrapingbee-jsonld'},
    }


def collect_source(source, client, diagnostics):
    items, seen = [], set()
    status = {'source': source['id'], 'gender': source['gender'], 'listingUrl': source['listingUrl'],
              'pages': 0, 'responses': 0, 'products': 0, 'dropped': {}, 'markers': [], 'errors': []}
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
            status['markers'] = page_markers(html)
            status['errors'].append({'url': page_url, 'error': 'NO_JSONLD_PRODUCTS_FOUND',
                                      'markers': status['markers'], 'length': len(html)})
            break
        new_this_page = 0
        for p in products:
            item = to_item(p, source)
            if not item or item['url'] in seen:
                continue
            seen.add(item['url'])
            new_this_page += 1
            kind, types, reason = classify(item['fullName'], 'sneakers')
            if not kind:
                status['dropped'][reason] = status['dropped'].get(reason, 0) + 1
                continue
            item.update({'category': kind, 'productType': kind, 'footwearTypes': types})
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
        print('Farfetch/Mytheresa/Net-a-Porter (ScrapingBee JSON-LD): requires_key', file=sys.stderr)
        return

    for source in SOURCES:
        items.extend(collect_source(source, client, diagnostics))

    result = {'status': 'ok' if items else 'unavailable', 'checkedAt': checked_at,
              'items': items, 'diagnostics': diagnostics, 'scrapingBeeCreditsUsed': client.credits_used}
    atomic_write_json(args.out, result)
    print(f"Farfetch/Mytheresa/Net-a-Porter (ScrapingBee JSON-LD): {result['status']} - "
          f"{len(items)} items, {client.credits_used} credits used", file=sys.stderr)


if __name__ == '__main__':
    main()
