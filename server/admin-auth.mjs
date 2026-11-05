const encoder=new TextEncoder();
export const ADMIN_COOKIE='__Host-shoes-admin';
export const SESSION_SECONDS=8*60*60;
export const bytes64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const from64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export const randomToken=()=>bytes64(crypto.getRandomValues(new Uint8Array(32)));
export const sha256=async value=>bytes64(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export function equalSecret(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=encoder.encode(a),y=encoder.encode(b);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);return diff===0;}
export async function hashPassword(password,salt=randomToken()){
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const hash=await crypto.subtle.deriveBits({name:'PBKDF2',salt:from64(salt),iterations:100000,hash:'SHA-256'},key,256);
 return `pbkdf2-sha256$100000$${salt}$${bytes64(hash)}`;
}
export async function checkPassword(password,encoded){
 if(typeof password!=='string'||password.length<14||password.length>200||!/^pbkdf2-sha256\$100000\$[\w-]{43}\$[\w-]{43}$/.test(encoded||''))return false;
 return equalSecret(await hashPassword(password,encoded.split('$')[2]),encoded);
}
export function sessionCookie(token,seconds=SESSION_SECONDS){return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;}
export async function passwordHashFor(db,bootstrap){return (await db.prepare('SELECT password_hash FROM admin_credentials WHERE id = 1').first())?.password_hash||bootstrap;}
export async function sessionFor(request,db,passwordHash,now=Date.now()){
 const value=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(ADMIN_COOKIE+'='))?.slice(ADMIN_COOKIE.length+1);
 if(!/^[\w-]{43}\.[\w-]{43}$/.test(value||'')||!equalSecret(value.split('.')[1],await sha256(passwordHash)))return null;
 return db.prepare('SELECT token_hash, csrf, expires FROM admin_sessions WHERE token_hash = ? AND expires > ?').bind(await sha256(value),Math.floor(now/1000)).first();
}
export function sameOrigin(request){return request.headers.get('Origin')===new URL(request.url).origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site';}
export async function loginRateAllowed(request,db,salt,now=Date.now()){
 const window=Math.floor(now/(15*60*1000)),ip=request.headers.get('CF-Connecting-IP')||'local';
 const bucket=await sha256(salt+'|'+ip);
 const row=await db.prepare('INSERT INTO admin_rate_limits (bucket, window, hits) VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET hits = CASE WHEN window = excluded.window THEN hits + 1 ELSE 1 END, window = excluded.window RETURNING hits').bind(bucket,window).first();
 return row.hits<=5;
}
