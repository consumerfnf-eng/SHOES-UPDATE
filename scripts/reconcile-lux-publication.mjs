import {readJson,atomicJson} from './publish-curated.mjs';
import {canonicalUrl,classifyFootwear} from './curation.mjs';
import {displayBrandGroup} from '../public/assets/brand-groups.mjs';
import {fileURLToPath} from 'node:url';

export function reconcileLux(catalog,progress,review={held:[]}) {
 const brands=catalog.brands.filter(b=>displayBrandGroup(b)==='LUX').map(b=>b.name);
 const key=p=>p.brand+'|'+canonicalUrl(p.url);
 const published=new Set(catalog.products.map(key));
 const held=new Map(review.held.map(p=>[p.id,p.reason]));
 const sneakerCategories=new Set(['sneaker','hybrid','ballet-sneaker','mary-jane-sneaker','mule-sneaker']);
 const outside=p=>{const type=classifyFootwear(p);return type.category&&!sneakerCategories.has(type.category)||['kids-sizing','not-footwear','excluded-footwear'].includes(type.reason);};
 return {schemaVersion:1,checkedAt:new Date().toISOString(),publishedAt:catalog.publishedAt,
  brands:brands.map(brand=>{
   const verified=(progress.products||[]).filter(p=>p.brand===brand);
   const coverage=progress.coverage?.find(c=>c.brand===brand);
   const absent=verified.filter(p=>!published.has(key(p)));
   const excluded=absent.filter(p=>outside(p)||held.get(p.id)==='duplicate-product-color').map(p=>({id:p.id,name:p.name,url:p.url,reason:held.get(p.id)||'outside-sneaker-scope'}));
   const excludedIds=new Set(excluded.map(p=>p.id));
   const missing=absent.filter(p=>!excludedIds.has(p.id)).map(p=>({id:p.id,name:p.name,url:p.url,reason:held.get(p.id)||'not-published-after-curation'}));
   return {brand,published:catalog.products.filter(p=>p.brand===brand).length,publishedSneakers:catalog.products.filter(p=>p.brand===brand&&sneakerCategories.has(p.category)).length,verified:verified.length,missing,excluded,
    pending:(progress.pending||[]).filter(p=>p.brand===brand).length,
    pages:coverage?.responses||0,truncated:coverage?.truncated??true,errors:coverage?.errors||[],scopeComplete:false};
  }),
  caveat:'Verified records are reconciled by official product URL, including duplicate IDs. Official totals and dynamic pagination must also be reconciled before any completeness claim.'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const root=new URL('../',import.meta.url);
 const progress=await readJson(process.argv[2]||new URL('logs/lux-assortment-progress.json',root));
 const catalog=await readJson(new URL('public/data/catalog.json',root));
 const review=await readJson(new URL('data/curation-review.json',root));
 const report=reconcileLux(catalog,progress,review);
 await atomicJson(new URL('data/lux-publication-reconciliation.json',root),report);
 await atomicJson(new URL('public/data/lux-publication-reconciliation.json',root),report);
 console.log(JSON.stringify(report.brands.map(b=>({brand:b.brand,published:b.published,missing:b.missing.length,pending:b.pending}))));
}
