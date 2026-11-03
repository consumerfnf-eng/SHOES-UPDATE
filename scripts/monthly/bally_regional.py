"""Current Bally UAE regional-store sneaker assortment; stock confirmation is not a release date."""
import hashlib,json,re,time
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]

def collect():
 excluded=json.loads((ROOT/'config/excluded-brands.json').read_text(encoding='utf-8'))
 if any(b.get('name')=='Bally' for b in excluded.get('brands',[])):
  print('Bally collection disabled by site brand policy');return
 from curl_cffi import requests
 checked=datetime.now(timezone.utc).isoformat();rows=[];pages=[]
 for page in range(1,13):
  url=f'https://www.bally.ae/products.json?limit=250&page={page}'
  response=requests.get(url,impersonate='chrome124',timeout=35);response.raise_for_status();payload=response.text;products=response.json()['products'];pages.append({'url':url,'count':len(products),'contentHash':hashlib.sha256(payload.encode()).hexdigest()})
  for p in products:
   if not re.search(r'sneaker|trainer',p['title']+' '+p.get('product_type',''),re.I) or re.search(r'kids|children|junior|baby',p['title']+' '+p.get('product_type',''),re.I):continue
   available=[v for v in p['variants'] if v.get('available')]
   if not available or not p.get('images'):continue
   color_option=next((i+1 for i,o in enumerate(p.get('options',[])) if re.search('colou?r',o['name'],re.I)),None);colors={}
   for v in available:colors.setdefault(v.get('option'+str(color_option),'') if color_option else '',v)
   for color,v in colors.items():
    product_url='https://www.bally.ae/products/'+p['handle'];image=next((i['src'] for i in p['images'] if i.get('id')==v.get('featured_image',{}).get('id')),p['images'][0]['src']) if isinstance(v.get('featured_image'),dict) else p['images'][0]['src'];style=str(p['id'])+(':'+color if color else '')
    rows.append({'id':'bally-uae-'+style,'brand':'Bally','name':p['title'],'url':product_url,'image':image,'style':style,'styleType':'retailer-product-id','source':'retail-bally-uae','retailer':'Bally UAE (regional store)','category':'sneaker','officialCategory':p.get('product_type','Sneakers'),'colorway':color,'material':'','listedAt':p.get('published_at',''),'newnessBasis':'current-assortment','availabilityEvidence':{'verified':True,'kind':'retail-current-assortment','productUrl':product_url,'listingUrl':url,'verifiedAt':checked,'contentHash':pages[-1]['contentHash']},'imageCandidates':[{'url':i['src'],'alt':p['title']} for i in p['images']]})
  print('Bally regional page',page,'products',len(products),'eligible available sneakers',len(rows),flush=True)
  if len(products)<250:break
  time.sleep(.5)
 else:raise RuntimeError('Bally regional catalogue pagination truncated; publication withheld')
 result={'schemaVersion':1,'checkedAt':checked,'source':'Bally UAE regional store; separate from bally.com official records','pages':pages,'products':rows};(ROOT/'data/bally-regional-retail.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('Verified Bally regional sneaker variants',len(rows),flush=True)
if __name__=='__main__':collect()
