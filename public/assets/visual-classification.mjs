export const VISUAL_CATEGORIES=Object.freeze([
 {id:'low-profile',label:'로우프로파일'},{id:'chunky',label:'청키'},
 {id:'retro-tech-runner',label:'복고·테크 러너'},{id:'ballet-mary-jane',label:'발레·메리제인'},
 {id:'mule-slipper',label:'뮬·슬리퍼'},{id:'court-other',label:'코트·기타'},
 {id:'boot',label:'부츠'},{id:'sandal',label:'샌들'},{id:'performance',label:'퍼포먼스'}
]);
const labels=new Map(VISUAL_CATEGORIES.map(row=>[row.id,row.label]));
const hash=/^[a-f0-9]{64}$/;
let registry=new Map(),overrides=new Map(),version='',modelProducts=[],modelKeys=p=>p.modelGroupId||p.modelKey||p.id,designs=new Map(),conflicts=new Set();
function direct(product){const key=visualImageHash(product);return overrides.has(key)?overrides.get(key):registry.get(key)||null;}
function rebuildDesigns(){
 const grouped=new Map();for(const product of modelProducts){const row=direct(product);if(!row)continue;const key=String(modelKeys(product)||product.id);if(!grouped.has(key))grouped.set(key,new Map());grouped.get(key).set(row.category,row);}
 conflicts=new Set([...grouped].filter(([,rows])=>rows.size>1).map(([key])=>key));
 designs=new Map([...grouped].filter(([,rows])=>rows.size===1).map(([key,rows])=>[key,Object.freeze({...rows.values().next().value,basis:'model-design'})]));
}
/** Register the site's existing design groups; never infer a group from a name. */
export function useVisualModelProducts(products,{keyOf=p=>p.modelGroupId||p.modelKey||p.id}={}){modelProducts=products;modelKeys=keyOf;rebuildDesigns();return designs.size;}
export function visualImageHash(product){
 const path=product?.presentation?.cachedPath;
 return typeof path==='string'?path.match(/^\/images\/([a-f0-9]{64})\.(?:jpg|png|webp)$/)?.[1]||'':'';
}
/** Only released labels are public. The full queue/embeddings stay private. */
export function useVisualClassifications(snapshot){
 if(!snapshot||snapshot.schemaVersion!==1||!hash.test(snapshot.model?.sha256||'')||typeof snapshot.model.version!=='string'||snapshot.model.version.length>160||!Array.isArray(snapshot.records))throw Error('Invalid visual classification snapshot');
 const next=new Map();
 for(const row of snapshot.records){
  if(!hash.test(row.imageHash||'')||!labels.has(row.category)||!['manual','model'].includes(row.source)||row.modelVersion!==snapshot.model.version||!Number.isFinite(row.confidence)||row.confidence<0||row.confidence>1||next.has(row.imageHash))throw Error('Invalid or duplicate visual classification record');
  if(row.source==='model'){
   const gate=snapshot.model.thresholds?.[row.category];
   if(snapshot.model.validated!==true||!gate||!Number.isFinite(gate.minConfidence)||gate.minConfidence<0||gate.minConfidence>1||!Number.isFinite(gate.minMargin)||gate.minMargin<0||gate.minMargin>1||!Number.isFinite(row.margin)||row.margin<gate.minMargin||row.confidence<gate.minConfidence)throw Error('Unreleased visual classification');
  }
  next.set(row.imageHash,Object.freeze({...row,label:labels.get(row.category)}));
 }
 registry=next;version=snapshot.model.version;rebuildDesigns();return registry.size;
}
export function useVisualClassificationReviews(snapshot){
 if(snapshot?.schemaVersion!==1||!Array.isArray(snapshot.records))throw Error('Invalid visual review snapshot');
 const next=new Map();for(const row of snapshot.records){
  if(!hash.test(row.imageHash||'')||!['approved','excluded'].includes(row.status)||row.status==='approved'&&!labels.has(row.category)||next.has(row.imageHash))throw Error('Invalid visual review');
  next.set(row.imageHash,row.status==='excluded'?null:Object.freeze({imageHash:row.imageHash,category:row.category,label:labels.get(row.category),source:'manual',confidence:1,modelVersion:'owner-review'}));
 }overrides=next;rebuildDesigns();return overrides.size;
}
export function visualClassification(product){const key=visualImageHash(product);if(overrides.has(key))return overrides.get(key);return registry.get(key)||designs.get(String(modelKeys(product)||product.id))||null;}
export function visualClassificationVersion(){return version;}
export function visualModelConflict(product){return conflicts.has(String(modelKeys(product)||product.id));}
/** Each design/model gets one vote. Disagreeing colour variants are withheld. */
export function visualModelDistribution(products,{keyOf=p=>p.modelGroupId||p.modelKey||p.id}={}){
 const models=new Map(),blocked=new Set();
 for(const p of products){const key=String(keyOf(p)||p.id);if(!models.has(key))models.set(key,new Set());if(visualModelConflict(p))blocked.add(key);const entry=visualClassification(p);if(entry)models.get(key).add(entry.category);}
 const counts=new Map();let classifiedModels=0,conflictedModels=0;
 for(const [key,types] of models){
  if(types.size>1||blocked.has(key)){conflictedModels++;continue;}if(types.size!==1)continue;
  const category=[...types][0];counts.set(category,(counts.get(category)||0)+1);classifiedModels++;
 }
 return {totalModels:models.size,classifiedModels,conflictedModels,rows:VISUAL_CATEGORIES.filter(c=>counts.has(c.id)).map(c=>({id:c.id,name:c.label,count:counts.get(c.id),share:classifiedModels?counts.get(c.id)/classifiedModels:0})).sort((a,b)=>b.count-a.count)};
}
