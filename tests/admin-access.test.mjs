import test from 'node:test';import assert from 'node:assert/strict';
import {onRequest} from '../functions/_middleware.js';
import {hashPassword,sha256,sessionCookie,ADMIN_COOKIE} from '../server/admin-auth.mjs';
import {adminDb} from './helpers/admin-db.mjs';
import {auditCandidates} from '../scripts/admin-monitor-runner.mjs';
const password='owner-password-fixture-3487234902',runner='runner-fixture-key-2345678901234567890123456789',origin='https://shoes-update-internal.pages.dev';
const encoded=await hashPassword(password);
function fixture(){
 const db=adminDb(),env={ADMIN_DB:db,ADMIN_PASSWORD_HASH:encoded,ADMIN_RUNNER_KEY:runner,INTERNAL_SITE_PASSWORD:'team-password',ASSETS:{async fetch(){return new Response('<main>ADMIN PRIVATE VIEW</main>',{headers:{'Content-Type':'text/html'}});}}};
 const request=async(path,{method='GET',body,headers={},basic=true,cookie}={})=>onRequest({env,request:new Request(origin+path,{method,headers:{...(basic?{Authorization:'Basic '+btoa('team:'+env.INTERNAL_SITE_PASSWORD)}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),next:async()=>new Response('NORMAL SITE')});
 const login=async()=>{const response=await request('/api/admin/login',{method:'POST',body:{password}});assert.equal(response.status,200);const cookie=response.headers.get('Set-Cookie').split(';')[0];const session=await (await request('/api/admin/session',{cookie})).json();return {cookie,csrf:session.csrf};};return {db,env,request,login};
}
test('team password alone never exposes administrator HTML or data, including encoded paths',async()=>{
 const f=fixture();for(const path of ['/admin/','/admin/index.html','/admin/app.mjs']){const r=await f.request(path);assert.equal(r.status,303,path);assert.equal(r.headers.get('Location'),'/admin/login');assert(!(await r.text()).includes('PRIVATE'));}
 assert.equal((await f.request('/api/admin/status')).status,401);
 for(const path of ['/%61dmin/index.html','/admin%2findex.html','/api/%61dmin/status','//admin/index.html'])assert.notEqual((await f.request(path)).status,200,path);
 assert.equal((await f.request('/admin/')).headers.get('Cache-Control'),'private, no-store, max-age=0');
 assert.equal(await(await f.request('/')).text(),'NORMAL SITE');
 assert.equal((await f.request('/admin/login',{basic:false})).status,401);
});
test('login requires the distinct administrator secret and same-origin POST',async()=>{
 const f=fixture();assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password:'team-password'}})).status,401);
 assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password},headers:{Origin:'https://attacker.example'}})).status,403);
 const response=await f.request('/api/admin/login',{method:'POST',body:{password}});assert.equal(response.status,200);
 const cookie=response.headers.get('Set-Cookie');for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=28800'])assert(cookie.includes(flag));
 const token=cookie.split(';')[0].split('=')[1],stored=f.db.sqlite.prepare('SELECT * FROM admin_sessions').get();assert.equal(stored.token_hash,await sha256(token));assert.notEqual(stored.token_hash,token);
});
test('persistent login rate limit blocks the sixth attempt per 15-minute IP window',async()=>{
 const f=fixture();for(let i=0;i<5;i++)assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password:'invalid-owner-password'}})).status,401);
 assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password}})).status,429);
 assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password},headers:{'CF-Connecting-IP':'192.0.2.7'}})).status,200);
});
test('sessions expire, cannot be forged, and still require normal site authentication',async()=>{
 const f=fixture(),{cookie}=await f.login();assert.equal((await f.request('/admin/',{cookie})).status,200);
 assert.equal((await f.request('/api/admin/status',{cookie,basic:false})).status,401);
 assert.equal((await f.request('/api/admin/status',{cookie:sessionCookie('a'.repeat(43))})).status,401);
 f.db.sqlite.exec('UPDATE admin_sessions SET expires=1');assert.equal((await f.request('/api/admin/status',{cookie})).status,401);
});
test('recollection requires CSRF, same origin and the permitted brand registry; duplicates share a job',async()=>{
 const f=fixture(),{cookie,csrf}=await f.login();
 assert.equal((await f.request('/api/admin/recollect',{method:'POST',cookie,body:{brand:'Nike'}})).status,403);
 assert.equal((await f.request('/api/admin/recollect',{method:'POST',cookie,body:{brand:'Nike'},headers:{'X-CSRF-Token':csrf,Origin:'https://attacker.example'}})).status,403);
 const options={method:'POST',cookie,body:{brand:'Nike'},headers:{'X-CSRF-Token':csrf}};
 const first=await(await f.request('/api/admin/recollect',options)).json(),second=await(await f.request('/api/admin/recollect',options)).json();assert.equal(first.job.id,second.job.id);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM admin_jobs').get().count,1);
 assert.equal((await f.request('/api/admin/recollect',{...options,body:{brand:'Goyard'}})).status,400);
});
test('only the scoped automation key claims a job, once, and a lease authorizes its completion',async()=>{
 const f=fixture(),{cookie,csrf}=await f.login();await f.request('/api/admin/recollect',{method:'POST',cookie,body:{brand:'PUMA'},headers:{'X-CSRF-Token':csrf}});
 assert.equal((await f.request('/api/admin/runner/claim',{method:'POST',cookie,body:{}})).status,401);
 const options={method:'POST',basic:false,body:{},headers:{Authorization:'Bearer '+runner}};
 const claimed=await(await f.request('/api/admin/runner/claim',options)).json();assert.equal(claimed.job.brand,'PUMA');assert.equal((await(await f.request('/api/admin/runner/claim',options)).json()).job,null);
 const report={status:'completed',checkedAt:new Date().toISOString(),listingPages:2,verified:24,discovered:37,exhaustive:true,errors:[],candidates:[{name:'New shoe',style:'NEW-1',url:'https://kr.puma.com/shoe'}]};
 const done={...options,body:{...claimed.job,report,runUrl:'https://attacker.example'}};
 assert.equal((await f.request('/api/admin/runner/complete',{...done,body:{...done.body,lease:'forged'}})).status,409);
 assert.equal((await f.request('/api/admin/runner/complete',done)).status,200);
 assert.equal((await f.request('/api/admin/runner/complete',done)).status,409);
 const stored=f.db.sqlite.prepare('SELECT * FROM admin_jobs').get();assert.equal(stored.run_url,null);assert.equal(stored.lease,null);assert.equal(f.db.sqlite.prepare('SELECT brand FROM admin_checks').get().brand,'PUMA');
 assert.equal((await f.request('/api/admin/status',{basic:false,headers:{Authorization:'Bearer '+runner}})).status,401);
});
test('overview reports real snapshot deltas, hides leases, and keeps responses uncacheable',async()=>{
 const f=fixture(),{cookie}=await f.login(),brand={brand:'Nike',group:'SPORTS',officialModels:10,officialRecords:20,lastCheckAt:'2020-01-01',status:'checked'};
 for(const [id,at,count] of [['old','2026-11-01',7],['new','2026-11-02',10]])f.db.sqlite.prepare('INSERT INTO admin_snapshots VALUES (?,?,?)').run(id,at,JSON.stringify({brands:[{...brand,officialModels:count}]}));
 const response=await f.request('/api/admin/status',{cookie}),data=await response.json();assert.equal(data.brands[0].modelDelta,3);assert.equal(data.brands[0].status,'stale');assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert(!JSON.stringify(data).includes('token_hash'));
});
test('logout revokes a stolen copy of the same cookie on the server',async()=>{
 const f=fixture(),{cookie,csrf}=await f.login();assert.equal((await f.request('/api/admin/logout',{method:'POST',cookie,body:{},headers:{'X-CSRF-Token':csrf}})).status,200);assert.equal((await f.request('/api/admin/status',{cookie})).status,401);
});
test('missing administrator bindings fail closed, and candidates are compared without editing products',async()=>{
 const f=fixture();delete f.env.ADMIN_DB;assert.equal((await f.request('/admin/')).status,503);
 const published=[{brand:'PUMA',url:'https://kr.puma.com/old',style:'OLD'}],incoming=[...published,{brand:'PUMA',name:'new',url:'https://kr.puma.com/new',style:'NEW'},{brand:'Gucci',url:'https://gucci.com/new',style:'NEW'}],before=JSON.stringify(published);
 assert.equal(auditCandidates(incoming,published,'PUMA').length,1);assert.equal(JSON.stringify(published),before);
});

test('owner chooses a separate password; rotation rejects the team password, revokes old tokens and replaces the bootstrap secret',async()=>{
 const f=fixture();f.env.INTERNAL_SITE_PASSWORD='shared-password-fixture-3487234';const {cookie,csrf}=await f.login();
 const options={method:'POST',cookie,headers:{'X-CSRF-Token':csrf}},next='new-owner-password-fixture-928374';
 const oldSession=f.db.sqlite.prepare('SELECT * FROM admin_sessions').get();
 assert.equal((await f.request('/api/admin/password',{...options,body:{currentPassword:password,newPassword:f.env.INTERNAL_SITE_PASSWORD}})).status,400);
 assert.equal((await f.request('/api/admin/password',{...options,body:{currentPassword:password,newPassword:next}})).status,200);
 assert.equal((await f.request('/api/admin/status',{cookie})).status,401);
 // An in-flight login tied to the old credential version cannot survive rotation.
 f.db.sqlite.prepare('INSERT INTO admin_sessions VALUES (?,?,?)').run(oldSession.token_hash,oldSession.csrf,oldSession.expires);
 assert.equal((await f.request('/api/admin/status',{cookie})).status,401);
 assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password}})).status,401);
 assert.equal((await f.request('/api/admin/login',{method:'POST',body:{password:next}})).status,200);
});
