// Validation only: this module performs no collection or network requests.
export const CATEGORY_API_FIELDS=['sourceUrl','categoryUrl','transport','jsonPointer','payloadPointer','provenance','globalProductId','merchProductId','scopeEvidence','ownBrand'];
// Only own title/subtitle/type and explicit brand fields, never construction
// prose: a sneaker's heel counter does not make it a heeled dress shoe.
export function nikeApiProductExclusion({title='',subTitle='',ownBrand,assignedBrand}={}){
 const titles=[title,subTitle].map(value=>String(value||''));
 const brands=(Array.isArray(ownBrand)?ownBrand:[ownBrand]).map(value=>typeof value==='string'?value: value?.name||value?.brandName||'').map(value=>value.trim().toLowerCase());
 if(brands.includes('converse')||titles.some(value=>/^\s*Converse\b/i.test(value)))return 'non-nike-own-brand';
 if(assignedBrand==='Nike'&&brands.includes('jordan'))return 'own-brand-requires-jordan-new-membership';
 const excluded=/\b(?:cleats?|spikes?|(?:duck)?boots?|sandals?|slides?|mules?|clogs?|slippers?|loafers?|socks?|gift\s*cards?|pumps?|stilettos?|heeled)\b|\bheels?\b(?![ -]+(?:counters?|clips?|tabs?|cushion\w*|support|padding|stabiliz\w*|lock|to[ -]toe|drop)\b)/i;
 return titles.some(value=>excluded.test(value))?'not-sneakers':'';
}
const roots={Nike:'https://www.nike.com/w/new-shoes-3n82yzy7ok',Jordan:'https://www.nike.com/w/new-jordan-shoes-37eefz3n82yzy7ok'};
const adultRoots=['https://www.nike.com/w/new-mens-shoes-3n82yznik1zy7ok','https://www.nike.com/w/new-womens-shoes-3n82yz5e1x6zy7ok'];
const wall='/discover/product_wall/v1/marketplace/US/language/en/consumerChannelId/d9a5bc42-4b9c-4976-858a-f159cf99c647';
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const date=(s,today)=>Number.isFinite(Date.parse(s))&&new Date(Date.parse(s)+9*3600000).toISOString().slice(0,10)<=today;
const url=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash?u:null;}catch{return null;}};
const wallScope=(source,category)=>{const u=url(source);return u?.hostname==='api.nike.com'&&u.pathname===wall&&u.searchParams.get('path')===new URL(category).pathname&&u.searchParams.get('queryType')==='PRODUCTS'&&['24','50','100'].includes(u.searchParams.get('count'))&&/^\d+$/.test(u.searchParams.get('anchor')||'');};
export function verifiedCategoryApiProof(p,today){
 const root=roots[p.brand],e=p.officialProductEvidence,i=p.officialImageEvidence,a=p.arrivalEvidence,sku=p.style;
 if(nikeApiProductExclusion({title:p.name,subTitle:p.officialCategory,ownBrand:[p.officialBrand,p.brandName,p.productBrand,e?.ownBrand],assignedBrand:p.brand}))return false;
 if(!root||!e||!i||!a||p.styleType==='official-product-id'||!/^[A-Z0-9]{6,10}-\d{3}$/.test(sku||''))return false;
 const pdp=url(p.url),image=url(p.image);
 if(pdp?.hostname!=='www.nike.com'||decodeURIComponent(pdp.pathname).split('/').at(-1)!==sku||image?.hostname!=='static.nike.com'||!image.pathname.startsWith('/a/images/'))return false;
 if(e.url!==p.url||i.url!==p.image||a.url!==root||a.productUrl!==p.url||a.kind!=='new-arrivals-listing'||p.productEvidenceUrl!==e.sourceUrl||!wallScope(e.sourceUrl,root))return false;
 for(const proof of [e,i,a])if(proof.verified!==true||proof.brand!==p.brand||proof.style!==sku||proof.verificationMethod!=='official-new-category-json-variant'||proof.transport!=='official-public-json-api'||proof.categoryUrl!==root||proof.sourceUrl!==e.sourceUrl||proof.jsonPointer!==e.jsonPointer||proof.contentHash!==e.contentHash||proof.globalProductId!==e.globalProductId||proof.merchProductId!==e.merchProductId||!date(proof.verifiedAt,today))return false;
 if(!hash(e.contentHash)||!/^\/productGroupings\/\d+\/products\/\d+$/.test(e.jsonPointer||'')||!e.globalProductId||!e.merchProductId)return false;
 const scope=e.scopeEvidence;if(scope?.verified!==true||scope.style!==sku||scope.audience!=='adult'||scope.transport!=='official-public-json-api'||!hash(scope.contentHash)||!date(scope.verifiedAt,today))return false;
 if(adultRoots.includes(scope.url))return wallScope(scope.sourceUrl,scope.url)&&/^\/productGroupings\/\d+\/products\/\d+$/.test(scope.jsonPointer||'');
 const exact=url(scope.sourceUrl);return scope.url===scope.sourceUrl&&exact?.hostname==='api.nike.com'&&exact.pathname==='/product_feed/threads/v3/'&&exact.searchParams.getAll('filter').includes('productInfo.merchProduct.styleColor('+sku+')')&&/^\/objects\/\d+\/productInfo\/\d+(?:\/merchProduct\/genders)?$/.test(scope.jsonPointer||'');
}
