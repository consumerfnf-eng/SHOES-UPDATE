import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {canonicalUrl,isOfficialProductUrl,officialEvidenceFor,curateProduct,kstDay} from './curation.mjs';
import {decodeText} from './source-feeds.mjs';

export const CUCINELLI_BRAND='Brunello Cucinelli';
const origin='https://shop.brunellocucinelli.com';
export const CUCINELLI_SOURCES=['men','women'].map(gender=>`${origin}/en-ae/${gender}/shoes/sneakers/`);
const hash=text=>createHash('sha256').update(text).digest('hex');
const textOf=html=>decodeText(html.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
function attrs(tag){
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),decodeText(m[2]??m[3])]));
}
function categoryUrl(raw){
  const u=new URL(raw);
  if(u.origin!==origin||u.username||u.password||!/^\/en-ae\/(?:men|women)\/shoes\/sneakers\/$/.test(u.pathname)||[...u.searchParams.keys()].some(k=>!['start','sz'].includes(k)))throw Error('CUCINELLI_SOURCE_OUTSIDE_SNEAKER_SCOPE');
  for(const key of ['start','sz'])if(u.searchParams.has(key)&&!/^\d+$/.test(u.searchParams.get(key)))throw Error('CUCINELLI_INVALID_PAGINATION');
  return u;
}
function skuUrl(raw,source){
  try{
    const u=new URL(raw,source);
    const root=categoryUrl(source);
    const sku=u.pathname.match(/-([a-z0-9]{10,})\.html$/i)?.[1]?.toUpperCase();
    return sku&&u.origin===origin&&!u.username&&!u.password&&u.pathname.startsWith(root.pathname)&&!u.search?{url:u.href,sku}:null;
  }catch{return null;}
}
function ownImage(raw,sku){
  try{
    const u=new URL(raw),file=u.pathname.split('/').at(-1),match=file.match(/^([a-z0-9]+)_([a-z0-9]+)\.(?:jpe?g|png|webp)$/i);
    return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname==='media.brunellocucinelli.com'&&match?.[1].toUpperCase()===sku?{url:u.href,slot:match[2].toUpperCase()}:null;
  }catch{return null;}
}
function categoryEvidence(html,source){
  const root=categoryUrl(source),expectedId=root.pathname.includes('/women/')?'woman-shoes-sneakers':'man-shoes-sneakers';
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(attrs(match[1]).id!=='mobify-data')continue;
    const state=JSON.parse(match[2]);
    const queries=state.__PRELOADED_STATE__?.__reactQuery?.queries||[];
    const matches=queries.filter(q=>q.queryKey?.[0]==='urlMapping'&&q.queryKey[1]===root.pathname);
    if(matches.length!==1)throw Error('CUCINELLI_CATEGORY_MAPPING_MISSING_OR_AMBIGUOUS');
    const data=matches[0].state?.data;
    if(data?.pageIdData?.resourceType!=='category'||data.pageIdData.urlSegment!==root.pathname||data.pageIdData.resourceId!==expectedId||data.categoryData?.id!==expectedId||data.categoryData.name!=='Sneakers')throw Error('CUCINELLI_CATEGORY_MAPPING_MISMATCH');
    return {kind:'official-mobify-category-mapping',id:expectedId,name:'Sneakers',url:root.origin+root.pathname};
  }
  throw Error('CUCINELLI_CATEGORY_MAPPING_MISSING');
}

/** Read only the source's rendered grid and official category mapping. Never
 * execute scripts, invent unobserved colour URLs, or use a model-only filename.
 * Every image must occur inside its own SKU's grid anchor AND name that full SKU.
 */
export function parseCucinelliListing(html,{url,checkedAt=new Date().toISOString()}={}){
  const root=categoryUrl(url),contentHash=hash(html),category=categoryEvidence(html,url);
  const body=html.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi,'');
  const anchors=[...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m=>({attributes:attrs(m[1]),body:m[2]}));
  const titles=new Map();
  for(const anchor of anchors){
    const item=skuUrl(anchor.attributes.href,url),paragraph=anchor.body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if(item&&paragraph&&textOf(paragraph))titles.set(item.sku,textOf(paragraph));
  }
  const rows=new Map(),products=[],pending=[],errors=[],outcomes=[];
  for(const anchor of anchors){
    const tile=anchor.attributes['data-testid']?.match(/^product-tile-([a-z0-9]+)-link$/i);
    if(!tile)continue;
    const item=skuUrl(anchor.attributes.href,url);
    if(!item||item.sku!==tile[1].toUpperCase()){
      errors.push({url:anchor.attributes.href,error:'CUCINELLI_TILE_SKU_URL_MISMATCH'});continue;
    }
    const previous=rows.get(item.sku);
    if(previous&&canonicalUrl(previous.url)!==canonicalUrl(item.url))errors.push({url:item.url,error:'CUCINELLI_AMBIGUOUS_SKU_URL'});
    else if(!previous)rows.set(item.sku,{...item,anchor});
  }
  for(const {sku,url:productUrl,anchor} of rows.values()){
    const label=(anchor.attributes['aria-label']||'').split(' - ');
    const labeled=label.length>=4&&label.at(-1)==='Brunello Cucinelli'&&['Man','Woman'].includes(label.at(-2));
    const name=titles.get(sku)||(labeled?label.slice(0,-3).join(' - '):'');
    const colorway=labeled?label.at(-3):'';
    const images=[...anchor.body.matchAll(/<img\b([^>]*)>/gi)].flatMap(m=>{
      const a=attrs(m[1]),bound=ownImage(a.src,sku);
      return bound?[{...bound,alt:a.alt||''}]:[];
    });
    const unique=[...new Map(images.map(i=>[i.url,i])).values()];
    unique.sort((a,b)=>Number(b.slot==='F')-Number(a.slot==='F')||Number(b.slot==='D')-Number(a.slot==='D'));
    const chosen=unique[0];
    if(!name||!chosen){
      const error=!name?'CUCINELLI_TILE_TITLE_UNVERIFIED':'CUCINELLI_FULL_COLOUR_SKU_IMAGE_UNVERIFIED';
      pending.push({brand:CUCINELLI_BRAND,candidate:{brand:CUCINELLI_BRAND,url:productUrl,style:sku,name},reason:error});
      outcomes.push({url:productUrl,style:sku,outcome:'unverified',reason:error});continue;
    }
    const base={verified:true,brand:CUCINELLI_BRAND,style:sku,identifierType:'official-product-id',verifiedAt:checkedAt,verificationMethod:'official-new-listing-sku-image',contentHash};
    const p={id:'cucinelli-'+sku.toLowerCase(),brand:CUCINELLI_BRAND,name,style:sku,styleType:'official-product-id',url:productUrl,image:chosen.url,
      description:chosen.alt,colorway,colors:[],gender:root.pathname.includes('/women/')?'Women':'Men',country:'AE',officialCategory:'Sneakers',
      firstSeen:checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:url,sourceSignals:[],imageCandidates:unique,
      arrivalEvidence:{verified:true,brand:CUCINELLI_BRAND,style:sku,productUrl,kind:'official-assortment-listing',url,verifiedAt:checkedAt,contentHash,excerpt:'Official sneaker category tile: '+name+' '+colorway},
      officialProductEvidence:{...base,url:productUrl},officialImageEvidence:{...base,url:chosen.url,sourceUrl:url},
      sourceSkuBinding:{verified:true,brand:CUCINELLI_BRAND,url:productUrl,image:chosen.url,style:sku,sourceUrl:url,contentHash,method:'official-own-tile-full-colour-sku'}};
    const official=officialEvidenceFor(p,kstDay(checkedAt)),curated=curateProduct(p,kstDay(checkedAt));
    if(!official||!curated.product){
      const reason=!official?'CUCINELLI_OFFICIAL_PROOF_INVALID':curated.reason;
      pending.push({brand:CUCINELLI_BRAND,candidate:{brand:CUCINELLI_BRAND,url:productUrl,style:sku,name},reason});
      outcomes.push({url:productUrl,style:sku,outcome:'unverified',reason});continue;
    }
    products.push(p);outcomes.push({url:productUrl,style:sku,outcome:'complete',contentHash});
  }
  // A localized translation string elsewhere in mobify-data is not a counter.
  const paginationAt=body.search(/\bid=["']pagination["']/i);
  const pagination=paginationAt<0?'':body.slice(paginationAt).split(/<\/div>/i)[0];
  const ranges=[...pagination.matchAll(/<p\b[^>]*>\s*(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)\s+products\s*<\/p>/gi)].map(m=>({first:Number(m[1]),last:Number(m[2]),total:Number(m[3])}));
  const followups=[];
  for(const match of pagination.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    if(!/^VIEW\s+\d+\s+MORE$/i.test(textOf(match[2])))continue;
    const next=new URL(attrs(match[1]).href,url);categoryUrl(next.href);
    if(next.pathname!==root.pathname||!next.searchParams.has('start')||!next.searchParams.has('sz'))throw Error('CUCINELLI_PAGINATION_SCOPE_MISMATCH');
    followups.push(next.href);
  }
  return {products,pending,outcomes,errors,followups:[...new Set(followups)],receipt:{url,checkedAt,contentHash,categoryEvidence:category,
    gridSkus:[...rows.keys()],extractedCandidateUrlCount:rows.size,verified:products.length,ranges,declaredTotalCounts:[...new Set(ranges.map(r=>r.total))],followupUrls:[...new Set(followups)]}};
}

function capturePage(value,url,now){
  if(typeof value==='string')return {html:value,checkedAt:now.toISOString()};
  const status=value.status??value.metadata?.statusCode;
  const final=value.url??value.metadata?.url;
  if(!Number.isInteger(status)||status<200||status>=300||value.metadata?.error)throw Error('CUCINELLI_SOURCE_HTTP_OR_RENDER_ERROR');
  if(!final||canonicalUrl(final)!==canonicalUrl(url))throw Error('CUCINELLI_SOURCE_REDIRECT_OR_QUERY_MISMATCH');
  const html=value.rawHtml||value.html;
  if(typeof html!=='string'||!html.length)throw Error('CUCINELLI_SOURCE_HTML_MISSING');
  return {html,checkedAt:value.checkedAt||now.toISOString()};
}

export async function collectCucinelliOfficial({read,sources=CUCINELLI_SOURCES,now=new Date(),maxPagesPerSource=8,onProgress}={}){
  if(typeof read!=='function')throw Error('Cucinelli read(url) is required');
  if(!Number.isInteger(maxPagesPerSource)||maxPagesPerSource<0)throw Error('Invalid Cucinelli page budget');
  const checkedAt=new Date(now).toISOString(),products=new Map(),pages=[],states=[];
  const snapshot=()=>{
    const pending=[...new Map(states.flatMap(s=>[...s.pending.values()]).map(e=>[e.candidate.url,e])).values()];
    const listingPending=states.flatMap(s=>[...s.queue,...s.failed].map(url=>({brand:CUCINELLI_BRAND,source:{url,shelfUrl:s.url}})));
    const outcomes=[...new Map(states.flatMap(s=>[...s.outcomes.values()]).map(o=>[o.url,o])).values()];
    const summaries=states.map(s=>{
      const totals=[...new Set(s.pages.flatMap(p=>p.declaredTotalCounts))];
      const declaredTotal=totals.length===1?totals[0]:null;
      const terminal=s.pages.some(p=>p.ranges.some(r=>r.first===1&&r.last===r.total&&r.total>0));
      const missing=s.pages.flatMap(p=>p.followupUrls).filter(url=>!s.pages.some(p=>canonicalUrl(p.url)===canonicalUrl(url)));
      const reasons=[];
      if(!s.pages.length)reasons.push('no-listing-receipt');
      if(!Number.isSafeInteger(declaredTotal)||declaredTotal<=0||s.observed.size!==declaredTotal)reasons.push('declared-total-missing-mixed-zero-or-mismatch');
      if(!terminal)reasons.push('terminal-source-counter-unproven');
      if(s.queue.length||s.failed.length||missing.length)reasons.push('listing-pending-or-missing-receipt');
      if(s.pending.size||[...s.outcomes.values()].some(o=>o.outcome!=='complete')||s.observed.size!==s.outcomes.size)reasons.push('candidate-proof-pending');
      if(s.errors.length)reasons.push('source-or-product-errors');
      return {url:s.url,declaredTotal,uniqueObserved:s.observed.size,verified:[...s.outcomes.values()].filter(o=>o.outcome==='complete').length,
        pages:s.pages.length,complete:reasons.length===0,method:reasons.length?null:'source-declared-colour-sku-enumeration',terminalCounter:terminal,reasons,errors:s.errors};
    });
    const complete=states.length===sources.length&&sources.length>0&&summaries.every(s=>s.complete);
    return {brand:CUCINELLI_BRAND,checkedAt,products:[...products.values()],pending,listingPending,candidateOutcomes:outcomes,listingReceipts:pages,
      coverage:[{brand:CUCINELLI_BRAND,checkedAt,status:complete?'complete':'partial',exhaustive:complete,responses:pages.length,listingPages:pages.length,verified:products.size,errors:states.flatMap(s=>s.errors),sources:summaries,
        completionProof:{complete,scope:'configured-official-UAE-sneaker-colour-variants',method:complete?'source-declared-colour-sku-enumeration':null,sources:summaries}}]};
  };
  for(const source of sources){categoryUrl(source);states.push({url:source,queue:[source],failed:[],pages:[],observed:new Set(),pending:new Map(),outcomes:new Map(),errors:[]});}
  for(const state of states){
    const seen=new Set();
    while(state.queue.length&&seen.size<maxPagesPerSource){
      const url=state.queue.shift(),key=canonicalUrl(url);if(seen.has(key))continue;seen.add(key);
      try{
        const capture=capturePage(await read(url),url,new Date(now));
        const result=parseCucinelliListing(capture.html,{url,checkedAt:capture.checkedAt});
        const fresh=result.receipt.gridSkus.filter(sku=>!state.observed.has(sku));
        state.pages.push(result.receipt);pages.push(result.receipt);state.errors.push(...result.errors);
        for(const sku of result.receipt.gridSkus)state.observed.add(sku);
        for(const p of result.products){products.set(canonicalUrl(p.url),p);state.pending.delete(p.url);}
        for(const p of result.pending)if(!products.has(canonicalUrl(p.candidate.url)))state.pending.set(p.candidate.url,p);
        for(const o of result.outcomes)if(o.outcome==='complete'||state.outcomes.get(o.url)?.outcome!=='complete')state.outcomes.set(o.url,o);
        const terminal=result.receipt.ranges.some(r=>r.first===1&&r.last===r.total&&r.total>0);
        if(state.pages.length>1&&!fresh.length&&!terminal)state.errors.push({url,error:'CUCINELLI_REPEATED_GRID_EXHAUSTION_UNPROVEN'});
        else for(const next of result.followups)if(!seen.has(canonicalUrl(next))&&!state.queue.includes(next))state.queue.push(next);
      }catch(error){state.errors.push({url,error:error.message});state.failed.push(url);}
      await onProgress?.(structuredClone(snapshot()));
    }
  }
  const result=snapshot();await onProgress?.(structuredClone(result));return result;
}

export async function readCucinelliOfficial(url){
  categoryUrl(url);
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0'}});
  if(!response.ok)throw Error('CUCINELLI_HTTP_'+response.status);
  return {url:response.url,status:response.status,rawHtml:await response.text(),checkedAt:new Date().toISOString()};
}

async function main(){
  const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
  const output=path.resolve(option('--output','reports/admin-recheck-followup-20261105/manual-cucinelli-products.json'));
  const cacheDir=path.resolve(option('--cache-dir',path.join(path.dirname(output),'manual-cucinelli-sources'))),captures=new Map();
  for(const file of await fs.readdir(cacheDir).catch(()=>[])){
    if(!/\.json(?:\.gz)?$/.test(file))continue;
    const raw=await fs.readFile(path.join(cacheDir,file));
    const page=JSON.parse(file.endsWith('.gz')?gunzipSync(raw).toString('utf8'):raw.toString('utf8'));
    const url=page.url||page.metadata?.url;if(url)captures.set(canonicalUrl(url),page);
  }
  const save=async result=>{await fs.mkdir(path.dirname(output),{recursive:true});const temporary=output+'.tmp';await fs.writeFile(temporary,JSON.stringify(result,null,2));await fs.rename(temporary,output);};
  const result=await collectCucinelliOfficial({read:async url=>captures.get(canonicalUrl(url))??(args.includes('--allow-network')?readCucinelliOfficial(url):Promise.reject(Error('CUCINELLI_CAPTURE_MISSING: '+url))),
    maxPagesPerSource:Number(option('--max-pages','8')),onProgress:save});
  await save(result);
  console.log(JSON.stringify({output,products:result.products.length,pending:result.pending.length,listingPending:result.listingPending.length,exhaustive:result.coverage[0].exhaustive,sources:result.coverage[0].sources}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
