import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {releaseSummary,safeJobId,processTrainingJob,ownerSnapshotCurrent,nextTrainingJob} from '../scripts/visual-training-worker.mjs';
const gate={minConfidence:.9,minMargin:.2,calibrationN:8,testN:8,calibrationPrecision:1,testPrecision:1};
test('background release needs independent class evidence; no confident-only shortcut',()=>{
 assert.deepEqual(releaseSummary({validated:false,thresholds:{}}),{enabled:false,categories:[]});
 assert.throws(()=>releaseSummary({validated:true,thresholds:{chunky:{minConfidence:.99,minMargin:.5}}}));
 assert.throws(()=>releaseSummary({validated:true,thresholds:{chunky:{...gate,testPrecision:.94}}}));
 assert.deepEqual(releaseSummary({validated:true,thresholds:{chunky:gate}}),{enabled:true,categories:['chunky']});
 for(const id of ['../x','job/123','',null])assert.throws(()=>safeJobId(id));
});
test('held owner training never publishes, syncs or alters the previous public snapshot',async()=>{
 const before=process.cwd(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'clip-owner-held-'));process.chdir(temp);
 try{
  await fs.mkdir('.secrets/clip',{recursive:true});await fs.mkdir('public/data',{recursive:true});await fs.writeFile('public/data/visual-classifications.json','PREVIOUS');
  const members=[{imageHash:'a'.repeat(64),role:'train'}],request={batchId:'batch',members};await fs.writeFile('.secrets/clip/priority-review.json',JSON.stringify({id:'batch',images:members}));
  let syncs=0;const commands=[];
  const outcome=await processTrainingJob({id:'test-job',batch_id:'batch',result:JSON.stringify({request})},{db:{},sync:async()=>syncs++,run:async(command,args)=>{commands.push(args[0]);if(args[0]==='scripts/train_visual_owner.py'){const dir=args[args.indexOf('--output-dir')+1];await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'held.json'),JSON.stringify({reason:'표본 부족'}));}}});
  assert.equal(outcome.status,'held');assert.equal(syncs,0);assert.equal(await fs.readFile('public/data/visual-classifications.json','utf8'),'PREVIOUS');assert.deepEqual(commands,['scripts/clip_classify.py','scripts/train_visual_owner.py']);
 }finally{process.chdir(before);await fs.rm(temp,{recursive:true,force:true});}
});
test('late owner edits invalidate a frozen automatic release, even when the model passed',async()=>{
 const members=[{imageHash:'a'.repeat(64),category:'chunky',status:'approved',revision:2}];
 const db=rows=>({prepare:()=>({bind:()=>({all:async()=>({results:rows})})})});
 assert.equal(await ownerSnapshotCurrent(db([{image_hash:members[0].imageHash,category:'chunky',status:'approved',revision:2}]),{members}),true);
 assert.equal(await ownerSnapshotCurrent(db([{image_hash:members[0].imageHash,category:'court-other',status:'approved',revision:3}]),{members}),false);
 assert.equal(await ownerSnapshotCurrent(db([]),{members}),false);
});
test('an interrupted claim recovers its D1 snapshot without needing a local request file',async()=>{
 const running={id:'claimed-before-power-loss',status:'running',result:JSON.stringify({request:{batchId:'batch',members:[]}})};let queries=0;
 const db={prepare(sql){queries++;assert.match(sql,/status='running'/);return {first:async()=>running};}};
 assert.equal(await nextTrainingJob(db),running);assert.equal(queries,1);
});
