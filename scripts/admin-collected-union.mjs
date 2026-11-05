import {canonicalUrl} from './curation.mjs';
export function mergeCollectedRuns(runs,brands){
 const allowed=new Set(brands),rows=new Map();
 // Prefer the latest complete proof object; never splice hashes or photographs
 // from different listing reads. Smaller resumed batches still contribute.
 for(const run of [...runs].sort((a,b)=>Date.parse(b.checkedAt||0)-Date.parse(a.checkedAt||0))){
  for(const p of run.products||[]){if(!allowed.has(p.brand)||!p.id||!p.url||p.officialProductEvidence?.verified!==true)continue;
   const product=p.officialProductEvidence.verificationMethod==='official-new-category-json-variant'&&!p.officialProductEvidence.scopeEvidence&&p.scopeEvidence?{...p,officialProductEvidence:{...p.officialProductEvidence,scopeEvidence:p.scopeEvidence}}:p;
   const key=p.brand+'|'+p.id+'|'+canonicalUrl(p.url);if(!rows.has(key))rows.set(key,product);
  }
 }
 return [...rows.values()];
}
