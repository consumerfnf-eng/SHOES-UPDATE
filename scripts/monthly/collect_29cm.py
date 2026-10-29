"""Collect 29CM's recent sneaker listings from its own public category API.

29CM is the one Korean retailer here that publishes a real per-item date:
every product in /api/v4/products/category carries `visibleBeginTimestamp`,
the moment the listing went live on 29CM. That makes a genuine "released in
the last 3 months" filter possible instead of a position-in-a-sort proxy.

The trade-off is that the endpoint has no working date sort - LATEST, NEW,
RECENT, NEWEST, REGISTER_DESC and sortType/order variants were all tried by
hand and every one of them returns the same unordered page - and `size` is
capped server-side at 48 whatever you ask for. So the only honest way to
find every recent item is to walk the whole category and filter on the date
the API itself gives us. That is a few hundred requests per run, which is
why the pages are fetched a few at a time with a small delay rather than
one at a time.

Category codes come from the products' own `frontCategoryInfo`, read off
live search responses - not guessed. 플랫슈즈 is included because that is
where 29CM files ballet/Mary Jane/jelly silhouettes, but every item from it
still has to pass footwear_scope.classify on its own title, so a plain flat
or a heeled Mary Jane is dropped rather than published as a sneaker.
"""
import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from curl_cffi import requests as curl_requests

from common import atomic_write_json, kst_now, kst_three_months_ago, short_id
from footwear_scope import classify, is_stated_value, split_ko_listing_title

API = 'https://search-api.29cm.co.kr/api/v4/products/category'
PRODUCT_URL = 'https://www.29cm.co.kr/products/{}'
IMAGE_BASE = 'https://img.29cm.co.kr'
PAGE_SIZE = 48           # server-side cap; larger values are ignored
MAX_PAGES = 260          # covers the largest shoe category (~10,300 items)
CONCURRENCY = 4
DETAIL_API = 'https://bff-api.29cm.co.kr/api/v5/product-detail/{}'
# Material is not in the listing; it is one small JSON call per product, so a
# bounded number of the newest items are enriched rather than all of them.
# The detail endpoint rate-limits: at five concurrent calls it answered 100
# products and then refused everything, so this stays near three per second
# and the diagnostics count the refusals instead of hiding them.
DETAIL_BUDGET = 1500
DETAIL_CONCURRENCY = 2
DETAIL_PAUSE = 0.6
HEADERS = {'accept': 'application/json', 'accept-language': 'ko-KR,ko;q=0.9',
           'referer': 'https://www.29cm.co.kr/'}

CATEGORIES = [
    {'large': '270100100', 'medium': '270106100', 'label': '여성슈즈 · 스니커즈', 'gender': 'women'},
    {'large': '274100100', 'medium': '274101100', 'label': '남성슈즈 · 스니커즈', 'gender': 'men'},
    {'large': '270100100', 'medium': '270121100', 'label': '여성슈즈 · 플랫슈즈', 'gender': 'women'},
]


def page_url(category, page):
    return (f"{API}?categoryLargeCode={category['large']}&categoryMediumCode={category['medium']}"
            f'&page={page}&size={PAGE_SIZE}')


def fetch_page(category, page, attempts=3):
    url = page_url(category, page)
    last_error = None
    for attempt in range(attempts):
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=HEADERS, timeout=30)
            if r.status_code == 200:
                return r.json().get('data') or {}, None
            last_error = f'http-{r.status_code}'
        except Exception as e:
            last_error = str(e)
        time.sleep(1.0 * (attempt + 1))
    return None, {'page': page, 'url': url, 'error': last_error or 'unknown-fetch-error'}


def image_url(path):
    if not path:
        return ''
    return path if path.startswith('http') else f"{IMAGE_BASE}{path if path.startswith('/') else '/' + path}"


def build_item(product, category, checked_at):
    name = (product.get('itemName') or '').strip()
    kind, types, reason = classify(name, category['label'])
    if not kind:
        return None, reason
    model, color, style = split_ko_listing_title(name)
    color = color if is_stated_value(color) else ''
    item_no = product.get('itemNo')
    url = PRODUCT_URL.format(item_no)
    began = product.get('visibleBeginTimestamp') or ''
    price = product.get('lastSalePrice') or product.get('consumerPrice')
    hexes = [h for h in (product.get('colorHexes') or []) if isinstance(h, str) and h.startswith('#')]
    return {
        'id': short_id('weekly-29cm', str(item_no or url)),
        'source': 'retail-29cm',
        'retailer': '29CM',
        'brand': product.get('frontBrandNameEng') or product.get('frontBrandNameKor') or '',
        'brandKo': product.get('frontBrandNameKor') or '',
        'name': model or name,
        'fullName': name,
        'url': url,
        'image': image_url(product.get('imageUrl')),
        'priceLabel': f'{price:,}원' if isinstance(price, int) else '',
        'gender': category['gender'],
        'colorway': color,
        'colorSwatches': hexes,
        'style': style,
        'category': kind,
        'productType': kind,
        'footwearTypes': types,
        'officialCategory': category['label'],
        'listedAt': began,
        'retailerEvidence': {
            'verified': True,
            'retailer': '29CM',
            'productUrl': url,
            'listingUrl': f"https://www.29cm.co.kr/category/list?categoryLargeCode={category['large']}"
                          f"&categoryMediumCode={category['medium']}",
            'listingBasis': f"29CM {category['label']} · 등록일 {began[:10]}",
            'listedAt': began,
            'verifiedAt': checked_at,
            'collectionMethod': 'public-category-api',
        },
    }, ''


def collect_category(category, cutoff_day, checked_at, diagnostics):
    status = {'category': f"{category['large']}/{category['medium']}", 'label': category['label'],
              'pages': 0, 'candidates': 0, 'kept': 0, 'tooOld': 0, 'dropped': {}, 'errors': [],
              'totalListed': None, 'pageCapHit': False}
    first, error = fetch_page(category, 1)
    if first is None:
        status['errors'].append(error)
        diagnostics.append(status)
        return []
    total = first.get('productsTotalCount') or 0
    status['totalListed'] = total
    last_page = min(MAX_PAGES, max(1, -(-total // PAGE_SIZE)))
    status['pageCapHit'] = last_page < -(-total // PAGE_SIZE)

    items = []

    def absorb(payload, page):
        status['pages'] += 1
        for product in payload.get('products') or []:
            status['candidates'] += 1
            began = product.get('visibleBeginTimestamp') or ''
            if began[:10] < cutoff_day:
                status['tooOld'] += 1
                continue
            item, reason = build_item(product, category, checked_at)
            if item is None:
                status['dropped'][reason] = status['dropped'].get(reason, 0) + 1
                continue
            items.append(item)
            status['kept'] += 1

    absorb(first, 1)
    pages = list(range(2, last_page + 1))
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for start in range(0, len(pages), CONCURRENCY):
            batch = pages[start:start + CONCURRENCY]
            for payload, error in pool.map(lambda p: fetch_page(category, p), batch):
                if payload is None:
                    status['errors'].append(error)
                    continue
                absorb(payload, 0)
            time.sleep(0.4)
    diagnostics.append(status)
    return items


# The shared guard in footwear_scope covers every "상세 페이지 참조" spelling
# these sellers use; a local copy drifted and let "상세내용참고" through.
def is_stated(value):
    return is_stated_value(value)


def fetch_detail(item_no, outcome, attempts=2):
    """Return the detail payload, recording why it failed when it does."""
    last = 'unknown'
    for attempt in range(attempts):
        try:
            r = curl_requests.get(DETAIL_API.format(item_no), impersonate='chrome124',
                                  headers=HEADERS, timeout=30)
            if r.status_code == 200:
                return r.json().get('data') or {}
            last = f'http-{r.status_code}'
        except Exception as e:
            last = type(e).__name__
        time.sleep(1.0 * (attempt + 1))
    outcome[last] = outcome.get(last, 0) + 1
    return None


def enrich_with_details(items, status):
    """Fill material / country / colour from 29CM's own product-detail API.

    The listing carries none of the three. The detail response has a
    structured itemDetailsList holding the legally required product facts, so
    "제품 주소재" is the retailer's own declared material rather than anything
    inferred from a title.
    """
    targets = sorted(items, key=lambda i: i.get('listedAt') or '', reverse=True)[:DETAIL_BUDGET]
    outcome = {}
    status.update({'detailsRequested': len(targets), 'detailsFilled': 0,
                   'detailsPlaceholder': 0, 'detailsFailed': outcome})

    def apply(item):
        detail = fetch_detail(item['url'].rsplit('/', 1)[-1], outcome)
        if detail is None:
            return 0, 0
        rows = {row.get('itemDetailsTitles'): (row.get('itemDetailsValue') or '').strip()
                for row in (detail.get('itemDetailsList') or [])}
        material, country, colour = rows.get('제품 주소재', ''), rows.get('제조국', ''), rows.get('색상', '')
        if is_stated(country):
            item['countryOrigin'] = country
        if is_stated(colour) and not item.get('colorway'):
            item['colorway'] = colour
        if is_stated(material):
            item['material'] = material
            return 1, 0
        return 0, 1

    with ThreadPoolExecutor(max_workers=DETAIL_CONCURRENCY) as pool:
        for start in range(0, len(targets), DETAIL_CONCURRENCY):
            batch = targets[start:start + DETAIL_CONCURRENCY]
            for filled, placeholder in pool.map(apply, batch):
                status['detailsFilled'] += filled
                status['detailsPlaceholder'] += placeholder
            time.sleep(DETAIL_PAUSE)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    now = kst_now()
    checked_at = now.isoformat()
    cutoff_day = kst_three_months_ago(now).strftime('%Y-%m-%d')
    diagnostics = []
    items, seen = [], set()
    for category in CATEGORIES:
        for item in collect_category(category, cutoff_day, checked_at, diagnostics):
            if item['url'] in seen:
                continue
            seen.add(item['url'])
            items.append(item)

    detail_status = {'step': 'product-detail enrichment'}
    if items:
        enrich_with_details(items, detail_status)
        diagnostics.append(detail_status)

    responded = any(d.get('pages') for d in diagnostics)
    result = {
        'status': 'ok' if items else ('partial' if responded else 'unavailable'),
        'checkedAt': checked_at,
        'cutoffDay': cutoff_day,
        'items': items,
        'diagnostics': diagnostics,
    }
    atomic_write_json(args.out, result)
    print(f"29CM new-arrival collection: {result['status']} - {len(items)} items since {cutoff_day}",
          file=sys.stderr)


if __name__ == '__main__':
    main()
