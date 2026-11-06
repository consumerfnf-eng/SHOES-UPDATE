import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {variantGroupKey} from '../public/assets/catalog-view.mjs';
import {siteBrandGroup,isSiteBrandAllowed} from '../public/assets/site-brand-policy.mjs';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const catalog=await read('public/data/catalog.json'),monthly=await read('public/data/monthly-catalog.json').catch(()=>({retail:[]}));
const cache=await read('data/photo-cache.json');
const images=new Map();
for(const p of [...catalog.products,...monthly.retail]){
 if(!isSiteBrandAllowed(p.brand))continue;
 const asset=p.presentation?.cachedPath||cache.images?.[p.presentation?.image||p.image]?.path;
 const match=asset?.match(/^\/images\/([a-f0-9]{64})\.(?:jpg|png|webp)$/);if(!match)continue;
 const file='public'+asset;try{await fs.access(file);}catch{continue;}
 const row={id:p.id,brand:p.brand,group:siteBrandGroup(p.brand),name:p.name,modelKey:p.brand+'|'+variantGroupKey(p),productType:p.productType||p.category,url:p.url,image:p.presentation?.image||p.image};
 if(!images.has(match[1]))images.set(match[1],{imageHash:match[1],path:file,products:[]});
 images.get(match[1]).products.push(row);
}
const rows=[...images.values()].sort((a,b)=>a.imageHash.localeCompare(b.imageHash));
const chosen=[],used=new Set();
for(const group of ['LUX','SPORTS','CASUAL']){
 const candidates=rows.filter(r=>r.products.some(p=>p.group===group)).sort((a,b)=>createHash('sha256').update('clip-blind-v1'+a.imageHash).digest('hex').localeCompare(createHash('sha256').update('clip-blind-v1'+b.imageHash).digest('hex')));
 const brands=new Map();for(const r of candidates){const p=r.products.find(p=>p.group===group);if(!brands.has(p.brand))brands.set(p.brand,[]);brands.get(p.brand).push(r);}
 let n=0;for(let round=0;n<100&&round<500;round++){let found=false;for(const queue of brands.values()){
  const r=queue.shift();if(!r)continue;found=true;const p=r.products.find(p=>p.group===group);if(used.has(p.modelKey)||chosen.some(c=>c.imageHash===r.imageHash))continue;
  used.add(p.modelKey);chosen.push({...r,sampleId:'V'+String(chosen.length+1).padStart(3,'0'),group,modelKey:p.modelKey});n++;if(n>=100)break;
 }if(!found)break;}
}
await fs.mkdir('.secrets/clip',{recursive:true});
const stamp=new Date().toISOString();
await fs.writeFile('.secrets/clip/manifest.json',JSON.stringify({schemaVersion:1,generatedAt:stamp,catalogHash:createHash('sha256').update(await fs.readFile('public/data/catalog.json')).digest('hex'),images:rows}));
await fs.writeFile('.secrets/clip/site-blind-sample.json',JSON.stringify({schemaVersion:1,generatedAt:stamp,selection:'100 distinct design/model groups per LUX/SPORTS/CASUAL; deterministic brand round robin; no classifier predictions used',images:chosen}));
console.log(JSON.stringify({images:rows.length,products:rows.reduce((n,r)=>n+r.products.length,0),sample:chosen.length,groups:Object.fromEntries(['LUX','SPORTS','CASUAL'].map(g=>[g,chosen.filter(r=>r.group===g).length]))}));
