"""Collect W Concept's sneaker listings from the same public category API
its own storefront calls.

Finding it took observing the live page: display.wconcept.co.kr renders its
product grid entirely client-side, so neither the HTML nor the Next.js RSC
payload contains any product. The grid is filled by
POST gw-front.wconcept.co.kr/display/api/category/v1/products/{menu}/{d1}/{d2}
with a `DISPLAY-API-KEY` header - a static key shipped in the storefront's own
JavaScript bundle, not a user credential. We re-read that key out of the
bundle on every run instead of pinning it, so a rotation shows up as a fresh
key rather than a silent failure; OBSERVED_KEY is only the fallback.

Unlike 29CM, W Concept publishes no per-item date, and the endpoint has no
working sort (sort/sortType/sortCd/orderBy/align x NEW/LATEST/REG_DATE_DESC/
numeric codes were all tried by hand; every one returns the default order,
and that order is not newest-first - page 100's item codes average higher
than page 1's). There is therefore no field here that says "new".

So W Concept is handled the way SSENSE already is in this pipeline: collect
the full in-scope listing every week and let update.py publish the
week-over-week delta. The first run establishes the baseline and publishes
nothing, which is the honest answer to "what arrived since last time?" when
there is no previous snapshot yet.

Category codes are read off live responses (each item echoes its own
mediumName/categoryDepthName), not guessed. 플랫슈즈 and 뮬/슬리퍼 are walked
because that is where ballet, Mary Jane and mule silhouettes are filed, but
every item from them still has to pass footwear_scope.classify on its own
title, so plain flats, heeled Mary Janes and bath slippers are dropped.
"""
import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from curl_cffi import requests as curl_requests

from common import atomic_write_json, kst_now, short_id
from footwear_scope import classify

API = 'https://gw-front.wconcept.co.kr/display/api/category/v1/products/{path}'
STOREFRONT = 'https://display.wconcept.co.kr/category/women/002002'
OBSERVED_KEY = 'VWmkUPgs6g2fviPZ5JQFQ3pERP4tIXv/J2jppLqSRBk='
KEY_RE = re.compile(r'["\']DISPLAY-API-KEY["\']\s*:\s*["\']([^"\']{8,120})["\']')
CHUNK_RE = re.compile(r'src="(https://wstatic\.wconcept\.co\.kr/[^"]+\.js)"')
PAGE_SIZE = 60           # server-side cap; 80/100/200 all come back as 60
MAX_PAGES = 200
CONCURRENCY = 4

CATEGORIES = [
    {'path': 'M33439436/002/002', 'label': '여성 신발 · 스니커즈', 'gender': 'women',
     'listing': 'https://display.wconcept.co.kr/category/women/002002'},
    {'path': 'M83985861/002/006', 'label': '남성 신발 · 스니커즈', 'gender': 'men',
     'listing': 'https://display.wconcept.co.kr/category/men/002006'},
    {'path': 'M33439436/002/003', 'label': '여성 신발 · 플랫슈즈', 'gender': 'women',
     'listing': 'https://display.wconcept.co.kr/category/women/002003'},
    {'path': 'M33439436/002/005', 'label': '여성 신발 · 뮬/슬리퍼', 'gender': 'women',
     'listing': 'https://display.wconcept.co.kr/category/women/002005'},
]


def discover_api_key(diagnostics):
    """Read DISPLAY-API-KEY out of the storefront's own JS bundle."""
    try:
        html = curl_requests.get(STOREFRONT, impersonate='chrome124', timeout=35,
                                 headers={'accept': 'text/html', 'accept-language': 'ko-KR'}).text
    except Exception as e:
        diagnostics.append({'keyDiscovery': 'storefront-unreachable', 'error': str(e)})
        return OBSERVED_KEY, 'fallback'
    chunks = sorted(set(CHUNK_RE.findall(html)))

    def read(url):
        try:
            return curl_requests.get(url, impersonate='chrome124', timeout=35,
                                     headers={'accept': '*/*'}).text
        except Exception:
            return ''

    with ThreadPoolExecutor(max_workers=8) as pool:
        for body in pool.map(read, chunks):
            found = KEY_RE.search(body)
            if found:
                key = found.group(1)
                diagnostics.append({'keyDiscovery': 'bundle', 'rotated': key != OBSERVED_KEY,
                                    'chunksScanned': len(chunks)})
                return key, 'bundle'
    diagnostics.append({'keyDiscovery': 'not-found-in-bundle', 'chunksScanned': len(chunks)})
    return OBSERVED_KEY, 'fallback'


def fetch_page(category, page, api_key, attempts=3):
    url = API.format(path=category['path'])
    headers = {'accept': 'application/json', 'content-type': 'application/json',
               'DISPLAY-API-KEY': api_key, 'origin': 'https://display.wconcept.co.kr',
               'referer': 'https://display.wconcept.co.kr/'}
    last_error = None
    for attempt in range(attempts):
        try:
            r = curl_requests.post(url, headers=headers, impersonate='chrome124', timeout=35,
                                   json={'pageNo': page, 'pageSize': PAGE_SIZE})
            if r.status_code == 200:
                payload = r.json()
                if payload.get('result') == 'SUCCESS':
                    return payload.get('data') or {}, None
                last_error = payload.get('message') or payload.get('errorCode')
            else:
                last_error = f'http-{r.status_code}'
        except Exception as e:
            last_error = str(e)
        time.sleep(1.0 * (attempt + 1))
    return None, {'page': page, 'url': url, 'error': str(last_error or 'unknown-fetch-error')}


def build_item(product, category, checked_at):
    name = (product.get('itemName') or '').strip()
    kind, types, reason = classify(name, category['label'])
    if not kind:
        return None, reason
    item_cd = product.get('itemCd') or ''
    url = product.get('landingUrl') or f'https://www.wconcept.co.kr/Product/{item_cd}'
    price = product.get('finalPrice') or product.get('salePrice') or product.get('customerPrice')
    hexes = [c for c in (product.get('colors') or []) if isinstance(c, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', c)]
    return {
        'id': short_id('weekly-wconcept', str(item_cd or url)),
        'source': 'retail-wconcept',
        'retailer': 'W Concept',
        'brand': product.get('brandNameEn') or product.get('brandNameKr') or '',
        'brandKo': product.get('brandNameKr') or '',
        'name': name,
        'fullName': name,
        'url': url,
        'image': product.get('productImageUrl') or '',
        'priceLabel': f'{price:,}원' if isinstance(price, int) else '',
        'gender': category['gender'],
        'colorway': '',
        'colorSwatches': hexes,
        'style': str(item_cd),
        'category': kind,
        'productType': kind,
        'footwearTypes': types,
        'officialCategory': ' · '.join(
            part for part in (product.get('categoryDepthName1'), product.get('categoryDepthName2')) if part
        ) or category['label'],
        'retailerEvidence': {
            'verified': True,
            'retailer': 'W Concept',
            'productUrl': url,
            'listingUrl': category['listing'],
            'listingBasis': f"W Concept {category['label']} 전수 수집 · 지난주 대비 신규 여부로 판정",
            'verifiedAt': checked_at,
            'collectionMethod': 'storefront-category-api',
        },
    }, ''


def collect_category(category, api_key, checked_at, diagnostics):
    status = {'category': category['path'], 'label': category['label'], 'pages': 0,
              'candidates': 0, 'kept': 0, 'dropped': {}, 'errors': [], 'totalListed': None,
              'pageCapHit': False}
    first, error = fetch_page(category, 1, api_key)
    if first is None:
        status['errors'].append(error)
        diagnostics.append(status)
        return []
    total = first.get('totalElements') or 0
    status['totalListed'] = total
    # Use the server's own totalPages: it reflects the page size actually
    # applied (W Concept clamps anything above 60), so computing the page
    # count locally against the requested size silently skips pages.
    needed = int(first.get('totalPages') or 0) or max(1, -(-total // PAGE_SIZE))
    last_page = min(MAX_PAGES, needed)
    status['pageCapHit'] = last_page < needed

    items = []

    def absorb(payload):
        status['pages'] += 1
        for product in payload.get('content') or []:
            status['candidates'] += 1
            item, reason = build_item(product, category, checked_at)
            if item is None:
                status['dropped'][reason] = status['dropped'].get(reason, 0) + 1
                continue
            items.append(item)
            status['kept'] += 1

    absorb(first)
    pages = list(range(2, last_page + 1))
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for start in range(0, len(pages), CONCURRENCY):
            batch = pages[start:start + CONCURRENCY]
            for payload, error in pool.map(lambda p: fetch_page(category, p, api_key), batch):
                if payload is None:
                    status['errors'].append(error)
                    continue
                absorb(payload)
            time.sleep(0.4)
    diagnostics.append(status)
    return items


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    checked_at = kst_now().isoformat()
    diagnostics = []
    api_key, key_source = discover_api_key(diagnostics)
    items, seen = [], set()
    for category in CATEGORIES:
        for item in collect_category(category, api_key, checked_at, diagnostics):
            if item['url'] in seen:
                continue
            seen.add(item['url'])
            items.append(item)

    responded = any(d.get('pages') for d in diagnostics)
    result = {
        'status': 'ok' if items else ('partial' if responded else 'unavailable'),
        'checkedAt': checked_at,
        'apiKeySource': key_source,
        'items': items,
        'diagnostics': diagnostics,
    }
    atomic_write_json(args.out, result)
    print(f"W Concept collection: {result['status']} - {len(items)} in-scope items", file=sys.stderr)


if __name__ == '__main__':
    main()
