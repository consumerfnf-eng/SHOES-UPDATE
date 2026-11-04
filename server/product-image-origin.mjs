// Only public product photographs already committed to this repository may
// use this fallback. Authentication runs before it; research assets never do.
export async function productImageOrigin(context,{fetchImpl=fetch,cache=globalThis.caches?.default}={}){
 const request=context.request,url=new URL(request.url),match=url.pathname.match(/^\/images\/([a-f0-9]{64})\.(jpg|png|webp)$/);
 if(!match||!['GET','HEAD'].includes(request.method)||!context.env.ASSETS)return null;
 let manifest;
 try{const metadata=await context.env.ASSETS.fetch(new URL('/data/product-image-origins.json',url));if(!metadata.ok||!metadata.headers.get('content-type')?.includes('application/json'))return null;manifest=await metadata.json();}catch{return null;}
 if(manifest.schemaVersion!==1||!/^([a-f0-9]{40})$/.test(manifest.commit)||!Array.isArray(manifest.paths)||!manifest.paths.includes(url.pathname))return null;
 const key=new Request(url.origin+url.pathname),cached=cache&&await cache.match(key);
 if(cached)return request.method==='HEAD'?new Response(null,{status:cached.status,headers:cached.headers}):cached;
 try{
  // Do not forward the site's Authorization header to the public origin.
  const upstream=await fetchImpl('https://raw.githubusercontent.com/consumerfnf-eng/SHOES-UPDATE/'+manifest.commit+'/public'+url.pathname);
  if(!upstream.ok)throw Error('Product origin unavailable');
  const bytes=await upstream.arrayBuffer();if(bytes.byteLength>25*1024*1024)throw Error('Image exceeds limit');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==match[1])throw Error('Product image hash mismatch');
  const response=new Response(bytes,{headers:{'Content-Type':{jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[match[2]],'Cache-Control':'public, max-age=31536000, immutable','ETag':'"'+match[1]+'"','X-Content-Type-Options':'nosniff'}});
  if(cache){const saved=cache.put(key,response.clone()).catch(()=>{});if(context.waitUntil)context.waitUntil(saved);else await saved;}
  return request.method==='HEAD'?new Response(null,{headers:response.headers}):response;
 }catch{return new Response('Product image temporarily unavailable.',{status:502});}
}
