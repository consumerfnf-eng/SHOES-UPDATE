import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isScopedSneakerCandidate} from './scoped-new-candidates.mjs';

export const ON_NEW='https://www.on.com/en-us/shop/new-arrivals/shoes';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const MAX_HTML=16*1024*1024;
const decode=value=>String(value||'').replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi,token=>{
 const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
 if(named[token.toLowerCase()])return named[token.toLowerCase()];
 const n=parseInt(token.slice(token[2].toLowerCase()==='x'?3:2,-1),token[2].toLowerCase()==='x'?16:10);
 return n<=0x10ffff?String.fromCodePoint(n):'';
});
const text=value=>decode(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m=>[m[1].toLowerCase(),decode(m[3])]));
const sameSource=value=>{try{return new URL(value).href===ON_NEW;}catch{return false;}};
const asset=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname==='images.ctfassets.net'&&u.pathname.startsWith('/hnk2vsx53n6l/')?u.origin+u.pathname:null;}catch{return null;}};
const productUrl=(value,sku,group)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname==='www.on.com'&&!u.search&&!u.hash&&
 /^\/en-us\/products\/[^/]+\/(?:mens|womens|unisex)\/[^/]+$/.test(u.pathname)&&u.pathname.split('/')[3].endsWith('-'+group.toLowerCase())&&u.pathname.endsWith('-shoes-'+sku)?u.href:null;}catch{return null;}};
function gridBlock(html){
 const grids=[...html.matchAll(/<ul\b[^>]*>/gi)].filter(m=>attrs(m[0])['data-test-id']==='productResults');
 if(grids.length!==1)throw Error('On official productResults grid missing or ambiguous');
 const start=grids[0].index,tags=/<\/?ul\b[^>]*>/gi;tags.lastIndex=start;let depth=0;
 for(let match;(match=tags.exec(html));){depth+=/^<\//.test(match[0])?-1:1;if(depth===0)return html.slice(start,tags.lastIndex);}
 throw Error('On productResults grid truncated');
}
function exclusion(group,variant,card){
 const summary=text(group.description),name=text(group.name),sku=String(variant.sku),url=String(variant.offers?.url||'');
 const ownText=[name,summary,decode(new URL(url).pathname)].join(' ').replace(/[_-]/g,' ');
 if(/\b(?:kids?|youth|juniors?|toddlers?|infants?|children|preschool)\b/i.test(ownText)||/^3[KY]/.test(sku))return 'not-adult';
 // A Coming soon card overrides schema.org/InStock, which is generic on this snapshot.
 if(/\bcoming soon\b/i.test(text(card)))return 'coming-soon';
 if(/\b(?:hikers?|hiking|mary jane|boots?|sandals?|slides?|slippers?|clogs?|mules?|loafers?|cleats?|spikes?)\b/i.test(ownText)||/\b(?:Cloudrock|Cloudtrax|Cloudalpine)\b/i.test(name))return 'not-confirmed-sneaker';
 const audience=summary.match(/^(Men|Women|Unisex)\s*[–—-]/)?.[1];
 const u=new URL(url),segment=u.pathname.split('/')[4];
 if(!audience||({Men:'mens',Women:'womens',Unisex:'unisex'})[audience]!==segment||!/^3[MWU][A-Z]\d{8}$/.test(sku))return 'not-confirmed-adult';
 if(!/(?:^|\s)(?:Cloud\w*|THE ROGER)\b/i.test(name)||!/running|\bruns?\b|training|gym|workout|all.day|everyday|lifestyle|tennis|comfort/i.test(summary)||
  !isScopedSneakerCandidate({brand:'On',name,cardDescription:summary,url}))return 'not-confirmed-sneaker';
 return null;
}

/** Only selected SKUs in the New results grid qualify. Color siblings and recommendations do not.
 * No endpoint or pagination URLs are invented: this adapter accepts an entirely rendered snapshot.
 * A source total, JSON-LD group count, positions and unique grid cards must all reconcile.
 */
export function onNewPage(html,url=ON_NEW,{at=new Date().toISOString()}={}){
 if(!sameSource(url))throw Error('On official US New shoes source required');
 if(typeof html!=='string'||Buffer.byteLength(html)>MAX_HTML)throw Error('Invalid or oversized On HTML');
 if(!Number.isFinite(Date.parse(at)))throw Error('Invalid On evidence timestamp');
 if(/<title[^>]*>[^<]*(?:access denied|device check|just a moment|blocked)/i.test(html))throw Error('On access blocked');
 const canonical=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>attrs(m[0])).filter(a=>a.rel==='canonical');
 const headings=[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>text(m[1]));
 if(canonical.length!==1||!sameSource(canonical[0].href)||!headings.some(h=>/^New arrivals:\s*Shoes$/i.test(h)))throw Error('On own New shoes page identity missing');
 const lists=[];
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(attrs(m[1]).type!=='application/ld+json')continue;
  let data;try{data=JSON.parse(m[2]);}catch{throw Error('Malformed On JSON-LD');}
  for(const node of Array.isArray(data)?data:(data['@graph']||[data]))if(node['@type']==='ItemList')lists.push(node);
 }
 if(lists.length!==1||!Array.isArray(lists[0].itemListElement))throw Error('On New JSON-LD ItemList missing or ambiguous');
 const list=lists[0],total=list.numberOfItems;
 if(!Number.isSafeInteger(total)||total<0||total>10000)throw Error('On source total invalid');
 const totals=[...html.matchAll(/>\s*(\d+)\s+Results\s*</gi)].map(m=>Number(m[1]));
 if(!totals.length||totals.some(value=>value!==total))throw Error('On visible and JSON-LD source totals disagree');
 const grid=gridBlock(html),cards=[...grid.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)];
 const groups=new Map(),positions=new Set();
 for(const entry of list.itemListElement){
  const g=entry.item;
  if(entry['@type']!=='ListItem'||!Number.isSafeInteger(entry.position)||entry.position<1||entry.position>total||positions.has(entry.position)||
   g?.['@type']!=='ProductGroup'||g.brand?.name!=='On'||!/^3[A-Z]{2}\d{4}$/.test(g.productGroupID||'')||groups.has(g.productGroupID)||!Array.isArray(g.hasVariant))throw Error('Invalid or repeated On source group');
  positions.add(entry.position);groups.set(g.productGroupID,{group:g,position:entry.position});
 }
 const hash=createHash('sha256').update(html).digest('hex'),products=[],excluded=[],missing=[],seen=new Set(),seenGroups=new Set();
 for(const card of cards){
  const a=attrs(card[1]),sku=a['data-sku'];
  if(!/^3[A-Z]{2}\d{8}$/.test(sku||'')||seen.has(sku)||!/^productCard-\d+$/.test(a['data-test-id']||''))throw Error('Invalid or repeated On grid SKU');
  seen.add(sku);
  const entry=groups.get(sku.slice(0,7));
  if(!entry||seenGroups.has(entry.group.productGroupID))throw Error('On grid SKU not in unique New JSON-LD group');
  seenGroups.add(entry.group.productGroupID);
  const group=entry.group,variants=group.hasVariant.filter(v=>v.sku===sku);
  const skip=reason=>missing.push({style:sku,name:group.name,reason});
  if(variants.length!==1){skip('selected-sku-jsonld-missing');continue;}
  const variant=variants[0],purl=productUrl(variant.offers?.url,sku,group.productGroupID);
  if(variant['@type']!=='Product'||!purl||group.url!==purl||!text(variant.color)){skip('selected-sku-url-or-color-mismatch');continue;}
  const links=[...card[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(m=>attrs(m[1])['data-wk-name']==='productCardLink');
  const primary=links.find(m=>/<img\b/i.test(m[2]));
  if(!primary||links.some(m=>attrs(m[1]).href!==purl)){skip('own-card-product-url-mismatch');continue;}
  const image=asset(variant.image),images=[...primary[2].matchAll(/<img\b[^>]*>/gi)].map(m=>asset(attrs(m[0]).src));
  if(!image||!images.includes(image)){skip('own-selected-sku-image-mismatch');continue;}
  const ownSummary=card[2].match(/<p\b[^>]*data-test-id=["']productSummary["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const ownTitle=card[2].match(/<p\b[^>]*data-test-id=["']productTitle["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const name=text(group.name).replace(/^(?:Men|Women)'s\s+/,'');
  if(!ownSummary||text(ownSummary)!==text(group.description)||!ownTitle||text(ownTitle)!==name){skip('own-card-name-or-type-mismatch');continue;}
  const reason=exclusion(group,variant,card[2]);
  if(reason){excluded.push({style:sku,name:text(group.name),url:purl,reason});continue;}
  if(variant.offers?.availability!=='https://schema.org/InStock'){excluded.push({style:sku,name,reason:'not-in-stock',url:purl});continue;}
  // This is the existing listing contract: the selected grid SKU, exact PDP
  // destination and its own primary CDN asset agree with that SKU's JSON-LD.
  // sourceUrl remains the listing; this does not claim a product-page read.
  const proof={verified:true,brand:'On',style:sku,verifiedAt:at,contentHash:hash,verificationMethod:'official-new-listing-sku-image'};
  const gender=text(group.description).match(/^(Men|Women|Unisex)/)[1],colorway=text(variant.color).replace(/\s*\|\s*/g,' / ');
  products.push({id:'on-new-'+sku.toLowerCase(),brand:'On',name,style:sku,manufacturerStyle:sku,productVariantId:sku,
   modelGroup:'on|'+group.productGroupID,modelGroupId:'on|'+group.productGroupID,url:purl,image,
   imageCandidates:[{url:image,alt:variant.name}],colorway,colors:colorway.split(' / '),country:'US',gender,
   productType:'sneaker',category:'sneaker',officialCategory:'New arrivals: Shoes',description:text(group.description),
   priceLabel:variant.offers.priceCurrency==='USD'&&Number.isFinite(Number(variant.offers.price))?'USD '+variant.offers.price:'',
   firstSeen:at,productVerifiedAt:at,productEvidenceUrl:url,sourceListing:url,sourceSignals:[],
   arrivalEvidence:{...proof,kind:'new-arrivals-listing',productUrl:purl,url,excerpt:`New arrivals: Shoes; result ${entry.position}; ${group.name}; selected SKU ${sku}; ${variant.color}. This is listing evidence, not a release date.`},
   officialProductEvidence:{...proof,url:purl,sourceUrl:url},officialImageEvidence:{...proof,url:image,sourceUrl:url},
   sourceTileBinding:{verified:true,brand:'On',style:sku,manufacturerStyle:sku,productVariantId:sku,
    url:purl,image,sourceUrl:url,contentHash:hash,verifiedAt:at,
    method:'official-on-new-grid-selected-sku-jsonld-image',tileSku:a['data-sku'],jsonLdSku:variant.sku,
    productGroupId:group.productGroupID,position:entry.position,
    tileHash:createHash('sha256').update(card[0]).digest('hex')}});
 }
 const sourceExhaustive=groups.size===total&&positions.size===total&&cards.length===total&&seenGroups.size===total;
 const exhaustive=sourceExhaustive&&!missing.length;
 const errors=[];
 if(!sourceExhaustive)errors.push({error:`On New rendered snapshot incomplete: ${cards.length} cards / ${groups.size} groups / ${total} reported results; no public next-page contract proved`});
 if(missing.length)errors.push({error:`On New selected-SKU evidence missing for ${missing.length} cards`});
 return {schemaVersion:1,brand:'On',checkedAt:at,sourceUrl:url,products,excluded,missing,errors,status:exhaustive?'completed':'partial',
  coverage:{total:exhaustive?total:null,reportedTotal:total,read:seen.size,pages:1,exhaustive,sourceExhaustive,
   scope:'selected SKUs in official New shoes results; excludes color siblings and recommendations',
   proof:'Visible Results count + JSON-LD ItemList positions + unique productResults cards',urls:[url]}};
}

export async function collectOnNew({readHtml,at=new Date().toISOString(),allowPartial=false}={}){
 readHtml??=async url=>{const r=await fetch(url,{headers:{Accept:'text/html'},signal:AbortSignal.timeout(22000)});if(!r.ok)throw Error('On HTTP '+r.status);if(r.url&&!sameSource(r.url))throw Error('On source redirected');return r.text();};
 const result=onNewPage(await readHtml(ON_NEW),ON_NEW,{at});
 if(!result.coverage.exhaustive&&!allowPartial){const error=Error(result.errors.map(e=>e.error).join('; '));error.partial=result;throw error;}
 return result;
}

export async function collectCachedOnNew({indexPath=path.join(ROOT,'reports/admin-rendered-index.json'),now=new Date(),maxAgeMs=86400000,allowPartial=false}={}){
 const index=JSON.parse(await fs.readFile(indexPath,'utf8')),entry=index[ON_NEW];
 if(!entry||!/^logs\/admin-rendered\/[a-f0-9]{64}\.json\.gz$/.test(entry.path||''))throw Error('On official cached capture missing');
 const cache=JSON.parse(gunzipSync(await fs.readFile(path.join(ROOT,entry.path)),{maxOutputLength:MAX_HTML}));
 const at=entry.checkedAt,age=now.getTime()-Date.parse(at);
 if(!Number.isFinite(age)||age<0||!Number.isFinite(maxAgeMs)||maxAgeMs<0||age>maxAgeMs)throw Error('On cached capture stale or invalid');
 if(cache.metadata?.statusCode!==200||!sameSource(cache.metadata.url||cache.metadata.sourceURL)||
  (cache.metadata.sourceURL&&!sameSource(cache.metadata.sourceURL))||(cache.requestedUrl&&!sameSource(cache.requestedUrl))||
  (cache.checkedAt&&cache.checkedAt!==at))throw Error('On cache response identity or timestamp mismatch');
 const html=cache.rawHtml||cache.html;
 const result=await collectOnNew({readHtml:async()=>html,at,allowPartial});
 return {...result,sourceCapture:{path:entry.path,checkedAt:at,statusCode:200,sourceUrl:ON_NEW}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);let output=path.join(ROOT,'reports/manual-on-products.json'),live=false,allowPartial=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--output'&&args[i+1])output=path.resolve(args[++i]);else if(args[i]==='--live')live=true;else if(args[i]==='--allow-partial')allowPartial=true;else throw Error('Unknown On collector argument: '+args[i]);}
 const result=live?await collectOnNew({allowPartial}):await collectCachedOnNew({allowPartial});
 await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({output,brand:result.brand,products:result.products.length,excluded:result.excluded.length,missing:result.missing.length,coverage:result.coverage}));
}
