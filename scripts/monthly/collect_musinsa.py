"""Collect Musinsa's own sneaker category ranking (category 103004, "신발 >
스니커즈", sortCode=POPULAR). This is a real product ranking, not a search
term list - distinct from the search-term ranking scripts/collect-search-
keywords.mjs already pulls from api.musinsa.com for the SHOES TREND KEYWORD
section. Rank here is the item's position in Musinsa's own POPULAR sort,
read from Next.js's embedded __NEXT_DATA__ JSON (confirmed by hand: a real
Product list at props.pageProps.dehydratedState.queries[0].state.data.pages
[0].data.list, 61 items, each with goodsName/brand/price/thumbnail - no
reverse-engineered private API call).
"""
import argparse
import json
import re
import sys
import time

from curl_cffi import requests as curl_requests

from common import BROWSER_HEADERS, atomic_write_json, is_kids_item, kst_now
from scrapingbee_client import ScrapingBeeClient

# Musinsa's own category 103004 is already scoped to sneakers, so (unlike
# SSENSE/Lyst) names rarely spell out "sneakers" explicitly - only exclude
# on an explicit non-sneaker keyword, not on the absence of one.
NON_SNEAKER_RE = re.compile(r'로퍼|옥스포드|더비|구두|슬링백|힐|펌프스|샌들|슬리퍼')

CATEGORY_URL = 'https://www.musinsa.com/category/103004?sortCode=POPULAR'
NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)
TOP_N = 50


def fetch(url, attempts=3, bee=None):
    """Direct curl_cffi first; on a hard block, retry through ScrapingBee.

    Musinsa serves this fine to a residential IP but answers 403 to GitHub
    Actions' datacenter ranges (confirmed: 50 ranked items locally, 403 from
    CI the same hour), so the scheduled run needs the proxy fallback.
    """
    last_error = None
    for attempt in range(attempts):
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=25)
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
            return bee.fetch(url, validate=lambda h: '__NEXT_DATA__' in h)
        except RuntimeError as e:
            raise RuntimeError(f'{last_error}; scrapingbee: {e}')
    raise RuntimeError(last_error or 'unknown-fetch-error')


def extract_list(html):
    m = NEXT_DATA_RE.search(html)
    if not m:
        return None
    data = json.loads(m.group(1))
    try:
        queries = data['props']['pageProps']['dehydratedState']['queries']
        for q in queries:
            pages = q.get('state', {}).get('data', {}).get('pages')
            if pages and isinstance(pages[0].get('data', {}).get('list'), list):
                return pages[0]['data']['list']
    except (KeyError, IndexError, TypeError):
        return None
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    checked_at = kst_now().isoformat()
    diagnostics = [{'url': CATEGORY_URL}]
    items = []
    try:
        bee = ScrapingBeeClient()
        html = fetch(CATEGORY_URL, bee=bee)
        goods = extract_list(html)
        if goods is None:
            diagnostics[0]['error'] = 'NEXT_DATA_LIST_NOT_FOUND'
        else:
            diagnostics[0]['totalListed'] = len(goods)
            rank = 0
            for g in goods:
                name = g.get('goodsName') or ''
                if is_kids_item(name) or NON_SNEAKER_RE.search(name):
                    continue
                rank += 1
                url = g.get('goodsLinkUrl') or f"https://www.musinsa.com/products/{g.get('goodsNo')}"
                items.append({
                    'rank': rank,
                    'brand': g.get('brandName') or g.get('brand') or '',
                    'name': name,
                    'url': url,
                    'image': g.get('thumbnail') or '',
                    'priceLabel': f"{g.get('finalPrice'):,}원" if g.get('finalPrice') else '',
                    'gender': 'women' if g.get('displayGenderText') == '여성' else ('men' if g.get('displayGenderText') == '남성' else ''),
                    'source': 'ecommerce-musinsa',
                    'checkedAt': checked_at,
                    'retailerEvidence': {'verified': True, 'retailer': 'Musinsa', 'productUrl': url,
                                          'listingUrl': CATEGORY_URL, 'verifiedAt': checked_at,
                                          'collectionMethod': 'curl_cffi', 'rank': rank},
                })
                if rank >= TOP_N:
                    break
    except Exception as e:
        diagnostics[0]['error'] = str(e)

    result = {'status': 'ok' if items else 'unavailable', 'checkedAt': checked_at,
              'items': items, 'diagnostics': diagnostics}
    atomic_write_json(args.out, result)
    print(f"Musinsa ranking collection: {result['status']} - {len(items)} ranked sneakers", file=sys.stderr)


if __name__ == '__main__':
    main()
