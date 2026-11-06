"""Single independent release test. No fitting or threshold selection."""
import json,pickle,hashlib,sqlite3
from pathlib import Path
from clip_classify import ENCODER,LABELS
from clip_quality import metrics,release_gates

def main():
    import numpy as np
    root=Path('.secrets/clip');directory=Path('.secrets/clip-models/site-v2')
    metadata=json.loads((directory/'metadata.json').read_text(encoding='utf-8'))
    assert hashlib.sha256((directory/'model.pkl').read_bytes()).hexdigest()==metadata['sha256']
    photos=json.loads((root/'site-fresh-test.json').read_text(encoding='utf-8'))['images'];byid={r['sampleId']:r for r in photos}
    labels=json.loads((root/'fresh-test-labels.json').read_text(encoding='utf-8'))['records'];assert len(labels)==100
    old=json.loads((root/'site-audit.json').read_text(encoding='utf-8'))['records']
    train_brands={r['brand'] for r in old if r['split']=='train'};old_hashes={r['imageHash'] for r in old};old_models={r['modelKey'] for r in old}
    assert all(not any(p['brand'] in train_brands for p in row['products']) and row['imageHash'] not in old_hashes and row['modelKey'] not in old_models for row in photos)
    db=sqlite3.connect(root/'features.sqlite')
    def predict(model,encoder,legacy):
        vectors={h:np.frombuffer(v,dtype='<f4') for h,v in db.execute('SELECT hash,vector FROM features WHERE encoder=?',(encoder,))}
        reviewed=[r for r in labels if r['category']];assert all(byid[r['sampleId']]['imageHash'] in vectors for r in reviewed)
        prob=model.predict_proba(np.stack([vectors[byid[r['sampleId']]['imageHash']] for r in reviewed]));out=[]
        for label,p in zip(reviewed,prob):
            row=byid[label['sampleId']];order=np.argsort(p)[::-1];category=LABELS[model.classes_[order[0]]] if legacy else str(model.classes_[order[0]])
            out.append({**label,'imageHash':row['imageHash'],'brand':row['products'][0]['brand'],'modelKey':row['modelKey'],'truth':label['category'],'split':'test','category':category,'confidence':float(p[order[0]]),'margin':float(p[order[0]]-p[order[1]])})
        return out
    with (directory/'model.pkl').open('rb') as file:model=pickle.load(file)
    with open('.secrets/clip-models/user-v4/model.pkl','rb') as file:baseline=pickle.load(file)
    selected=predict(model,metadata['encoder'],metadata['legacyLabels']);base=predict(baseline,ENCODER,True)
    gates=release_gates(metadata['frozenCalibrationThresholds'],selected)
    if metrics(selected)['accuracy']<metrics(base)['accuracy']:gates={}
    metadata['validated']=bool(gates);metadata['thresholds']=gates
    metadata['evaluation'].update({'freshTestPending':False,'freshTest':metrics(selected),'originalModelFreshTest':metrics(base),'freshTestReviewed':len(selected),'freshTestWithheld':100-len(selected),'releaseThresholds':gates,'classMinimumCalibration':8,'classMinimumTest':8,'requiredPrecision':.95})
    (directory/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'site-v2-fresh-test-results.json').write_text(json.dumps({'schemaVersion':1,'modelSha256':metadata['sha256'],'selected':selected,'baseline':base},ensure_ascii=False,indent=2),encoding='utf-8')
    # Append independently reviewed photos for manual release; keep exclusions.
    existing={r['sampleId'] for r in old}
    for label in labels:
        row=byid[label['sampleId']]
        assert label['sampleId'] not in existing
        old.append({**label,'imageHash':row['imageHash'],'modelKey':row['modelKey'],'brand':row['products'][0]['brand'],'group':row['group'],'split':'fresh-test','truth':label['category']})
    # Preserve the original audit and exposed test as its own immutable record.
    (root/'site-audit-v2.json').write_text(json.dumps({'schemaVersion':1,'records':old},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'validated':bool(gates),'selected':metrics(selected),'original':metrics(base),'released':gates},ensure_ascii=True),flush=True)

if __name__=='__main__':main()
