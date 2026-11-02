// Lossless defaults for repeated source bindings. Full export/product fields
// survive; the browser downloads each common URL, code and proof once per row.
const PRODUCT=['verified','brand','style','url','verifiedAt','identifierType'];
const IMAGE=[...PRODUCT,'verificationMethod','contentHash','modelIdentity','sourceUrl'];
const ARRIVAL=['verified','brand','style','productUrl','verifiedAt','contentHash'];
const PRESENTATION=['image','sourceUrl','checkedAt'];
const same=(a,b)=>a===b||(a&&b&&typeof a==='object'&&typeof b==='object'&&JSON.stringify(a)===JSON.stringify(b));
function pack(value,defaults,fields){
 if(!value)return value;const out={...value};let bits=0;
 fields.forEach((key,index)=>{if(Object.hasOwn(out,key)&&same(out[key],defaults[key])){delete out[key];bits|=1<<index;}});
 if(bits)out._wire=bits;return out;
}
function unpack(value,defaults,fields){
 if(!value||!value._wire)return value;const {_wire,...out}=value;
 fields.forEach((key,index)=>{if(_wire&(1<<index))out[key]=defaults[key];});return out;
}
function defaults(p){return {verified:true,brand:p.brand,style:p.style,url:p.url,verifiedAt:p.lastVerifiedAt,identifierType:p.styleType==='official-product-id'?'official-product-id':undefined};}
function imageDefaults(p){return {...p.officialProductEvidence,url:p.image,sourceUrl:p.officialProductEvidence?.verificationMethod==='official-new-listing-sku-image'?p.arrivalEvidence?.url:p.url};}
function arrivalDefaults(p){return {...defaults(p),productUrl:p.url,contentHash:p.officialProductEvidence?.verificationMethod==='official-new-listing-sku-image'?p.officialProductEvidence.contentHash:undefined};}
function presentationDefaults(p){return {image:p.image,sourceUrl:p.url,checkedAt:p.lastVerifiedAt};}
export function encodeCatalog(snapshot){
 return {...snapshot,wireFormat:'catalog-ui-v1',products:snapshot.products.map(p=>{
  const out={...p};
  if(p.officialImageEvidence)out.officialImageEvidence=pack(p.officialImageEvidence,imageDefaults(p),IMAGE);
  if(p.arrivalEvidence)out.arrivalEvidence=pack(p.arrivalEvidence,arrivalDefaults(p),ARRIVAL);
  if(p.officialProductEvidence)out.officialProductEvidence=pack(p.officialProductEvidence,defaults(p),PRODUCT);
  if(p.presentation)out.presentation=pack(p.presentation,presentationDefaults(p),PRESENTATION);
  return out;
 })};
}
export function decodeCatalog(snapshot){
 if(snapshot?.wireFormat!=='catalog-ui-v1')return snapshot;
 const {wireFormat,...out}=snapshot;
 out.products=snapshot.products.map(p=>{
  const row={...p};
  if(p.officialProductEvidence)row.officialProductEvidence=unpack(p.officialProductEvidence,defaults(p),PRODUCT);
  if(p.arrivalEvidence)row.arrivalEvidence=unpack(p.arrivalEvidence,arrivalDefaults(row),ARRIVAL);
  if(p.officialImageEvidence)row.officialImageEvidence=unpack(p.officialImageEvidence,imageDefaults(row),IMAGE);
  if(p.presentation)row.presentation=unpack(p.presentation,presentationDefaults(row),PRESENTATION);
  return row;
 });return out;
}
