"""Private review shortlists only. Never approves or publishes a photo."""
import collections,json,re,sqlite3
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps,ImageDraw
from proposal_text_features import encode_texts
from clip_classify import LETTERBOX_ENCODER
P=Path('.secrets/proposals-105')
def read(f):return json.loads(f.read_text(encoding='utf8'))
def main():
 ideas={}
 for season in ['27SS','27FW','28SS']:
  d=read(P/f'ideas-{season}.json')
  for i in d['ideas'] if isinstance(d,dict) else d:ideas[i['id']]=i
 boards={b['id']:b for b in read(P/'matches.json')['boards']};inventory=read(P/'inventory.json')['records'];inventory=[r for r in inventory if not re.search(r'\bpants?\b|\bjackets?\b|\bshorts\b|셔츠|팬츠|재킷|재킷|가방',r['name'],re.I)]
 db=sqlite3.connect('.secrets/clip/features.sqlite');features={h:np.frombuffer(v,dtype='<f4') for h,v in db.execute('SELECT hash,vector FROM features WHERE encoder=?',(LETTERBOX_ENCODER,))};inventory=[r for r in inventory if r['imageHash'] in features]
 for r in inventory:
  with Image.open(r['path']) as im:r['width'],r['height']=im.size
 inventory=[r for r in inventory if min(r['width'],r['height'])>=200]
 vectors=np.stack([features[r['imageHash']] for r in inventory]);issues=[]
 for season in ['27FW','28SS']:
  for b in read(P/f'audit-{season}.json')['boards']:
   for issue in b.get('issues',[]):
    slot=issue['slot']
    if slot=='concept':continue
    i=ideas[b['id']];query=i['photoQuery'] if slot=='hero' else i['referencePlan'][int(slot)]['query']
    issues.append({'id':b['id'],'season':season,'slot':slot,'query':query,'reason':issue['reason']})
 classes={'sneaker':'a photo of low top sneakers','boot':'a photo of high boots','ballet':'a photo of ballet flats','sandal':'a photo of open toe strap sandals','mule':'a photo of backless mules and clogs','heel':'a photo of high heel pumps','person':'a full body fashion model photograph'}
 qs=['a clear footwear photograph, '+r['query'] for r in issues];texts=encode_texts(qs+list(classes.values()));classscores=vectors@np.stack([texts[q] for q in classes.values()]).T
 anchors={b['references'][0]['modelKey']:b['id'] for b in boards.values()};heroHashes={b['hero']['imageHash']:b['id'] for b in boards.values()};out=[];folder=P/'fix-shortlists';folder.mkdir(exist_ok=True)
 for issue,query in zip(issues,qs):
  b=boards[issue['id']];i=ideas[b['id']];slot=issue['slot'];scores=vectors@texts[query];q=i['photoQuery'].lower();last=i['construction']['last'].lower()
  boot=bool(re.search(r'boot|high|chukka|midboot|snow',last));sandal=bool(re.search(r'sandal|open.toe|slide',q));ballet=bool(re.search(r'ballet|mary jane|ballerina',q));want=1 if boot else 3 if sandal else 2 if ballet else 0
  candidates=[];used={r['imageHash'] for idx,r in enumerate(b['references']) if idx!=slot}
  for n,r in enumerate(inventory):
   if slot=='hero':
    if r['kind']!='show' or min(r['width'],r['height'])<700 or (r['imageHash'] in heroHashes and heroHashes[r['imageHash']]!=b['id']):continue
   elif slot==4:
    if r['kind']!='show':continue
   elif slot==5:
    if r['kind']!='mlb':continue
   elif r['kind']!='product':continue
   if slot==0 and r['modelKey'] in anchors and anchors[r['modelKey']]!=b['id']:continue
   if r['imageHash'] in used or r['imageHash']==b['hero']['imageHash']:continue
   name=r['name'].lower()
   if not boot and re.search(r'\bboots?\b|\bhigh.top\b|부츠|하이탑',name):continue
   if i['season']!='27FW' and re.search(r'shearling|fleece|fur\b|패딩|플리스|퍼\s|보온',name):continue
   if classscores[n,5]>classscores[n,want]+.025:continue
   # Relative type agreement, rather than a claim of calibrated accuracy.
   score=float(scores[n])+.5*float(classscores[n,want]-max(classscores[n,:6]))
   if r['kind']=='product' and classscores[n,6]>classscores[n,want]+.01:score-=.08
   candidates.append((score,n))
  options=[{**inventory[n],'score':float(s)} for s,n in sorted(candidates,reverse=True)[:8]];out.append({**issue,'alternatives':options})
  sheet=Image.new('RGB',(2400,320),'white');draw=ImageDraw.Draw(sheet);draw.text((8,4),b['id']+' | '+str(slot)+' | '+issue['query'][:190],fill='black')
  for x,r in enumerate(options):
   with Image.open(r['path']) as im:t=ImageOps.contain(im.convert('RGB'),(286,238))
   sheet.paste(t,(x*300+(300-t.width)//2,30+(238-t.height)//2));draw.text((x*300+6,274),r['brand'][:30],fill='black');draw.text((x*300+6,294),r['key'][:43],fill='#506070')
  sheet.save(folder/(b['id']+'-'+str(slot)+'.jpg'),quality=94)
 (P/'fix-shortlists.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'issues':len(out),'sheets':len(out)}))
if __name__=='__main__':main()
