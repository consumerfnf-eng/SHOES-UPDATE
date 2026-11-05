"""Cache only prepared SPORTS/CASUAL records; never rewrite a LUX snapshot."""
from pathlib import Path
import json,sys,io,hashlib,urllib.request
from concurrent.futures import ThreadPoolExecutor,as_completed
from PIL import Image,ImageOps,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parent/'monthly'))
from image_signals import body_colour
from product_photo_palette import color_name
source=Path(sys.argv[1]);dest=Path(sys.argv[2]);d=json.loads(source.read_text(encoding='utf-8'));public=Path('public');cachepath=Path('data/photo-cache.json');cache=json.loads(cachepath.read_text(encoding='utf-8'));jobs={p['presentation']['image'] for p in d['products']};done={};errors=[]
groups=json.loads(Path('config/site-brand-groups.json').read_text(encoding='utf8'))
allowed_groups=['SPORTS','CASUAL']+(['LUX'] if '--include-lux' in sys.argv[3:] else [])
allowed={b for group in groups['groups'] if group['name'] in allowed_groups for b in group['priority']}
assert all(p['brand'] in allowed for p in d['products']),'Explicit LUX permission required; excluded brands cannot enter photo preparation'
frames={p['presentation']['image']:p['presentation'].get('frame') for p in d['products']}
manifest=Path('reports/sports-casual-photo-downloads.json')
downloads=json.loads(manifest.read_text(encoding='utf-8')).get('images',{}) if manifest.exists() else {}
def photo(url):
 old=cache.get('images',{}).get(url,{}) or downloads.get(url,{})
 if old.get('path') and (public/old['path'].lstrip('/')).exists():
  data=(public/old['path'].lstrip('/')).read_bytes();im=Image.open(io.BytesIO(data));path=old['path']
  if url in downloads and (min(im.size)<180 or im.width*im.height>40000000):raise ValueError('Invalid/too small product image')
 else:
  req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'image/webp,image/jpeg,image/png,*/*'})
  with urllib.request.urlopen(req,timeout=25) as response:data=response.read(20*1024*1024)
  im=Image.open(io.BytesIO(data));im.load();fmt=im.format;ext={'JPEG':'jpg','PNG':'png','WEBP':'webp'}.get(fmt)
  if not ext or min(im.size)<180 or im.width*im.height>40000000:raise ValueError('Invalid/too small product image')
  path='/images/'+hashlib.sha256(data).hexdigest()+'.'+ext
  if not (public/path.lstrip('/')).exists():(public/path.lstrip('/')).write_bytes(data)
 rgba=ImageOps.exif_transpose(im).convert('RGBA');background=Image.new('RGBA',rgba.size,'white');background.alpha_composite(rgba);rgb=background.convert('RGB');frame=frames.get(url)
 if frame:
  x,y,w,h=[frame[k] for k in ['x','y','width','height']];assert min(x,y)>=0 and w>0 and h>0 and x+w<=1 and y+h<=1
  rgb=rgb.crop((round(x*rgb.width),round(y*rgb.height),round((x+w)*rgb.width),round((y+h)*rgb.height)))
 body=body_colour(rgb);rgb.thumbnail((640,640));buf=io.BytesIO();rgb.save(buf,'WEBP',quality=86,method=4);thumb=buf.getvalue();thumbpath='/images/'+hashlib.sha256(thumb).hexdigest()+'.webp'
 if not (public/thumbpath.lstrip('/')).exists():(public/thumbpath.lstrip('/')).write_bytes(thumb)
 return {'path':path,'width':im.width,'height':im.height,'thumbnail':thumbpath,'thumbnailWidth':rgb.width,'thumbnailHeight':rgb.height,'bytes':len(data),'bodyColor':body,'cropped':bool(frame)}
with ThreadPoolExecutor(max_workers=6) as pool:
 futures={pool.submit(photo,url):url for url in jobs}
 for future in as_completed(futures):
  url=futures[future]
  try:done[url]=future.result()
  except Exception as e:errors.append({'url':url,'error':str(e)})
  if (len(done)+len(errors))%30==0:print('Cached',len(done),'of',len(jobs),'errors',len(errors),flush=True)
for p in d['products']:
 info=done.get(p['presentation']['image'])
 if not info:continue
 p['presentation'].update({'cachedPath':info['path'],'thumbnail':{'path':info['thumbnail'],'width':info['thumbnailWidth'],'height':info['thumbnailHeight'],**({'cropped':True} if info['cropped'] else {})}})
 if info['bodyColor']:
  p['bodyColor']=info['bodyColor']
  if not p.get('colorway') or p.get('colorEvidence',{}).get('method')=='upper-image-analysis':
   p['colorway']=color_name(info['bodyColor']);p['colorEvidence']={'method':'upper-image-analysis','image':p['presentation']['image'],'hex':info['bodyColor'],'label':p['colorway']}
 cache.setdefault('images',{}).setdefault(p['presentation']['image'],{'path':info['path'],'width':info['width'],'height':info['height'],'bytes':info['bytes']})
d['photoErrors']=errors;d['products']=[p for p in d['products'] if p['presentation'].get('cachedPath')];dest.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8');cachepath.write_text(json.dumps(cache,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
models={}
for p in d['products']:models.setdefault(p.get('modelGroupId') or p.get('modelKey') or p['id'],p)
rows=list(models.values())
for start in range(0,len(rows),36):
 sheet=Image.new('RGB',(1200,900),'white');draw=ImageDraw.Draw(sheet)
 for i,p in enumerate(rows[start:start+36]):
  image=Image.open(public/p['presentation']['cachedPath'].lstrip('/')).convert('RGB');image.thumbnail((184,116));x=(i%6)*200;y=(i//6)*150;sheet.paste(image,(x+(200-image.width)//2,y));draw.text((x+4,y+118),(p.get('manufacturerStyle') or p['style'])[:25],fill='#253c50');draw.text((x+4,y+132),p.get('colorway','')[:25],fill='#4c6d79')
 sheet.save(dest.parent/(dest.stem+'-contact-'+str(start//36)+'.jpg'))
print('Completed',len(d['products']),'variants;',len(models),'models;',len(errors),'photo errors')
