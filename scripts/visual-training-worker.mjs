import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {spawn} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {adminD1} from './admin-d1.mjs';import {syncQueue} from './sync-visual-classification-queue.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export function safeJobId(id){if(typeof id!=='string'||!(/^[a-zA-Z0-9-]{1,100}$/).test(id))throw Error('Invalid training job ID');return id;}
export function releaseSummary(metadata){
 const gates=metadata?.thresholds;
 if(metadata?.validated!==true||!gates||!Object.keys(gates).length)return {enabled:false,categories:[]};
 for(const [category,g] of Object.entries(gates))if(!['low-profile','chunky','retro-tech-runner','ballet-mary-jane','mule-slipper','court-other','boot','sandal','performance'].includes(category)||!Number.isInteger(g.calibrationN)||g.calibrationN<8||!Number.isInteger(g.testN)||g.testN<8||g.calibrationPrecision<.95||g.testPrecision<.95||g.calibrationPrecision>1||g.testPrecision>1||!Number.isFinite(g.calibrationPrecision)||!Number.isFinite(g.testPrecision)||!Number.isFinite(g.minConfidence)||g.minConfidence<0||g.minConfidence>1||!Number.isFinite(g.minMargin)||g.minMargin<0||g.minMargin>1)throw Error('Release evidence incomplete');
 return {enabled:true,categories:Object.keys(gates)};
}
export async function runCommand(command,args){
 await new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2',OPENBLAS_NUM_THREADS:'2'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(path.basename(command)+' failed ('+code+')')));});
}
export async function ownerSnapshotCurrent(db,request){
 const members=request.members;
 const rows=(await db.prepare(`SELECT image_hash,category,status,revision FROM visual_classification_reviews WHERE image_hash IN (${members.map(()=>'?').join(',')})`).bind(...members.map(r=>r.imageHash)).all()).results;
 const current=new Map(rows.map(r=>[r.image_hash,r]));
 return members.every(r=>{const now=current.get(r.imageHash);return now&&now.revision===r.revision&&now.status===r.status&&now.category===r.category;});
}
export async function nextTrainingJob(db){
 // One owner-PC worker. A running row is an interrupted local job, including
 // interruption before any local request file existed. Resume it first.
 const running=await db.prepare("SELECT * FROM visual_training_jobs WHERE status='running' ORDER BY started_at LIMIT 1").first();
 if(running){safeJobId(running.id);return running;}
 const queued=await db.prepare("SELECT * FROM visual_training_jobs WHERE status='queued' ORDER BY requested_at LIMIT 1").first();
 if(!queued)return null;
 return db.prepare("UPDATE visual_training_jobs SET status='running',started_at=? WHERE id=? AND status='queued' RETURNING *").bind(new Date().toISOString(),queued.id).first();
}
export async function processTrainingJob(job,{db=adminD1(),run=runCommand,sync=syncQueue}={}){
 const id=safeJobId(job.id),directory=path.join('.secrets/clip/jobs',id);await fs.mkdir(directory,{recursive:true});
 const envelope=JSON.parse(job.result||'{}'),request=envelope.request;
 if(!request||request.batchId!==job.batch_id||!Array.isArray(request.members))throw Error('Frozen owner request missing');
 await fs.writeFile(path.join(directory,'request.json'),JSON.stringify(request));
 const batch=await read('.secrets/clip/priority-review.json');
 if(batch.id!==request.batchId||request.members.length!==batch.images.length||request.members.some(m=>!batch.images.some(r=>r.imageHash===m.imageHash&&r.role===m.role)))throw Error('Frozen batch changed');
 const python=process.env.CLIP_PYTHON||'python',modelDir=path.join('.secrets/clip-models/owner',id);
 await run(python,['scripts/clip_classify.py','--manifest','.secrets/clip/priority-manifest.json','--view','shoe-letterbox','--threads','2','--batch','2','--features-only']);
 await run(python,['scripts/train_visual_owner.py','--request',path.join(directory,'request.json'),'--output-dir',modelDir]);
 const held=await read(path.join(modelDir,'held.json')).catch(()=>null),metadata=await read(path.join(modelDir,'metadata.json')).catch(()=>null);
 const release=held?{enabled:false,categories:[]}:releaseSummary(metadata);
 let result={request,worker:os.hostname(),message:held?.reason||'평가 기준 미달 · 기존 자동 분류 상태 유지',evaluation:metadata?.evaluation||held,releasedCategories:release.categories};
 if(!release.enabled)return {status:'held',result};
 const changed=()=>({status:'held',result:{...result,message:'학습 요청 후 검수 내용이 수정되어 자동 반영 보류 · 수정된 검수와 새 평가 묶음 확인 필요',releasedCategories:[]}});
 if(!await ownerSnapshotCurrent(db,request))return changed();
 // Private staging only. D1 metadata changes only after complete exact-SHA inference.
 await run(process.execPath,['scripts/prepare-clip-manifest.mjs']);await run(process.execPath,['scripts/prepare-clip-model-manifest.mjs']);
 await run(python,['scripts/clip_classify.py','--manifest','.secrets/clip/model-manifest.json','--view','shoe-letterbox','--threads','2','--batch','2','--features-only']);
 const publicPreview=path.join(directory,'released-preview.json'),queue=path.join(directory,'release-queue.json');
 await run(python,['scripts/publish_visual_classifications.py','--manifest','.secrets/clip/model-manifest.json','--model-dir',modelDir,'--audit','.secrets/clip/site-audit-v2.json','--output',publicPreview,'--queue-output',queue]);
 const snapshot=await read(publicPreview);
 if(snapshot.model.sha256!==metadata.sha256||!snapshot.records.length)throw Error('Validated release has no eligible exact-photo results');
 if(!await ownerSnapshotCurrent(db,request))return changed();
 await sync(queue,{db});
 result={...result,message:'기준 통과 범주 자동 반영 완료 · 직원 화면 새로고침 시 적용',modelVersion:metadata.version,automaticPhotos:snapshot.records.length,activatedAt:new Date().toISOString()};
 return {status:'completed',result};
}
async function main(){
 process.chdir(root);await fs.mkdir('.secrets/clip/jobs',{recursive:true});const lock='.secrets/clip/training-worker.lock';
 try{const handle=await fs.open(lock,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await handle.close();}
 catch(error){if(error.code!=='EEXIST')throw error;const old=await read(lock);try{process.kill(old.pid,0);console.log('Training worker already running');return;}catch(check){if(check.code!=='ESRCH')throw check;}await fs.unlink(lock);const handle=await fs.open(lock,'wx');await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.close();}
 try{
  const db=adminD1(),job=await nextTrainingJob(db);
  if(!job){console.log(JSON.stringify({at:new Date().toISOString(),state:'idle',message:'검수 완료 후 추가 학습 요청 대기'}));return;}
  let outcome;
  try{outcome=await processTrainingJob(job,{db});}
  catch(error){console.error(error);outcome={status:'failed',result:{...JSON.parse(job.result||'{}'),message:'백그라운드 처리 중 오류 · 기존 공개 분류 유지',error:error.message}};}
  await db.execute(`UPDATE visual_training_jobs SET status=${literal(outcome.status)},finished_at=${literal(new Date().toISOString())},result=${literal(JSON.stringify(outcome.result))} WHERE id=${literal(job.id)} AND status='running';`);
  console.log(JSON.stringify({jobId:job.id,status:outcome.status,message:outcome.result.message}));
 }finally{if((await read(lock).catch(()=>null))?.pid===process.pid)await fs.unlink(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
