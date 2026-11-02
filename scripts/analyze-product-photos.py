"""Read cached shoe uppers, retain photo provenance, and measure safe display bounds."""
import colorsys
import hashlib
import json
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/monthly'))
from image_signals import canvas_colour, canvas_mask, dhash


def colour_name(rgb):
    r,g,b=rgb; h,s,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)
    if v<.24:return 'Black'
    if s<.12:return 'White' if v>.81 else 'Light Grey' if v>.60 else 'Grey' if v>.36 else 'Charcoal'
    if .06<h<.18 and s<.48:return 'Beige' if v>.67 else 'Taupe' if s<.25 else 'Brown'
    if h<.06 or h>.95:return 'Pink' if v>.7 and s<.55 else 'Red' if v>.48 else 'Burgundy'
    if h<.13:return 'Tan' if v>.65 else 'Brown'
    if h<.20:return 'Yellow'
    if h<.46:return 'Olive' if h<.27 and v<.65 else 'Green'
    if h<.55:return 'Teal'
    if h<.73:return 'Navy' if v<.43 else 'Blue'
    return 'Purple'


def analyze(image):
    im=image.convert('RGB');small=im.resize((96,96));px=list(small.getdata());canvas=canvas_colour(px,96)
    if canvas is None:mask=bytearray([0]*len(px))
    else:mask=canvas_mask(px,96,canvas)
    coords=[(i%96,i//96) for i in range(len(px)) if not mask[i]]
    if len(coords)>96*96*.80 or canvas is None:
        # Dior/AMIRI use a shaded studio sweep. Model each row's background
        # from both visible edges instead of flooding a single flat colour.
        coords=[]
        for y in range(96):
            left=tuple(sum(px[y*96+x][c] for x in range(3))/3 for c in range(3))
            right=tuple(sum(px[y*96+x][c] for x in range(93,96))/3 for c in range(3))
            for x in range(3,93):
                expected=tuple(left[c]+(right[c]-left[c])*x/95 for c in range(3))
                if max(abs(px[y*96+x][c]-expected[c]) for c in range(3))>25:coords.append((x,y))
        # Ignore disconnected compression specks and distant sweep shadows.
        remaining=set(coords);components=[]
        while remaining:
            seed=remaining.pop();stack=[seed];component=[seed]
            while stack:
                x,y=stack.pop()
                for point in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                    if point in remaining:remaining.remove(point);stack.append(point);component.append(point)
            if len(component)>25:components.append(component)
        coords=[p for component in components for p in component]
        # Fill enclosed light upper panels between the visible outline edges.
        spans={}
        for x,y in coords:
            if y not in spans:spans[y]=[x,x]
            else:spans[y]=[min(spans[y][0],x),max(spans[y][1],x)]
        coords=[(x,y) for y,(l,r) in spans.items() for x in range(l,r+1)]
    if len(coords)<70 or len(coords)>96*96*.80:return None
    xs=sorted(x for x,y in coords);ys=sorted(y for x,y in coords)
    # Keep the full subject including sole and toe. Bounds control display only.
    l,t,r,b=min(xs),min(ys),max(xs)+1,max(ys)+1
    if r-l<12 or b-t<8:return None
    # Sample the upper central body, excluding the bottom 30% containing the sole.
    upper=[px[y*96+x] for x,y in coords if l+(r-l)*.10<x<r-(r-l)*.10 and t+(b-t)*.12<y<t+(b-t)*.66]
    if len(upper)<25:return None
    buckets=Counter(tuple(c//24 for c in p) for p in upper)
    key=buckets.most_common(1)[0][0]
    members=[p for p in upper if tuple(c//24 for c in p)==key]
    rgb=tuple(round(sum(p[c] for p in members)/len(members)) for c in range(3))
    margin=3
    frame={'x':max(0,l-margin)/96,'y':max(0,t-margin)/96,'width':(min(96,r+margin)-max(0,l-margin))/96,'height':(min(96,b+margin)-max(0,t-margin))/96,'imageWidth':im.width,'imageHeight':im.height}
    return {'bodyColor':'#%02x%02x%02x'%rgb,'colorName':colour_name(rgb),'photoHash':dhash(im),'frame':frame}


def main():
    catalog=json.loads((ROOT/'public/data/catalog.json').read_text(encoding='utf-8'))
    monthly=json.loads((ROOT/'public/data/monthly-catalog.json').read_text(encoding='utf-8'))
    target=ROOT/'data/product-photo-analysis.json'
    store=json.loads(target.read_text(encoding='utf-8')) if target.exists() else {'schemaVersion':1,'method':'upper-image-analysis','photos':{}}
    lux=set(['Louis Vuitton','Dior','Balenciaga','Prada','Gucci','Celine','Saint Laurent','Hermès','Chanel','Miu Miu','Alexander McQueen','Fendi','Valentino Garavani','Givenchy','Maison Margiela','Bottega Veneta','Loewe','Lanvin','Rick Owens','Jil Sander','Off-White','AMIRI','Loro Piana','Brunello Cucinelli','Zegna','Moncler','The Row','Golden Goose','Maison Mihara Yasuhiro','Common Projects','Axel Arigato','Autry','PANE','ALOHAS'])
    rows={}
    for p in catalog['products']+monthly['retail']:
        if p in monthly['retail'] and p['brand'] not in lux and p.get('colorway') and not __import__('re').search(r'미표기|미확인|unknown|^image',p['colorway'],__import__('re').I):continue
        url=(p.get('presentation') or {}).get('image') or p['image'];rows[url]=p
    def work(pair):
        url,p=pair
        if url in store['photos'] and store['photos'][url].get('version')==1 and not store['photos'][url].get('needsReview'):return url,store['photos'][url]
        cached=(p.get('presentation') or {}).get('cachedPath','')
        if cached and (ROOT/'public'/cached.lstrip('/')).exists():raw=(ROOT/'public'/cached.lstrip('/')).read_bytes()
        else:
            from curl_cffi import requests
            response=requests.get(url,impersonate='chrome124',timeout=25)
            response.raise_for_status();raw=response.content
        with Image.open(BytesIO(raw)) as im:
            im.load();a=analyze(im)
            if not a:
                # A nonstudio image needs review; never infer its background as shoe colour.
                return url,{'version':1,'needsReview':True,'reason':'upper-not-isolated'}
            ext='webp' if raw[:4]==b'RIFF' else 'png' if raw[:4]==b'\x89PNG' else 'jpg'
            if not cached:
                cached='/images/'+hashlib.sha256(raw).hexdigest()+'.'+ext
                (ROOT/'public'/cached.lstrip('/')).write_bytes(raw)
            presentation={'image':url,'cachedPath':cached}
            if p['brand']=='Dior':presentation['frame']=a['frame']
            return url,{'version':1,**a,'presentation':presentation}
    errors=[];done=0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures={pool.submit(work,pair):pair for pair in rows.items()}
        for f in as_completed(futures):
            try:
                url,a=f.result();store['photos'][url]=a
            except Exception as e:errors.append({'url':futures[f][0],'error':str(e)[:200]})
            done+=1
            if done%150==0:
                target.write_text(json.dumps(store,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('Analyzed',done,'/',len(rows),flush=True)
    target.write_text(json.dumps(store,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (ROOT/'logs/photo-analysis-errors.json').write_text(json.dumps(errors,indent=2),encoding='utf-8')
    print('Photo analysis complete',len(store['photos']),'errors',len(errors),'review',sum(bool(p.get('needsReview')) for p in store['photos'].values()),flush=True)


if __name__=='__main__':main()
