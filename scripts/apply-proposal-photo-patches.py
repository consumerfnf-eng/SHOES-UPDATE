"""Merge visually reviewed private photo patches, without running retrieval again."""
import json
from pathlib import Path
from PIL import Image
P=Path('.secrets/proposals-105')
def read(p):return json.loads(p.read_text(encoding='utf8'))
def main():
 data=read(P/'matches.json');index={r['key']:r for r in read(P/'inventory.json')['records']}
 index.update({r['key']:r for r in read(P/'mlb-baselines.json')['records']})
 boards={b['id']:b for b in data['boards']};count=0
 for season in ['27SS','27FW','28SS']:
  f=P/f'patches-{season}.json'
  if not f.exists():continue
  patch=read(f)
  for row in patch['boards']:
   b=boards[row['id']]
   if b['season']!=season:raise ValueError('Wrong patch season')
   for change in row.get('replacements',[]):
    slot=change['slot'];old=b['hero'] if slot=='hero' else b['references'][int(slot)]
    r=change.get('reference') or index[change['key']]
    with Image.open(r['path']) as im:w,h=im.size
    new={**r,'width':w,'height':h,**{k:old[k] for k in ['role','roleLabel','matchEvidence','seasonRelation'] if k in old},'note':change.get('note',old.get('note','')),'reviewedNote':change.get('note',old.get('note',''))}
    if slot=='hero':b['hero']=new
    else:b['references'][int(slot)]=new
    count+=1
 # Report every conflict at once. A patch never silently substitutes another photo.
 anchors={};heroes={};conflicts=[]
 for b in data['boards']:
  key=b['references'][0]['modelKey']
  if key in anchors:conflicts.append({'kind':'primary','a':anchors[key],'b':b['id'],'modelKey':key})
  anchors[key]=b['id'];key=b['hero']['imageHash']
  if key in heroes:conflicts.append({'kind':'hero','a':heroes[key],'b':b['id'],'hash':key})
  heroes[key]=b['id']
  if len({r['imageHash'] for r in b['references']})<6:conflicts.append({'kind':'within-board','b':b['id']})
 (P/'patch-conflicts.json').write_text(json.dumps(conflicts,ensure_ascii=False,indent=2),encoding='utf8')
 (P/'matches.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps({'applied':count,'conflicts':len(conflicts)}))
if __name__=='__main__':main()
