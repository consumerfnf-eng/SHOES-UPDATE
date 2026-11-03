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
export function encodeCatalogV1(snapshot){
 return {...snapshot,wireFormat:'catalog-ui-v1',products:snapshot.products.map(p=>{
  const out={...p};
  if(p.officialImageEvidence)out.officialImageEvidence=pack(p.officialImageEvidence,imageDefaults(p),IMAGE);
  if(p.arrivalEvidence)out.arrivalEvidence=pack(p.arrivalEvidence,arrivalDefaults(p),ARRIVAL);
  if(p.officialProductEvidence)out.officialProductEvidence=pack(p.officialProductEvidence,defaults(p),PRODUCT);
  if(p.presentation)out.presentation=pack(p.presentation,presentationDefaults(p),PRESENTATION);
  return out;
 })};
}
function decodeCatalogV1(snapshot){
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

// Long URLs, source text and hashes recur across evidence records. Interning
// those strings reduces download and JSON parsing without dropping any fact.
function mapStrings(value,convert){
 if(typeof value==='string')return convert(value);
 if(Array.isArray(value))return value.map(v=>mapStrings(v,convert));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapStrings(v,convert)]));
 return value;
}
export function encodeCatalogV2(snapshot){
 const payload=encodeCatalogV1(snapshot),counts=new Map();
 mapStrings(payload,value=>{if(value.length>=24)counts.set(value,(counts.get(value)||0)+1);return value;});
 const strings=[...counts].filter(([value,count])=>count>=3&&(value.length-8)*count>value.length+8).map(([value])=>value);
 if(!strings.length)return payload;
 const index=new Map(strings.map((value,i)=>[value,i]));
 return {wireFormat:'catalog-ui-v2',strings,payload:mapStrings(payload,value=>index.has(value)?'~'+index.get(value).toString(36):value.startsWith('~')?'~'+value:value)};
}
function decodeCatalogV2(snapshot){
 if(snapshot?.wireFormat!=='catalog-ui-v2')return decodeCatalogV1(snapshot);
 if(!Array.isArray(snapshot.strings)||snapshot.strings.some(value=>typeof value!=='string'))throw Error('Invalid catalogue string dictionary');
 const payload=mapStrings(snapshot.payload,value=>{
   if(value.startsWith('~~'))return value.slice(1);
   if(!value.startsWith('~'))return value;
   if(!/^~[0-9a-z]+$/.test(value))throw Error('Invalid catalogue string reference');
   const index=parseInt(value.slice(1),36);
   if(!Number.isSafeInteger(index)||index>=snapshot.strings.length)throw Error('Catalogue string reference outside dictionary');
   return snapshot.strings[index];
 });
 return decodeCatalogV1(payload);
}

export function encodeCatalog(snapshot){
 const v2=encodeCatalogV2(snapshot),strings=v2.wireFormat==='catalog-ui-v2'?v2.strings:[];
 const value=v2.wireFormat==='catalog-ui-v2'?v2.payload:v2;
 const shapes=[],indices=new Map();
 const packNode=node=>{
   if(node===undefined)return [-1];
   if(Array.isArray(node))return [0,...node.map(packNode)];
   if(node&&typeof node==='object'){
     const keys=Object.keys(node).sort(),signature=JSON.stringify(keys);
     if(!indices.has(signature)){indices.set(signature,shapes.length);shapes.push(keys);}
     return [indices.get(signature)+1,...keys.map(key=>packNode(node[key]))];
   }
   return node;
 };
 const payload=packNode(value);
 return {wireFormat:'catalog-ui-v3',strings,shapes,payload};
}
export function decodeCatalog(snapshot){
 if(snapshot?.wireFormat!=='catalog-ui-v3')return decodeCatalogV2(snapshot);
 const {shapes,strings}=snapshot;
 if(!Array.isArray(shapes)||shapes.some(keys=>!Array.isArray(keys)||keys.some(k=>typeof k!=='string')||new Set(keys).size!==keys.length))throw Error('Invalid catalogue object dictionary');
 const unpackNode=node=>{
   if(!Array.isArray(node))return node;
   const [type,...values]=node;
   if(type===-1&&values.length===0)return undefined;
   if(type===0)return values.map(unpackNode);
   if(!Number.isInteger(type)||type<1||type>shapes.length)throw Error('Invalid catalogue object reference');
   const keys=shapes[type-1];if(values.length!==keys.length)throw Error('Catalogue object field count mismatch');
   return Object.fromEntries(keys.map((key,i)=>[key,unpackNode(values[i])]));
 };
 const payload=unpackNode(snapshot.payload);
 return Array.isArray(strings)&&strings.length===0?decodeCatalogV1(payload):decodeCatalogV2({wireFormat:'catalog-ui-v2',strings,payload});
}
