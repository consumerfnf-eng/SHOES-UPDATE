import test from 'node:test';
import assert from 'node:assert/strict';
import {adminDb} from './helpers/admin-db.mjs';
import {hashPassword,sha256,ADMIN_COOKIE} from '../server/admin-auth.mjs';
import {onRequest as middleware} from '../functions/_middleware.js';
import {onRequest as overlay} from '../functions/api/visual-classifications.js';
import {PRIORITY_VISUAL_BATCH} from '../server/visual-classifications.mjs';
import {useVisualClassifications,useVisualClassificationReviews,visualClassification} from '../public/assets/visual-classification.mjs';
const origin='https://shoes-update-internal.pages.dev',passwordHash=await hashPassword('owner-batch-test-password-4598234');
const hash=n=>n.toString(16).padStart(64,'0'),base='/api/admin/visual-classifications';
const gate={minConfidence:.8,minMargin:.2,calibrationN:8,testN:8,calibrationPrecision:.95,testPrecision:.96};
const model=()=>({version:'clip-v2',sha256:hash(999),encoder:'CLIP/shoe-letterbox-v2',validated:false,thresholds:{chunky:{...gate}},privatePath:'.secrets/weights',evaluation:{private:'do not expose'}});
const candidate=n=>({imageHash:hash(n),modelVersion:'clip-v2',category:'chunky',confidence:.9,margin:.3,alternatives:[{category:'boot',score:.1}],thumbnail:`/images/${hash(n)}.webp`,status:n===1?'excluded':n===2?'auto':'review-needed',products:[{id:'p'+n,brand:'Brand '+n,name:'Shoe '+n,modelKey:'existing-model-'+n,url:'https://example.com/p'+n}]});
async function fixture(t){
 const db=adminDb();t.after(()=>db.sqlite.close());
 const data={id:PRIORITY_VISUAL_BATCH,title:'우선 검수 96장',targetCount:96,selectionVersion:'priority-v1',modelVersion:'clip-v2',reasons:{[hash(65)]:'독립 검수 표본'}};
 db.sqlite.prepare('INSERT INTO visual_review_batches VALUES (?,?,?)').run(PRIORITY_VISUAL_BATCH,JSON.stringify(data),'2026-11-06');
 for(let n=1;n<=96;n++){
  db.sqlite.prepare('INSERT INTO visual_classification_candidates VALUES (?,?,?,?)').run(hash(n),'clip-v2',JSON.stringify(candidate(n)),'2026-11-06');
  db.sqlite.prepare('INSERT INTO visual_review_batch_members VALUES (?,?,?,?)').run(PRIORITY_VISUAL_BATCH,hash(n),n<=32?'train':n<=64?'calibration':'test',n);
 }
 const setModel=m=>db.sqlite.prepare('INSERT OR REPLACE INTO visual_classification_metadata VALUES (1,?,?)').run(JSON.stringify(m),'2026-11-06');setModel(model());
 const token='b'.repeat(43)+'.'+await sha256(passwordHash),csrf='batch-csrf';
 db.sqlite.prepare('INSERT INTO admin_sessions VALUES (?,?,?)').run(await sha256(token),csrf,Math.floor(Date.now()/1000)+3600);
 const env={ADMIN_DB:db,ADMIN_PASSWORD_HASH:passwordHash,INTERNAL_SITE_PASSWORD:'team',ADMIN_RUNNER_KEY:'runner',ASSETS:{async fetch(){return new Response('image',{headers:{'Content-Type':'image/webp'}});}}};
 async function request(route,{owner=true,team=false,method='GET',input,raw,headers={}}={}){
  const request=new Request(origin+route,{method,headers:{...(owner?{Cookie:`${ADMIN_COOKIE}=${token}`} :{}),...(team?{Authorization:'Basic '+btoa('staff:team')}:{}),...(method==='POST'?{'Content-Type':'application/json',Origin:origin,'X-CSRF-Token':csrf}:{}),...headers},...(raw!==undefined?{body:raw}:input!==undefined?{body:JSON.stringify(input)}:{})});
  return middleware({request,env,next:()=>overlay({request,env})});
 }
 const review=(n,status='approved',category=n%2?'boot':'sandal')=>db.sqlite.prepare('INSERT OR REPLACE INTO visual_classification_reviews VALUES (?,?,?,?,?)').run(hash(n),status==='excluded'?null:category,status,'2026-11-06',1);
 const complete=()=>{for(let n=1;n<=96;n++)review(n,n===96?'excluded':'approved');};
 return {db,request,review,complete,setModel,train:(input={batchId:PRIORITY_VISUAL_BATCH})=>request(base+'/train',{method:'POST',input})};
}
test('batch API requires owner and unchanged CSRF/same-origin guard; runner has no new permission',async t=>{
 const f=await fixture(t);
 for(const route of [base+'?batch=priority',base+'/batch',base+'/train']){
  const opts=route.endsWith('/train')?{method:'POST',input:{batchId:PRIORITY_VISUAL_BATCH}}:{};
  assert.equal((await f.request(route,{...opts,owner:false,team:true})).status,401);
  assert.equal((await f.request(route,{...opts,owner:false,headers:{Authorization:'Bearer runner'}})).status,401);
 }
 for(const headers of [{'X-CSRF-Token':''},{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.request(base+'/train',{method:'POST',input:{batchId:PRIORITY_VISUAL_BATCH},headers})).status,403);
 for(const raw of ['{',' '.repeat(5000)])assert.equal((await f.request(base+'/train',{method:'POST',raw})).status,400);
 for(const input of [{},{batchId:'../bad'},{batchId:null}])assert.equal((await f.train(input)).status,400);
 assert.equal((await f.request(base+'/train')).status,405);
 assert.equal((await f.request(base+'/batch',{method:'POST',input:{}})).status,405);
 assert.equal((await f.request(base+'?batch=absent')).status,404);
 assert.equal((await f.request(base+'?batch=')).status,400);
 assert.equal((await f.request(base+'/batch?batchId=absent')).status,404);
});
test('priority alias returns progress and member order; unreviewed excluded candidates remain in batch review-needed',async t=>{
 const f=await fixture(t);f.review(2);
 const response=await f.request(base+'?batch=priority&status=review-needed'),data=await response.json();
 assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/private, no-store/);
 assert.equal(data.total,95);assert.equal(data.records.length,20);assert.equal(data.records[0].imageHash,hash(1));assert.equal(data.records[0].status,'review-needed');assert.equal(data.records[0].reviewRole,'train');
 assert.deepEqual(data.batch,{id:PRIORITY_VISUAL_BATCH,title:'우선 검수 96장',targetCount:96,total:96,reviewed:1,approved:1,excluded:0,remaining:95,job:null});
 assert.deepEqual((await(await f.request(base+'/batch')).json()).batch,data.batch);
 assert.equal((await(await f.request(base+'?batch='+PRIORITY_VISUAL_BATCH+'&status=approved')).json()).total,1);
 const all=await(await f.request(base)).json();assert.equal(all.total,96);assert.equal(all.records[0].status,'excluded');assert(!('batch' in all));assert(!('reviewRole' in all.records[0]));
 assert.equal((await(await f.request(base+'?status=review-needed')).json()).total,94);
});
test('test members are blind with owner review preserved and no model category/scores/alternatives',async t=>{
 const f=await fixture(t);f.review(65,'approved','sandal');
 const data=await(await f.request(base+'?batch=priority&page=4')).json(),r=data.records.find(r=>r.imageHash===hash(65));
 assert.equal(r.reviewRole,'test');assert.equal(r.blindReview,true);assert.equal(r.reason,'독립 검수 표본');
 assert.equal(r.category,null);assert.equal(r.confidence,0);assert.equal(r.margin,0);assert.deepEqual(r.alternatives,[]);assert.equal(r.review.category,'sandal');assert.equal(r.revision,1);
 assert(!JSON.stringify(r).includes('chunky'));assert(!JSON.stringify(r).includes('score'));
});
test('global brand-filtered queue redacts priority test photos even when batch is omitted',async t=>{
 const f=await fixture(t);f.review(65,'approved','sandal');
 const response=await f.request(base+'?brand='+encodeURIComponent('Brand 65'));
 assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.total,1);assert(!('batch' in data));
 const r=data.records[0];assert.equal(r.imageHash,hash(65));assert.equal(r.blindReview,true);assert.equal(r.reviewRole,'test');
 assert.equal(r.category,null);assert.equal(r.confidence,0);assert.equal(r.margin,0);assert.deepEqual(r.alternatives,[]);
 assert.equal(r.review.category,'sandal');assert.equal(r.revision,1);assert(!JSON.stringify(r).includes('chunky'));
});
test('explicit train submission requires all 96 decisions and at least two approved train categories',async t=>{
 const f=await fixture(t);let response=await f.train();assert.equal(response.status,409);assert.match((await response.json()).error,/96/);
 f.complete();f.db.sqlite.prepare('DELETE FROM visual_classification_reviews WHERE image_hash=?').run(hash(96));
 response=await f.train();assert.equal(response.status,409);assert.match((await response.json()).error,/1장/);
 assert.equal((await f.request(base+'/review',{method:'POST',input:{imageHash:hash(96),status:'excluded',category:null,expectedModelVersion:'clip-v2',expectedRevision:0}})).status,200);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM visual_training_jobs').get().n,0,'Last review never implicitly starts training');
 f.db.sqlite.prepare("UPDATE visual_classification_reviews SET category='boot' WHERE image_hash IN (SELECT image_hash FROM visual_review_batch_members WHERE role='train')").run();
 response=await f.train();assert.equal(response.status,409);assert.match((await response.json()).error,/2종/);
 f.review(2,'approved','sandal');assert.equal((await f.train()).status,202);
});
test('concurrent submissions create one immutable authoritative snapshot, exposed job metadata never leaks its labels',async t=>{
 const f=await fixture(t);f.complete();
 const attempts=await Promise.all([f.train({batchId:PRIORITY_VISUAL_BATCH,members:[{imageHash:'forged',role:'train',category:'chunky',modelKey:'forged'}]}),f.train()]);
 assert.deepEqual(attempts.map(r=>r.status).sort(),[200,202]);
 const stored=f.db.sqlite.prepare('SELECT * FROM visual_training_jobs').get(),result=JSON.parse(stored.result);assert.equal(stored.status,'queued');assert.equal(result.request.batchId,PRIORITY_VISUAL_BATCH);assert.equal(result.request.members.length,96);
 assert.deepEqual(result.request.members[0],{imageHash:hash(1),role:'train',category:'boot',status:'approved',revision:1,modelKey:'existing-model-1',brand:'Brand 1'});
 assert.equal(result.request.members[95].status,'excluded');assert.equal(result.request.members[95].category,null);
 for(const role of ['train','calibration','test'])assert.equal(result.request.members.filter(r=>r.role===role).length,32);
 f.db.sqlite.prepare("UPDATE visual_classification_reviews SET category='chunky',revision=revision+1 WHERE image_hash=?").run(hash(1));
 f.db.sqlite.prepare("UPDATE visual_review_batch_members SET role='test' WHERE image_hash=?").run(hash(1));
 assert.equal((await f.train()).status,200);assert.equal(f.db.sqlite.prepare('SELECT result FROM visual_training_jobs').get().result,stored.result);
 const progress=await(await f.request(base+'/batch')).json();assert.equal(progress.batch.job.id,stored.id);assert.equal(progress.batch.reviewed,96);assert(!JSON.stringify(progress).includes('members'));assert(!JSON.stringify(progress).includes('modelKey'));
 f.db.sqlite.prepare("UPDATE visual_training_jobs SET status='held' WHERE id=?").run(stored.id);assert.equal((await f.train()).status,200);assert.equal(f.db.sqlite.prepare('SELECT status FROM visual_training_jobs').get().status,'held');
 f.db.sqlite.prepare("UPDATE visual_training_jobs SET status='completed' WHERE id=?").run(stored.id);assert.equal((await f.train()).status,200);
});
test('owner job summaries whitelist messages and sample-backed metrics without returning training members or diagnostics',async t=>{
 const f=await fixture(t);f.complete();await f.train();
 const envelope=JSON.parse(f.db.sqlite.prepare('SELECT result FROM visual_training_jobs').get().result);
 f.db.sqlite.prepare("UPDATE visual_training_jobs SET status='held',result=?").run(JSON.stringify({...envelope,message:'검증 표본 부족',releasedCategories:['chunky','invalid','chunky'],automaticPhotos:42,modelVersion:'clip-owner-next',activatedAt:'2026-11-06',worker:'private-host',error:'.secrets/private-diagnostics',evaluation:{ownerSplitCounts:{train:30,calibration:31,test:32,private:'secret'},test:{n:32,accuracy:.7,byCategory:{private:'labels'}},calibration:{n:0,accuracy:1},baselineTest:{accuracy:.5},trainingTrials:['private trial'],private:'secret'}}));
 const job=(await(await f.request(base+'/batch')).json()).batch.job;
 assert.equal(job.message,'검증 표본 부족');assert.deepEqual(job.evaluation,{ownerSplitCounts:{train:30,calibration:31,test:32},test:{n:32,accuracy:.7}});
 assert.deepEqual(job.result,{message:'검증 표본 부족',releasedCategories:['chunky'],automaticPhotos:42,modelVersion:'clip-owner-next',evaluation:job.evaluation});
 for(const secret of ['members','request','private','worker','error','modelKey','byCategory','trainingTrials','activatedAt'])assert(!JSON.stringify(job).includes('"'+secret+'":'));
});
test('failed job retry reuses same id and frozen request; concurrent retries queue once',async t=>{
 const f=await fixture(t);f.complete();await f.train();const before=f.db.sqlite.prepare('SELECT * FROM visual_training_jobs').get();
 f.db.sqlite.prepare("UPDATE visual_training_jobs SET status='failed',started_at='old',finished_at='old' WHERE id=?").run(before.id);
 f.db.sqlite.prepare("UPDATE visual_classification_reviews SET category='chunky',revision=revision+1 WHERE image_hash=?").run(hash(1));
 const retries=await Promise.all([f.train(),f.train()]);assert.deepEqual(retries.map(r=>r.status).sort(),[200,202]);
 const after=f.db.sqlite.prepare('SELECT * FROM visual_training_jobs').get();assert.equal(after.id,before.id);assert.equal(after.result,before.result);assert.equal(after.status,'queued');assert.equal(after.started_at,null);assert.equal(after.finished_at,null);
});
test('completion predicate and snapshot are in the same SQLite INSERT even if a review disappears before the write',async t=>{
 const f=await fixture(t);f.complete();const prepare=f.db.prepare.bind(f.db);let changed=false;
 f.db.prepare=sql=>{
  const statement=prepare(sql);
  if(sql.startsWith('INSERT INTO visual_training_jobs')){
   const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),first=bound.first.bind(bound);bound.first=async()=>{changed=true;f.db.sqlite.prepare('DELETE FROM visual_classification_reviews WHERE image_hash=?').run(hash(1));return first();};return bound;};
  }return statement;
 };
 assert.equal((await f.train()).status,409);assert(changed);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM visual_training_jobs').get().n,0);
});
test('automatic overlay independently enforces precision, sample counts and metadata validation',async t=>{
 const f=await fixture(t),fetchOverlay=async()=>{const response=await f.request('/api/visual-classifications',{owner:false,team:true});assert.equal(response.status,200);return response.json();};
 assert(!('automatic' in await fetchOverlay()));
 for(const patch of [{testN:7},{calibrationN:7},{testN:8.5},{testPrecision:.949},{calibrationPrecision:.94},{minConfidence:null},{minMargin:2},{calibrationN:100001}]){
  f.setModel({...model(),validated:true,thresholds:{chunky:{...gate,...patch}}});assert(!('automatic' in await fetchOverlay()));
 }
 f.setModel({...model(),validated:true,thresholds:{}});assert(!('automatic' in await fetchOverlay()));
 f.setModel({...model(),validated:true,sha256:'bad'});assert(!('automatic' in await fetchOverlay()));
});
test('automatic overlay is version-bound, qualified-only, clean and compatible with owner override precedence',async t=>{
 const f=await fixture(t);f.setModel({...model(),validated:true});f.review(2,'approved','boot');
 const put=(n,patch={},version='clip-v2')=>f.db.sqlite.prepare('INSERT OR REPLACE INTO visual_classification_candidates VALUES (?,?,?,?)').run(hash(n),version,JSON.stringify({...candidate(n),status:'auto',...patch}),'2026-11-06');
 put(3,{confidence:.79});put(4,{margin:.19});put(5,{category:'sandal'});put(6,{},'old-model');put(7,{modelVersion:'old-model'});put(8,{category:'constructor'});put(9,{status:'review-needed'});put(10,{status:'excluded'});
 const response=await f.request('/api/visual-classifications',{owner:false,team:true}),data=await response.json();assert.match(response.headers.get('Cache-Control'),/private, no-store/);
 assert.deepEqual(data.automatic.records,[{imageHash:hash(2),category:'chunky',confidence:.9,margin:.3,modelVersion:'clip-v2',source:'model'}]);
 assert.deepEqual(Object.keys(data.automatic.model).sort(),['encoder','sha256','thresholds','validated','version']);
 for(const secret of ['privatePath','.secrets','alternatives','products','thumbnail','evaluation','modelKey','Brand'])assert(!JSON.stringify(data).includes(secret),secret);
 useVisualClassifications(data.automatic);useVisualClassificationReviews(data);
 assert.equal(visualClassification({presentation:{cachedPath:`/images/${hash(2)}.webp`}}).category,'boot');
 assert.equal((await f.request('/api/visual-classifications',{owner:false})).status,401);
});
