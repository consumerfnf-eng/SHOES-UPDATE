import assert from 'node:assert/strict';
import {canonicalBrand,officialEvidenceFor,kstDay} from './curation.mjs';

// Identity normalization is deliberately narrower than canonicalUrl: variant,
// c, dwvar_*_color, locale paths and storefront hosts all remain significant.
function productUrlIdentity(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return '';u.hash='';for(const key of [...u.searchParams.keys()])if(/^(?:utm_|gclid$|fbclid$)/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href;}catch{return '';}
}
export function exactOfficialPdpKey(product,today=kstDay()){
 if(!officialEvidenceFor(product,today))return '';
 const url=productUrlIdentity(product.url);if(!url||new URL(url).pathname==='/')return '';
 return canonicalBrand(product.brand)+'|'+url;
}
function adoptedVariantRefinement(from,to){
 // An inferred parent tile may already have adopted the ID later resolved by
 // the structured feed. Replace that unresolved tile; never join two colors.
 if(from.id!==to.id||from.productVariantId||!to.productVariantId||from.colourId!==undefined||from.colorId!==undefined)return false;
 try{
  const a=new URL(productUrlIdentity(from.url)),b=new URL(productUrlIdentity(to.url));
  const selector=k=>/^(?:c|cid|colou?r(?:_?id)?|variant(?:_?id)?|dwvar_.+_color)$/i.test(k);
  if(a.origin!==b.origin||a.pathname!==b.pathname||[...a.searchParams.keys()].some(selector))return false;
  if([...a.searchParams].some(([k,v])=>b.searchParams.get(k)!==v))return false;
  const added=[...b.searchParams.keys()].filter(k=>!a.searchParams.has(k));return added.length>0&&added.every(selector);
 }catch{return false;}
}
export function scopedVariantConflict(a,b){
 if(adoptedVariantRefinement(a,b)||adoptedVariantRefinement(b,a))return false;
 try{
  const left=new URL(productUrlIdentity(a.url)),right=new URL(productUrlIdentity(b.url));
  if(left.origin===right.origin&&left.pathname===right.pathname&&left.search!==right.search)return true;
  const selected=u=>new Map([...u.searchParams].filter(([k])=>/^(?:c|cid|colou?r(?:_?id)?|variant(?:_?id)?|dwvar_.+_color)$/i.test(k)));
  const ac=selected(left),bc=selected(right);
  if([...ac].some(([key,value])=>bc.has(key)&&bc.get(key)!==value))return true;
 }catch{/* Missing URLs cannot establish an exact PDP match. */}
 for(const field of ['colourId','colorId'])if(a[field]!==undefined&&b[field]!==undefined&&String(a[field])!==String(b[field]))return true;
 if(a.productVariantId&&b.productVariantId&&String(a.productVariantId)!==String(b.productVariantId))return true;
 return false;
}
export function sameExactOfficialPdp(a,b,today=kstDay()){
 const key=exactOfficialPdpKey(a,today);return !!key&&key===exactOfficialPdpKey(b,today)&&!scopedVariantConflict(a,b);
}
const missing=value=>value===undefined||value===null||value===''||Array.isArray(value)&&!value.length;
// Only the winning proof envelope supplies identifiers. Sparse business fields
// may be retained from the same variant; photo reviews require the same asset.
export function retainScopedVariantFields(incoming,old){
 const copy=structuredClone(incoming);
 const proofFields=new Set(['id','brand','name','style','styleType','productId','productVariantId','colourId','colorId','url','image','officialProductEvidence','officialImageEvidence','arrivalEvidence','productEvidenceUrl','productVerifiedAt','lastVerifiedAt','sourceTileBinding','scopeEvidence','modelNameEvidence','recheckEvidence','colourReview','designReview','colorEvidence','bodyColor','colorSwatches','presentation']);
 for(const [field,value] of Object.entries(old))if(copy[field]===undefined&&!proofFields.has(field))copy[field]=structuredClone(value);
 for(const field of ['priceLabel','price','currency','material','gender','country','description','manufacturerStyle','colorway','colors','modelName'])if(missing(copy[field])&&old[field]!==undefined)copy[field]=structuredClone(old[field]);
 if(old.modelGroupId)copy.modelGroupId=old.modelGroupId;
 const samePhoto=old.image===copy.image||!!old.presentation?.cachedPath&&old.presentation.cachedPath===copy.presentation?.cachedPath;
 if(samePhoto){
  if(copy.presentation&&old.presentation)for(const field of ['frame','scale','offsetY','thumbnail'])if(old.presentation[field]!==undefined)copy.presentation[field]=structuredClone(old.presentation[field]);
  const review=old.colourReview;
  if(review?.verified===true&&review.brand===old.brand&&review.style===old.style&&review.url===old.url&&review.image===old.image){
   for(const field of ['bodyColor','colorway','colors','colorSwatches','colorEvidence'])if(old[field]!==undefined)copy[field]=structuredClone(old[field]);
   if(copy.colorEvidence)copy.colorEvidence.image=copy.image;
  }else for(const field of ['bodyColor','colorSwatches','colorEvidence'])if(copy[field]===undefined&&old[field]!==undefined)copy[field]=structuredClone(old[field]);
  for(const field of ['colourReview','designReview']){
   const r=old[field];if(r?.verified!==true||r.brand!==old.brand||r.style!==old.style||r.url!==old.url||r.image!==old.image)continue;
   if(r.style===copy.style&&r.url===copy.url&&r.image===copy.image&&(!r.id||r.id===copy.id)){copy[field]=structuredClone(r);continue;}
   copy[field]={...structuredClone(r),id:copy.id,brand:copy.brand,style:copy.style,url:copy.url,image:copy.image,
    ...(field==='colourReview'?{presentationImage:copy.presentation?.image||copy.image}:{}),
    retainedFrom:r.retainedFrom||{id:old.id,style:old.style,url:old.url,image:old.image,cachedPath:old.presentation?.cachedPath},
    retentionBasis:old.image===copy.image?'identical-product-image-url':'identical-sha256-product-photo'};
  }
 }
 if(copy.officialProductEvidence?.verified){if(copy.officialProductEvidence.identifierType==='official-product-id')copy.styleType='official-product-id';else delete copy.styleType;}
 return copy;
}
// Prefer the structured official colour variant over a second scrape of the
// same page. One page's inferred body colour must not overwrite its own SKU.
export function dedupeScopedPrepared(products,{today=kstDay()}={}){
 const byId=new Map(),score=p=>(p.productVariantId?10:0)+(/official-/.test(p.colorEvidence?.method||'')?5:0)+(/_SLC_|_SL_LT_|_N01[.]/i.test(p.presentation?.image||p.image)?2:0);
 for(const p of products){const old=byId.get(p.id);if(old){assert.equal(old.brand,p.brand);assert(productUrlIdentity(old.url)===productUrlIdentity(p.url)||adoptedVariantRefinement(old,p)||adoptedVariantRefinement(p,old),'A duplicated prepared ID points to different products');assert(!scopedVariantConflict(old,p),'A duplicated prepared ID points to different color variants');if(score(old)>=score(p))continue;}byId.set(p.id,p);}
 const rows=[],byPdp=new Map();
 for(const p of byId.values()){
  const key=exactOfficialPdpKey(p,today),positions=key?(byPdp.get(key)||[]):[];
  const index=positions.find(i=>sameExactOfficialPdp(rows[i],p,today));
  if(index===undefined){if(key){positions.push(rows.length);byPdp.set(key,positions);}rows.push(p);continue;}
  const old=rows[index],time=p=>Date.parse(p.officialProductEvidence?.verifiedAt)||0;
  const preferNew=score(p)>score(old)||score(p)===score(old)&&time(p)>time(old);
  rows[index]=preferNew?retainScopedVariantFields(p,old):retainScopedVariantFields(old,p);
 }
 return rows;
}
export function bindPreparedRaw(products,raw){
 return products.map(p=>{const r=raw.find(r=>r.brand===p.brand&&r.style===p.style&&productUrlIdentity(r.url)===productUrlIdentity(p.url));assert(r,'No matching reviewed raw SKU for '+p.id);return {...r,id:p.id};});
}
