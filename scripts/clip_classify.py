"""Offline, resumable CLIP features. No network/site writes or training here.
All artifacts/embeddings remain in .secrets; public release is a separate gate.
"""
import argparse,hashlib,json,os,pickle,sqlite3,time
from pathlib import Path

ENCODER='ViT-B-16/dfn2b/normalized-original-plus-mirror-v1'
LETTERBOX_ENCODER='ViT-B-16/dfn2b/shoe-letterbox-plus-mirror-v2'
LABELS={'로우프로파일':'low-profile','청키':'chunky','복고·테크 러너':'retro-tech-runner','발레·메리제인':'ballet-mary-jane','뮬·슬리퍼':'mule-slipper','코트·기타':'court-other','부츠':'boot','샌들':'sandal','퍼포먼스(축구·육상)':'performance'}

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--manifest',default='.secrets/clip/manifest.json');ap.add_argument('--model',default='.secrets/clip-models/user-v4/model.pkl');ap.add_argument('--limit',type=int,default=0);ap.add_argument('--batch',type=int,default=4);ap.add_argument('--threads',type=int,default=4);ap.add_argument('--view',choices=['original','shoe-letterbox'],default='original');ap.add_argument('--features-only',action='store_true');args=ap.parse_args()
    if not 1<=args.batch<=16 or not 1<=args.threads<=4:ap.error('CPU budget: batch 1..16, threads 1..4')
    encoder=LETTERBOX_ENCODER if args.view=='shoe-letterbox' else ENCODER
    os.environ.setdefault('OMP_NUM_THREADS',str(args.threads));os.environ.setdefault('MKL_NUM_THREADS',str(args.threads));os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY','1')
    if os.name=='nt':
        import ctypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.GetCurrentProcess.restype=ctypes.c_void_p
        kernel.SetPriorityClass.argtypes=[ctypes.c_void_p,ctypes.c_uint32]
        kernel.SetPriorityClass(kernel.GetCurrentProcess(),0x4000)
    import numpy as np
    from clip_encoder import load_clip_visual
    from PIL import Image,ImageOps
    root=Path('.secrets/clip');root.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(root/'features.sqlite');db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE IF NOT EXISTS features (encoder TEXT, hash TEXT, vector BLOB, PRIMARY KEY(encoder,hash))');db.execute('CREATE TABLE IF NOT EXISTS errors (encoder TEXT,hash TEXT,error TEXT,PRIMARY KEY(encoder,hash))')
    rows=json.loads(Path(args.manifest).read_text(encoding='utf-8'))['images']
    existing={r[0] for r in db.execute('SELECT hash FROM features WHERE encoder=?',(encoder,))}
    pending=[r for r in rows if r['imageHash'] not in existing]
    if args.limit:pending=pending[:args.limit]
    started=time.monotonic();print(json.dumps({'pending':len(pending),'cached':len(existing),'encoder':encoder,'threads':args.threads}),flush=True)
    if pending:
        import torch
        torch.set_num_threads(args.threads)
        model,pre=load_clip_visual()
        for start in range(0,len(pending),args.batch):
            valid=[];original=[];mirror=[]
            for row in pending[start:start+args.batch]:
                try:
                    assert digest(row['path'])==row['imageHash'],'Photo SHA mismatch'
                    with Image.open(row['path']) as im:
                        if args.view=='shoe-letterbox':
                            from clip_photo import shoe_letterbox
                            im=shoe_letterbox(im)
                        else:im=ImageOps.exif_transpose(im).convert('RGB')
                        assert min(im.size)>=120,'Image too small'
                        original.append(pre(im));mirror.append(pre(ImageOps.mirror(im)));valid.append(row)
                except Exception as error:
                    db.execute('INSERT OR REPLACE INTO errors VALUES(?,?,?)',(encoder,row['imageHash'],str(error)[:300]));db.commit()
            if valid:
                with torch.inference_mode():
                    a=model(torch.stack(original));b=model(torch.stack(mirror));f=a/a.norm(dim=-1,keepdim=True)+b/b.norm(dim=-1,keepdim=True);f=(f/f.norm(dim=-1,keepdim=True)).float().numpy()
                assert f.shape==(len(valid),512)
                db.executemany('INSERT OR REPLACE INTO features VALUES(?,?,?)',[(encoder,r['imageHash'],v.astype('<f4').tobytes()) for r,v in zip(valid,f)]);db.commit()
            if start%40==0 or start+args.batch>=len(pending):print(json.dumps({'done':min(start+args.batch,len(pending)),'total':len(pending),'seconds':round(time.monotonic()-started,1)}),flush=True)
    if args.features_only:
        print(json.dumps({'cached':db.execute('SELECT COUNT(*) FROM features WHERE encoder=?',(encoder,)).fetchone()[0],'encoder':encoder,'seconds':round(time.monotonic()-started,1)}),flush=True)
        return
    # The classifier is the owner's trusted local artifact, never a web upload.
    with open(args.model,'rb') as file:clf=pickle.load(file)
    assert clf.n_features_in_==512 and all(c in LABELS for c in clf.classes_)
    allowed={r['imageHash'] for r in rows}
    ready=[(h,np.frombuffer(v,dtype='<f4')) for h,v in db.execute('SELECT hash,vector FROM features WHERE encoder=?',(encoder,)) if h in allowed]
    predictions=[]
    if ready:
        probs=clf.predict_proba(np.stack([v for _,v in ready]))
        for (h,_),p in zip(ready,probs):
            order=np.argsort(p)[::-1];predictions.append({'imageHash':h,'category':LABELS[clf.classes_[order[0]]],'confidence':float(p[order[0]]),'margin':float(p[order[0]]-p[order[1]]),'alternatives':[{'category':LABELS[clf.classes_[i]],'score':float(p[i])} for i in order[:3]]})
    output={'schemaVersion':1,'encoder':encoder,'modelSha256':digest(args.model),'predictions':predictions,'errors':[{'imageHash':h,'error':e} for h,e in db.execute('SELECT hash,error FROM errors WHERE encoder=?',(encoder,))],'elapsedSeconds':round(time.monotonic()-started,1)}
    target=root/('predictions-letterbox.json' if args.view=='shoe-letterbox' else 'predictions.json');temp=target.with_suffix('.tmp');temp.write_text(json.dumps(output,ensure_ascii=False),encoding='utf-8');temp.replace(target)
    print(json.dumps({'predicted':len(predictions),'errors':len(output['errors']),'seconds':output['elapsedSeconds']}),flush=True)

if __name__=='__main__':main()
