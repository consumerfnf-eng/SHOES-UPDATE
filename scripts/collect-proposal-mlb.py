"""Collect observed official MLB comparison products; never insert catalog rows."""
import concurrent.futures,hashlib,json,re,urllib.request,io
from datetime import datetime,timezone
from pathlib import Path
from bs4 import BeautifulSoup
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'.secrets/proposals-105';DEST.mkdir(parents=True,exist_ok=True)
ASSETS=ROOT/'public/proposals/mlb';ASSETS.mkdir(parents=True,exist_ok=True)
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
    return urllib.request.urlopen(req,timeout=30).read()
records=[];seen=set()
# All category IDs were read from the official NEW page's categoryInfo.
for category in ['MBMB04NEW','MBMB04B07','MBMB04B01','MBMB04B02','MBMB04B05','MBMB04B03']:
    url='https://www.mlb-korea.com/display/'+category
    try:
        raw=get(url);(DEST/(category+'.html')).write_bytes(raw)
        soup=BeautifulSoup(raw,'html.parser');data=json.loads(soup.find('script',id='__NEXT_DATA__').string)['props']['pageProps']
        for entry in data.get('jsonLdProductList',{}).get('itemListElement',[]):
            p=entry['item'];style=str(p.get('sku','')).split('-')[0]
            if not style or style in seen:continue
            if not p.get('image') or not p.get('offers',{}).get('price'):continue
            seen.add(style);records.append({'id':'mlb-'+style,'key':'mlb:'+style,'kind':'mlb','brand':'MLB','name':p['name'],'modelKey':'MLB|'+style,'remoteImage':p['image'],'url':p['offers']['url'],'sourceListing':url,'observedPrice':int(float(p['offers']['price'])),'text':p['name']+' '+(p.get('description') or ''),'credit':'MLB · 한국 공식몰 비교 상품','sourceSeason':'공식몰 현행 상품','sourceDate':datetime.now(timezone.utc).isoformat(),'productType':'footwear'})
    except Exception as e:print(category,type(e).__name__,str(e)[:120],flush=True)
def photo(row):
    try:
        gallery=[]
        # Listing cards can be campaign photos. Use the observed PDP product
        # gallery for a legible construction baseline, without guessing URLs.
        try:
            detail=BeautifulSoup(get(row['url']),'html.parser')
            props=json.loads(detail.find('script',id='__NEXT_DATA__').string)['props']['pageProps']
            gallery=props.get('data',{}).get('mainImageUrls',[])
            if gallery:row={**row,'remoteImage':gallery[0]}
        except Exception:pass
        raw=get(row['remoteImage'])
        with Image.open(io.BytesIO(raw)) as probe:
            if probe.height>probe.width*1.2 and len(gallery)>1:
                row={**row,'remoteImage':gallery[1]};raw=get(row['remoteImage'])
        with Image.open(io.BytesIO(raw)) as opened:
            im=ImageOps.exif_transpose(opened).convert('RGBA');bg=Image.new('RGBA',im.size,'white');bg.alpha_composite(im);im=bg.convert('RGB');im.thumbnail((1800,1800));buf=io.BytesIO();im.save(buf,'JPEG',quality=96);raw=buf.getvalue();w,h=im.size
        if min(w,h)<180:return None
        sha=hashlib.sha256(raw).hexdigest();path=ASSETS/(sha+'.jpg');path.write_bytes(raw)
        return {**row,'imageHash':sha,'path':path.relative_to(ROOT).as_posix(),'image':'/'+path.relative_to(ROOT/'public').as_posix(),'original':'/'+path.relative_to(ROOT/'public').as_posix(),'width':w,'height':h}
    except Exception as e:print('photo',row['id'],type(e).__name__,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:photos=[r for r in pool.map(photo,records) if r]
(DEST/'mlb-baselines.json').write_text(json.dumps({'schemaVersion':1,'records':photos},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'officialModels':len(photos),'range':sorted({r['observedPrice'] for r in photos})}),flush=True)
