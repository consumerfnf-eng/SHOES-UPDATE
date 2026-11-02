import {createHash} from 'node:crypto';
import {readJson,atomicJson,publishCurated} from './publish-curated.mjs';
export async function collectShopifyLux(profile,{publish=false}={}){
const settings={amiri:{brand:'AMIRI',origin:'https://amiri.com',collections:[['mens-footwear','Men'],['womens-sneakers','Women']]},rick:{brand:'Rick Owens',origin:'https://www.rickowens.eu',collections:[['men-sneakers','Men'],['women-sneakers','Women']]}}[profile];
if(!settings)throw Error('UNKNOWN_LUX_PROFILE');
const {brand,origin,collections}=settings;
const source=await readJson('data/catalog-source.json'),products=new Map(),pages=[],excluded=[];
const checkedAt=new Date().toISOString();
for(const [collection,gender] of collections){
 const seen=new Set();let finished=false;
 for(let page=1;page<=10;page++){
  const url=`${origin}/collections/${collection}/products.json?limit=250&page=${page}`;
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`SHOPIFY_LUX_OFFICIAL_API_HTTP_${response.status}`);
  const text=await response.text(),payload=JSON.parse(text),rows=payload.products;
  if(!Array.isArray(rows))throw Error('SHOPIFY_LUX_OFFICIAL_API_SCHEMA');
  const contentHash=createHash('sha256').update(text).digest('hex');
  pages.push({url,records:rows.length,checkedAt});
  if(rows.length&&rows.every(p=>seen.has(p.id)))throw Error('SHOPIFY_LUX_REPEATED_PAGE');
  for(const row of rows){
   if(seen.has(row.id))continue;seen.add(row.id);
   if(profile==='amiri'&&!/^sneakers?$/i.test(row.product_type)||profile==='rick'&&/\bboots?\b/i.test(row.title+' '+(row.body_html||'').replace(/<[^>]*>/g,' ').slice(0,800))){excluded.push({id:row.id,title:row.title,type:row.product_type});continue;}
   if(!/^[a-z0-9-]+$/.test(row.handle)||!row.images?.[0]?.src)throw Error('SHOPIFY_LUX_PRODUCT_UNBOUND');
   const image=row.images[0].src;
   if(!['cdn.shopify.com',new URL(origin).hostname].includes(new URL(image).hostname))throw Error('SHOPIFY_LUX_IMAGE_HOST');
   const old=source.products.find(p=>p.brand===brand&&p.url?.split('/').pop()===row.handle);
   const p={id:old?.id||profile+'-'+createHash('sha256').update(row.handle).digest('hex').slice(0,20),brand,name:profile==='rick'?row.title.split('|').pop().trim():row.title,style:profile==='rick'?row.title.split('|')[0].trim():row.handle,styleType:profile==='rick'?'sku':'official-product-id',url:old?.url||origin+'/products/'+row.handle,image,
    description:(row.body_html||'').replace(/<[^>]*>/g,' '),officialCategory:profile==='rick'?'Sneakers':row.product_type,gender,country:profile==='rick'?'GL':'US',colorway:row.options?.find(o=>/^colou?r$/i.test(o.name))?.values?.join(' / ')||'',colors:[],firstSeen:old?.firstSeen||checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:url,sourceSignals:[],
    arrivalEvidence:{verified:true,brand,style:profile==='rick'?row.title.split('|')[0].trim():row.handle,productUrl:old?.url||origin+'/products/'+row.handle,kind:'official-assortment-listing',url,verifiedAt:checkedAt,contentHash,excerpt:'Official collection product JSON: '+row.title}};
   const proof={verified:true,brand:p.brand,style:p.style,...(profile==='rick'?{}:{identifierType:'official-product-id'}),verifiedAt:checkedAt,verificationMethod:'official-new-listing-sku-image',contentHash};
   p.officialProductEvidence={...proof,url:p.url};p.officialImageEvidence={...proof,url:image,sourceUrl:url};products.set(row.id,p);
  }
  if(rows.length<250){finished=true;break;}
 }
 if(!finished)throw Error('SHOPIFY_LUX_PAGINATION_INCOMPLETE');
}
if(!products.size)throw Error('EMPTY_OFFICIAL_SNEAKER_COLLECTIONS');
const progress={checkedAt,products:[...products.values()],coverage:[{brand,responses:pages.length,verified:products.size,truncated:false,errors:[],pages}],pending:[]};
await atomicJson(`logs/${profile}-assortment-progress.json`,progress);
await atomicJson(`data/${profile}-assortment-report.json`,{checkedAt,pages,verifiedSneakers:products.size,excluded,scope:'Official adult collections listed in pages; all available pages read, other regions not independently reconciled'});
if(publish){const result=await publishCurated({incoming:progress.products});console.log(brand+' publication',result.snapshot.products.length);}
console.log({brand,verified:products.size,pages:pages.length,excluded:excluded.length});
return progress;
}
