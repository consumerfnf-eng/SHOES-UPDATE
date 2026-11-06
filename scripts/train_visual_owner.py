"""Owner-confirmed batch refinement. No website writes; blind test is used once.

Labels are frozen by the authenticated training request. Existing assistant
TRAIN labels are optional weak auxiliary data, never owner ground truth.
"""
import argparse, hashlib, json, os, pickle, sqlite3
from pathlib import Path
from clip_classify import LETTERBOX_ENCODER, LABELS
from clip_quality import brand_key, calibrate, metrics, release_gates

CATEGORIES=set(LABELS.values())

def split_request(request, auxiliary=()):
    members=request.get('members',[])
    if not 50<=len(members)<=100:raise ValueError('Expected 50..100 frozen owner decisions')
    groups={role:[] for role in ('train','calibration','test')};seen=set();models=set();brands={r:set() for r in groups}
    for row in members:
        role=row.get('role');key=row.get('imageHash');model=row.get('modelKey');brand=row.get('brand')
        if role not in groups or not isinstance(key,str) or len(key)!=64 or any(c not in '0123456789abcdef' for c in key) or key in seen:raise ValueError('Invalid/duplicate batch photo')
        if not model or model in models or not brand:raise ValueError('Duplicate design or missing brand')
        if row.get('status') not in ('approved','excluded') or not isinstance(row.get('revision'),int) or row['revision']<1:raise ValueError('Unconfirmed owner label')
        if row['status']=='approved' and row.get('category') not in CATEGORIES:raise ValueError('Invalid owner category')
        if row['status']=='excluded' and row.get('category') is not None:raise ValueError('Excluded image cannot have a truth label')
        seen.add(key);models.add(model);brands[role].add(brand_key(brand))
        if row['status']=='approved':groups[role].append({**row,'truth':row['category'],'split':role,'labelSource':'authenticated-owner'})
    if any(brands[a]&brands[b] for a,b in [('train','calibration'),('train','test'),('calibration','test')]):raise ValueError('Brand leakage across owner splits')
    safe_aux=[]
    for row in auxiliary:
        if row.get('split')!='train' or row.get('truth') not in CATEGORIES:continue
        if row.get('imageHash') in seen or row.get('modelKey') in models:continue
        if brand_key(row.get('brand')) in brands['calibration']|brands['test']:raise ValueError('Auxiliary training brand leaks into evaluation')
        safe_aux.append({**row,'labelSource':'assistant-auxiliary'})
    return groups,safe_aux

def predict(model,rows,vectors,legacy=False):
    import numpy as np
    if not rows:return []
    probabilities=model.predict_proba(np.stack([vectors[r['imageHash']] for r in rows]));out=[]
    for row,prob in zip(rows,probabilities):
        order=np.argsort(prob)[::-1];category=LABELS[model.classes_[order[0]]] if legacy else str(model.classes_[order[0]])
        out.append({**row,'category':category,'confidence':float(prob[order[0]]),'margin':float(prob[order[0]]-prob[order[1]])})
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--request',required=True);ap.add_argument('--output-dir',required=True);args=ap.parse_args()
    os.environ['OMP_NUM_THREADS']='2';os.environ['MKL_NUM_THREADS']='2'
    request=json.loads(Path(args.request).read_text(encoding='utf-8'));request_hash=hashlib.sha256(json.dumps(request,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    directory=Path(args.output_dir);directory.mkdir(parents=True,exist_ok=True)
    # Retries reuse the frozen result, not a new attempt tuned against the test.
    existing=directory/'metadata.json'
    if existing.exists():
        metadata=json.loads(existing.read_text(encoding='utf-8'))
        if metadata.get('evaluation',{}).get('requestHash')!=request_hash:raise ValueError('Frozen result belongs to another owner snapshot')
        if hashlib.sha256((directory/'model.pkl').read_bytes()).hexdigest()!=metadata['sha256']:raise ValueError('Frozen model changed')
        print(json.dumps({'reusedFrozenResult':True,'validated':metadata['validated']}));return
    freeze_path=directory/'freeze.json'
    frozen=json.loads(freeze_path.read_text(encoding='utf-8')) if freeze_path.exists() else None
    if frozen and frozen.get('requestHash')!=request_hash:raise ValueError('Frozen weights belong to another owner snapshot')
    auxiliary=[] if frozen else json.loads(Path('.secrets/clip/site-audit-v2.json').read_text(encoding='utf-8'))['records']
    groups,aux=split_request(request,auxiliary);train=aux+groups['train'];cal=groups['calibration'];test=groups['test']
    if len(groups['train'])<12 or len({r['truth'] for r in groups['train']})<2 or len(cal)<8 or len(test)<8:
        (directory/'held.json').write_text(json.dumps({'reason':'검수 제외로 학습·평가 표본 부족','splitCounts':{k:len(v) for k,v in groups.items()}},ensure_ascii=False),encoding='utf-8');print('Insufficient owner labels; held without inference or publication');return
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from threadpoolctl import threadpool_limits
    db=sqlite3.connect('.secrets/clip/features.sqlite')
    needed={r['imageHash'] for r in train+cal+test}
    vectors={h:np.frombuffer(v,dtype='<f4') for h,v in db.execute('SELECT hash,vector FROM features WHERE encoder=?',(LETTERBOX_ENCODER,)) if h in needed}
    if needed-set(vectors):raise ValueError('Feature cache incomplete; preserve previous release')
    if frozen:
        # Recover even if interrupted between freezing and writing metadata.
        # Neither current auxiliary labels nor the current baseline may refit
        # or replace the exact model whose holdout evaluation already started.
        payload=(directory/'model.pkl').read_bytes();baseline_payload=(directory/'baseline.pkl').read_bytes()
        if hashlib.sha256(payload).hexdigest()!=frozen['sha256'] or hashlib.sha256(baseline_payload).hexdigest()!=frozen['baselineSha256']:raise ValueError('Frozen model/baseline SHA changed')
        best=pickle.loads(payload);baseline=pickle.loads(baseline_payload);legacy=frozen['legacyLabels'];baseline_legacy=frozen['baselineLegacyLabels']
        selected_cal=frozen['calibration'];trials=frozen['trials'];frozen_gates=frozen['thresholds'];sha=frozen['sha256'];auxiliary_n=frozen['auxiliaryTrainN']
    else:
        baseline_dir=Path('.secrets/clip-models/site-v2');baseline_meta=json.loads((baseline_dir/'metadata.json').read_text(encoding='utf-8'))
        baseline_payload=(baseline_dir/'model.pkl').read_bytes();baseline=pickle.loads(baseline_payload);baseline_legacy=baseline_meta.get('legacyLabels',False)
        best=baseline;legacy=baseline_legacy;selected_cal=predict(best,cal,vectors,legacy)
        def selection(rows):return (sum(g['calibrationN'] for g in calibrate(rows).values()),metrics(rows)['accuracy'])
        best_score=selection(selected_cal);trials=[]
        xx=np.stack([vectors[r['imageHash']] for r in train]);yy=np.array([r['truth'] for r in train]);weights=np.array([3. if r['labelSource']=='authenticated-owner' else .5 for r in train])
        # No test labels or test metrics take part in this choice.
        for strength in (.1,.3,1.,3.,10.,30.):
            with threadpool_limits(limits=2):candidate=LogisticRegression(C=strength,max_iter=6000,class_weight='balanced').fit(xx,yy,sample_weight=weights)
            predicted=predict(candidate,cal,vectors);score=selection(predicted);trials.append({'C':strength,'calibration':metrics(predicted),'eligibleCalibration':score[0]})
            if score>best_score:best=candidate;legacy=False;selected_cal=predicted;best_score=score
        payload=pickle.dumps(best,protocol=5);sha=hashlib.sha256(payload).hexdigest();frozen_gates=calibrate(selected_cal);auxiliary_n=len(aux)
        (directory/'model.pkl').write_bytes(payload);(directory/'baseline.pkl').write_bytes(baseline_payload)
        freeze={'requestHash':request_hash,'sha256':sha,'baselineSha256':hashlib.sha256(baseline_payload).hexdigest(),'baselineLegacyLabels':baseline_legacy,'legacyLabels':legacy,'calibration':selected_cal,'auxiliaryTrainN':auxiliary_n,'thresholds':frozen_gates,'trials':trials}
        temporary=directory/'freeze.tmp';temporary.write_text(json.dumps(freeze,ensure_ascii=False,indent=2),encoding='utf-8');temporary.replace(freeze_path)
    # First access to owner test predictions is AFTER weights and thresholds freeze.
    selected_test=predict(best,test,vectors,legacy);baseline_test=predict(baseline,test,vectors,baseline_legacy)
    gates=release_gates(frozen_gates,selected_test)
    if metrics(selected_test)['accuracy']<metrics(baseline_test)['accuracy']:gates={}
    evaluation={'requestHash':request_hash,'batchId':request['batchId'],'labelSource':'authenticated-owner','auxiliaryLabelSource':'assistant-auxiliary-train-only','ownerSplitCounts':{k:len(v) for k,v in groups.items()},'auxiliaryTrainN':auxiliary_n,'calibration':metrics(selected_cal),'test':metrics(selected_test),'baselineTest':metrics(baseline_test),'minimumPerClassCalibration':8,'minimumPerClassTest':8,'requiredPrecision':.95,'releasedCategories':list(gates),'trainingTrials':trials,'note':'Observed class precision; small samples are not a population guarantee. Holdout labels are never fitted or used to tune thresholds.'}
    metadata={'version':'clip-owner-'+sha[:16],'sha256':sha,'encoder':LETTERBOX_ENCODER,'legacyLabels':legacy,'validated':bool(gates),'thresholds':gates,'evaluation':evaluation}
    (directory/'evaluation.json').write_text(json.dumps({'calibration':selected_cal,'test':selected_test,'baselineTest':baseline_test},ensure_ascii=False,indent=2),encoding='utf-8')
    temporary=directory/'metadata.tmp';temporary.write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8');temporary.replace(existing)
    print(json.dumps({'modelVersion':metadata['version'],'validated':bool(gates),'evaluation':evaluation},ensure_ascii=True))

if __name__=='__main__':main()
