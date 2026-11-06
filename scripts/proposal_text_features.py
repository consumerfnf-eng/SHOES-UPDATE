"""Local text tower for reference retrieval only; no category publication."""
import hashlib,json,os,sqlite3,sys
from pathlib import Path

def encode_texts(texts):
    os.environ.setdefault('OMP_NUM_THREADS','2');os.environ.setdefault('MKL_NUM_THREADS','2')
    import numpy as np
    import torch
    from open_clip import get_tokenizer
    from open_clip.factory import get_model_config
    from open_clip.model import _build_text_tower
    from clip_encoder import CHECKPOINT
    torch.set_num_threads(2)
    cache=Path('.secrets/proposals-105/text-cache-v2.sqlite');cache.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(cache);db.execute('CREATE TABLE IF NOT EXISTS text_features(text TEXT PRIMARY KEY,vector BLOB)')
    known={t:np.frombuffer(v,dtype='<f4') for t,v in db.execute('SELECT text,vector FROM text_features')}
    pending=list(dict.fromkeys(t for t in texts if t not in known))
    if pending:
        config=get_model_config('ViT-B-16')
        with torch.device('meta'):model=_build_text_tower(config['embed_dim'],config['text_cfg'],quick_gelu=False,cast_dtype=None)
        state=torch.load(CHECKPOINT,map_location='cpu',mmap=True,weights_only=True)
        if 'state_dict' in state:state=state['state_dict']
        keys=set(model.state_dict());weights={key:value for raw,value in state.items() if (key:=raw.removeprefix('module.')) in keys}
        model.load_state_dict(weights,strict=True,assign=True);del state,weights
        # Non-persistent buffers are not restored by load_state_dict(assign=True).
        # Rebuild the causal mask on CPU: leaving it on meta yields invalid attention.
        if model.attn_mask is not None:model.attn_mask=model.build_causal_mask()
        assert not any(b.is_meta for b in model.buffers()),'Unmaterialized text buffer'
        model.eval();tokenizer=get_tokenizer('ViT-B-16')
        for start in range(0,len(pending),12):
            batch=pending[start:start+12]
            with torch.inference_mode():features=model(tokenizer(batch));features=features/features.norm(dim=-1,keepdim=True);features=features.float().numpy()
            for text,vector in zip(batch,features):known[text]=vector;db.execute('INSERT OR REPLACE INTO text_features VALUES(?,?)',(text,vector.astype('<f4').tobytes()))
            db.commit()
        del model
    db.close();return {text:known[text] for text in texts}

if __name__=='__main__':
    texts=json.loads(Path(sys.argv[1]).read_text(encoding='utf8'));features=encode_texts(texts)
    print(json.dumps({'encoded':len(features),'dimensions':len(next(iter(features.values())))}))
