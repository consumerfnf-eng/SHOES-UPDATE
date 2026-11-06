import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {adminDb} from './helpers/admin-db.mjs';
import {hashPassword,sha256,ADMIN_COOKIE} from '../server/admin-auth.mjs';
import {onRequest as middleware} from '../functions/_middleware.js';
import {onRequest as overlay} from '../functions/api/visual-classifications.js';
import {validateQueue,syncQueue} from '../scripts/sync-visual-classification-queue.mjs';
const origin='https://shoes-update-internal.pages.dev',passwordHash=await hashPassword('owner-visual-test-password-1234');
const hash=n=>n.toString(16).padStart(64,'0');
const candidate=(n=1)=>({imageHash:hash(n),modelVersion:'clip-v1',category:'chunky',confidence:.8,margin:.2,alternatives:[{category:'boot',score:.2}],thumbnail:`/images/${hash(n)}.webp`,status:'review-needed',products:[{id:'p'+n,brand:n%2?'Nike':'PUMA',name:'Shoe <script>bad()</script>',url:'https://example.com/shoe',modelKey:'m'+n}]});
const queue=records=>({schemaVersion:1,generatedAt:'2026-11-06T00:00:00Z',model:{version:'clip-v1',sha256:hash(100),encoder:'CLIP',validated:false,thresholds:{chunky:{minConfidence:.8,minMargin:.2}}},records,evaluation:{private:'secret evaluation'}});
async function fixture(t){
 const db=adminDb();t.after(()=>db.sqlite.close());
 for(let n=1;n<=25;n++)db.sqlite.prepare('INSERT INTO visual_classification_candidates VALUES (?,?,?,?)').run(hash(n),'clip-v1',JSON.stringify(candidate(n)),'2026-11-06');
 db.sqlite.prepare('INSERT INTO visual_classification_metadata VALUES (1,?,?)').run(JSON.stringify(queue([]).model),'2026-11-06');
 const token='x'.repeat(43)+'.'+await sha256(passwordHash),csrf='visual-csrf-token';
 db.sqlite.prepare('INSERT INTO admin_sessions VALUES (?,?,?)').run(await sha256(token),csrf,Math.floor(Date.now()/1000)+3600);
 const env={ADMIN_DB:db,ADMIN_PASSWORD_HASH:passwordHash,INTERNAL_SITE_PASSWORD:'team-password',ADMIN_RUNNER_KEY:'runner-token',ASSETS:{async fetch(){return new Response('image bytes',{headers:{'Content-Type':'image/webp','Cache-Control':'public'}});}}};
 async function request(route,{owner=true,team=false,method='GET',input,raw,headers={}}={}){
  const request=new Request(origin+route,{method,headers:{...(owner?{Cookie:`${ADMIN_COOKIE}=${token}`} :{}),...(team?{Authorization:'Basic '+btoa('team:team-password')}:{}),...(method==='POST'?{'Content-Type':'application/json',Origin:origin,'X-CSRF-Token':csrf}:{}),...headers},...(raw!==undefined?{body:raw}:input!==undefined?{body:JSON.stringify(input)}:{})});
  return middleware({request,env,next:()=>overlay({request,env})});
 }
 return {db,env,request,review:{imageHash:hash(1),status:'approved',category:'boot',expectedModelVersion:'clip-v1',expectedRevision:0}};
}
test('staff and runner cannot access private queue, review or image; owner needs no team login',async t=>{
 const f=await fixture(t);
 for(const route of ['/api/admin/visual-classifications','/api/admin/visual-image/'+hash(1)]){
  assert.equal((await f.request(route,{owner:false,team:true})).status,401);
  assert.equal((await f.request(route,{owner:false,headers:{Authorization:'Bearer runner-token'}})).status,401);
  const response=await f.request(route);assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/private, no-store/);
 }
 assert.equal((await f.request('/api/admin/visual-classifications/review',{owner:false,team:true,method:'POST',input:f.review})).status,401);
});
test('reviews retain same-origin CSRF guard and enforce strict input and body bounds',async t=>{
 const f=await fixture(t),route='/api/admin/visual-classifications/review',opts={method:'POST',input:f.review};
 for(const headers of [{'X-CSRF-Token':''},{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.request(route,{...opts,headers})).status,403);
 for(const input of [{...f.review,category:'sneaker'},{...f.review,imageHash:'../images/x'},{...f.review,imageHash:[hash(1)]},{...f.review,expectedRevision:-1},{...f.review,expectedRevision:1.5},{...f.review,expectedModelVersion:null},{...f.review,status:'auto'},{...f.review,status:'excluded'}])assert.equal((await f.request(route,{method:'POST',input})).status,400);
 for(const raw of ['{',' '.repeat(5000)])assert.equal((await f.request(route,{method:'POST',raw})).status,400);
 assert.equal((await f.request(route,{...opts,headers:{'Content-Type':'text/plain'}})).status,400);
 for(const query of ['page=0','page=1001','page=1.2','status=bad','brand='+('x'.repeat(161))])assert.equal((await f.request('/api/admin/visual-classifications?'+query)).status,400);
 assert.equal((await f.request(route,{method:'PUT'})).status,405);
});
test('queue paginates 20 and filters brand/status with global model stats',async t=>{
 const f=await fixture(t),first=await(await f.request('/api/admin/visual-classifications')).json();
 assert.equal(first.records.length,20);assert.equal(first.total,25);assert.equal(first.model.version,'clip-v1');assert.equal(first.stats['review-needed'],25);
 assert.equal((await(await f.request('/api/admin/visual-classifications?page=2')).json()).records.length,5);
 const filtered=await(await f.request('/api/admin/visual-classifications?brand=Nike&status=review-needed')).json();assert.equal(filtered.total,13);assert(filtered.records.every(r=>r.products[0].brand==='Nike'));
 assert.equal((await(await f.request('/api/admin/visual-classifications?brand=%27%20OR%201%3D1')).json()).total,0);
});
test('atomic review rejects competing/stale writes and decisions survive candidate model refresh',async t=>{
 const f=await fixture(t),post=input=>f.request('/api/admin/visual-classifications/review',{method:'POST',input});
 const responses=await Promise.all([post(f.review),post({...f.review,category:'sandal'})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 assert.equal((await post({...f.review,imageHash:hash(999)})).status,409);
 assert.equal((await post({...f.review,expectedRevision:1,expectedModelVersion:'old'})).status,409);
 f.db.sqlite.prepare('UPDATE visual_classification_candidates SET model_version=? WHERE image_hash=?').run('clip-v2',hash(1));
 assert.equal((await post({...f.review,expectedRevision:1})).status,409);
 const record=(await(await f.request('/api/admin/visual-classifications?status=approved')).json()).records[0];assert.equal(record.review.status,'approved');assert.equal(record.revision,1);assert.equal(record.modelVersion,'clip-v2');
 assert.equal((await post({...f.review,status:'excluded',category:null,expectedModelVersion:'clip-v2',expectedRevision:1})).status,200);
 assert.equal(f.db.sqlite.prepare('SELECT revision FROM visual_classification_reviews').get().revision,2);
});
test('image lookup only serves candidate local hashed assets and image content types',async t=>{
 const f=await fixture(t);let fetched=[];
 f.env.ASSETS.fetch=async request=>{fetched.push(request.url);assert.equal(request.headers.get('Cookie'),null);return new Response('photo',{headers:{'Content-Type':'image/webp'}});};
 assert.equal((await f.request('/api/admin/visual-image/'+hash(1))).status,200);assert.equal(fetched[0],origin+candidate().thumbnail);
 for(const thumbnail of ['https://evil.example/photo.webp','/images/../../secret','/admin/index.html','/images/'+hash(1)+'.svg']){
  f.db.sqlite.prepare('UPDATE visual_classification_candidates SET data=? WHERE image_hash=?').run(JSON.stringify({...candidate(),thumbnail}),hash(1));assert.equal((await f.request('/api/admin/visual-image/'+hash(1))).status,404);
 }assert.equal(fetched.length,1);
 f.db.sqlite.prepare('UPDATE visual_classification_candidates SET data=? WHERE image_hash=?').run(JSON.stringify(candidate()),hash(1));
 for(const type of ['text/html','image/svg+xml']){f.env.ASSETS.fetch=async()=>new Response('<html>',{headers:{'Content-Type':type}});assert.equal((await f.request('/api/admin/visual-image/'+hash(1))).status,404);}
 assert.equal((await f.request('/api/admin/visual-image/'+hash(999))).status,404);
 assert.equal((await f.request('/api/admin/visual-image/bad')).status,404);
});
test('public overlay requires team Basic and contains only owner decisions without private queue metadata',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/api/visual-classifications')).status,401);
 await f.request('/api/admin/visual-classifications',{method:'POST',input:f.review});
 const response=await f.request('/api/visual-classifications',{owner:false,team:true}),result=await response.json();
 assert.deepEqual(Object.keys(result).sort(),['records','schemaVersion','updatedAt']);assert.deepEqual(result.records,[{imageHash:hash(1),category:'boot',status:'approved'}]);assert.match(response.headers.get('Cache-Control'),/private, no-store/);
 assert.equal((await f.request('/api/visual-classifications',{owner:false,team:true,method:'POST',input:{}})).status,405);
 delete f.env.ADMIN_DB;assert.equal((await f.request('/api/visual-classifications',{owner:false,team:true})).status,503);
});
test('sync validates all input before writes, strips unlisted data, batches SQL and preserves owner reviews',async t=>{
 const f=await fixture(t),dir=await fs.mkdtemp(path.join(os.tmpdir(),'visual-queue-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'queue.json'),rows=Array.from({length:1600},(_,i)=>({...candidate(i+1),privateNote:'never persisted'}));
 const before=f.db.sqlite.prepare('SELECT password_hash FROM admin_credentials').get();
 await f.request('/api/admin/visual-classifications',{method:'POST',input:f.review});
 const calls=[],db={async execute(sql){assert(Buffer.byteLength(sql)<=1000000);calls.push(sql);f.db.sqlite.exec(sql);}};
 await fs.writeFile(file,JSON.stringify(queue(rows)));const result=await syncQueue(file,{db});assert.equal(result.records,1600);assert(calls.length>3);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM visual_classification_candidates').get().count,1600);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM visual_classification_reviews').get().count,1);
 assert.equal(f.db.sqlite.prepare('SELECT password_hash FROM admin_credentials').get(),before);
 assert(!calls.join('').includes('never persisted'));assert(!calls.join('').includes('secret evaluation'));
 const count=calls.length;await syncQueue(file,{db,dryRun:true});assert.equal(calls.length,count);
 for(const bad of [queue([candidate(),candidate()]),queue([{...candidate(),thumbnail:'https://evil.example/x'}]),queue([{...candidate(),confidence:2}]),queue([{...candidate(),category:'bad'}]),queue([{...candidate(),modelVersion:'different'}]),queue([{...candidate(),products:[{...candidate().products[0],url:'javascript:bad()'}]}]),queue(Array(20001).fill(candidate()))]){
  await fs.writeFile(file,JSON.stringify(bad));await assert.rejects(syncQueue(file,{db}));assert.equal(calls.length,count);
 }
 const safe=validateQueue(queue([candidate()]));assert.equal(safe.records.length,1);
 const next=queue([{...candidate(),modelVersion:'clip-v2'}]);next.model.version='clip-v2';await fs.writeFile(file,JSON.stringify(next));await syncQueue(file,{db});
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM visual_classification_candidates').get().count,1);
 assert.equal(f.db.sqlite.prepare('SELECT category FROM visual_classification_reviews').get().category,'boot');
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM admin_sessions').get().count,1);
});
test('release gate scores and sample counts use strict separate whitelists and bounds',()=>{
 const input=queue([candidate()]);input.model.thresholds.chunky={minConfidence:.9,minMargin:.2,calibrationPrecision:1,testPrecision:.95,calibrationN:8,testN:100000};
 assert.deepEqual(validateQueue(input).model.thresholds,input.model.thresholds);
 for(const [key,value] of [['testN',-1],['testN',1.5],['calibrationN',100001],['minConfidence',2],['testPrecision',NaN],['sourceWeights',.1],['unknown',0]]){
  assert.throws(()=>validateQueue({...input,model:{...input.model,thresholds:{chunky:{...input.model.thresholds.chunky,[key]:value}}}}));
 }
});
