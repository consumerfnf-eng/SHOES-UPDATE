import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const HOKA_NEW='https://www.hoka.com/en/us/new-arrivals/';
export const HOKA_BROWSER_TRANSPORT='chrome-rendered-main-dom';
export const HOKA_HTTP_TRANSPORT='official-http-html';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const digest=s=>createHash('sha256').update(s).digest('hex');
const decode=s=>String(s||'').replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi,x=>{
 const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
 if(named[x.toLowerCase()])return named[x.toLowerCase()];const hex=x[2].toLowerCase()==='x',n=parseInt(x.slice(hex?3:2,-1),hex?16:10);return n<=0x10ffff?String.fromCodePoint(n):'';
});
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m=>[m[1].toLowerCase(),decode(m[3])]));
const cls=(n,c)=>(n.a.class||'').split(/\s+/).includes(c);
function location(raw){
 const u=new URL(raw);
 if(u.origin!=='https://www.hoka.com'||u.username||u.password||u.hash)throw Error('HOKA unofficial capture URL');
 if(u.href===HOKA_NEW)return {url:u.href,start:0,root:true};
 if(u.pathname!=='/on/demandware.store/Sites-HOKA-US-Site/en_US/Search-UpdateGrid'||u.searchParams.get('cgid')!=='new-arrivals'||
  [...u.searchParams.keys()].some(k=>!['cgid','start','sz'].includes(k)||u.searchParams.getAll(k).length!==1)||
  !/^\d+$/.test(u.searchParams.get('start')||'')||!/^\d+$/.test(u.searchParams.get('sz')||'')||!Number.isSafeInteger(Number(u.searchParams.get('start')))||Number(u.searchParams.get('start'))<1||Number(u.searchParams.get('sz'))<1||Number(u.searchParams.get('sz'))>200)throw Error('HOKA browser fragment outside New scope');
 return {url:u.href,start:Number(u.searchParams.get('start')),size:Number(u.searchParams.get('sz')),root:false};
}
const urlKey=s=>{const u=new URL(s);u.searchParams.sort();return u.href;};
// Index DOM elements only. Script bodies, gallery JSON attributes and analytics
// are never evaluated or used as product/category/count evidence.
function elements(html){
 const safe=html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi,m=>' '.repeat(m.length));
 const nodes=[],stack=[];
 for(const m of safe.matchAll(/<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)){
  const tag=m[1].toLowerCase();
  if(m[0].startsWith('</')){const i=stack.findLastIndex(n=>n.tag===tag);if(i>=0){const n=stack[i];n.close=m.index;n.end=m.index+m[0].length;n.closed=true;stack.splice(i);}continue;}
  const n={tag,a:attrs(m[0]),start:m.index,open:m.index+m[0].length,parent:stack.at(-1),closed:false};nodes.push(n);
  if(/^(img|input|br|hr|source|meta|link|wbr|area|embed|param|track|col|base)$/.test(tag)||m[0].endsWith('/>')){n.close=n.open;n.end=n.open;n.closed=true;}else stack.push(n);
 }
 return nodes;
}
const within=(n,p)=>n.start>=p.open&&(!p.closed||n.end<=p.close);
const inner=(html,n)=>n?.closed?html.slice(n.open,n.close):'';
const text=s=>decode(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const visible=n=>{for(let p=n;p;p=p.parent)if(p.a['aria-hidden']==='true'||/display\s*:\s*none|visibility\s*:\s*hidden/i.test(p.a.style||'')||/\b(?:d-none|sr-only|hidden)\b/.test(p.a.class||''))return false;return true;};
function pdp(raw,base){
 const u=new URL(raw,base),m=u.pathname.match(/^\/en\/us\/([^/]+)\/([^/]+)\/(\d{7})\.html$/);
 if(u.origin!=='https://www.hoka.com'||u.username||u.password||u.hash||!m)throw Error('HOKA own product URL missing');
 const key='dwvar_'+m[3]+'_color';
 if([...u.searchParams.keys()].some(k=>k!==key)||u.searchParams.getAll(key).length>1)throw Error('HOKA ambiguous selected color URL');
 return {url:u.href,category:m[1],model:m[3],color:u.searchParams.get(key)};
}
function photo(raw,style){
 const u=new URL(raw);
 if(u.origin!=='https://dms.deckers.com'||u.username||u.password||u.hash||!u.pathname.startsWith('/hoka/image/upload/')||!new RegExp('/'+style+'_1\\.(?:png|jpe?g|webp)$','i').test(u.pathname))throw Error('HOKA own selected SKU primary image missing');
 return u.href;
}
function typeReason(name,category,usage,audience){
 const own=(name+' '+category+' '+audience).replaceAll('-',' ');
 if(/\b(?:kids?|children|youth|junior|toddlers?|infants?|boys?|girls?)\b/i.test(own))return 'not-adult';
 if(/\b(?:mocs?|moccasins?|slippers?|slides?|sandals?|mules?|clogs?|boots?|hikers?|hiking|kaha|anacapa|tor ultra|ora|hopara)\b/i.test(own))return 'non-sneaker-form';
 if(/\b(?:socks?|hats?|caps?|shirts?|tees?|jackets?|shorts?|pants?|tights?|leggings?|bras?|apparel|accessories|headwear)\b/i.test(own))return 'not-footwear';
 const gender=/^womens-/.test(category)?'Women':/^mens-/.test(category)?'Men':/^(?:all-gender|unisex)-/.test(category)||category==='race-shoes'?'Unisex':null;
 if(!gender)return 'adult-athletic-type-unproven';
 if(gender==='Women'&&!/^Women(?:'s)?$/i.test(audience)||gender==='Men'&&!/^Men(?:'s)?$/i.test(audience)||gender==='Unisex'&&!/^(?:All Gender|All-Gender|Unisex)$/i.test(audience))return 'adult-athletic-type-unproven';
 const athletic=/\b(?:clifton|bondi|mach|speedgoat|challenger|transport|cielo|rincon|arahi|gaviota|elevon|stinson|rocket|tecton)\b/i.test(name);
 if(/(?:^|-)(?:road|trail|running|fitness|training)$/.test(category)&&/\brun(?:ning)?\b|training|walking|fitness|race/i.test(usage))return null;
 if(athletic&&/running|race|footwear/.test(category)&&/\brun(?:ning)?\b|race/i.test(usage))return null;
 if(athletic&&(/(?:^|-)lifestyle$/.test(category)||/^(?:all-gender|unisex)-footwear$/.test(category))&&/lifestyle|comfort/i.test(usage))return null;
 return 'adult-athletic-type-unproven';
}

/** Accept only an explicitly labelled Chrome main-DOM capture. No HTTP status,
 * hidden JS, scraper JSON, data-images gallery, or fabricated PDP proof is used. */
export function hokaBrowserNewPage(capture,{now=new Date(),maxAgeMs=86400000}={}){
 if(!capture||capture.brand!=='HOKA'||capture.transport!==HOKA_BROWSER_TRANSPORT||typeof capture.html!=='string'||!capture.html.trim()||Buffer.byteLength(capture.html)>16*1024*1024)throw Error('Validated HOKA Chrome DOM capture required');
 if(['status','statusCode','httpStatus','rawHtml'].some(k=>Object.hasOwn(capture,k))||capture.metadata?.statusCode!==undefined)throw Error('Browser DOM capture must not claim HTTP status/raw response');
 return parseCapturedNewDom(capture,{now,maxAgeMs});
}

function parseCapturedNewDom(capture,{now=new Date(),maxAgeMs=86400000}={}){
 const where=location(capture.url),at=capture.checkedAt,age=now.getTime()-Date.parse(at);
 if(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(at)||!Number.isFinite(age)||age<0||!Number.isFinite(maxAgeMs)||maxAgeMs<0||age>maxAgeMs)throw Error('HOKA capture timestamp invalid or stale');
 if(!where.root&&capture.parentUrl!==HOKA_NEW)throw Error('HOKA fragment parent New URL missing');
 const html=capture.html,nodes=elements(html),errors=[],products=[],excluded=[],missing=[],placements=[];
 const main=nodes.find(n=>n.tag==='main'&&n.a.id==='main-content');
 if(where.root&&(!main||!nodes.some(n=>within(n,main)&&n.tag==='h1'&&/^HOKA New Arrivals$/i.test(text(inner(html,n))))))throw Error('HOKA visible New root identity missing');
 const scope=where.root?nodes.find(n=>cls(n,'product-grid')&&within(n,main)):null;
 if(where.root&&!scope)throw Error('HOKA New product grid missing');
 const counts=where.root?[...new Set(nodes.filter(n=>cls(n,'category-info-header__results-count')&&within(n,main)).map(n=>Number(text(inner(html,n)).match(/^\((\d+)\)$/)?.[1])))]:[];
 if(where.root&&(counts.length!==1||!Number.isSafeInteger(counts[0])||counts[0]<0))throw Error('HOKA visible source total missing or ambiguous');
 const contentHash=digest(html),provenance={transport:capture.transport,format:capture.transport===HOKA_BROWSER_TRANSPORT?'rendered-main-dom':'original-http-html',sourceUrl:where.url,checkedAt:at,
  ...(capture.transport===HOKA_HTTP_TRANSPORT?{upstreamStatus:200}:{}),...(capture.extraction?{extraction:capture.extraction}:{})};
 const cards=nodes.filter(n=>cls(n,'product')&&n.a['data-pid']&&visible(n)&&(!scope||within(n,scope)));
 for(const card of cards){
  if(!card.closed){missing.push({reason:'truncated-product-card',productId:card.a['data-pid']});continue;}
  const children=nodes.filter(n=>within(n,card)),pid=card.a['data-pid'];
  let identity,name,style;
  try{
   const title=children.find(n=>cls(n,'tile-product-name')&&n.closed),link=title&&children.find(n=>n.tag==='a'&&n.a.href&&within(n,title));
   if(!link)throw Error('HOKA own tile name/product link missing');
   identity=pdp(link.a.href,capture.url);
   const group=children.find(n=>cls(n,'product-group')&&within(n,link));
   const audience=text(inner(html,group));name=text(inner(html,link)).replace(new RegExp('^'+audience.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*'),'').trim();
   if(!name)throw Error('HOKA own title missing');
   const usage=children.filter(n=>cls(n,'best-for__item')&&visible(n)).map(n=>text(inner(html,n))).join(', ');
   const badge=children.filter(n=>visible(n)&&(cls(n,'product-badge-text')||cls(n,'deckers-badge__text'))).map(n=>text(inner(html,n))).join(' ');
   const reason=/\bcoming soon\b|pre[ -]?order/i.test(badge)?'upcoming':typeReason(name,identity.category,usage,audience);
   style=identity.color?identity.model+'-'+identity.color:identity.model;
   const key=style,placement={key,style,url:identity.url,productId:pid,kind:'product'};placements.push(placement);
   if(reason==='adult-athletic-type-unproven')throw Error('HOKA adult athletic shoe type unproven');
   if(reason){excluded.push({...placement,name,reason});continue;}
   if(!/^[A-Z0-9]{2,8}$/.test(identity.color||'')||(card.a['data-master-id']!==undefined&&card.a['data-master-id']!==identity.model))throw Error('HOKA manufacturer/selected color binding missing');
   const images=children.filter(n=>cls(n,'image-container')&&!cls(n,'swatch-image-container')&&children.some(a=>a.tag==='a'&&cls(a,'image-link')&&within(a,n)));
   // Sanitized browser DOM may omit nonessential data attributes. The actual
   // own image link + exact <model>-<color>_1 filename still bind the SKU.
   if(images.length!==1||[['data-image-selector',style],['data-product-master-id',identity.model],['data-product-color',identity.color],['data-product-id',pid],['data-product-name',name]].some(([key,value])=>images[0].a[key]!==undefined&&images[0].a[key]!==value))throw Error('HOKA primary image container identity mismatch');
   const imageLink=children.find(n=>n.tag==='a'&&cls(n,'image-link')&&within(n,images[0]));
   if(!imageLink||pdp(imageLink.a.href,capture.url).url!==identity.url)throw Error('HOKA primary image link differs from selected product');
   const imageNodes=children.filter(n=>n.tag==='img'&&within(n,imageLink));
   if(imageNodes.length!==1)throw Error('HOKA primary photo ambiguous');
   const img=imageNodes[0];let image;
   if(/^https:/.test(img.a.src||''))image=photo(img.a.src,style);
   else if(/^https:/.test(img.a['data-src']||''))image=photo(img.a['data-src'],style);
   else{
    const candidates=children.filter(n=>n.tag==='source'&&within(n,imageLink)).flatMap(n=>(n.a.srcset||'').split(/,\s*/).map(s=>s.trim().split(/\s+/)[0]).filter(Boolean));
    if(!candidates.length)throw Error('HOKA lazy primary photo URL absent from captured DOM');
    const bound=candidates.map(value=>photo(value,style));image=bound[0];
   }
   if(img.a.alt!==name&&img.a.title!==name)throw Error('HOKA primary photo title contradicts selected shoe');
   const selectedSwatches=children.filter(n=>n.tag==='button'&&n.a['data-product-color']===identity.color&&/^Select color /i.test(n.a['aria-label']||''));
   const swatches=selectedSwatches.filter(n=>{
    if(n.tag!=='button'||n.a['data-product-color']!==identity.color||!/^Select color /i.test(n.a['aria-label']||''))return false;
    try{const target=new URL(n.a.value,capture.url),keys=[...target.searchParams.keys()];
     return target.origin==='https://www.hoka.com'&&target.pathname===new URL(identity.url).pathname&&keys.length===1&&
      ['dwvar_'+identity.model+'_color','dwvar_'+pid+'_color'].includes(keys[0])&&target.searchParams.get(keys[0])===identity.color;
    }catch{return false;}
   });
   if(selectedSwatches.length&&!swatches.length)throw Error('HOKA selected color label destination contradicts product');
   const labels=[...new Set(swatches.map(n=>n.a['aria-label'].replace(/^Select color /i,'')))];
   if(labels.length>1)throw Error('HOKA selected color label ambiguous');
   // A sanitizer may remove swatch values. Do not guess the color's name from
   // swatch order; retain the exact manufacturer color code and leave it blank.
   const colorway=labels[0]||'',gender=/^womens-/.test(identity.category)?'Women':/^mens-/.test(identity.category)?'Men':'Unisex';
   const proof={verified:true,brand:'HOKA',style,verifiedAt:at,contentHash,verificationMethod:'official-new-listing-sku-image',provenance};
   products.push({id:'hoka-new-'+style.toLowerCase(),brand:'HOKA',name,style,manufacturerStyle:style,productVariantId:style,modelGroup:'hoka|'+identity.model,modelGroupId:'hoka|'+identity.model,
    url:identity.url,image,imageCandidates:[{url:image,alt:name}],gender,country:'US',colorCode:identity.color,colorway,colors:colorway?colorway.split(' / '):[],category:'sneaker',productType:'sneaker',officialCategory:identity.category,description:usage||'Adult athletic lifestyle sneaker',
    priceLabel:/^\d+(?:\.\d+)?$/.test(images[0].a['data-product-price']||'')?'USD '+images[0].a['data-product-price']:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:capture.url,sourceSignals:[],
    arrivalEvidence:{...proof,kind:'new-arrivals-listing',url:capture.url,productUrl:identity.url,excerpt:`Official HOKA New selected color card: ${name}; ${style}; ${usage}. Observed Chrome DOM, not a release date or HTTP/PDP read.`},
    officialProductEvidence:{...proof,url:identity.url},officialImageEvidence:{...proof,url:image,sourceUrl:capture.url},
    sourceTileBinding:{...proof,url:identity.url,image,sourceUrl:capture.url,tilePid:pid,selectedStyle:style,method:'chrome-dom-own-selected-color-tile',tileHash:digest(html.slice(card.start,card.end))}});
  }catch(e){missing.push({productId:pid,style,url:identity?.url,name,reason:e.message});}
 }
 const nextUrls=[];
 for(const n of nodes.filter(n=>['button','a'].includes(n.tag)&&n.a['data-url'])){
  try{const u=new URL(n.a['data-url'],capture.url),next=location(u.href);if(!next.root&&next.start>where.start)nextUrls.push(u.href);}catch{/* unrelated page controls */}
 }
 const unknownTiles=scope?nodes.filter(n=>cls(n,'tile-row')&&within(n,scope)&&visible(n)&&n.closed&&!cards.some(c=>within(c,n))):[];
 for(const n of unknownTiles){
  const explicit=n.a['data-is-merch-tile']==='true'||n.a['data-is-content-tile']==='true';
  if(explicit){const key='editorial:'+digest(html.slice(n.start,n.end));placements.push({key,kind:'editorial'});excluded.push({key,reason:'explicit-source-editorial-placement'});}
  else missing.push({reason:'unclassified-grid-placement'});
 }
 const truncated=html.includes('[Truncated]')||where.root&&!main.closed||cards.some(c=>!c.closed);
 if(truncated)errors.push({url:capture.url,error:'Browser DOM snapshot truncated; visible counters/analytics are not complete cards'});
 if(missing.length)errors.push({url:capture.url,error:`${missing.length} unresolved product/grid placements`});
 return {url:capture.url,parentUrl:capture.parentUrl,checkedAt:at,transport:capture.transport,provenance,contentHash,root:where.root,start:where.start,total:where.root?counts[0]:null,
  products,excluded,missing,placements,cardCount:cards.filter(c=>c.closed).length,nextUrls:[...new Set(nextUrls)],truncated,errors};
}

/** Browser-only replay. Partial rows are retained; duplicate variants and unknown
 * editorial/count gaps prevent completion rather than being padded to the total. */
function collectedPages(pages,extraErrors=[]){
 const roots=pages.filter(p=>p.root);
 if(roots.length!==1)throw Error('Exactly one HOKA root snapshot required; do not merge changing root reads');
 const root=roots[0],errors=[...pages.flatMap(p=>p.errors),...extraErrors],seenUrls=new Set(),seen=new Map(),duplicates=[],products=new Map(),excluded=[],missing=pages.flatMap(p=>p.missing);
 for(const p of pages){
  const key=urlKey(p.url);if(seenUrls.has(key))errors.push({url:p.url,error:'Repeated browser source capture'});seenUrls.add(key);
  if(!p.root&&!pages.some(parent=>parent.nextUrls.some(url=>urlKey(url)===key)))errors.push({url:p.url,error:'Fragment link absent from captured parent DOM; declared parent alone does not prove pagination completeness'});
  for(const item of p.placements){if(seen.has(item.key))duplicates.push({style:item.style,url:item.url,firstSource:seen.get(item.key),sourceUrl:p.url});else seen.set(item.key,p.url);}
  for(const row of p.products)if(!products.has(row.style))products.set(row.style,row);
  excluded.push(...p.excluded);
 }
 if(duplicates.length)errors.push({error:`${duplicates.length} repeated source placements/selected variants; total cannot be reconciled by summing pages`});
 if(seen.size!==root.total)errors.push({error:`HOKA New count mismatch: ${seen.size} unique observed placements / ${root.total} visible source total`});
 const pendingUrls=[...new Set(pages.flatMap(p=>p.nextUrls))].filter(url=>!seenUrls.has(urlKey(url)));
 let end=0;for(const page of [...pages].sort((a,b)=>a.start-b.start)){
  if(page.start!==end)errors.push({url:page.url,error:`Noncontiguous observed placement range: expected start ${end}, received ${page.start}`});
  end=page.start+page.placements.length;
 }
 if(pendingUrls.length)errors.push({error:'Observed Load More browser DOM capture still pending'});
 const exhaustive=!errors.length&&!missing.length&&!pendingUrls.length&&seen.size===root.total;
 return {schemaVersion:1,brand:'HOKA',checkedAt:root.checkedAt,transport:root.transport,products:[...products.values()],excluded,missing,duplicates,errors,pendingUrls,status:exhaustive?'completed':'partial',exhaustive,
  coverage:{total:exhaustive?root.total:null,reportedTotal:root.total,read:seen.size,pages:pages.length,exhaustive,exhausted:exhaustive,scope:'selected-color placements in captured official New DOM; no all-color inventory claim'},
  sourceCaptures:pages.map(({products,excluded,missing,placements,...receipt})=>receipt)};
}

/** An ordinary official HTTP response is a different contract from a CUA DOM
 * receipt. Preserve all upstream statuses/URLs; never manufacture browser type. */
export function hokaHttpNewPage(record,requestedUrl,{now=new Date(),maxAgeMs=86400000}={}){
 location(requestedUrl);
 if(!record||typeof record!=='object'||record.success===false||record.error||record.transport===HOKA_BROWSER_TRANSPORT)throw Error('HOKA original HTTP response required');
 const data=record.data??record,meta=data.metadata||{};
 if(data.transport!==undefined&&data.transport!==HOKA_HTTP_TRANSPORT||meta.error)throw Error('HOKA HTTP response transport/error mismatch');
 const statuses=[record.status,record.statusCode,data.status,data.statusCode,meta.statusCode].filter(x=>x!==undefined);
 if(!statuses.length||statuses.some(x=>x!==200))throw Error('HOKA HTTP '+(statuses.find(x=>x!==200)??'status missing'));
 const urls=[record.url,record.requestedUrl,record.sourceURL,data.url,data.requestedUrl,data.sourceURL,meta.url,meta.sourceURL].filter(x=>x!==undefined);
 if(!urls.length||urls.some(x=>urlKey(x)!==urlKey(requestedUrl)))throw Error('HOKA HTTP source URL missing/redirect mismatch');
 const html=data.body??data.rawHtml??data.html;
 if(typeof html!=='string'||!html.trim()||Buffer.byteLength(html)>16*1024*1024)throw Error('HOKA original HTTP HTML missing');
 if(/<title[^>]*>[^<]*(?:access denied|device check|just a moment|blocked)|captcha-delivery\.com|verify (?:that )?you are human/i.test(html))throw Error('HOKA official HTTP access challenge');
 const checkedAt=meta.cacheState==='hit'?meta.cachedAt:data.checkedAt??data.observedAt??now.toISOString();
 if(meta.cacheState==='hit'&&!checkedAt)throw Error('HOKA cached HTTP observation timestamp missing');
 return parseCapturedNewDom({brand:'HOKA',transport:HOKA_HTTP_TRANSPORT,url:requestedUrl,checkedAt,html,
  ...(requestedUrl!==HOKA_NEW?{parentUrl:HOKA_NEW}:{})},{now,maxAgeMs});
}

export async function readHokaNewHttp(url){
 location(url);
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(22000),headers:{Accept:'text/html'}});
 return {url:response.url,status:response.status,body:await response.text(),transport:HOKA_HTTP_TRANSPORT};
}

async function collectHokaHttpNew({read=readHokaNewHttp,now=new Date(),maxAgeMs=86400000,maxPages=10}={}){
 if(typeof read!=='function'||!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw Error('Invalid HOKA HTTP collection options');
 const pages=[],queue=[HOKA_NEW],seen=new Set(),errors=[];
 while(queue.length){
  const url=queue.shift();
  if(seen.has(urlKey(url)))continue;
  if(pages.length>=maxPages){errors.push({url,error:'HOKA page limit reached; observed continuation pending'});break;}
  seen.add(urlKey(url));
  try{const page=hokaHttpNewPage(await read(url),url,{now,maxAgeMs});pages.push(page);for(const next of page.nextUrls)if(!seen.has(urlKey(next)))queue.push(next);}
  catch(error){errors.push({url,error:error.message});break;}
 }
 if(pages.length)return collectedPages(pages,errors);
 return {schemaVersion:1,brand:'HOKA',checkedAt:now.toISOString(),transport:HOKA_HTTP_TRANSPORT,status:'failed',products:[],excluded:[],missing:[],duplicates:[],errors,pendingUrls:[HOKA_NEW],exhaustive:false,
  coverage:{total:null,reportedTotal:null,read:0,pages:0,exhaustive:false,exhausted:false,status:'failed'},sourceCaptures:[]};
}

/** Await either path. Explicit captures are browser-only and never trigger
 * network fallback. Without captures, try the ordinary official HTTP reader. */
export function collectHokaNew({captures,now=new Date(),maxAgeMs=86400000,...httpOptions}={}){
 if(captures===undefined)return collectHokaHttpNew({...httpOptions,now,maxAgeMs});
 if(!Array.isArray(captures)||!captures.length||captures.length>100)throw Error('HOKA browser captures required');
 return collectedPages(captures.map(c=>hokaBrowserNewPage(c,{now,maxAgeMs})));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),files=[];let output=path.join(ROOT,'reports/admin-recheck-followup-20261105/manual-hoka-products.json');
 for(let i=0;i<args.length;i++){if(args[i]==='--capture'&&args[i+1])files.push(path.resolve(args[++i]));else if(args[i]==='--output'&&args[i+1])output=path.resolve(args[++i]);else throw Error('Unknown HOKA collector argument: '+args[i]);}
 if(!files.length)files.push(...['manual-hoka-browser-dom.json','manual-hoka-next-browser-dom.json'].map(n=>path.join(ROOT,'reports/admin-recheck-followup-20261105',n)));
 const captures=await Promise.all(files.map(async file=>JSON.parse(await fs.readFile(file,'utf8'))));
 const result=collectHokaNew({captures});await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({output,products:result.products.length,excluded:result.excluded.length,missing:result.missing.length,coverage:result.coverage,errors:result.errors}));
}
