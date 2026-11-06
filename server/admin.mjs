import {SITE_BRAND_GROUPS,isSiteBrandAllowed} from '../public/assets/site-brand-policy.mjs';
import {checkPassword,hashPassword,passwordHashFor,equalSecret,randomToken,sha256,sessionCookie,sessionFor,sameOrigin,loginRateAllowed,SESSION_SECONDS} from './admin-auth.mjs';
import {monitoringSnapshot,enqueueBulkRecheck,recentBatch} from './admin-monitor.mjs';
import {visualQueue,reviewVisualCandidate,visualImage} from './visual-classifications.mjs';
const brands=new Set(SITE_BRAND_GROUPS.flatMap(g=>g.priority));
const headers={
 'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff',
 'X-Robots-Tag':'noindex, nofollow, noarchive','X-Frame-Options':'DENY','Referrer-Policy':'same-origin',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...extra}});
const deny=()=>json({error:'관리자 로그인이 필요합니다.'},401);
async function body(request,max=4096){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error('Invalid content type');
 if(Number(request.headers.get('Content-Length'))>max)throw Error('Body too large');
 const reader=request.body?.getReader();if(!reader)throw Error('Empty body');let size=0,parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('Body too large');parts.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));
}
export function adminPath(raw){
 let path=raw;try{for(let n=0;n<4;n++){const next=decodeURIComponent(path);if(next===path)break;path=next;}}catch{return raw.startsWith('/admin')?'/admin/invalid':raw;}
 return path.replaceAll('\\','/').replace(/\/{2,}/g,'/');
}
export function isAdminPath(path){const p=adminPath(path);return p==='/admin'||p.startsWith('/admin/')||p==='/api/admin'||p.startsWith('/api/admin/');}
async function asset(context,path){
 // Pages redirects .html and /index.html requests; use the canonical asset URL
 // so the private response is rendered here instead of following a static redirect.
 const canonical=path.replace(/\/index\.html$/,'/').replace(/\.html$/,'');
 const url=new URL(canonical,context.request.url),response=await context.env.ASSETS.fetch(new Request(url,{method:'GET'}));
 if(!response.ok)return json({error:'관리자 화면을 불러오지 못했습니다.'},503);
 const protectedHeaders=new Headers(response.headers);for(const [name,value] of Object.entries(headers))protectedHeaders.set(name,value);
 return new Response(context.request.method==='HEAD'?null:response.body,{status:response.status,headers:protectedHeaders});
}
export async function adminRequest(context){
 const {request,env}=context,url=new URL(request.url),path=adminPath(url.pathname);
 if(!isAdminPath(path))return null;
 // Alternative URL spellings cannot fall through to an unguarded static asset.
 if(path!==url.pathname)return json({error:'잘못된 주소입니다.'},404);
 if(!env.ADMIN_DB||!env.ADMIN_PASSWORD_HASH)return json({error:'관리자 인증 설정을 준비하고 있습니다.'},503);
 try{
  const passwordHash=await passwordHashFor(env.ADMIN_DB,env.ADMIN_PASSWORD_HASH);
  if(path==='/api/admin/login'){
   if(request.method!=='POST')return json({error:'허용하지 않는 요청입니다.'},405);
   if(!sameOrigin(request))return json({error:'동일 사이트에서 로그인해 주세요.'},403);
   if(!await loginRateAllowed(request,env.ADMIN_DB,passwordHash))return json({error:'로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.'},429,{'Retry-After':'900'});
   const input=await body(request);
   if(!await checkPassword(input.password,passwordHash))return json({error:'관리자 비밀번호를 확인해 주세요.'},401);
   const token=randomToken()+'.'+await sha256(passwordHash),csrf=randomToken(),expires=Math.floor(Date.now()/1000)+SESSION_SECONDS;
   await env.ADMIN_DB.prepare('INSERT INTO admin_sessions (token_hash, csrf, expires) VALUES (?, ?, ?)').bind(await sha256(token),csrf,expires).run();
   await env.ADMIN_DB.prepare('DELETE FROM admin_sessions WHERE expires <= ?').bind(Math.floor(Date.now()/1000)).run();
   return json({ok:true},200,{'Set-Cookie':sessionCookie(token)});
  }
  const session=await sessionFor(request,env.ADMIN_DB,passwordHash);
  if(['/admin/login','/admin/login.html','/admin/admin.css','/admin/login.mjs','/admin/Pretendard-Medium.woff2'].includes(path)&&['GET','HEAD'].includes(request.method)){
   if(session&&path.startsWith('/admin/login'))return new Response(null,{status:303,headers:{...headers,Location:'/admin/'}});
   return asset(context,path==='/admin/login'?'/admin/login.html':path==='/admin/Pretendard-Medium.woff2'?'/assets/fonts/Pretendard-Medium.woff2':path);
  }
  if(!session){
   if(path.startsWith('/api/'))return deny();
   return new Response(null,{status:303,headers:{...headers,Location:'/admin/login'}});
  }
  if(request.method==='POST'){
   if(!sameOrigin(request)||!equalSecret(request.headers.get('X-CSRF-Token'),session.csrf))return json({error:'인증 요청을 새로고침해 주세요.'},403);
  }else if(!['GET','HEAD'].includes(request.method))return json({error:'허용하지 않는 요청입니다.'},405);
  if(path==='/api/admin/session'&&request.method==='GET')return json({csrf:session.csrf,expires:session.expires});
  if(path.startsWith('/api/admin/visual-image/')&&['GET','HEAD'].includes(request.method))return await visualImage(context,path.slice('/api/admin/visual-image/'.length),headers);
  if(path==='/api/admin/visual-classifications'||path==='/api/admin/visual-classifications/review'){
   try{
    if(request.method==='GET'&&path==='/api/admin/visual-classifications')return json(await visualQueue(env.ADMIN_DB,url));
    if(request.method==='POST'){
     let input;try{input=await body(request);}catch{return json({error:'검수 요청 형식과 크기를 확인해 주세요.'},400);}
     const review=await reviewVisualCandidate(env.ADMIN_DB,input);
     return review?json({ok:true,review}):json({error:'모델 또는 검수 결과가 변경되었습니다. 목록을 새로고침해 주세요.'},409);
    }
    return json({error:'허용하지 않는 요청입니다.'},405);
   }catch(error){if(error instanceof TypeError)return json({error:'분류·필터·검수 입력을 확인해 주세요.'},400);throw error;}
  }
  if(path==='/api/admin/logout'&&request.method==='POST'){
   await env.ADMIN_DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(session.token_hash).run();
   return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
  }
  if(path==='/api/admin/password'&&request.method==='POST'){
   if(!await loginRateAllowed(request,env.ADMIN_DB,passwordHash))return json({error:'비밀번호 확인 시도가 많습니다. 15분 후 다시 시도해 주세요.'},429);
   const input=await body(request);
   if(!await checkPassword(input.currentPassword,passwordHash))return json({error:'현재 관리자 비밀번호를 확인해 주세요.'},400);
   if(typeof input.newPassword!=='string'||input.newPassword.length<14||input.newPassword.length>200)return json({error:'새 관리자 비밀번호는 14~200자로 입력해 주세요.'},400);
   if(equalSecret(input.newPassword,env.INTERNAL_SITE_PASSWORD)||equalSecret(input.newPassword,input.currentPassword))return json({error:'기존 사이트 비밀번호와 현재 관리자 비밀번호가 아닌 새 비밀번호를 지정해 주세요.'},400);
   const nextHash=await hashPassword(input.newPassword);
   await env.ADMIN_DB.batch([
    env.ADMIN_DB.prepare('INSERT INTO admin_credentials (id, password_hash, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at').bind(nextHash,new Date().toISOString()),
    env.ADMIN_DB.prepare('DELETE FROM admin_sessions')
   ]);
   return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
  }
  if(path==='/api/admin/status'&&request.method==='GET'){
   const current=await monitoringSnapshot(env.ADMIN_DB);
   const jobs=(await env.ADMIN_DB.prepare('SELECT id, brand, status, requested_at, started_at, finished_at, result, run_url FROM admin_jobs ORDER BY requested_at DESC LIMIT 50').all()).results.map(j=>({...j,result:j.result?JSON.parse(j.result):null}));
   const activeJobs=(await env.ADMIN_DB.prepare("SELECT id, brand, status FROM admin_jobs WHERE status IN ('queued','running')").all()).results;
   return json({...current,jobs,activeJobs,batch:await recentBatch(env.ADMIN_DB),workflowUrl:'https://github.com/consumerfnf-eng/SHOES-UPDATE/actions/workflows/admin-monitor.yml'});
  }
  if(path==='/api/admin/recollect-all'&&request.method==='POST'){
   const input=await body(request);if(!['attention','all'].includes(input.scope))return json({error:'재수집 범위를 선택해 주세요.'},400);
   const current=await monitoringSnapshot(env.ADMIN_DB);return json(await enqueueBulkRecheck(env.ADMIN_DB,current.brands,input.scope),202);
  }
  if(path==='/api/admin/recollect'&&request.method==='POST'){
   const input=await body(request);if(!brands.has(input.brand)||!isSiteBrandAllowed(input.brand))return json({error:'등록된 브랜드를 선택해 주세요.'},400);
   const id=crypto.randomUUID(),at=new Date().toISOString();
   await env.ADMIN_DB.prepare("INSERT OR IGNORE INTO admin_jobs (id, brand, status, requested_at) VALUES (?, ?, 'queued', ?)").bind(id,input.brand,at).run();
   const job=await env.ADMIN_DB.prepare("SELECT id, brand, status FROM admin_jobs WHERE brand = ? AND status IN ('queued','running')").bind(input.brand).first();
   return json({ok:true,job},202);
  }
  if(path==='/admin'||path==='/admin/'||path==='/admin/index.html')return asset(context,'/admin/index.html');
  if(path==='/admin/app.mjs')return asset(context,path);
  return json({error:'페이지를 찾을 수 없습니다.'},404);
 }catch(error){console.error('Admin request failed:',error.name);return json({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},error instanceof SyntaxError?400:503);}
}
// The automation key can only claim audits and submit their result. It cannot
// read monitoring snapshots. It cannot log in, read sessions, or edit the product catalog.
export async function adminRunnerRequest(context){
 const {request,env}=context,path=new URL(request.url).pathname;
 if(!path.startsWith('/api/admin/runner/'))return null;
 if(!env.ADMIN_RUNNER_KEY||!equalSecret(request.headers.get('Authorization'),'Bearer '+env.ADMIN_RUNNER_KEY))return deny();
 if(!env.ADMIN_DB)return json({error:'Monitoring database unavailable'},503);
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  if(path==='/api/admin/runner/claim'){
   const now=Math.floor(Date.now()/1000),lease=randomToken();
   const job=await env.ADMIN_DB.prepare("UPDATE admin_jobs SET status = 'running', started_at = ?, lease = ?, lease_until = ? WHERE id = (SELECT id FROM admin_jobs WHERE status = 'queued' OR (status = 'running' AND lease_until < ?) ORDER BY requested_at LIMIT 1) RETURNING id, brand, lease").bind(new Date().toISOString(),lease,now+1800,now).first();
   return json({job:job||null});
  }
  if(path==='/api/admin/runner/complete'){
   const input=await body(request,150000),report=input.report;
   if(!report||!['completed','partial','failed'].includes(report.status)||!Array.isArray(report.candidates)||report.candidates.length>200)return json({error:'Invalid report'},400);
   const safeReport={status:report.status,checkedAt:report.checkedAt,listingPages:Number(report.listingPages)||0,verified:Number(report.verified)||0,discovered:Number(report.discovered)||0,exhaustive:report.exhaustive===true,errors:(report.errors||[]).slice(0,12).map(x=>String(x).slice(0,240)),candidates:report.candidates.map(p=>({name:String(p.name||'').slice(0,180),style:String(p.style||'').slice(0,80),url:https(p.url)})).filter(p=>p.url)};
   const runUrl=/^https:\/\/github\.com\/consumerfnf-eng\/SHOES-UPDATE\/actions\/runs\/\d+$/.test(input.runUrl||'')?input.runUrl:null;
   if(!Number.isFinite(Date.parse(safeReport.checkedAt))||Date.parse(safeReport.checkedAt)>Date.now()+60000)return json({error:'Invalid check time'},400);
   const result=await env.ADMIN_DB.prepare("UPDATE admin_jobs SET status = ?, finished_at = ?, result = ?, run_url = ?, lease = NULL, lease_until = NULL WHERE id = ? AND status = 'running' AND lease = ? AND lease_until > ? RETURNING brand").bind(report.status==='failed'?'failed':'completed',new Date().toISOString(),JSON.stringify(safeReport),runUrl,input.id,input.lease,Math.floor(Date.now()/1000)).first();
   if(!result)return json({error:'Audit lease expired'},409);
   await env.ADMIN_DB.prepare('INSERT INTO admin_checks (brand, checked_at, data) VALUES (?, ?, ?) ON CONFLICT(brand) DO UPDATE SET checked_at = excluded.checked_at, data = excluded.data WHERE excluded.checked_at > admin_checks.checked_at').bind(result.brand,safeReport.checkedAt,JSON.stringify(safeReport)).run();
   return json({ok:true});
  }
  return json({error:'Not found'},404);
 }catch(error){console.error('Admin runner failed:',error.name);return json({error:'Audit request failed'},400);}
}
function https(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
