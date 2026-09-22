from pathlib import Path
import json, re, datetime

ROOT=Path(__file__).resolve().parents[1]
html_path=ROOT/'public'/'index.html'
state_path=ROOT/'data'/'runtime_state.json'
state=json.loads(state_path.read_text(encoding='utf-8'))
text=html_path.read_text(encoding='utf-8')

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

products=state.get('products') or []
trend=state.get('trendData') or {'updated':'','items':[]}
meta=state.get('meta') or {}
coverage=state.get('coverage') or []
text=replace_js_value(text,'const SEED_PRODUCTS=',products)
text=replace_js_value(text,'const TREND_SNAPSHOT=',trend)
# Make local/browser cache version date-specific so deployed snapshot wins over stale visitor cache.
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M')
text=re.sub(r"const LIVE_KEY='shoes-ss-live-products-v[^']+'",f"const LIVE_KEY='shoes-ss-live-products-pub-{stamp}'",text,count=1)
text=re.sub(r"SEEN_KEY='shoes-ss-seen-v[^']+'",f"SEEN_KEY='shoes-ss-seen-pub-{stamp}'",text,count=1)
text=re.sub(r"TREND_KEY='shoes-ss-trend-v[^']+'",f"TREND_KEY='shoes-ss-trend-pub-{stamp}'",text,count=1)
text=re.sub(r"META_KEY='shoes-ss-meta-v[^']+'",f"META_KEY='shoes-ss-meta-pub-{stamp}'",text,count=1)
html_path.write_text(text,encoding='utf-8')
summary={
  'updated_at':meta.get('lastFinished') or trend.get('updated'),
  'product_count':len(products),
  'mandatory_brand_count':len(state.get('mandatoryBrands') or []),
  'mandatory_failed':[x.get('brand') for x in coverage if x.get('brand') in (state.get('mandatoryBrands') or []) and not x.get('responses')],
  'mandatory_missing':meta.get('mandatoryMissing') or [],
  'new_items':meta.get('lastNewItems',0),
  'coverage':coverage,
}
(ROOT/'data'/'last_update.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
