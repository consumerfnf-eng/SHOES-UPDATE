from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
import json, re, datetime
from validate_coverage import validate

def replace_js_value(src, marker, new_value):
    start=src.index(marker)+len(marker)
    opening=src[start]
    pairs={'[':']','{':'}'}
    if opening not in pairs: raise ValueError(f'Unsupported JS value after {marker}')
    close=pairs[opening]; depth=0; ins=False; esc=False
    for i in range(start,len(src)):
        ch=src[i]
        if ins:
            if esc: esc=False
            elif ch=='\\': esc=True
            elif ch=='"': ins=False
            continue
        if ch=='"': ins=True
        elif ch==opening: depth+=1
        elif ch==close:
            depth-=1
            if depth==0:
                return src[:start]+json.dumps(new_value,ensure_ascii=False,separators=(',',':'))+src[i+1:]
    raise ValueError(f'Unclosed value for {marker}')

def read_js_value(text, marker):
    return json.JSONDecoder().raw_decode(text[text.index(marker)+len(marker):])[0]

def product_url(product):
    value = urlsplit(product.get('url', ''))
    path = re.sub(r'/collections/[^/]+/products/', '/products/', value.path).rstrip('/')
    return urlunsplit((value.scheme.lower(), value.netloc.lower().removeprefix('www.'), path, '', ''))

def preserve_products(existing, incoming):
    # Keep even previously hidden records. A source outage or display filter must
    # never delete the last good source snapshot.
    merged = list(existing)
    ids = {p.get('id') for p in existing}
    urls = {product_url(p) for p in existing}
    styles = {(p.get('brand'), p.get('style', '').strip().lower()) for p in existing if p.get('style')}
    for product in incoming:
        style = (product.get('brand'), product.get('style', '').strip().lower())
        url = product_url(product)
        if product.get('id') in ids or url in urls or (style[1] and style in styles):
            continue
        merged.append(product)
        ids.add(product.get('id')); urls.add(url)
        if style[1]: styles.add(style)
    return merged

def patch(root):
    html_path = root/'public/index.html'
    state = json.loads((root/'data/runtime_state.json').read_text(encoding='utf-8'))
    required = [row['canonical'] for row in json.loads((root/'config/mandatory_brands.json').read_text(encoding='utf-8'))['brands']]
    failed = validate(state, required)
    text = html_path.read_text(encoding='utf-8')
    existing = read_js_value(text, 'const SEED_PRODUCTS=')
    products = preserve_products(existing, state['products'])
    trend = state.get('trendData') or read_js_value(text, 'const TREND_SNAPSHOT=')
    meta = state.get('meta') or {}
    text = replace_js_value(text, 'const SEED_PRODUCTS=', products)
    text = replace_js_value(text, 'const TREND_SNAPSHOT=', trend)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
    for key, suffix in [('LIVE', 'live-products'), ('SEEN', 'seen'), ('TREND', 'trend'), ('META', 'meta')]:
        text, count = re.subn(rf"{key}_KEY='shoes-ss-{suffix}-[^']+'", f"{key}_KEY='shoes-ss-{suffix}-pub-{stamp}'", text, count=1)
        if count != 1: raise ValueError(f'Missing cache key: {key}')
    # Initialize the deployed daily status from this run rather than the import date.
    defaults = {key: meta[key] for key in ['lastUpdateDay', 'lastFinished', 'lastNewItems'] if key in meta}
    defaults.update(dailySnapshot=True, unavailableBrands=len(failed), lastNewItems=len(products)-len(existing))
    text = re.sub(r"META=safeParse\(APP_STORAGE.getItem\(META_KEY\),\{[^}]*\}\)",
                  lambda _: 'META=safeParse(APP_STORAGE.getItem(META_KEY),'+json.dumps(defaults, ensure_ascii=False)+')', text, count=1)
    summary = {
        'updated_at': meta.get('lastFinished'), 'product_count': len(products),
        'mandatory_brand_count': len(required), 'mandatory_failed': failed,
        'mandatory_missing': [], 'new_items': len(products)-len(existing),
        'source_checks_complete': not failed, 'catalog_exhaustive': False,
        'coverage': state['coverage'], 'crawler': state['crawler'],
    }
    # Commit only after all preconditions and serialization have succeeded.
    staged = html_path.with_suffix('.html.tmp')
    staged.write_text(text, encoding='utf-8'); staged.replace(html_path)
    for destination in [root/'data/last_update.json', root/'public/data/last_update.json']:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Preserved {len(existing)} previous records; added {len(products)-len(existing)}; {len(failed)} unavailable mandatory sources')
    return summary

if __name__ == '__main__':
    patch(Path(__file__).resolve().parents[1])
