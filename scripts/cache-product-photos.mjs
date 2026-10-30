import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {readJson,atomicJson,publishCurated} from './publish-curated.mjs';
const root=new URL('../',import.meta.url),catalog=await readJson(new URL('public/data/catalog.json',root));
const reviews=await readJson(new URL('data/product-presentation.json',root),{products:[]});
const cache=await readJson(new URL('data/photo-cache.json',root),{schemaVersion:1,images:{}});
const sources=[...new Set([...catalog.products.map(p=>p.presentation?.image),...reviews.products.filter(p=>p.approved).map(p=>p.image)].filter(Boolean))];
await fs.mkdir(new URL('public/images/',root),{recursive:true});let next=0;
// A photo we cannot fetch costs that one product its card. It used to stop the
// whole run, which in CI meant a single 403 from one brand's CDN threw away an
// hour of collection before any of it reached the site - and this step sits
// before publication, so nothing else got through either. Dropping the one
// product is the same answer the catalogue already gives to a product with no
// photograph at all.
const failures=new Map();
async function worker(){while(next<sources.length){const url=sources[next++],known=cache.images[url];
 if(known&&/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(known.path)){try{const b=await fs.readFile(new URL('public'+known.path,root));if(createHash('sha256').update(b).digest('hex')===known.sha256)continue;}catch{}}
 try{
  if(!url.startsWith('https://'))throw Error('not an https URL');
  const response=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0','Accept':'image/webp,image/*,*/*;q=0.8'}});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8_000_000)throw Error('larger than 8MB');
  const extension=bytes[0]===0xff&&bytes[1]===0xd8?'jpg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
  if(!extension)throw Error('not a supported raster image');
  const sha256=createHash('sha256').update(bytes).digest('hex'),publicPath=`/images/${sha256}.${extension}`;
  await fs.writeFile(new URL('public'+publicPath,root),bytes);cache.images[url]={path:publicPath,sha256,sourceUrl:url,checkedAt:new Date().toISOString()};
 }catch(error){failures.set(url,error.message);}
}}
await Promise.all(Array.from({length:3},worker));
const dropped=catalog.products.filter(p=>p.presentation&&!cache.images[p.presentation.image]);
// Striking those products out of the published list by hand left the snapshot
// disagreeing with itself: the keyword catalogue, the style board and the
// social comparisons had all been computed over products that were no longer
// in it, and `npm run build` - which is what Cloudflare runs - refuses a
// snapshot whose own sections do not match its products. So the unfetchable
// photos are recorded, and the publication is rebuilt from them, which is the
// one place every section is computed over the same set of products.
cache.unavailable=Object.fromEntries([...failures].map(([url,error])=>[url,{error,checkedAt:new Date().toISOString()}]));
await atomicJson(new URL('data/photo-cache.json',root),cache);
const republished=await publishCurated({});
if(dropped.length){
 const byHost={};for(const p of dropped){const h=(()=>{try{return new URL(p.presentation.image).hostname}catch{return '?'}})();byHost[h]=(byHost[h]||0)+1;}
 console.log(`photo unavailable, product not published: ${dropped.length}`);
 for(const [host,n] of Object.entries(byHost).sort((a,b)=>b[1]-a[1]))
  console.log(`  ${String(n).padStart(4)}  ${host}  ${[...failures].find(([u])=>u.includes(host))?.[1]||''}`);
}
console.log(`photos cached: ${Object.keys(cache.images).length} · published: ${republished.snapshot.products.length}`);
