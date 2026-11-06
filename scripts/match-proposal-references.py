"""Role-based private candidate retrieval. Similarity is not review accuracy.

Produces a candidate manifest and inspection sheets. Publication is separate.
"""
import collections,hashlib,json,re,sqlite3,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps,ImageDraw
from proposal_text_features import encode_texts
from clip_classify import LETTERBOX_ENCODER

ROOT=Path('.secrets/proposals-105')
def tokens(text):return set(re.findall(r'[a-z0-9가-힣]{2,}',str(text).lower().replace('-',' ')))
def main():
    ideas=[]
    for season in ['27SS','27FW','28SS']:
        d=json.loads((ROOT/f'ideas-{season}.json').read_text(encoding='utf8'));ideas+=d['ideas'] if isinstance(d,dict) else d
    assert len(ideas)==105
    inventory=json.loads((ROOT/'inventory.json').read_text(encoding='utf8'))['records']
    # Add newly collected comparison products without changing an in-flight
    # feature manifest. The final extraction pass resolves these hashes.
    mlb=json.loads((ROOT/'mlb-baselines.json').read_text(encoding='utf8'))['records']
    known={r['key'] for r in inventory};inventory +=[r for r in mlb if r['key'] not in known]
    db=sqlite3.connect('.secrets/clip/features.sqlite');features={h:np.frombuffer(v,dtype='<f4') for h,v in db.execute('SELECT hash,vector FROM features WHERE encoder=?',(LETTERBOX_ENCODER,))}
    missing={r['imageHash'] for r in inventory}-features.keys()
    # Unusable tiny source photos are excluded, never enlarged into references.
    rejected=[{'key':r['key'],'reason':'No usable image embedding; excluded'} for r in inventory if r['imageHash'] in missing]
    (ROOT/'rejected-photos.json').write_text(json.dumps(rejected,ensure_ascii=False),encoding='utf8')
    inventory=[r for r in inventory if r['imageHash'] not in missing]
    records=[]
    for r in inventory:
        with Image.open(r['path']) as im:w,h=im.size
        if min(w,h)<200:continue
        records.append({**r,'width':w,'height':h})
    vectors=np.stack([features[r['imageHash']] for r in records])
    roles=['silhouette','silhouette','material','sole-detail','styling','mlb-baseline']
    def query(idea,role):
        base=idea['photoQuery']
        if role=='hero':return 'fashion editorial photograph of shoes worn on feet, '+base
        if role=='material':return 'a footwear product photo, '+(idea.get('referencePlan') or [{}]*6)[2].get('query',base)
        if role=='sole-detail':return 'side profile of footwear showing lateral midsole and toe shape, '+base
        if role=='styling':return 'runway shoes on feet close up, '+base
        return 'a clear product photograph of '+base
    queries=[query(i,r) for i in ideas for r in ['silhouette','material','sole-detail','styling','hero']]
    negative=['a photograph of stiletto high heel pumps','a photograph of wedge high heels','a photograph of a slingback pump','a photograph showing only the bottom outsole of a shoe facing the camera','a photograph of gloves and no shoes','a drawing or sketch of a shoe','a photograph of a handbag and no shoes']
    text=encode_texts(queries+negative)
    neg=vectors@np.stack([text[t] for t in negative]).T
    usage=collections.Counter();anchor_models=set();hero_hashes=set();output=[];candidate_notes=[]
    for idea in ideas:
        used=set();used_models=set();selected=[];brand_count=collections.Counter()
        base_query=text[query(idea,'silhouette')];base_scores=vectors@base_query
        lex=tokens(' '.join(idea.get('photoKeywords',[])))
        shape='boot' if re.search(r'\bboot\b',idea['photoQuery'],re.I) else 'sandal' if re.search(r'\bsandal\b',idea['photoQuery'],re.I) else 'slide' if re.search(r'\b(?:slide|mule|clog)\b',idea['photoQuery'],re.I) else 'ballet' if re.search(r'\b(?:ballet|mary jane)\b',idea['photoQuery'],re.I) else 'sneaker'
        # Source type is never silently rewritten to claim a future season.
        hero_scores=vectors@text[query(idea,'hero')]
        options=[]
        for n,r in enumerate(records):
            if r['kind']!='show' or r['imageHash'] in hero_hashes or min(r['width'],r['height'])<700:continue
            bad=max(neg[n,0],neg[n,1],neg[n,2],neg[n,4],neg[n,5],neg[n,6])
            lexical=len(lex&tokens(r['text']))/max(1,len(lex))
            options.append((float(hero_scores[n])+.05*lexical-.35*max(0,bad-hero_scores[n]),n))
        if not options:raise ValueError('No distinct editorial/show hero for '+idea['id'])
        _,hn=max(options);hero=records[hn];hero_hashes.add(hero['imageHash']);used.add(hero['imageHash']);used_models.add(hero['modelKey'])
        for position,role in enumerate(roles):
            scores=vectors@text[query(idea,role)] if role!='mlb-baseline' else base_scores
            candidates=[]
            for n,r in enumerate(records):
                if r['imageHash'] in used or r['modelKey'] in used_models:continue
                if r['kind']=='product' and brand_count[r['brand']]>=2:continue
                if role=='mlb-baseline':
                    if r['kind']!='mlb':continue
                elif role=='styling':
                    if r['kind']!='show':continue
                elif r['kind']!='product':continue
                if role!='mlb-baseline' and usage[r['modelKey']]>=2:continue
                if position==0 and r['modelKey'] in anchor_models:continue
                source_text=r['text'];terms=tokens(source_text);lexical=len(lex&terms)/max(1,len(lex))
                if role=='mlb-baseline':
                    desired=(idea.get('referencePlan') or [{}]*6)[5].get('query','')
                    baseline_match=sum(t in source_text for t in tokens(desired))
                    score=float(scores[n])+.25*baseline_match
                else:
                    score=.7*float(scores[n])+.3*float(base_scores[n])+.10*lexical+(.015 if r.get('group')=='LUX' else 0)-.018*usage[r['modelKey']]
                    if shape=='boot' and not re.search(r'boot|high.top|sock|부츠|부티|하이탑|삭',source_text,re.I):score-=.05
                    if shape in ('sandal','slide') and not re.search(r'sandal|slide|mule|clog|샌들|슬라이드|뮬|클로그|슬리퍼',source_text,re.I):score-=.09
                    if shape=='ballet' and not re.search(r'ballet|mary.jane|ballerina|발레|메리제인|스니커리나',source_text,re.I):score-=.07
                    bad=max(neg[n,0],neg[n,1],neg[n,2],neg[n,3],neg[n,4],neg[n,6])
                    score-=.8*max(0,bad-scores[n]+.01)
                candidates.append((score,n,lexical))
            if not candidates:raise ValueError('No candidates '+idea['id']+' '+role)
            ranked=sorted(candidates,reverse=True);score,n,lexical=ranked[0];r=records[n]
            selected.append({**r,'role':role,'roleLabel':{'silhouette':'실루엣·비례','material':'소재·표면감','sole-detail':'밑창·구조','styling':'착용·스타일링','mlb-baseline':'MLB 기존 상품 비교'}[role],
             'note':{'silhouette':'토·갑피·밑창의 비례 참고','material':'패널의 표면감과 소재 대비 참고','sole-detail':'측면 밑창의 볼륨·연결 구조 참고','styling':'신발과 하의의 착용 비례 참고','mlb-baseline':'기존 MLB의 로고·구조와 비교'}[role],
             'matchEvidence':{'method':'CLIP retrieval + source text + role filter; similarity is not correctness','cosine':float(scores[n]),'lexicalOverlap':lexical,'reviewStatus':'candidate','matchedTerms':sorted(lex&tokens(r['text']))[:12]}})
            candidate_notes.append({'idea':idea['id'],'slot':position,'chosen':r['key'],'alternatives':[{'key':records[j]['key'],'score':float(s)} for s,j,_ in ranked[:8]]})
            used.add(r['imageHash']);used_models.add(r['modelKey']);usage[r['modelKey']]+=1;brand_count[r['brand']]+=1
            if position==0:anchor_models.add(r['modelKey'])
        output.append({'id':idea['id'],'season':idea['season'],'title':idea['title'],'category':idea['category'],'photoQuery':idea['photoQuery'],'hero':{**hero,'note':'화보·쇼 사진의 착용 비례와 분위기 참고','seasonRelation':'same-season' if idea['season']=='27SS' else 'earlier-season','reviewStatus':'candidate'},'references':selected})
    (ROOT/'matches.json').write_text(json.dumps({'schemaVersion':1,'boards':output},ensure_ascii=False,indent=2),encoding='utf8')
    (ROOT/'match-alternatives.json').write_text(json.dumps(candidate_notes,ensure_ascii=False),encoding='utf8')
    # Six boards per inspection sheet; each row shows hero + all six references.
    directory=ROOT/'inspection';directory.mkdir(exist_ok=True)
    for season in ['27SS','27FW','28SS']:
        rows=[b for b in output if b['season']==season]
        for start in range(0,len(rows),5):
            sheet=Image.new('RGB',(2100,1500),'white');draw=ImageDraw.Draw(sheet)
            for y,b in enumerate(rows[start:start+5]):
                draw.text((8,y*300+4),b['id']+' | '+b['photoQuery'][:190],fill='black')
                for x,r in enumerate([b['hero']]+b['references']):
                    with Image.open(r['path']) as im:thumb=ImageOps.contain(ImageOps.exif_transpose(im).convert('RGB'),(286,228))
                    sheet.paste(thumb,(x*300+(300-thumb.width)//2,y*300+26+(228-thumb.height)//2));draw.text((x*300+6,y*300+258),('HERO' if x==0 else str(x)+' '+r['role'])+' | '+r['brand'][:24],fill='black')
                    draw.text((x*300+6,y*300+276),r['key'][:43],fill='#506070')
            sheet.save(directory/f'{season}-{start//5+1:02}.jpg',quality=95)
    print(json.dumps({'boards':len(output),'heroPhotos':len(hero_hashes),'uniquePrimaryDesigns':len(anchor_models),'inspectionSheets':21}),flush=True)

if __name__=='__main__':main()
