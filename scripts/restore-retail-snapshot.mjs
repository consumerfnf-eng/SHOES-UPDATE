import {canonicalSiteBrand,isSiteBrandAllowed} from '../public/assets/site-brand-policy.mjs';
import {isExcludedBrand} from '../public/assets/brand-exclusions.mjs';
export function restoreRetailSnapshot(current,archive,policy){
 if(policy?.schemaVersion!==1||policy.snapshotId!=='retail-restored-20261103')return current;
 const ids=new Set(policy.productIds||[]),byId=new Map(current.map(p=>[p.id,p]));
 for(const raw of archive){
  const brand=canonicalSiteBrand(raw.brand);
  if(!ids.has(raw.id)||!isSiteBrandAllowed(brand)||isExcludedBrand(brand))continue;
  const existing=byId.get(raw.id);
  const same=existing&&['style','url','image'].every(k=>existing[k]===raw[k]);
  const p={...(same?existing:raw),brand};
  p.retailRestoration={snapshotId:policy.snapshotId,id:p.id,brand,style:p.style||'',url:p.url,image:p.image};
  byId.set(p.id,p);
 }
 return [...byId.values()];
}
