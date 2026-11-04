import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {productImageOrigin} from '../server/product-image-origin.mjs';import {onRequest} from '../functions/_middleware.js';import {deferredProductOriginals} from '../scripts/deployment-photo-budget.mjs';
const bytes=Buffer.from('public product fixture'),hash=createHash('sha256').update(bytes).digest('hex'),path='/images/'+hash+'.jpg',commit='a'.repeat(40);
const context=(pathname=path)=>({request:new Request('https://shoes-update-internal.pages.dev'+pathname,{headers:{Authorization:'Basic private-site-value'}}),env:{ASSETS:{fetch:async()=>Response.json({schemaVersion:1,commit,paths:[path]})}}});
test('pinned public originals retain bytes and hash without forwarding authentication',async()=>{
 let calls=0;const c=context(),response=await productImageOrigin(c,{fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://raw.githubusercontent.com/consumerfnf-eng/SHOES-UPDATE/'+commit+'/public'+path);assert.equal(options,undefined);return new Response(bytes);}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(calls,1);
});
test('research, arbitrary paths, unknown hashes and missing manifests never use the public origin',async()=>{
 for(const pathname of ['/catwalk/private.jpg','/forecast/report.jpg','/images/anything.jpg','/images/'+'b'.repeat(64)+'.jpg'])assert.equal(await productImageOrigin(context(pathname),{fetchImpl:async()=>{throw Error('Unexpected external request');}}),null);
 const c=context();c.env.ASSETS.fetch=async()=>new Response('<html>SPA fallback</html>',{headers:{'content-type':'text/html'}});assert.equal(await productImageOrigin(c),null);
});
test('unexpected origin bytes fail closed and are not cached',async()=>{
 const response=await productImageOrigin(context(),{fetchImpl:async()=>new Response('changed'),cache:{match:async()=>null,put:async()=>{throw Error('must not cache');}}});assert.equal(response.status,502);
});
test('cached originals serve HEAD without another origin download',async()=>{
 const c=context();c.request=new Request(c.request.url,{method:'HEAD'});const result=await productImageOrigin(c,{fetchImpl:async()=>{throw Error('Unexpected download');},cache:{match:async()=>new Response(bytes,{headers:{'content-type':'image/jpeg'}})}});assert.equal(result.status,200);assert.equal(await result.text(),'');
});
test('the existing password gate runs before original-image lookup',async()=>{
 let calls=0;const c=context();c.env.INTERNAL_SITE_PASSWORD='secret';c.env.ASSETS.fetch=async()=>{calls++;return Response.json({});};c.next=async()=>{throw Error('Unauthorized fallback');};const response=await onRequest(c);assert.equal(response.status,401);assert.equal(calls,0);
});
test('normal card photographs keep the direct static path without manifest requests',async()=>{
 const c=context();c.request=new Request(c.request.url,{headers:{Authorization:'Basic '+btoa('team:secret')}});c.env.INTERNAL_SITE_PASSWORD='secret';c.next=async()=>new Response(bytes,{headers:{'content-type':'image/jpeg'}});c.env.ASSETS.fetch=async()=>{throw Error('Static photos must not look up the origin manifest');};const response=await onRequest(c);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
});
test('file budgeting preserves every LUX file and all fast card thumbnails',()=>{
 const image=n=>'/images/'+String(n).repeat(64)+'.jpg',thumb=n=>'/images/'+String(n).repeat(64)+'.webp';const catalog={products:[{brand:'Prada',presentation:{cachedPath:image(1),thumbnail:{path:thumb(1)}}},{brand:'PUMA',presentation:{cachedPath:image(2),thumbnail:{path:thumb(2)}}},{brand:'Converse',presentation:{cachedPath:image(3),thumbnail:{path:thumb(3)}}}]};const selected=['data/catalog.json',...catalog.products.flatMap(p=>[p.presentation.cachedPath.slice(1),p.presentation.thumbnail.path.slice(1)])];const omitted=deferredProductOriginals(catalog,selected,6);assert.deepEqual([...omitted],[image(2).slice(1),image(3).slice(1)]);assert(!omitted.has(image(1).slice(1)));assert.throws(()=>deferredProductOriginals(catalog,selected,3),/no data or research files/);
});
