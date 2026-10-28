"""Collect women's sneakers from Lyst's "Newest" sort via ScrapingBee.

Lyst blocks curl_cffi (403) and both headless and headful Playwright (403,
confirmed by hand - even a fresh headful profile got blocked on a retry a
few minutes after an earlier successful run). Only a real, long-lived,
already-logged-in Chrome profile loaded it reliably; a fresh browser
profile launched for automation does not. So this uses the user's own paid
ScrapingBee key as the automated path instead.

The parsing targets are real selectors read from Lyst's own rendered page
(scripts/monthly/collect-lyst.mjs has the same patterns, confirmed against
the live site by hand): each card is `data-testid="product-card"`, holding
an `<img alt="Brand Name - Color" src="...">`, a canonical product link
`href="/shoes/<slug>/..."`, a `data-testid="product-price"` block, and the
retailer name inside the lead link's aria-label ("View X at RETAILER").
Like collect_ssense.py, Lyst's "Newest" sort carries no visible per-item
date, so "new" here is purely update.py's month-over-month delta - this
collector only reports what it currently sees.
"""
import argparse
import re
import sys
import time

from common import atomic_write_json, canonical_url, derive_colorway, kst_now, short_id
from footwear_scope import classify
from scrapingbee_client import ScrapingBeeClient

# Lyst's own "Newest" view. Women's flats are walked too, the same way the
# other retailers are, for ballet/Mary Jane silhouettes.
LISTINGS = [
    {'url': 'https://www.lyst.com/shop/sneakers/?view=newest', 'gender': '', 'label': 'sneakers'},
    {'url': 'https://www.lyst.com/shop/womens-flat-shoes/?view=newest', 'gender': 'women', 'label': 'flats'},
]
MAX_PAGES = 6

CARD_SPLIT = re.compile(r'data-testid="product-card"')
IMG_RE = re.compile(r'<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"')
PRICE_RE = re.compile(r'data-testid="product-price"[^>]*>.*?\$([\d,.]+)', re.S)
URL_RE = re.compile(r'href="(/shoes/[^"?]+)')
RETAILER_RE = re.compile(r'aria-label="View [^"]+ at ([^"]+)"')


def valid_lyst_page(html):
    return 'data-testid="product-card"' in html


def parse_card(card_html):
    img = IMG_RE.search(card_html)
    url = URL_RE.search(card_html)
    if not img or not url:
        return None
    image, alt = img.groups()
    price = PRICE_RE.search(card_html)
    retailer = RETAILER_RE.search(card_html)
    dash = alt.rfind(' - ')
    name_part = alt[:dash] if dash > 0 else alt
    words = name_part.strip().split()
    brand = ' '.join(words[:min(3, max(1, len(words) - 2))]) if words else name_part
    return {
        'brand': brand or name_part,
        'name': name_part,
        'image': image,
        'url': 'https://www.lyst.com' + url.group(1).rstrip('/') + '/',
        'priceLabel': f'${price.group(1)}' if price else '',
        'retailer': retailer.group(1) if retailer else '',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    client = ScrapingBeeClient()
    checked_at = kst_now().isoformat()
    items, diagnostics, seen = [], [], set()

    if not client.has_key:
        atomic_write_json(args.out, {'status': 'requires_key', 'checkedAt': checked_at, 'items': [],
                                      'diagnostics': [{'error': 'SCRAPINGBEE_API_KEY not set'}]})
        print('Lyst (ScrapingBee) collection: requires_key', file=sys.stderr)
        return

    listing_pages = [(listing, page) for listing in LISTINGS for page in range(1, MAX_PAGES + 1)]
    stopped = set()
    for listing, page in listing_pages:
        if listing['url'] in stopped:
            continue
        page_url = f"{listing['url']}&page={page}"
        status = {'page': page, 'url': page_url, 'cards': 0, 'kept': 0, 'dropped': {}, 'errors': []}
        try:
            html = client.fetch(page_url, validate=valid_lyst_page)
        except RuntimeError as e:
            status['errors'].append({'error': str(e)})
            diagnostics.append(status)
            if 'QUOTA' in str(e) or 'NO_KEY' in str(e) or 'BUDGET' in str(e):
                break
            stopped.add(listing['url'])
            continue
        cards = CARD_SPLIT.split(html)[1:]
        new_this_page = 0
        for raw in cards:
            parsed = parse_card(raw[:4000])
            if not parsed or parsed['url'] in seen:
                continue
            seen.add(parsed['url'])
            new_this_page += 1
            kind, types, reason = classify(parsed['name'], listing['label'])
            if not kind:
                status['dropped'][reason] = status['dropped'].get(reason, 0) + 1
                continue
            colorway = derive_colorway(parsed['name'])
            model = parsed['name'][len(colorway):].strip() if colorway else parsed['name']
            items.append({**parsed,
                          'id': short_id('weekly-lyst', canonical_url(parsed['url']) or parsed['url']),
                          'name': model or parsed['name'],
                          'fullName': parsed['name'],
                          'colorway': colorway,
                          'gender': listing['gender'],
                          'source': 'retail-lyst',
                          'category': kind, 'productType': kind, 'footwearTypes': types,
                          'officialCategory': listing['label'],
                          'retailerEvidence': {'verified': True, 'retailer': parsed['retailer'] or 'Lyst',
                                                'productUrl': parsed['url'], 'listingUrl': page_url,
                                                'listingBasis': f"Lyst {listing['label']} · Newest",
                                                'verifiedAt': checked_at, 'collectionMethod': 'scrapingbee'}})
            status['kept'] += 1
        status['cards'] = new_this_page
        diagnostics.append(status)
        if new_this_page == 0:
            stopped.add(listing['url'])
            continue
        time.sleep(1.5)

    result = {'status': 'ok' if items else ('partial' if diagnostics else 'unavailable'),
              'checkedAt': checked_at, 'items': items, 'diagnostics': diagnostics,
              'scrapingBeeCreditsUsed': client.credits_used}
    atomic_write_json(args.out, result)
    print(f"Lyst (ScrapingBee) collection: {result['status']} - {len(items)} items, "
          f"{client.credits_used} credits used", file=sys.stderr)


if __name__ == '__main__':
    main()
