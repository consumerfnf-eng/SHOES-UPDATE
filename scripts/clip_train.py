"""Supervised probe refinement using curated labels, never its own guesses.
Keep source model, train/calibration/test separation and the release evidence.
"""
import os,json,pickle,sqlite3,hashlib,time
from pathlib import Path
from clip_quality import split_brand,metrics,calibrate,release_gates
from clip_classify import ENCODER,LABELS,digest

def main():
    os.environ['OMP_NUM_THREADS']='2';os.environ['MKL_NUM_THREADS']='2'
    import numpy as np,pandas as pd
    from sklearn.linear_model import LogisticRegression
    from threadpoolctl import threadpool_limits
    root=Path('.secrets/clip');origin=Path('.secrets/clip-models/user-v4/training')
    read=lambda name:pd.read_pickle(origin/name)
    k=read('kr2.pkl');labels=read('kr_clip_v3.pkl');cn=read('cn.pkl');gt=read('cn_blind_gt.pkl').dropna()
    pos={j:i for i,j in enumerate(k.index)};cp={j:i for i,j in enumerate(cn.index)}
    fm=np.load(origin/'F_ViT-B-16_dfn2b_main.npy',mmap_mode='r');fe=np.load(origin/'F_ViT-B-16_dfn2b_extra.npy',mmap_mode='r');fc=np.load(origin/'F_ViT-B-16_dfn2b_cn.npy',mmap_mode='r')
    extra=json.loads((origin/'F_ViT-B-16_dfn2b_extra.json').read_text(encoding='utf-8'))
    import re
    truth=lambda value:LABELS.get(str(value).replace('기타 스니커즈','코트·기타'))
    x=[];y=[];weights=[]
    for j,row in labels.iterrows():
        if j in pos and truth(row.fin):x.append(fm[pos[j]]);y.append(truth(row.fin));weights.append(1.)
    for n,file in enumerate(extra):
        m=re.search(r'i(\d+)_',file)
        if m and int(m[1]) in labels.index:
            category=truth(labels.loc[int(m[1]),'fin'])
            if category:x.append(fe[n]);y.append(category);weights.append(1.)
    for j,value in gt.items():
        if j in cp and truth(value):x.append(fc[cp[j]]);y.append(truth(value));weights.append(5.)
    old_brands=set(labels.brand)|set(cn.loc[gt.index,'brand'])
    sample=json.loads((root/'site-blind-sample.json').read_text(encoding='utf-8'))['images'];byid={r['sampleId']:r for r in sample}
    reviewed=[]
    for file in ['lux-sports-labels.json','casual-labels.json']:reviewed.extend(json.loads((root/file).read_text(encoding='utf-8'))['records'])
    assert len(reviewed)==300 and len({r['sampleId'] for r in reviewed})==300
    db=sqlite3.connect(root/'features.sqlite');vectors={h:np.frombuffer(v,dtype='<f4') for h,v in db.execute('SELECT hash,vector FROM features WHERE encoder=?',(ENCODER,))}
    missing=[r['sampleId'] for r in reviewed if byid[r['sampleId']]['imageHash'] not in vectors]
    if missing:raise RuntimeError('Sample feature extraction incomplete: '+str(len(missing)))
    rows=[]
    for review in reviewed:
        row=byid[review['sampleId']];brand=row['products'][0]['brand'];category=review['category']
        rows.append({**review,'imageHash':row['imageHash'],'modelKey':row['modelKey'],'brand':brand,'group':row['group'],'split':split_brand(brand,old_brands),'truth':category})
    assert not ({r['brand'] for r in rows if r['split']=='train'}&{r['brand'] for r in rows if r['split']!='train'})
    train=[r for r in rows if r['split']=='train' and r['truth']];cal=[r for r in rows if r['split']=='calibration' and r['truth']];test=[r for r in rows if r['split']=='test' and r['truth']]
    assert len(cal)>=30 and len(test)>=30,'Insufficient brand-independent validation'
    baseline_file=Path('.secrets/clip-models/user-v4/model.pkl')
    with baseline_file.open('rb') as file:baseline=pickle.load(file)
    def predict(model,items,legacy=False):
        p=model.predict_proba(np.stack([vectors[r['imageHash']] for r in items]));output=[]
        for row,probs in zip(items,p):
            order=np.argsort(probs)[::-1];category=LABELS[model.classes_[order[0]]] if legacy else model.classes_[order[0]]
            output.append({**row,'category':category,'confidence':float(probs[order[0]]),'margin':float(probs[order[0]]-probs[order[1]])})
        return output
    base_cal=predict(baseline,cal,True);base_test=predict(baseline,test,True)
    best=baseline;legacy=True;best_score=metrics(base_cal)['accuracy'];trials=[]
    # Source model is evaluated first. Refine the small probe only if needed.
    if best_score<.95:
        xx=np.stack(x+[vectors[r['imageHash']] for r in train]);yy=np.array(y+[r['truth'] for r in train]);ww=np.array(weights+[4.]*len(train))
        for strength in (.3,1.,3.,10.,30.):
            with threadpool_limits(limits=2):
                candidate=LogisticRegression(C=strength,max_iter=8000,class_weight='balanced').fit(xx,yy,sample_weight=ww)
            score=metrics(predict(candidate,cal))['accuracy'];trials.append({'C':strength,'calibrationAccuracy':score})
            if score>best_score:best=candidate;legacy=False;best_score=score
    selected_cal=predict(best,cal,legacy);selected_test=predict(best,test,legacy)
    # Never publish a replacement that reduced independent test accuracy.
    if not legacy and metrics(selected_test)['accuracy']<metrics(base_test)['accuracy']:
        best=baseline;legacy=True;selected_cal=base_cal;selected_test=base_test
    gates=release_gates(calibrate(selected_cal),selected_test)
    directory=Path('.secrets/clip-models/site-v1');directory.mkdir(parents=True,exist_ok=True)
    if legacy:payload=baseline_file.read_bytes()
    else:payload=pickle.dumps(best,protocol=5)
    (directory/'model.pkl').write_bytes(payload);sha=hashlib.sha256(payload).hexdigest();version='clip-site-v1-'+sha[:12]
    evaluation={'method':'Brand-independent train/calibration/test; curated original user labels plus independent assistant photo audit; no prediction pseudo-labels','reviewer':'assistant-independent-visual-review','sample':len(rows),'reviewed':sum(bool(r['truth']) for r in rows),'needsOwner':sum(not r['truth'] for r in rows),'splitCounts':{s:sum(r['split']==s and bool(r['truth']) for r in rows) for s in ['train','calibration','test']},'baseline':{'calibration':metrics(base_cal),'test':metrics(base_test)},'selected':{'calibration':metrics(selected_cal),'test':metrics(selected_test),'retrained':not legacy},'trainingTrials':trials,'releaseThresholds':gates,'classMinimumCalibration':8,'classMinimumTest':8,'requiredPrecision':.95,'sourceDataHashes':{p.name:digest(p) for p in origin.iterdir() if p.is_file()}}
    metadata={'version':version,'sha256':sha,'encoder':ENCODER,'validated':bool(gates),'thresholds':gates,'legacyLabels':legacy,'evaluation':evaluation}
    (directory/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'site-audit.json').write_text(json.dumps({'schemaVersion':1,'records':rows,'calibration':selected_cal,'test':selected_test},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'model':version,'retrained':not legacy,'baselineTest':metrics(base_test),'selectedTest':metrics(selected_test),'released':list(gates),'splitCounts':evaluation['splitCounts']},ensure_ascii=True),flush=True)

if __name__=='__main__':main()
