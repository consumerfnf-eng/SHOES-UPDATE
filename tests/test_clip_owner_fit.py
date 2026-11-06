"""Optional local ML integration: synthetic vectors, never production labels."""
import hashlib,importlib.util,json,os,pickle,sqlite3,subprocess,sys,tempfile,unittest
from pathlib import Path
SCRIPTS=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(SCRIPTS))
from clip_classify import LETTERBOX_ENCODER

@unittest.skipUnless(importlib.util.find_spec('sklearn') and importlib.util.find_spec('numpy'),'Optional offline ML runtime is not part of the web/CI dependencies')
class OwnerFitIntegration(unittest.TestCase):
    def test_frozen_owner_splits_fit_evaluate_and_reuse_without_production_writes(self):
        import numpy as np
        from sklearn.linear_model import LogisticRegression
        with tempfile.TemporaryDirectory(prefix='clip-owner-fit-') as folder:
            root=Path(folder);private=root/'.secrets/clip';private.mkdir(parents=True)
            baseline=root/'.secrets/clip-models/site-v2';baseline.mkdir(parents=True)
            categories=['court-other','low-profile'];features=[];labels=[];members=[]
            db=sqlite3.connect(private/'features.sqlite');db.execute('CREATE TABLE features(encoder TEXT,hash TEXT,vector BLOB)')
            for i in range(96):
                vector=np.zeros(512,dtype='<f4');vector[i%2]=1;features.append(vector);labels.append(categories[i%2]);key=f'{i+1:064x}'
                db.execute('INSERT INTO features VALUES(?,?,?)',(LETTERBOX_ENCODER,key,vector.tobytes()))
                members.append({'imageHash':key,'role':('train','calibration','test')[i//32],'brand':f'brand-{i//32}','modelKey':f'model-{i}','category':categories[i%2],'status':'approved','revision':1})
            db.commit();db.close()
            model=LogisticRegression(C=10).fit(np.stack(features[:32]),np.array(labels[:32]))
            (baseline/'model.pkl').write_bytes(pickle.dumps(model));(baseline/'metadata.json').write_text(json.dumps({'legacyLabels':False}))
            (private/'site-audit-v2.json').write_text(json.dumps({'records':[]}));request={'batchId':'synthetic','members':members};(private/'request.json').write_text(json.dumps(request))
            output=root/'.secrets/clip-models/owner/job';command=[sys.executable,str(SCRIPTS/'train_visual_owner.py'),'--request',str(private/'request.json'),'--output-dir',str(output)]
            env={**os.environ,'OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','MKL_NUM_THREADS':'2'}
            first=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=90)
            self.assertEqual(first.returncode,0,first.stderr)
            meta=json.loads((output/'metadata.json').read_text());self.assertTrue(meta['validated']);self.assertEqual(set(meta['thresholds']),set(categories))
            self.assertEqual(meta['evaluation']['ownerSplitCounts'],{'train':32,'calibration':32,'test':32})
            self.assertTrue(all(g['testN']==16 and g['testPrecision']==1 for g in meta['thresholds'].values()))
            before=hashlib.sha256((output/'metadata.json').read_bytes()).hexdigest()
            again=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=90)
            self.assertEqual(again.returncode,0,again.stderr);self.assertIn('reusedFrozenResult',again.stdout)
            self.assertEqual(hashlib.sha256((output/'metadata.json').read_bytes()).hexdigest(),before)
            self.assertFalse((root/'public').exists())
            # Simulate interruption after freeze but before metadata publication.
            # Changing present-day auxiliary/baseline files must not refit or
            # alter the already frozen model and holdout thresholds.
            (output/'metadata.json').unlink();(baseline/'model.pkl').write_bytes(b'changed baseline after interruption')
            (private/'site-audit-v2.json').write_text('invalid changed auxiliary data')
            recovered=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=90)
            self.assertEqual(recovered.returncode,0,recovered.stderr)
            self.assertEqual(hashlib.sha256((output/'metadata.json').read_bytes()).hexdigest(),before)

if __name__=='__main__':unittest.main()
