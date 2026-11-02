"""Verified Common Projects stockist assortment. Availability is not a release date."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MRPORTER = 'https://www.mrporter.com/en-us/mens/designer/common-projects/shoes/sneakers'
KITH = 'https://kith.com/collections/common-projects/products.json?limit=250&page=1'


def parse_mrporter(document, checked_at):
    blocks = re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', document, re.S | re.I)
    listing = next((json.loads(b) for b in blocks if '"itemListElement"' in b and '"numberOfItems"' in b), None)
    if not listing:
        raise ValueError('Missing MR PORTER structured assortment')
    rows = [e['item'] for e in listing['itemListElement']]
    if len(rows) != listing['numberOfItems']:
        raise ValueError('MR PORTER pagination/count mismatch')
    out = []
    for p in rows:
        if not re.search(r'/shoes/(?:low-top|high-top)-sneakers/', p['url']):
            continue
        out.append(make_item('mrporter', p['productID'], p['name'], p['url'], p['image'][0]['url'],
                             p.get('color', ''), '', '', checked_at, MRPORTER, document))
    return out


def parse_kith(document, checked_at):
    out = []
    for p in json.loads(document)['products']:
        if not any(v.get('available') for v in p['variants']) or 'Sneakers' not in p['product_type']:
            continue
        text = re.sub('<[^>]+>', ' ', p['body_html'])
        field = lambda name: (re.search(r'\b' + name + r':\s*([^\n]+)', text, re.I) or [None, ''])[1].strip()
        name = re.sub(r'^Common Projects\s+', '', p['title']).split(' - ')[0]
        silhouette = re.search(r'^\s*([^\n]+?)\s+silhouette\s*(?:\n|$)', text, re.I)
        if silhouette:
            name = silhouette[1].strip()
        out.append(make_item('kith', str(p['id']), name, 'https://kith.com/products/' + p['handle'],
                            p['images'][0]['src'], field('Color'), field('Material'), field('Style').upper(),
                            checked_at, KITH, document, p.get('published_at', '')))
    return out


def make_item(retailer, product_id, name, url, image, color, material, manufacturer, checked, listing, document, listed=''):
    evidence = {'verified': True, 'kind': 'retail-current-assortment', 'productUrl': url,
                'listingUrl': listing, 'verifiedAt': checked,
                'contentHash': hashlib.sha256(document.encode()).hexdigest()}
    return {'id': 'common-' + retailer + '-' + product_id, 'brand': 'Common Projects', 'name': name,
            'source': 'retail-' + retailer, 'retailer': {'kith': 'Kith', 'mrporter': 'MR PORTER'}[retailer],
            'url': url, 'image': image, 'style': manufacturer or product_id,
            'styleType': 'manufacturer' if manufacturer else 'retailer-product-id',
            'manufacturerStyle': manufacturer, 'retailerProductId': product_id,
            'colorway': color, 'material': material, 'category': 'sneaker', 'officialCategory': 'Sneakers',
            'gender': 'Men', 'listedAt': listed, 'availabilityEvidence': evidence,
            'newnessBasis': 'current-assortment', 'firstSeenAt': checked}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--from-cache', action='store_true')
    args = parser.parse_args()
    checked = datetime.now(timezone.utc).isoformat()
    if args.from_cache:
        mr = (ROOT / 'logs/common-mrporter-catalogue.txt').read_text(encoding='utf-8')
        kith = (ROOT / 'logs/common-kith-catalogue.txt').read_text(encoding='utf-8')
    else:
        from curl_cffi import requests
        def fetch(url):
            response = requests.get(url, impersonate='chrome124', timeout=30)
            response.raise_for_status()
            return response.text
        mr, kith = fetch(MRPORTER), fetch(KITH)
    rows = parse_mrporter(mr, checked) + parse_kith(kith, checked)
    target = ROOT / 'data/common-projects-retail.json'
    target.write_text(json.dumps({'schemaVersion': 1, 'checkedAt': checked, 'products': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Common Projects: {len(rows)} exact stockist listings; no release date invented')


if __name__ == '__main__':
    main()
