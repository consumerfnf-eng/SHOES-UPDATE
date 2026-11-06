"""Prepare private, source-backed proposals. Never changes the shoe catalog.

--prepare upgrades observed same-asset photos and writes a draft. Finalization
requires a visual audit per season; candidate retrieval is not an approval.
"""
import argparse,concurrent.futures,hashlib,io,json,re,urllib.request
from bs4 import BeautifulSoup
from datetime import datetime,timezone
from pathlib import Path
from PIL import Image,ImageOps,ImageChops
ROOT=Path(__file__).resolve().parents[1];PRIVATE=ROOT/'.secrets/proposals-105'
def read(p):return json.loads(p.read_text(encoding='utf8'))
def write(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf8')
def normalized(s):return re.sub(r'[^a-z0-9가-힣]','',s.lower())
def caption(note,fallback):
 # A private rejection audit can describe a mismatch. Published captions only
 # describe the visible feature being referenced, never a missing-evidence row.
 parts=re.split(r'(?<=[.!?])\s+|\n',str(note or ''))
 kept=[s for s in parts if not re.search(r'미확인|확인하지|확인할 수 없|근거\s*없|확정하지|보류',s)]
 return ' '.join(kept).strip() or fallback
def display_name(value,brand,style=''):
 translations={
  'Basket Racer 45 en nylon et cuir suédé':'Racer 45 나일론·스웨이드 스니커즈',
  'Baskets Racing Mid-Top en nylon et cuir':'Racing Mid-Top 나일론·레더 스니커즈',
  'Baskets Racing Low en nylon et cuir':'Racing Low 나일론·레더 스니커즈'}
 if value in translations:return translations[value]
 if re.search(r'[\u3040-\u30ff\u4e00-\u9fff]',value):return brand+' 풋웨어 '+style
 return value
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--prepare',action='store_true');ap.add_argument('--no-download',action='store_true');ap.add_argument('--repair-only',action='store_true');ap.add_argument('--reviewed-season',choices=['27SS','27FW','28SS']);args=ap.parse_args()
 if args.reviewed_season and not args.prepare:ap.error('--reviewed-season is staging only; combine with --prepare')
 ideas=[]
 for season in ['27SS','27FW','28SS']:
  data=read(PRIVATE/f'ideas-{season}.json');ideas+=data['ideas'] if isinstance(data,dict) else data
 matches={b['id']:b for b in read(PRIVATE/'matches.json')['boards']}
 reports={r['id']:r for r in read(ROOT/'public/data/forecast.json')['reports']}
 pages={r['id']:r for r in read(PRIVATE/'wgsn-text.json')['reports']}
 catalog={p['id']:p for p in read(ROOT/'public/data/catalog.json')['products']}
 shows={p['id']:p for p in read(ROOT/'public/data/catwalk.json')['looks']}
 upgrades_path=PRIVATE/'photo-upgrades.json';upgrades=read(upgrades_path) if upgrades_path.exists() else {}
 attempts_path=PRIVATE/'photo-attempts.json';attempted=set(read(attempts_path)) if attempts_path.exists() else set()
 assets=ROOT/'public/proposals/originals105';assets.mkdir(parents=True,exist_ok=True)
 selected={r['key']:r for b in matches.values() for r in [b['hero']]+b['references']}
 if args.repair_only:
  alpha=set(read(PRIVATE/'alpha-upgrades.json'))
  selected={k:r for k,r in selected.items() if k in alpha or min(r['width'],r['height'])<350}
  for k in selected:upgrades.pop(k,None)
 def upgrade(r):
  if r.get('manualPhoto'):return r['key'],None
  if r['key'] in upgrades and (ROOT/'public'/upgrades[r['key']]['image'].lstrip('/')).exists():return r['key'],upgrades[r['key']]
  if r['key'] in attempted and not args.repair_only:return r['key'],None
  if r['kind']=='show':url=shows[r['id']].get('originalUrl') or shows[r['id']].get('sourceUrl')
  elif r['kind']=='product':
   p=catalog[r['id']];url=p.get('presentation',{}).get('image') or p.get('image')
   if url:
    if r['brand']=='KOLON SPORT' and '_LS' in url:
     try:
      req=urllib.request.Request(r['url'],headers={'User-Agent':'Mozilla/5.0'})
      html=urllib.request.urlopen(req,timeout=15).read();soup=BeautifulSoup(html,'html.parser')
      target=url.replace('/LS','/LM').replace('_LS','_LM')
      observed={im.get('src') for im in soup.select('img[src]')}
      if target in observed:url=target
     except Exception:pass
    url=re.sub(r'Resize=\(\d+\)','Resize=(2000)',url);url=re.sub(r'([?&](?:sw|sh|wid|hei|width|height)=)\d+',lambda m:m[1]+'1800',url);url=re.sub(r'/w_\d+/','/w_1600/',url)
    url=re.sub(r'(?:%20|\s)\d+w$','',url)
    if '/cdn/shop/' in url:url=re.sub(r'_\d+x\d*\.(jpg|jpeg|png|webp)(?=\?|$)',r'_1800x.\1',url,flags=re.I)
    if 'assets.hermes.com/is/image/' in url:url+='&wid=1800&hei=1800'
    if '/_jcr_content/renditions/' in url:url=url.split('/_jcr_content/')[0]
    if 'loropiana.com' in url:url=url.replace('_SMALL.jpg','_LARGE.jpg')
  else:url=r.get('remoteImage')
  if not url:return r['key'],None
  try:
   request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
   with urllib.request.urlopen(request,timeout=18) as response:raw=response.read(24*1024*1024)
   with Image.open(io.BytesIO(raw)) as im:
    im=ImageOps.exif_transpose(im).convert('RGBA');bg=Image.new('RGBA',im.size,'white');bg.alpha_composite(im);im=bg.convert('RGB');w,h=im.size
    if w*h<=r['width']*r['height']*1.25:return r['key'],None
    # Same observed asset, not a substitute image chosen by filename guess.
    with Image.open(ROOT/r['path']) as old:
     a=ImageOps.fit(old.convert('L'),(32,32));b=ImageOps.fit(im.convert('L'),(32,32));diff=sum(ImageChops.difference(a,b).getdata())/1024
    if diff>35:return r['key'],None
    buf=io.BytesIO();im.save(buf,'JPEG',quality=96,optimize=True);raw=buf.getvalue()
   sha=hashlib.sha256(raw).hexdigest();dest=assets/(sha+'.jpg');dest.write_bytes(raw)
   return r['key'],{'image':'/proposals/originals105/'+dest.name,'width':w,'height':h,'sourceImageUrl':url,'comparisonMeanDifference':round(diff,2)}
  except Exception:return r['key'],None
 if not args.no_download:
  with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
   for key,result in pool.map(upgrade,selected.values()):
    if result:upgrades[key]=result
  write(attempts_path,sorted(attempted|selected.keys()))
 write(upgrades_path,upgrades)
 audits={}
 if not args.prepare or args.reviewed_season:
  for season in ['27SS','27FW','28SS']:
   if args.prepare and season!=args.reviewed_season:continue
   audit=read(PRIVATE/f'audit-{season}.json')
   for b in audit['boards']:audits[b['id']]=b
 for idea in ideas:
  found=matches[idea['id']];audit=audits.get(idea['id'])
  reviewed=bool(audit and audit.get('status')=='approved')
  if not args.prepare and (not audit or audit.get('status')!='approved'):raise ValueError('Visual audit required: '+idea['id'])
  def photo(r,hero=False):
   upgraded={} if r.get('manualPhoto') else upgrades.get(r['key'],{});result={k:v for k,v in r.items() if k not in ['path','text','group','remoteImage','sourceListing','frame','matchEvidence','listPrice','manualPhoto','reviewedNote']}
   result.update({k:v for k,v in upgraded.items() if k in ['image','width','height']});result['original']=result['image'];result['kind']='catwalk' if r['kind']=='show' else r['kind'];result['reviewStatus']='reviewed' if reviewed else 'candidate'
   result['name']=display_name(result['name'],result['brand'],result.get('style',''))
   result['cropMode']='auto'
   if r['kind']=='show':
    result['sourceSeason']=shows[r['id']]['season'];result['url']=shows[r['id']].get('sourceFeedUrl') or shows[r['id']].get('originalUrl') or shows[r['id']].get('sourceUrl')
   result['quality']={'width':result['width'],'height':result['height'],'rendition':'출처의 큰 원본' if upgraded else '보유 원본'}
   result['matchEvidence']={'photoRole':r.get('roleLabel','착용 비례와 분위기'),'review':'시각 검수 완료' if reviewed else '후보'}
   if hero:
    result['frame']={'x':0,'y':0,'width':1,'height':1};result['seasonRelation']='same-season' if idea['season']=='27SS' else 'earlier-season'
   if audit:
    notes=audit.get('notes',{});result['note']=r.get('reviewedNote') or notes.get(r['key'],r.get('note',''))
   result['note']=caption(result.get('note'),r.get('roleLabel','착용 비례와 분위기')+' 참고')
   return result
  idea['hero']=photo(found['hero'],True);idea['references']=[photo(r) for r in found['references']]
  for f in idea['forecast']:
   r=reports[f['id']];page=pages[f['id']]['pages'][f['page']-1]['text']
   if len(page.strip())<60 or '502 Bad Gateway' in page:raise ValueError('Invalid WGSN source page '+idea['id'])
   if normalized(f['heading']) not in normalized(page):raise ValueError('Heading not on page: '+idea['id']+' '+f['heading'])
   f.update({'title':r['title'],'shortTitle':r['title'].replace('Men’s & Women’s ',''),'url':r['url']})
  application='\n'.join(idea['strategies'][:3])
  evidence=' / '.join(('소재' if 'Material' in reports[f['id']]['title'] else '실루엣')+' p.'+str(f['page']) for f in idea['forecast'][:2])
  idea['boardCopy']={'insight':idea['insight'],'application':application,'memo':idea['strategies'][3]+'\nWGSN · '+evidence+'\n목표가 가설 · '+format(idea['targetPrice'],',')+'원'}
 config={'schemaVersion':3,'brand':'MLB','seasons':['27SS','27FW','28SS'],'ideas':ideas,'asOf':datetime.now(timezone.utc).date().isoformat(),'method':'WGSN 보고서의 실제 시즌·페이지와 공식 상품, 쇼 사진을 대조한 MLB 개발 제안. 화보의 실제 출처 시즌과 개발 기획 시즌을 구분해 표시. 목표 가격과 기능은 개발 가설이며 시제품 시험을 통해 검증.'}
 destination=PRIVATE/'resolved-draft.json' if args.prepare else ROOT/'data/season-proposals.json'
 if not args.prepare:
  backup=PRIVATE/'legacy-season-proposals.json'
  if not backup.exists():backup.write_bytes(destination.read_bytes())
 write(destination,config);print(json.dumps({'ideas':len(ideas),'upgradedPhotos':len(upgrades),'draft':args.prepare}),flush=True)
if __name__=='__main__':main()
