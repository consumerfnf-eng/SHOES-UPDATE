import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {readJson,atomicJson} from './publish-curated.mjs';
const root=new URL('../',import.meta.url),catalog=await readJson(new URL('public/data/catalog.json',root));
const reviews=await readJson(new URL('data/product-presentation.json',root),{products:[]});
const cache=await readJson(new URL('data/photo-cache.json',root),{schemaVersion:1,images:{}});
const sources=[...new Set([...catalog.products.map(p=>p.presentation?.image),...reviews.products.filter(p=>p.approved).map(p=>p.image)].filter(Boolean))];
await fs.mkdir(new URL('public/images/',root),{recursive:true});let next=0;
async function worker(){while(next<sources.length){const url=sources[next++],known=cache.images[url];
 if(known&&/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(known.path)){try{const b=await fs.readFile(new URL('public'+known.path,root));if(createHash('sha256').update(b).digest('hex')===known.sha256)continue;}catch{}}
 if(!url.startsWith('https://'))throw Error('Invalid reviewed photo URL');
 const response=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0','Accept':'image/webp,image/*,*/*;q=0.8'}});if(!response.ok)throw Error(`Official photo unavailable: HTTP ${response.status} ${new URL(url).hostname}`);
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8_000_000)throw Error('Official photo too large');
 const extension=bytes[0]===0xff&&bytes[1]===0xd8?'jpg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
 if(!extension)throw Error('Official photo is not a supported raster image');
 const sha256=createHash('sha256').update(bytes).digest('hex'),publicPath=`/images/${sha256}.${extension}`;
 await fs.writeFile(new URL('public'+publicPath,root),bytes);cache.images[url]={path:publicPath,sha256,sourceUrl:url,checkedAt:new Date().toISOString()};
}}
await Promise.all(Array.from({length:3},worker));
for(const p of catalog.products)if(p.presentation)p.presentation.cachedPath=cache.images[p.presentation.image].path;
await atomicJson(new URL('data/photo-cache.json',root),cache);await atomicJson(new URL('public/data/catalog.json',root),catalog);
console.log(`Official photo cache verified: ${sources.length} exact original files; no generated or altered product photos.`);
