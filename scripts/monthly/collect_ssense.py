"""Collect sneaker listings from SSENSE's men's and women's shoes/sneakers
category pages, as a verified-retailer substitute for Farfetch/Mytheresa.

Why SSENSE and not Farfetch/Mytheresa: both block curl_cffi (TLS-impersonated
requests) and Node/Playwright (headless and headful) with Akamai bot pages, and
this project's Firecrawl account is out of credits. SSENSE's listing pages are
reachable with curl_cffi's Chrome TLS impersonation (plain Node fetch and
Playwright are blocked there too). If Farfetch/Mytheresa ever stop blocking, a
collector for them can be added the same way this one works: real JSON-LD
product blocks, no guessed selectors.

Each product on the listing page is embedded as a schema.org Product JSON-LD
block. We never invent colorway/description text that imageUrl/JSON-LD does
not actually contain.
"""
import argparse
import json
import re
import sys
import time

from curl_cffi import requests as curl_requests

from common import (BROWSER_HEADERS, atomic_write_json, canonical_url, is_kids_item, is_sneaker_title,
                     kst_now, short_id)
from scrapingbee_client import ScrapingBeeClient

CATEGORIES = [
    {'gender': 'men', 'url': 'https://www.ssense.com/en-us/men/shoes/sneakers'},
    {'gender': 'women', 'url': 'https://www.ssense.com/en-us/women/shoes/sneakers'},
]
MAX_PAGES = 12
LDJSON_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


def image_url(sku):
    return f'https://img.ssensemedia.com/image/upload/b_white,c_lpad,g_south,ar_2:3/f_auto,c_limit,w_768,q_85/{sku}_1.jpg'


def fetch(url, attempts=3, bee=None):
    """Direct curl_cffi first; on a hard block, retry through ScrapingBee.

    SSENSE serves this fine to a residential IP but answers 403 to GitHub
    Actions' datacenter ranges (confirmed: 1,100 items collected locally,
    403 on every page from CI the same hour). ScrapingBee's proxies are not
    in that blocklist, so it's the fallback that makes the scheduled run
    work at all - without a key, the 403 stands and is reported as such.
    """
    last_error = None
    for attempt in range(attempts):
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=25)
            if r.status_code == 200:
                return r.text
            last_error = f'http-{r.status_code}'
            if r.status_code in (401, 403, 407, 429):
                break  # a block won't clear by retrying the same way
        except Exception as e:
            last_error = str(e)
        time.sleep(1.5 * (attempt + 1))
    if bee is not None and bee.has_key:
        try:
            return bee.fetch(url, validate=lambda h: 'application/ld+json' in h)
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
        if data.get('@type') != 'Product':
            continue
        out.append(data)
    return out


def collect_category(gender, listing_url, checked_at, diagnostics, bee=None):
    seen_urls = set()
    items = []
    status = {'gender': gender, 'listingUrl': listing_url, 'pages': 0, 'responses': 0,
               'candidates': 0, 'sneakers': 0, 'errors': []}
    for page in range(1, MAX_PAGES + 1):
        page_url = f'{listing_url}?page={page}'
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
        for p in products:
            url = p.get('url')
            canon = canonical_url(url) if url else ''
            if not canon or canon in seen_urls:
                continue
            seen_urls.add(canon)
            new_this_page += 1
            status['candidates'] += 1
            name = (p.get('name') or '').strip()
            if not is_sneaker_title(name) or is_kids_item(name, url):
                continue
            sku = (p.get('sku') or '').strip()
            if not sku:
                continue
            brand = ((p.get('brand') or {}).get('name') or '').strip()
            offers = p.get('offers') or {}
            price = offers.get('price')
            currency = offers.get('priceCurrency') or ''
            content_hash = __import__('hashlib').sha256(json.dumps(p, sort_keys=True).encode('utf-8')).hexdigest()
            item = {
                'id': short_id('monthly-ssense', brand, canon),
                'source': 'retail-ssense',
                'gender': gender,
                'brand': brand,
                'name': name,
                'url': url,
                'image': image_url(sku),
                'sku': sku,
                'priceLabel': (f'{currency} {price}'.strip() if price is not None else ''),
                'retailerEvidence': {
                    'verified': True,
                    'retailer': 'SSENSE',
                    'productUrl': url,
                    'listingUrl': page_url,
                    'verifiedAt': checked_at,
                    'contentHash': content_hash,
                    'sku': sku,
                },
            }
            items.append(item)
            status['sneakers'] += 1
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
    diagnostics = []
    items = []
    bee = ScrapingBeeClient()
    for cat in CATEGORIES:
        try:
            items.extend(collect_category(cat['gender'], cat['url'], checked_at, diagnostics, bee=bee))
        except Exception as e:
            diagnostics.append({'gender': cat['gender'], 'listingUrl': cat['url'], 'errors': [{'error': str(e)}]})

    responded = any(d.get('responses') for d in diagnostics)
    result = {
        'status': 'ok' if responded and items else ('partial' if responded else 'unavailable'),
        'checkedAt': checked_at,
        'items': items,
        'diagnostics': diagnostics,
        'scrapingBeeCreditsUsed': bee.credits_used,
    }
    atomic_write_json(args.out, result)
    print(f"SSENSE collection: {result['status']} — {len(items)} sneaker items across "
          f"{sum(d.get('pages', 0) for d in diagnostics)} pages", file=sys.stderr)


if __name__ == '__main__':
    main()
