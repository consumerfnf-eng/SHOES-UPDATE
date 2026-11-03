import fs from'node:fs/promises';import{createHash}from'node:crypto';import{shopifyRows}from'./assemble-official-expansion.mjs';import{isSiteBrandAllowed}from'../public/assets/site-brand-policy.mjs';import{kstDay}from'./curation.mjs';
export async function readShopifyInventory(source,{read=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'}});if(!r.ok)throw Error('HTTP '+r.status);return r.text();},maxPages=100}={}){
 const products=[],pages=[],seen=new Set();let exhausted=false,error='';
 for(let page=1;page<=maxPages;page++){
  const url=source.root.replace(/\/$/,'')+`/products.json?limit=250&page=${page}`;
  try{const text=await read(url),value=JSON.parse(text);if(!Array.isArray(value.products))throw Error('Invalid products feed');pages.push({url,status:200,products:value.products.length,hash:createHash('sha256').update(text).digest('hex')});if(!value.products.length){exhausted=true;break;}const fresh=value.products.filter(p=>!seen.has(String(p.id)));if(fresh.length!==value.products.length)throw Error('Repeated product/page: exhaustion unproven');products.push(...fresh);fresh.forEach(p=>seen.add(String(p.id)));}catch(e){error=e.message;break;}
 }
 if(!exhausted&&!error)error='Page limit reached: exhaustion unproven';return {...source,products,pages,exhausted,error};
}
export async function collectOfficialInventory({now=new Date(),sources,read}={}){
 sources??=JSON.parse(await fs.readFile(new URL('../config/official-inventory-sources.json',import.meta.url),'utf8')).sources;
 const products=[],diagnostics=[];let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<sources.length){const source=sources[next++];if(source.brand!=='Toga'&&!isSiteBrandAllowed(source.brand))continue;const feed=await readShopifyInventory(source,{read});const result=shopifyRows(source,feed,{at:now.toISOString(),today:kstDay(now)});products.push(...result.products);diagnostics.push({brand:source.brand,adapter:'official-shopify-inventory',exhausted:feed.exhausted,error:feed.error,pages:feed.pages.length,feedProducts:feed.products.length,verified:result.products.length,excluded:result.excluded.length});}}));
 return{products,diagnostics};
}
