import assert from 'node:assert/strict';
import {canonicalUrl} from './curation.mjs';
// Prefer the structured official colour variant over a second scrape of the
// same page. One page's inferred body colour must not overwrite its own SKU.
export function dedupeScopedPrepared(products){
 const byId=new Map(),score=p=>(p.productVariantId?10:0)+(/official-/.test(p.colorEvidence?.method||'')?5:0)+(/_SLC_|_SL_LT_|_N01[.]/i.test(p.presentation?.image||p.image)?2:0);
 for(const p of products){const old=byId.get(p.id);if(old){assert.equal(old.brand,p.brand);assert.equal(canonicalUrl(old.url),canonicalUrl(p.url),'A duplicated prepared ID points to different products');if(score(old)>=score(p))continue;}byId.set(p.id,p);}
 return [...byId.values()];
}
export function bindPreparedRaw(products,raw){
 return products.map(p=>{const r=raw.find(r=>r.brand===p.brand&&r.style===p.style&&canonicalUrl(r.url)===canonicalUrl(p.url));assert(r,'No matching reviewed raw SKU for '+p.id);return {...r,id:p.id};});
}
