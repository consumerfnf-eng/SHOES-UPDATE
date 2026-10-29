"""Collect Musinsa's genuinely new sneaker listings (sortCode=NEW) across
every shoe category in this project's publication scope.

How the paging works (observed, not guessed): the category page embeds a
React Query cache in __NEXT_DATA__ whose first entry holds page 1 of the
listing *and* a `pagination.nextPageUrl` pointing at Musinsa's own
api.musinsa.com/api2/dp/v2/plp/goods endpoint, signed with a per-session
`hmacId`. Page 1 therefore has to come from the HTML; every later page is
fetched from the freshly signed nextPageUrl the previous response returns -
a signature only authorises its own request, so bumping page 1's page
number answers 403 from page 3 on (verified by hand).
Calling the API without an hmacId from a real page load answers
DISPLAY_000_0001 ("잘못된 파라미터"), so the HTML step cannot be skipped and
is not attempted.

Musinsa publishes no date field, but it files every thumbnail under the day
it was uploaded, so `listedAt` comes from the image path (see listed_day).
That matters: its own 신상품순 sort reaches back well past three months -
collected items carry image dates from March - so the sort's position alone
is not a three-month guarantee and the date is what the publish window uses.
"""
import argparse
import json
import re
import sys
import time

from curl_cffi import requests as curl_requests

from common import BROWSER_HEADERS, atomic_write_json, kst_now, short_id
from footwear_scope import classify, is_stated_value, split_ko_listing_title
from scrapingbee_client import ScrapingBeeClient

# Musinsa's own shoe tree (code -> label), limited to this project's scope.
# 103004 is the whole 스니커즈 branch (which already contains 스니커즈 뮬,
# 슬립온 and 캔버스/단화); the 103005 entries are the sports silhouettes that
# are sneakers rather than cleats or boots. The 구두 / 부츠 / 샌들 branches are
# excluded wholesale - the few sneaker-shaped items filed there come in from
# the other retailers instead of opening the door to loafers and heels.
CATEGORIES = [
    {'code': '103004', 'label': '스니커즈'},
    {'code': '103005009', 'label': '러닝화'},
    {'code': '103005008', 'label': '농구화'},
    {'code': '103005001', 'label': '테니스화'},
    {'code': '103005012', 'label': '피트니스화'},
    {'code': '103005006', 'label': '기타 운동화'},
]
PAGES_PER_CATEGORY = 6          # 6 x 60 = up to 360 newest listings per category
PAGE_SIZE = 60
NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)
THUMBNAIL_DAY_RE = re.compile(r'/goods_img/(\d{4})(\d{2})(\d{2})/')


def listing_url(code):
    return f'https://www.musinsa.com/category/{code}?sortCode=NEW'


def fetch(url, attempts=3, bee=None, validate=None):
    """Direct curl_cffi first; on a hard block, retry through ScrapingBee.

    Musinsa serves this fine to a residential IP but answers 403 to GitHub
    Actions' datacenter ranges, so the scheduled run needs the fallback.
    """
    last_error = None
    for attempt in range(attempts):
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=30)
            if r.status_code == 200:
                return r.text
            last_error = f'http-{r.status_code}'
            if r.status_code in (401, 403, 407, 429):
                break
        except Exception as e:
            last_error = str(e)
        time.sleep(1.5 * (attempt + 1))
    if bee is not None and bee.has_key:
        try:
            return bee.fetch(url, validate=validate)
        except RuntimeError as e:
            raise RuntimeError(f'{last_error}; scrapingbee: {e}')
    raise RuntimeError(last_error or 'unknown-fetch-error')


def first_page_from_html(html):
    """Return (goods, next_page_url) from a category page's embedded cache."""
    m = NEXT_DATA_RE.search(html)
    if not m:
        return None, None
    data = json.loads(m.group(1))
    try:
        queries = data['props']['pageProps']['dehydratedState']['queries']
    except (KeyError, TypeError):
        return None, None
    for query in queries:
        state = (query.get('state') or {}).get('data')
        pages = state.get('pages') if isinstance(state, dict) else None
        if not pages:
            continue
        block = (pages[0] or {}).get('data') or {}
        if isinstance(block.get('list'), list):
            return block['list'], (block.get('pagination') or {}).get('nextPageUrl')
    return None, None


def next_page_of(payload):
    """Each signed API response carries its own freshly signed nextPageUrl.

    The hmacId in a given nextPageUrl authorises exactly that one request:
    reusing page 1's signature with the page number bumped answers 403 from
    page 3 on (verified by hand). So the chain has to be followed link by
    link rather than constructed."""
    return ((payload.get('data') or {}).get('pagination') or {}).get('nextPageUrl')


def listed_day(thumbnail):
    """The day Musinsa first hosted this product's image.

    Musinsa publishes no date field anywhere - not in the listing, not on the
    product page - but it files every thumbnail under the day it was uploaded
    (`/goods_img/20261014/7516828/...`), which for a listing is the day it went
    up. It is already in the listing payload, so this costs no extra request.
    It is recorded as what it is, an image-upload day, not as a release date:
    1,357 of 1,365 collected items carry one, and they show that Musinsa's own
    신상품순 reaches back well past three months, which is exactly why the date
    filter is needed rather than trusting the sort's position alone.
    """
    found = THUMBNAIL_DAY_RE.search(thumbnail or '')
    return '-'.join(found.groups()) if found else ''


def build_item(good, category, checked_at, listing, rank):
    name = good.get('goodsName') or ''
    kind, types, reason = classify(name, category['label'])
    if not kind:
        return None, reason
    model, color, style = split_ko_listing_title(name)
    color = color if is_stated_value(color) else ''
    url = good.get('goodsLinkUrl') or f"https://www.musinsa.com/products/{good.get('goodsNo')}"
    price = good.get('finalPrice') or good.get('price')
    gender_text = good.get('displayGenderText') or ''
    thumbnail = good.get('thumbnail') or ''
    listed = listed_day(thumbnail)
    return {
        'id': short_id('weekly-musinsa', str(good.get('goodsNo') or url)),
        'source': 'retail-musinsa',
        'retailer': 'Musinsa',
        'brand': good.get('brandName') or good.get('brand') or '',
        'brandSlug': good.get('brand') or '',
        'name': model or name,
        'fullName': name,
        'url': url,
        'image': thumbnail,
        'priceLabel': f'{price:,}원' if isinstance(price, int) else '',
        'gender': 'women' if gender_text == '여성' else ('men' if gender_text == '남성' else ''),
        'colorway': color,
        'style': style,
        'category': kind,
        'productType': kind,
        'footwearTypes': types,
        'officialCategory': category['label'],
        'listedAt': listed,
        'retailerEvidence': {
            'verified': True,
            'retailer': 'Musinsa',
            'productUrl': url,
            'listingUrl': listing,
            'listedAt': listed,
            'listingBasis': (f"Musinsa {category['label']} · 신상품순(sortCode=NEW) {rank}번째"
                              + (f' · 이미지 등록일 {listed}' if listed else ' · 등록일 미표기')),
            'verifiedAt': checked_at,
            'collectionMethod': 'next-data+signed-plp-api',
        },
    }, ''


def collect_category(category, checked_at, bee, diagnostics):
    listing = listing_url(category['code'])
    status = {'category': category['code'], 'label': category['label'], 'listingUrl': listing,
              'pages': 0, 'candidates': 0, 'kept': 0, 'dropped': {}, 'errors': []}
    items = []
    try:
        html = fetch(listing, bee=bee, validate=lambda body: '__NEXT_DATA__' in body)
    except Exception as e:
        status['errors'].append({'url': listing, 'error': str(e)})
        diagnostics.append(status)
        return items
    goods, next_url = first_page_from_html(html)
    if goods is None:
        status['errors'].append({'url': listing, 'error': 'NEXT_DATA_LIST_NOT_FOUND'})
        diagnostics.append(status)
        return items

    rank = 0
    page = 1
    while True:
        status['pages'] = page
        for good in goods:
            rank += 1
            status['candidates'] += 1
            item, reason = build_item(good, category, checked_at, listing, rank)
            if item is None:
                status['dropped'][reason] = status['dropped'].get(reason, 0) + 1
                continue
            items.append(item)
            status['kept'] += 1
        if page >= PAGES_PER_CATEGORY or not next_url or len(goods) < PAGE_SIZE:
            break
        page += 1
        try:
            body = fetch(next_url, bee=bee, validate=lambda text: '"list"' in text)
            payload = json.loads(body)
            goods = ((payload.get('data') or {}).get('list')) or []
            next_url = next_page_of(payload)
        except Exception as e:
            status['errors'].append({'page': page, 'error': str(e)})
            break
        if not goods:
            break
        time.sleep(1.0)
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
        for item in collect_category(category, checked_at, bee, diagnostics):
            if item['url'] in seen:
                continue
            seen.add(item['url'])
            items.append(item)

    responded = any(d.get('pages') for d in diagnostics)
    result = {
        'status': 'ok' if items else ('partial' if responded else 'unavailable'),
        'checkedAt': checked_at,
        'items': items,
        'scrapingBeeCreditsUsed': bee.credits_used,
        'diagnostics': diagnostics,
    }
    atomic_write_json(args.out, result)
    print(f"Musinsa new-arrival collection: {result['status']} - {len(items)} items across "
          f'{len(CATEGORIES)} categories', file=sys.stderr)


if __name__ == '__main__':
    main()
