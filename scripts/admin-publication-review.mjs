import {siteBrandGroup} from '../public/assets/site-brand-policy.mjs';
import {samePhysicalVariant} from '../public/assets/product-identity.mjs';
import {isNewListing} from './new-arrivals.mjs';
import {isOfficialProductUrl,officialEvidenceFor,kstDay} from './curation.mjs';
export function bindAdminRawProof(raw,prepared){
 const copy={...raw};
 for(const field of ['style','styleType','url','image','officialProductEvidence','officialImageEvidence','arrivalEvidence','productEvidenceUrl','recheckEvidence','sourceTileBinding','sourceSkuBinding','scopeEvidence']){
  if(prepared[field]!==undefined)copy[field]=structuredClone(prepared[field]);else delete copy[field];
 }
 return copy;
}
export function preserveAdminBaselineFields(products,baseline,allowedBrands){
 const prior=new Map(baseline.map(p=>[p.id,p]));
 return products.map(p=>{const old=prior.get(p.id);if(!old||!allowedBrands.includes(p.brand))return p;
  const copy={...structuredClone(old),...p};
  for(const field of ['priceLabel','price','currency','material','gender','country','description','manufacturerStyle'])if((copy[field]===undefined||copy[field]===null||copy[field]==='')&&old[field]!==undefined)copy[field]=structuredClone(old[field]);
  return copy;
 });
}
export function reviewAdminProducts(products,sources){
 const rows=new Map(),held=[];
 for(const product of products){
  const p=structuredClone(product),arrival=p.arrivalEvidence;
  if(siteBrandGroup(p.brand)!=='LUX'&&arrival?.kind==='new-arrivals-listing'){
   const configured=(sources[p.brand]||[]).some(s=>s.url===arrival.url&&s.sectionEvidence?.kind==='new-arrivals-navigation'&&s.sectionEvidence.targetUrl===s.url&&s.sectionEvidence.contentHash&&isOfficialProductUrl(p.brand,s.sectionEvidence.url));
   if(!isNewListing(arrival.url)&&!configured){held.push({id:p.id,brand:p.brand,reason:'new-membership-not-bound-to-verified-section',url:p.url,source:arrival.url});continue;}
  }
  const previous=rows.get(p.id);
  if(previous){
   if(previous.brand!==p.brand||!samePhysicalVariant(previous,p)){held.push({id:p.id,brand:p.brand,reason:'conflicting-product-id',url:p.url});continue;}
   // Locale storefronts of the exact manufacturer variant are one record.
   continue;
  }
  rows.set(p.id,p);
 }
 return {products:[...rows.values()],held};
}
export function retainReviewedAdminPhoto(product,existing){
 const old=existing.find(p=>p.brand===product.brand&&samePhysicalVariant(p,product));
 if(!old?.presentation?.cachedPath||!old.image)return product;
 if(old.image!==product.image||old.style!==product.style){
  if(!officialEvidenceFor(old,kstDay()))return product;
  // A listing-bound image proof cannot be combined with a different listing's
  // hash. Retain the complete reviewed proof envelope and record the new check
  // separately, without pretending the old photograph was verified today.
  return {...structuredClone(old),id:product.id,name:product.name||old.name,
   ...(product.priceLabel?{priceLabel:product.priceLabel}:{}),
   recheckEvidence:{checkedAt:product.lastVerifiedAt||product.productVerifiedAt,product:structuredClone(product.officialProductEvidence),arrival:structuredClone(product.arrivalEvidence)}};
 }
 const copy={...product};
 for(const field of ['presentation','bodyColor','colorway','colors','colorSwatches','colorEvidence','colourReview'])if(old[field]!==undefined)copy[field]=structuredClone(old[field]);
 return copy;
}
export function retainExactPhotoAdminReview(product,existing){
 const old=existing.find(p=>p.brand===product.brand&&p.presentation?.cachedPath&&p.presentation.cachedPath===product.presentation?.cachedPath&&(p.colourReview?.verified===true||p.designReview?.verified===true));
 if(!old)return product;
 const copy={...product,presentation:{...product.presentation}};
 for(const key of ['frame','scale','offsetY','thumbnail'])if(old.presentation[key]!==undefined)copy.presentation[key]=structuredClone(old.presentation[key]);
 const retainedFrom={id:old.id,url:old.url,image:old.image,cachedPath:old.presentation.cachedPath};
 if(old.colourReview?.verified){
  for(const key of ['bodyColor','colorway','colorSwatches','colorEvidence'])if(old[key]!==undefined)copy[key]=structuredClone(old[key]);
  if(copy.colorEvidence)copy.colorEvidence.image=product.image;
  copy.colourReview={...structuredClone(old.colourReview),id:product.id,style:product.style,url:product.url,image:product.image,presentationImage:product.presentation.image,retainedFrom,retentionBasis:'identical-sha256-product-photo'};
 }
 if(old.designReview?.verified){
  for(const key of ['modelName','modelGroupId'])if(old[key]!==undefined)copy[key]=old[key];
  copy.designReview={...structuredClone(old.designReview),id:product.id,style:product.style,url:product.url,image:product.image,retainedFrom,retentionBasis:'identical-sha256-product-photo'};
 }
 return copy;
}
