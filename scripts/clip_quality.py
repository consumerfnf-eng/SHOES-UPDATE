"""Pure release/split rules; no model execution or external dependencies."""
import hashlib,re

def brand_key(value):
    value=re.sub(r'[^a-z0-9]+','',str(value).lower())
    return {'adidasoriginals':'adidas','filachina':'fila','rockfishweatherwear':'rockfish'}.get(value,value)

def split_brand(brand,known_training_brands):
    if brand_key(brand) in {brand_key(b) for b in known_training_brands}:return 'train'
    return ('train','calibration','test')[int(hashlib.sha256(('clip-site-brand-split-v1|'+brand_key(brand)).encode()).hexdigest()[:8],16)%3]

def metrics(rows):
    labeled=[r for r in rows if r.get('truth')]
    if not labeled:return {'n':0,'accuracy':None,'byCategory':{}}
    result={'n':len(labeled),'accuracy':sum(r['truth']==r['category'] for r in labeled)/len(labeled),'byCategory':{}}
    for category in sorted({r['truth'] for r in labeled}):
        group=[r for r in labeled if r['truth']==category]
        result['byCategory'][category]={'n':len(group),'recall':sum(r['category']==category for r in group)/len(group)}
    return result

def calibrate(rows,min_n=8,target=.95):
    """Choose thresholds ONLY on calibration rows. Never consume test labels."""
    if any(r.get('split')!='calibration' for r in rows):raise ValueError('Calibration split only')
    gates={}
    for category in sorted({r['category'] for r in rows}):
        best=None
        for cutoff in (.5,.6,.65,.7,.75,.8,.85,.9,.95,.97,.99):
            for margin in (.1,.15,.2,.25,.3,.4,.5):
                selected=[r for r in rows if r['category']==category and r['confidence']>=cutoff and r['margin']>=margin]
                if len(selected)<min_n:continue
                precision=sum(r.get('truth')==category for r in selected)/len(selected)
                if precision<target:continue
                gate={'minConfidence':cutoff,'minMargin':margin,'calibrationN':len(selected),'calibrationPrecision':precision}
                if best is None or len(selected)>best['calibrationN']:best=gate
        if best:gates[category]=best
    return gates

def passes(row,gate):return bool(gate) and row['confidence']>=gate['minConfidence'] and row['margin']>=gate['minMargin']

def release_gates(gates,test_rows,min_n=8,target=.95):
    if any(r.get('split')!='test' for r in test_rows):raise ValueError('Independent test split only')
    released={}
    for category,gate in gates.items():
        selected=[r for r in test_rows if r['category']==category and passes(r,gate)]
        precision=sum(r.get('truth')==category for r in selected)/len(selected) if selected else 0
        if len(selected)>=min_n and precision>=target:released[category]={**gate,'testN':len(selected),'testPrecision':precision}
    return released
