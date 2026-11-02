import {canonicalUrl} from './curation.mjs';
import {manufacturerCode} from '../public/assets/product-identity.mjs';
import {repairSourceLabels} from './repair-source-labels.mjs';
function productUrl(p){
 try{const u=new URL(canonicalUrl(p.url));for(const key of ['cgid','cate','cate_no','display_group'])u.searchParams.delete(key);u.searchParams.sort();return u.href;}catch{return '';}
}
function shopifyHandle(p){try{return new URL(p.url).pathname.match(/\/products\/([^/]+)$/)?.[1]||'';}catch{return '';}}
// Keep existing IDs/publication history when a current primary source supplies
// better variant facts. A numeric retailer ID is never a manufacturer match.
export function reconcileOfficialAssortment(existing,incoming,{publishedIds=new Set()}={}){
 const rows=existing.map(repairSourceLabels),byUrl=new Map(),byCode=new Map(),byHandle=new Map();
 const index=p=>{const brand=p.brand+'|',u=productUrl(p),code=manufacturerCode(p),handle=shopifyHandle(p);for(const[map,key]of[[byUrl,u],[byCode,code],[byHandle,handle]])if(key&&!map.has(brand+key))map.set(brand+key,p);};
 [...rows].sort((a,b)=>Number(publishedIds.has(b.id))-Number(publishedIds.has(a.id))).forEach(index);
 const added=[],updated=[];
 for(const raw of incoming){
  const p=repairSourceLabels(raw),brand=p.brand+'|',url=productUrl(p),code=manufacturerCode(p),handle=shopifyHandle(p);
  const structured=/\/products\.json(?:\?|$)/.test(p.arrivalEvidence?.url||'');
  if(structured&&p.modelName)p.modelNameEvidence={verified:true,brand:p.brand,style:p.style,url:p.url,image:p.image,sourceUrl:p.arrivalEvidence.url,contentHash:p.arrivalEvidence.contentHash,modelName:p.modelName,method:'official-product-attribute'};
  if(p.colorway&&p.officialProductEvidence?.verified)p.colorEvidence={method:'official-product-attribute',url:p.productEvidenceUrl||p.arrivalEvidence?.url,label:p.colorway,contentHash:p.officialProductEvidence.contentHash};
  const old=(url&&byUrl.get(brand+url))||(code&&byCode.get(brand+code))||(handle&&byHandle.get(brand+handle));
  if(old){
    const id=old.id,firstSeen=old.firstSeen,firstPublishedAt=old.firstPublishedAt;
    const readPdp=p.officialProductEvidence?.verificationMethod==='official-new-arrivals-and-product-page';
    // A rendered shelf must not overwrite a previously checked factory code,
    // English model name or approved side photograph with a six-digit shop ID
    // and a translated thumbnail caption. Refresh its membership separately.
    if(publishedIds.has(id)&&!structured&&!readPdp)old.assortmentRecheck=p.arrivalEvidence;
    else Object.assign(old,p,{id,firstSeen,...(firstPublishedAt?{firstPublishedAt}:{})});
    updated.push({id,brand:p.brand,style:old.style,url:old.url});index(old);
  }
  else{rows.push(p);added.push({id:p.id,brand:p.brand,style:p.style,url:p.url});index(p);}
 }
 return {products:rows,added,updated:[...new Map(updated.map(p=>[p.id,p])).values()]};
}
