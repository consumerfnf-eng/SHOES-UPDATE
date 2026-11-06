"""Freeze a whole-shoe probe using training/calibration ONLY.
The first audit's exposed test results are not reused as the release test.
"""
import os,json,pickle,sqlite3,hashlib
from pathlib import Path
from clip_quality import metrics,calibrate,passes
from clip_classify import LETTERBOX_ENCODER,LABELS

def main():
    os.environ['OMP_NUM_THREADS']='2';os.environ['MKL_NUM_THREADS']='2'
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from threadpoolctl import threadpool_limits
    root=Path('.secrets/clip');audit=json.loads((root/'site-audit.json').read_text(encoding='utf-8'))
    rows=[r for r in audit['records'] if r['truth']]
    train=[r for r in rows if r['split']=='train'];cal=[r for r in rows if r['split']=='calibration']
    assert len(train)>=60 and len(cal)>=30
    assert not ({r['brand'] for r in train}&{r['brand'] for r in cal})
    db=sqlite3.connect(root/'features.sqlite');vectors={h:np.frombuffer(v,dtype='<f4') for h,v in db.execute('SELECT hash,vector FROM features WHERE encoder=?',(LETTERBOX_ENCODER,))}
    assert all(r['imageHash'] in vectors for r in train+cal),'Whole-shoe sample features incomplete'
    def predict(model,items,legacy=False):
        probs=model.predict_proba(np.stack([vectors[r['imageHash']] for r in items]));out=[]
        for row,p in zip(items,probs):
            order=np.argsort(p)[::-1];category=LABELS[model.classes_[order[0]]] if legacy else str(model.classes_[order[0]])
            out.append({**row,'category':category,'confidence':float(p[order[0]]),'margin':float(p[order[0]]-p[order[1]])})
        return out
    with open('.secrets/clip-models/user-v4/model.pkl','rb') as file:baseline=pickle.load(file)
    best=baseline;legacy=True;best_rows=predict(baseline,cal,True);trials=[]
    def quality(pred):
        gates=calibrate(pred)
        accepted=sum(passes(r,gates.get(r['category'])) for r in pred)
        return (accepted,metrics(pred)['accuracy'])
    best_quality=quality(best_rows)
    x=np.stack([vectors[r['imageHash']] for r in train]);y=np.array([r['truth'] for r in train])
    for strength in (.03,.1,.3,1.,3.,10.,30.,100.):
        with threadpool_limits(limits=2):model=LogisticRegression(C=strength,max_iter=8000,class_weight='balanced').fit(x,y)
        predicted=predict(model,cal);score=quality(predicted)
        trials.append({'C':strength,'calibrationAccuracy':metrics(predicted)['accuracy'],'calibrationAccepted':score[0]})
        if score>best_quality:best=model;legacy=False;best_rows=predicted;best_quality=score
    directory=Path('.secrets/clip-models/site-v2');directory.mkdir(parents=True,exist_ok=True)
    payload=Path('.secrets/clip-models/user-v4/model.pkl').read_bytes() if legacy else pickle.dumps(best,protocol=5)
    sha=hashlib.sha256(payload).hexdigest();(directory/'model.pkl').write_bytes(payload)
    metadata={'version':'clip-shoe-v2-'+sha[:12],'sha256':sha,'encoder':LETTERBOX_ENCODER,'legacyLabels':legacy,'validated':False,'thresholds':{},'frozenCalibrationThresholds':calibrate(best_rows),'evaluation':{'method':'Independent assistant visual audit, not model pseudo-labels; brand-separated training/calibration; NEW release test reserved after first exposed audit. Whole shoe foreground/letterbox preserves toe/heel.','reviewer':'assistant-independent-visual-review','trainN':len(train),'calibration':metrics(best_rows),'trainingTrials':trials,'selectionQuality':list(best_quality),'freshTestPending':True}}
    (directory/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'site-v2-calibration.json').write_text(json.dumps(best_rows,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'model':metadata['version'],'legacy':legacy,'calibration':metadata['evaluation']['calibration'],'gates':metadata['frozenCalibrationThresholds'],'trials':trials},ensure_ascii=True),flush=True)

if __name__=='__main__':main()
