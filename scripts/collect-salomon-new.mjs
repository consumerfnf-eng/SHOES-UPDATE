import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {pacedOfficialFetch} from './official-reader.mjs';
import {decodeText} from './source-feeds.mjs';

export const SALOMON_NEW_URL='https://www.salomon.com/en-us/c/new/inspiration/new-arrivals';
export const SALOMON_NEW_FILTER='categoryPageId:"new > inspiration > new-arrivals"';
// This immutable client was observed in the official New page, not guessed.
const clientPath='/_next/static/immutable/chunks/40kktjibmen_n.js';
const sha=s=>createHash('sha256').update(s).digest('hex');
const clean=s=>decodeText(String(s||'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const sourceUrl=u=>{const p=new URL(u);if(p.href!==SALOMON_NEW_URL)throw Error('Exact official Salomon New source required');return p.href;};
const scripts=html=>[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(m=>({attrs:m[1],body:m[2]}));

/** Parse JSON only. Never evaluate page JavaScript or React flight strings. */
export function salomonNewBootstrap(html,url=SALOMON_NEW_URL) {
  sourceUrl(url);
  if(/<title[^>]*>\s*(?:Access Denied|Just a moment)|verify (?:that )?you are human|captcha challenge/i.test(html))throw Error('OFFICIAL_ACCESS_CHALLENGE');
  if(!/<h1\b[^>]*>\s*New Arrivals\s*<\/h1>/i.test(html)&&!/<meta[^>]*(?:property|name)="og:title"[^>]*content="New Arrivals \| Salomon"/i.test(html))throw Error('Official New heading missing');
  const blocks=scripts(html),prefix='window[Symbol.for("InstantSearchInitialResults")]';
  const matches=blocks.filter(s=>s.body.trimStart().startsWith(prefix));
  if(matches.length!==1)throw Error('New results missing or ambiguous');
  const raw=matches[0].body.slice(matches[0].body.indexOf('=')+1).trim().replace(/;$/,'');
  const initial=JSON.parse(raw),entries=Object.entries(initial).filter(([index,e])=>/^prod_v\d+_en-US_products$/.test(index)&&e.state?.filters===SALOMON_NEW_FILTER);
  if(entries.length!==1)throw Error('Results are not bound to the exact New category');
  const [indexName,entry]=entries[0],params=entry.requestParams?.[0],result=entry.results?.[0];
  if(entry.state.index!==indexName||params?.filters!==SALOMON_NEW_FILTER||params.distinct!==true||params.page!==0||result?.page!==0)throw Error('Unverified initial New query');
  const keys=[];
  const walk=o=>{if(!o||typeof o!=='object')return;if(o.indexName===indexName&&o.filters===SALOMON_NEW_FILTER&&typeof o.publicKey==='string'&&!o.publicKey.startsWith('$'))keys.push(o.publicKey);for(const v of Object.values(o))if(v&&typeof v==='object')walk(v);};
  for(const s of blocks.filter(s=>s.body.startsWith('self.__next_f.push('))) {
    const arg=JSON.parse(s.body.slice(s.body.indexOf('(')+1,s.body.lastIndexOf(')')));
    if(typeof arg[1]!=='string')continue;
    for(const line of arg[1].split('\n')){const i=line.indexOf(':');if(i<0)continue;try{walk(JSON.parse(line.slice(i+1)));}catch{/* Non-JSON flight module records. */}}
  }
  const client=[...html.matchAll(/<script[^>]+src=["']([^"']+)/g)].map(m=>decodeText(m[1])).find(u=>{try{const p=new URL(u,url);return p.origin==='https://www.salomon.com'&&p.pathname===clientPath;}catch{return false;}});
  return {indexName,params,result,searchKey:keys.length===1?keys[0]:null,clientUrl:client?new URL(client,url).href:null,contentHash:sha(html)};
}

export function salomonSearchContract(client,url) {
  const p=new URL(url);if(p.origin!=='https://www.salomon.com'||p.pathname!==clientPath)throw Error('Unobserved Salomon search client');
  const appId=client.match(/e\.s\(\["K",0,"([A-Z0-9]+)"/)?.[1];
  if(!appId||!client.includes('${e}-dsn.algolia.net')||!client.includes('path:"/1/indexes/*/queries"'))throw Error('Public search contract changed');
  return {appId,url:'https://'+appId.toLowerCase()+'-dsn.algolia.net/1/indexes/*/queries',scriptUrl:url,contentHash:sha(client)};
}

function resultOf(json) {return json?.results?.[0]||json;}
function validateResult(result,{indexName,page,hitsPerPage,total,nbPages}) {
  if(result?.index!==indexName||result.page!==page||result.hitsPerPage!==hitsPerPage||!Array.isArray(result.hits))throw Error('Search response page/index mismatch');
  if(!Number.isSafeInteger(result.nbHits)||result.nbHits<0||!Number.isSafeInteger(result.nbPages)||result.nbPages<0)throw Error('Invalid New source totals');
  if(result.nbHits!==total||result.nbPages!==nbPages||nbPages!==Math.ceil(total/hitsPerPage))throw Error('New totals changed or source result window is capped');
  if(result.hits.length!==Math.min(hitsPerPage,Math.max(0,total-page*hitsPerPage)))throw Error('Incomplete New response page');
}

function shoeDecision(hit) {
  const title=clean(hit.detailedTitle),name=clean(hit.modelName),type=String(hit.gtmProductCategory1||'');
  if(/\b(?:junior|kids?|children|youth|infant|toddler)\b/i.test(title+' '+name+' '+type))return {decision:'excluded',reason:'not-adult'};
  if(/snowclog|\b(?:clogs?|slides?|mules?|sandals?|slippers?|boots?)\b/i.test(name))return {decision:'excluded',reason:'non-sneaker-form'};
  if(!/^(?:Men|Women|Unisex)\s*·/.test(title))return {decision:'excluded',reason:'adult-footwear-type-not-established'};
  const explicitType=/\b(?:Sneakers|(?:Trail|Road|Gravel) running shoes)\b/i.test(title);
  if(type==='sportstyle_shoes-mid'&&explicitType)return {decision:'held',reason:'mid-form-needs-visual-review'};
  if(!/^(?:sportstyle|trail-running|road-running)_shoes-low$/.test(type)||!explicitType)return {decision:'excluded',reason:'not-source-typed-athletic-low-shoe'};
  return {decision:'eligible',reason:'official-adult-sneaker-or-low-running-shoe-type'};
}

/** A hit must itself be returned by the exact New query. A grouped swatch is
 * never sufficient: color records require distinct:false response evidence.
 * releaseDateTime is not used as membership or release-date proof. */
export function salomonNewRows(result,{indexName,request,at=new Date().toISOString(),membershipMode='primary-result'}={}) {
  const color=membershipMode==='individual-color-record';
  if(request?.indexName!==indexName||request.filters!==SALOMON_NEW_FILTER||request.distinct!==(color?false:true)||result.index!==indexName)throw Error('Exact New query provenance required');
  if(color){const p=new URLSearchParams(result.params);if(p.get('distinct')!=='false'||!p.getAll('filters').includes(SALOMON_NEW_FILTER))throw Error('Color response does not attest the unchanged New filter');}
  const products=[],excluded=[],held=[],contentHash=sha(JSON.stringify(result));
  for(const h of result.hits) {
    const style=String(h.objectID||''),name=clean(h.modelName),candidate={brand:'Salomon',style,name,url:h.url,sourceProductType:clean(h.detailedTitle),sourceCategory:h.gtmProductCategory1};
    const decision=shoeDecision(h);
    if(decision.decision!=='eligible'){(decision.decision==='held'?held:excluded).push({...candidate,reason:decision.reason});continue;}
    let productUrl,image;
    try {
      const p=new URL(h.url),i=new URL(h.image,h.imageBaseUrl);
      if(!/^L\d{8}$/.test(style)||p.origin!=='https://www.salomon.com'||!/^\/en-us\/product\/[^/]+\/L\d{8}$/.test(p.pathname)||decodeURIComponent(p.pathname.split('/').at(-1))!==style)throw Error('product');
      if(i.origin!=='https://cdn.dam.salomon.com'||!decodeURIComponent(i.pathname).split('/').includes(style)||i.username||i.password)throw Error('image');
      if(h.swatches?.[style]?.image&&new URL(h.swatches[style].image,h.imageBaseUrl).pathname!==i.pathname)throw Error('primary swatch image');
      productUrl=p.href;image=i.href;
    }catch{held.push({...candidate,reason:'unbound-primary-SKU-product-or-image'});continue;}
    const officialCategory=clean(h.detailedTitle),proof={verified:true,brand:'Salomon',style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash};
    products.push({id:'salomon-new-'+style,brand:'Salomon',name,style,manufacturerStyle:style,modelGroupId:'salomon|'+String(h.modelCode||style).replace(/\$$/,''),url:productUrl,image,sourceImageUrl:image,category:'sneaker',productType:'sneaker',officialCategory,sourceProductType:officialCategory,description:name+' · '+officialCategory,gender:officialCategory.split(' · ')[0],audience:'adult',country:'US',colorway:'',colors:[],priceLabel:Number.isFinite(h.price)?'USD '+h.price:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:SALOMON_NEW_URL,sourceSignals:[],arrivalEvidence:{...proof,kind:'new-arrivals-listing',url:SALOMON_NEW_URL,productUrl,excerpt:'New Arrivals · '+name+' · '+officialCategory,queryFilter:SALOMON_NEW_FILTER,resultIndex:indexName,resultPage:result.page,membershipUnit:color?'individual-color-record':'distinct-primary-result',queryDistinct:!color},officialProductEvidence:{...proof,url:productUrl},officialImageEvidence:{...proof,url:image,sourceUrl:SALOMON_NEW_URL},scopeEvidence:{...proof,url:productUrl,image,category:'sneaker',sourceCategory:h.gtmProductCategory1,excerpt:officialCategory}});
  }
  return {products,held,excluded};
}

/** Stable read-only interface. readSearch(requestBody, context) is an optional
 * public transport hook; no key/cookie is included in the returned evidence.
 * maxPages bounds actual requests. initialObservedAt should be supplied when
 * readHtml returns cached HTML instead of a fresh official response. */
export async function collectSalomonNew({readHtml,readScript,readSearch,now=new Date(),initialObservedAt,maxPages=12,onProgress=()=>{}}={}) {
  if(!Number.isInteger(maxPages)||maxPages<1)throw Error('Positive maxPages required');
  const paced=pacedOfficialFetch({intervalMs:1200,attempts:1});
  const get=async(u,options={})=>{const r=await paced(u,{redirect:'error',...options});if(!r.ok)throw Error('Public Salomon HTTP '+r.status);return r;};
  readHtml??=async u=>(await get(u)).text();readScript??=async u=>(await get(u)).text();
  const at=now.toISOString(),out={brand:'Salomon',adapter:'official-salomon-new-search-json',checkedAt:at,observedAt:at,products:[],held:[],excluded:[],coverage:[],sourceCoverage:[],evidence:[],contracts:[],errors:[]};
  let total=null,pagesExpected=null,pagesRead=0,read=0,unexpandedSwatches=0,scopedVerified=false;const ids=new Set();
  try {
    const html=await readHtml(SALOMON_NEW_URL),boot=salomonNewBootstrap(html);scopedVerified=true;total=boot.result.nbHits;pagesExpected=boot.result.nbPages;
    const size=boot.params.hitsPerPage;if(!Number.isInteger(size)||size<1)throw Error('Invalid source page size');
    let contract;
    if(!readSearch&&pagesExpected>1&&maxPages>1) {
      if(!boot.clientUrl||!boot.searchKey)throw Error('Observed public pagination client/key missing');
      contract=salomonSearchContract(await readScript(boot.clientUrl),boot.clientUrl);
      readSearch=async body=>(await get(contract.url,{method:'POST',headers:{'Content-Type':'application/json','X-Algolia-Application-Id':contract.appId,'X-Algolia-API-Key':boot.searchKey},body:JSON.stringify(body)})).json();
      out.contracts.push({...contract,method:'POST',indexName:boot.indexName,filter:SALOMON_NEW_FILTER});
    }
    out.contracts.push({sourceUrl:SALOMON_NEW_URL,sourceHtmlHash:boot.contentHash,indexName:boot.indexName,filter:SALOMON_NEW_FILTER,distinct:true,initialObservedAt:initialObservedAt||at});
    for(let page=0;page<Math.min(maxPages,pagesExpected||1);page++) {
      const request={indexName:boot.indexName,...boot.params,page},json=page===0?{results:[boot.result]}:await readSearch({requests:[request]},{sourceUrl:SALOMON_NEW_URL,indexName:boot.indexName,page});
      const result=resultOf(json);validateResult(result,{indexName:boot.indexName,page,hitsPerPage:size,total,nbPages:pagesExpected});
      const pageIds=new Set();for(const h of result.hits){if(!h.objectID||ids.has(h.objectID)||pageIds.has(h.objectID))throw Error('Repeated Salomon New primary SKU');pageIds.add(h.objectID);}
      for(const id of pageIds)ids.add(id);
      const observedAt=page===0?(initialObservedAt||at):at,rows=salomonNewRows(result,{indexName:boot.indexName,request,at:observedAt});
      out.products.push(...rows.products);out.held.push(...rows.held);out.excluded.push(...rows.excluded);
      out.evidence.push({sourceUrl:SALOMON_NEW_URL,transport:page===0?'official-html-initial-results':'official-public-search-json',...(contract?{apiUrl:contract.url}:{}),request,contentHash:sha(JSON.stringify(result)),observedAt,json:{results:[result]}});
      pagesRead++;read+=result.hits.length;unexpandedSwatches+=result.hits.reduce((n,h)=>n+Math.max(0,Object.keys(h.swatches||{}).length-1),0);
      await onProgress({brand:'Salomon',page:page+1,pagesExpected,read,total,verified:out.products.length});
    }
  }catch(e){out.errors.push({brand:'Salomon',error:e.message});}
  const paginationComplete=total!==null&&pagesRead===(pagesExpected||1)&&read===total&&!out.errors.length;
  out.coverage.push({brand:'Salomon',adapter:out.adapter,url:SALOMON_NEW_URL,scope:'official-new-distinct-primary-variants',scopedOfficialNew:scopedVerified,status:out.errors.length&&!pagesRead?'failed':'partial',pages:pagesRead,listingPages:pagesRead,pagesExpected,read,total:null,sourceTotal:total,sourcePaginationComplete:paginationComplete,primaryVariantsRead:ids.size,verified:out.products.length,held:out.held.length,excluded:out.excluded.length,unexpandedSwatches,allColorVariantsVerified:false,newFootwearEnumerationComplete:false,exhaustive:false,exhausted:false,errors:out.errors.map(e=>e.error),note:'Only source-returned primary SKUs are emitted. Other color swatches are not promoted to New; full color-variant completeness is not claimed.'});
  out.sourceCoverage.push({brand:'Salomon',url:SALOMON_NEW_URL,scope:'distinct-New-primary-search-results',total,read,pages:pagesRead,pagesExpected,exhausted:paginationComplete});
  return out;
}

/** Every original non-primary swatch is retained as a target, even when the
 * source model is not footwear. No URL is manufactured from a parent URL. */
export function salomonSwatchTargets(previous) {
  const primaryEvidence=(previous?.evidence||[]).filter(e=>e.request?.distinct===true&&e.request.filters===SALOMON_NEW_FILTER);
  if(!primaryEvidence.length)throw Error('Retained authoritative primary New evidence required');
  const hits=primaryEvidence.flatMap(e=>resultOf(e.json).hits),primary=new Set(hits.map(h=>h.objectID)),targets=new Map();let references=0;
  for(const h of hits)for(const [style,swatch] of Object.entries(h.swatches||{})) {
    if(style===h.objectID)continue;references++;
    let image=null;try{const u=new URL(swatch.image,h.imageBaseUrl);if(u.origin==='https://cdn.dam.salomon.com'&&decodeURIComponent(u.pathname).split('/').includes(style))image=u.href;}catch{}
    const parent={style:h.objectID,url:h.url,modelCode:h.modelCode,name:h.modelName,sourceProductType:h.detailedTitle};
    if(targets.has(style)){targets.get(style).parents.push(parent);continue;}
    targets.set(style,{brand:'Salomon',style,name:clean(h.modelName),parents:[parent],image,ownImageBound:!!image,ownStickers:swatch.stickers||[],alreadyPrimary:primary.has(style)});
  }
  return {targets:[...targets.values()],references,primaryResults:primary.size,primaryEvidence};
}

const responseHasNewColors=r=>{const p=new URLSearchParams(r?.params);return p.get('distinct')==='false'&&p.getAll('filters').includes(SALOMON_NEW_FILTER);};
const variantFingerprint=(r,index)=>sha(JSON.stringify([index,SALOMON_NEW_FILTER,r.nbHits,r.nbPages,r.hitsPerPage,r.hits.map(h=>[h.objectID,h.url,h.image,h.price,h.detailedTitle])]));

/** Exhaustive *query membership*, not propagation from a model's swatches.
 * Only distinct changes: false exposes individual color objects under the
 * same categoryPageId filter. Missing records remain unresolved, not New.
 * `previous` also resumes valid successful pages; failures remain in history.
 * No files are read/written by this function. */
export async function collectSalomonNewVariants({previous,readHtml,readScript,readSearch,now=new Date(),maxPages=40,resumeMaxAgeMs=3600000,onProgress=()=>{}}={}) {
  if(!Number.isInteger(maxPages)||maxPages<1||!Number.isFinite(resumeMaxAgeMs)||resumeMaxAgeMs<0)throw Error('Invalid variant request bound or resume age');
  const baseline=salomonSwatchTargets(previous),at=now.toISOString();
  const out={brand:'Salomon',adapter:'official-salomon-new-individual-color-json',checkedAt:at,observedAt:at,products:[],held:[],excluded:[],unresolved:[],swatchResolution:[],coverage:[],sourceCoverage:previous.sourceCoverage||[],evidence:baseline.primaryEvidence,variantEvidence:[],failedVariantEvidence:[],contracts:[...(previous.contracts||[])],errors:[],retainedErrors:[]};
  const knownPriorIds=new Set(baseline.primaryEvidence.flatMap(e=>resultOf(e.json).hits.map(h=>h.objectID)));
  for(const e of previous.variantEvidence||[])if(e.request?.filters===SALOMON_NEW_FILTER&&e.request.distinct===false&&responseHasNewColors(resultOf(e.json)))for(const h of resultOf(e.json).hits)knownPriorIds.add(h.objectID);
  const priorProducts=(previous.products||[]).filter(p=>knownPriorIds.has(p.style)&&p.brand==='Salomon'&&p.category==='sneaker'&&p.arrivalEvidence?.verified===true&&p.arrivalEvidence.url===SALOMON_NEW_URL&&p.arrivalEvidence.style===p.style&&p.arrivalEvidence.productUrl===p.url&&p.officialImageEvidence?.url===p.image);
  const productMap=new Map(priorProducts.map(p=>[p.style,p])),heldMap=new Map((previous.held||[]).map(p=>[p.style,p])),excludedMap=new Map((previous.excluded||[]).map(p=>[p.style,p]));
  const firstSeen=new Map(priorProducts.map(p=>[p.style,p.firstSeen]));
  const seen=new Map(),pageRecords=new Map();let total=null,pagesExpected=null,size=null,fingerprint=null,indexName=null,networkRequests=0,reusedPages=0,limitReached=false,scopedVerified=false;
  const read=pacedOfficialFetch({intervalMs:1200,attempts:1});
  const get=async(u,options={})=>{const r=await read(u,{redirect:'error',...options});if(!r.ok)throw Error('Public Salomon HTTP '+r.status);return r;};
  readHtml??=async u=>(await get(u)).text();readScript??=async u=>(await get(u)).text();
  const activeError=(stage,page,error)=>out.errors.push({brand:'Salomon',stage,...(page==null?{}:{page}),error:String(error.message||error),observedAt:at});
  const checkpoint=()=>({version:1,indexName,filter:SALOMON_NEW_FILTER,distinct:false,fingerprint,hitsPerPage:size,total,pagesExpected,completedPages:[...pageRecords.keys()].sort((a,b)=>a-b),failedPages:out.errors.filter(e=>e.stage==='variant-pagination').map(e=>e.page),pendingPages:pagesExpected==null?[]:Array.from({length:pagesExpected},(_,i)=>i).filter(p=>!pageRecords.has(p)),checkedAt:at});
  try {
    const html=await readHtml(SALOMON_NEW_URL),boot=salomonNewBootstrap(html);scopedVerified=true;indexName=boot.indexName;size=boot.params.hitsPerPage;
    if(!readSearch) {
      if(!boot.clientUrl||!boot.searchKey)throw Error('Observed public color-query client/key missing');
      const contract=salomonSearchContract(await readScript(boot.clientUrl),boot.clientUrl);
      readSearch=async body=>(await get(contract.url,{method:'POST',headers:{'Content-Type':'application/json','X-Algolia-Application-Id':contract.appId,'X-Algolia-API-Key':boot.searchKey},body:JSON.stringify(body)})).json();
      out.contracts.push({...contract,method:'POST',indexName,filter:SALOMON_NEW_FILTER,distinct:false});
    }
    // Refresh page zero even on resume: a changed cohort invalidates reuse.
    const makeRequest=page=>({indexName,...boot.params,distinct:false,page});
    const firstRequest=makeRequest(0);networkRequests++;
    const firstJson=await readSearch({requests:[firstRequest]},{sourceUrl:SALOMON_NEW_URL,indexName,page:0,stage:'variant-pagination'}),first=resultOf(firstJson);
    total=first.nbHits;pagesExpected=first.nbPages;fingerprint=variantFingerprint(first,indexName);
    const reusable=previous.variantCheckpoint?.fingerprint===fingerprint;
    const priorPages=new Map((previous.variantEvidence||[]).map(e=>[e.request?.page,e]));
    for(let page=0;page<pagesExpected;page++) {
      const request=makeRequest(page);let json,observedAt=at,fromCache=false;
      try {
        if(page===0)json=firstJson;
        else {
          const old=priorPages.get(page),age=old?new Date(now).getTime()-Date.parse(old.observedAt):Infinity;
          if(reusable&&old?.request?.filters===SALOMON_NEW_FILTER&&old.request.distinct===false&&old.request.indexName===indexName&&age>=0&&age<=resumeMaxAgeMs){json=old.json;observedAt=old.observedAt;fromCache=true;}
          else {if(networkRequests>=maxPages){limitReached=true;break;}networkRequests++;json=await readSearch({requests:[request]},{sourceUrl:SALOMON_NEW_URL,indexName,page,stage:'variant-pagination'});}
        }
        const result=resultOf(json);
        validateResult(result,{indexName,page,hitsPerPage:size,total,nbPages:pagesExpected});
        if(!responseHasNewColors(result))throw Error('Color response does not attest the unchanged New filter');
        if(result.exhaustiveNbHits!==true&&result.exhaustive?.nbHits!==true)throw Error('Color-source hit count is not exhaustive');
        const local=new Set();for(const h of result.hits){if(!h.objectID||seen.has(h.objectID)||local.has(h.objectID))throw Error('Repeated Salomon New color SKU');local.add(h.objectID);}
        const rows=salomonNewRows(result,{indexName,request,at:observedAt,membershipMode:'individual-color-record'});
        const entry={sourceUrl:SALOMON_NEW_URL,transport:'official-public-search-json',request,contentHash:sha(JSON.stringify(result)),observedAt,json:{results:[result]}};
        out.variantEvidence.push(entry);pageRecords.set(page,entry);if(fromCache)reusedPages++;
        for(const h of result.hits)seen.set(h.objectID,{hit:h,page,contentHash:entry.contentHash,observedAt});
        for(const p of rows.products){productMap.set(p.style,{...p,firstSeen:firstSeen.get(p.style)||p.firstSeen});heldMap.delete(p.style);excludedMap.delete(p.style);}
        for(const p of rows.excluded){excludedMap.set(p.style,p);productMap.delete(p.style);heldMap.delete(p.style);}
        for(const p of rows.held){heldMap.set(p.style,p);productMap.delete(p.style);excludedMap.delete(p.style);}
        out.products=[...productMap.values()];out.variantCheckpoint=checkpoint();
        await onProgress({brand:'Salomon',stage:'variant-pagination',page:page+1,pagesExpected,read:seen.size,total,verified:productMap.size,networkRequests,reusedPages,fromCache},out);
      }catch(e){activeError('variant-pagination',page,e);if(json)out.failedVariantEvidence.push({request,observedAt,json});if(/total|window is capped|index mismatch|New filter|not exhaustive/.test(e.message))break;}
    }
  }catch(e){activeError('variant-initialization',0,e);}
  const complete=pagesExpected!=null&&pageRecords.size===pagesExpected&&seen.size===total&&!out.errors.length;
  if(complete)for(const [style,p] of productMap)if(!seen.has(style)){productMap.delete(style);heldMap.set(style,{brand:'Salomon',style,name:p.name,url:p.url,reason:'previously-verified-primary-not-in-current-New-color-snapshot',previousArrivalEvidence:p.arrivalEvidence});}
  out.products=[...productMap.values()];out.held=[...heldMap.values()];out.excluded=[...excludedMap.values()];out.variantCheckpoint=checkpoint();
  // A failed page-zero refresh must not erase a resumable successful snapshot.
  // It is retained as evidence only, never counted as a fresh complete query.
  if(!fingerprint&&previous.variantEvidence?.length){out.variantEvidence=previous.variantEvidence;out.variantCheckpoint={...previous.variantCheckpoint,initializationFailedAt:at,retainedEvidenceOnly:true};}
  for(const target of baseline.targets) {
    const match=seen.get(target.style);
    if(match){const eligible=productMap.get(target.style),held=heldMap.get(target.style),excluded=excludedMap.get(target.style);out.swatchResolution.push({...target,membershipStatus:'verified-new-color-query-member',eligibilityStatus:eligible?'eligible':held?'held':'excluded',...(eligible?{url:eligible.url,image:eligible.image}:{}),reason:held?.reason||excluded?.reason||'own-SKU-and-image-returned-by-unchanged-New-filter',newEvidence:{kind:'new-arrivals-listing',url:SALOMON_NEW_URL,queryFilter:SALOMON_NEW_FILTER,distinct:false,indexName,objectID:target.style,page:match.page,contentHash:match.contentHash,observedAt:match.observedAt}});}
    else {const ownNew=target.ownStickers.some(s=>s.code==='new_arrival'||s.label==='New');const row={...target,membershipStatus:'unresolved',eligibilityStatus:'not-promoted',ownNewStickerPresent:ownNew,reason:!complete?'New-color-query-incomplete-retry-pending':ownNew?'own-New-sticker-present-but-public-visibility-unverified':'absent-from-complete-public-US-New-color-query-and-no-own-New-badge',checkedAgainstCompleteNewScope:complete};out.swatchResolution.push(row);out.unresolved.push(row);}
  }
  const historical=new Map();for(const e of [...(previous.retainedErrors||[]),...(previous.errors||[])]){const key=sha(JSON.stringify([e.stage,e.page,e.error])),resolved=e.status==='resolved'||complete||e.stage==='variant-pagination'&&pageRecords.has(e.page);historical.set(key,{...e,status:resolved?'resolved':'retained-unresolved',...(resolved?{resolvedAt:e.resolvedAt||at}:{})});}out.retainedErrors=[...historical.values()];
  const matched=out.swatchResolution.filter(s=>s.membershipStatus==='verified-new-color-query-member'),eligibleAdded=matched.filter(s=>s.eligibilityStatus==='eligible'&&!firstSeen.has(s.style)).length;
  out.swatchCoverage={references:baseline.references,targets:baseline.targets.length,checked:baseline.targets.length,verifiedNewMembers:matched.length,unresolved:out.unresolved.length,pendingDueToIncompleteQuery:complete?0:out.unresolved.length,eligibleProductsAdded:eligibleAdded,allTargetsCheckedAgainstCompleteNewScope:complete,ownBadgeOnlyPromotions:0};
  out.coverage.push({brand:'Salomon',adapter:out.adapter,url:SALOMON_NEW_URL,scope:'official-New-individual-color-records-public-US',scopedOfficialNew:scopedVerified,status:'partial',pages:pageRecords.size,listingPages:pageRecords.size,pagesExpected,read:seen.size,total:null,sourceTotal:total,sourcePaginationComplete:complete,networkRequests,reusedPages,paginationLimitReached:limitReached,primaryBaselineResults:baseline.primaryResults,swatchTargets:baseline.targets.length,swatchNewMembers:matched.length,unresolvedSwatches:out.unresolved.length,verified:out.products.length,held:out.held.length,excluded:out.excluded.length,carriedProducts:out.products.filter(p=>!seen.has(p.style)).length,allColorVariantsVerified:false,newFootwearEnumerationComplete:false,exhaustive:false,exhausted:false,errors:out.errors.map(e=>e.error),note:'Every emitted new color is independently returned by the unchanged official New filter. Absent colors and any unverified badge visibility remain unresolved; no model-to-color New inheritance.'});
  out.sourceCoverage=[...(previous.sourceCoverage||[]).filter(c=>c.scope!=='individual-New-color-search-results'),{brand:'Salomon',url:SALOMON_NEW_URL,scope:'individual-New-color-search-results',total,read:seen.size,pages:pageRecords.size,pagesExpected,exhausted:complete}];
  return out;
}

// No writes on import or CLI execution. The caller owns any report destination.
if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await collectSalomonNew(),null,2));
