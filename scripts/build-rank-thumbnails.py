"""Cache source ranking cards independently from catalogue eligibility."""
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import urllib.request
from PIL import Image, ImageOps

ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'public/data/rank-boards.json').read_bytes())
cache=json.loads((ROOT/'data/photo-cache.json').read_bytes()).get('images',{}) if (ROOT/'data/photo-cache.json').exists() else {}
catalog=json.loads((ROOT/'public/data/catalog.json').read_bytes())
monthly=json.loads((ROOT/'public/data/monthly-catalog.json').read_bytes())
by_url={}
for p in catalog.get('products',[])+monthly.get('retail',[]):
    thumb=p.get('presentation',{}).get('thumbnail',{}).get('path')
    if thumb:
        for key in [p.get('url'),p.get('image'),p.get('presentation',{}).get('image')]:
            if key: by_url[key]=thumb

def render(item):
    existing=by_url.get(item.get('url')) or by_url.get(item.get('image'))
    if existing and (ROOT/'public'/existing.lstrip('/')).exists():
        item['thumbnail']=existing
        return True
    url=item.get('image','')
    if not url.startswith('https://'): return False
    checkpoint=ROOT/'logs/rank-images'
    checkpoint.mkdir(parents=True,exist_ok=True)
    record=checkpoint/(hashlib.sha256(url.encode()).hexdigest()+'.json')
    if record.exists():
        path=json.loads(record.read_bytes())['path']
        if (ROOT/'public'/path.lstrip('/')).exists(): item['thumbnail']=path; return True
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'image/avif,image/webp,image/*,*/*;q=0.8'})
        with urllib.request.urlopen(req,timeout=20) as response: raw=response.read(12*1024*1024)
        with Image.open(io.BytesIO(raw)) as im:
            image=ImageOps.exif_transpose(im).convert('RGBA')
            canvas=Image.new('RGBA',image.size,'white');canvas.alpha_composite(image)
            image=canvas.convert('RGB');image.thumbnail((400,400),Image.Resampling.LANCZOS)
            buffer=io.BytesIO();image.save(buffer,'WEBP',quality=82,method=4);encoded=buffer.getvalue()
        path='/images/'+hashlib.sha256(encoded).hexdigest()+'.webp'
        (ROOT/'public'/path.lstrip('/')).write_bytes(encoded)
        record.write_text(json.dumps({'path':path}),encoding='utf-8');item['thumbnail']=path;return True
    except Exception as error:
        print(f'Ranking image retained at source: {item.get("rank")} {type(error).__name__}',flush=True);return False

items=[item for board in data['boards'] for item in board.get('items',[])]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(render,items))
(ROOT/'public/data/rank-boards.json').write_text(json.dumps(data,ensure_ascii=False)+'\n',encoding='utf-8')
print(f'Ranking thumbnails: {sum(results)}/{len(items)} cached; native ranks and scope unchanged',flush=True)
