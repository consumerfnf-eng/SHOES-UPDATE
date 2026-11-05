import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {canonicalUrl,officialEvidenceFor,curateProduct,kstDay} from './curation.mjs';
import {decodeText,readPublicSource} from './source-feeds.mjs';

export const JACQUEMUS_SOURCES=['men','women'].map(g=>`https://www.jacquemus.com/en_us/sneakers-shoes-${g}`);
const brand='Jacquemus',origin='https://www.jacquemus.com';
const digest=text=>createHash('sha256').update(text).digest('hex');
const text=html=>decodeText(html.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const attributes=raw=>Object.fromEntries([...raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),decodeText(m[2]??m[3])]));
// Quoted attribute values contain serialized breadcrumb HTML with literal >.
const quotedAttributes=String.raw`((?:"[^"]*"|'[^']*'|[^'">])*)`;
function sourceUrl(raw){
  const u=new URL(raw);
  if(u.origin!==origin||u.username||u.password||!/^\/en_us\/sneakers-shoes-(?:men|women)$/.test(u.pathname)||[...u.searchParams.keys()].some(k=>!['start','sz'].includes(k)))throw Error('JACQUEMUS_SOURCE_SCOPE');
  for(const key of ['start','sz'])if(u.searchParams.has(key)&&!/^\d+$/.test(u.searchParams.get(key)))throw Error('JACQUEMUS_INVALID_PAGING');
  return u;
}
function productUrl(raw,sku){
  try{
    const u=new URL(raw,origin);
    return u.origin===origin&&!u.username&&!u.password&&!u.search&&u.pathname.startsWith('/en_us/')&&u.pathname.split('/').at(-1)===sku+'.html'?u.href:null;
  }catch{return null;}
}
function imageBinding(raw,sku){
  try{
    const u=new URL(raw),file=u.pathname.split('/').at(-1);
    const match=file.match(new RegExp('^(?:[0-9]{2}[A-Z])?'+sku+'_(\\d+)\\.(?:jpe?g|png|webp)$','i'));
    return u.origin===origin&&!u.username&&!u.password&&u.pathname.startsWith('/dw/image/v2/')&&u.pathname.includes('/Sites-master-jacquemus/')&&match?{url:u.href,slot:Number(match[1])}:null;
  }catch{return null;}
}

/** Explicit SFCC grid membership, own GA4 product model and own JSON-LD offer
 * agree on the full colour SKU and destination. Sibling images are accepted only
 * inside that same product-tile and only with an exact full-SKU filename.
 */
export function parseJacquemusListing(html,{url,checkedAt=new Date().toISOString()}={}){
  const source=sourceUrl(url),root=source.origin+source.pathname,contentHash=digest(html),errors=[],pending=[],products=[],outcomes=[],gridItems=[];
  const start=Number(source.searchParams.get('start')||0);
  const documents=[];
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(attributes(m[1]).type==='application/ld+json')documents.push(JSON.parse(m[2]));
  const breadcrumbs=documents.filter(d=>d['@type']==='BreadcrumbList').flatMap(d=>d.itemListElement||[]);
  if(!breadcrumbs.some(b=>b.name==='Sneakers'&&new URL(b.item,origin).href===root))throw Error('JACQUEMUS_SNEAKER_BREADCRUMB_UNVERIFIED');
  const entries=documents.filter(d=>d['@type']==='ItemList').flatMap(d=>d.itemListElement||[]).map(e=>e.item);
  const schema=new Map();
  for(const item of entries){
    const sku=item?.offers?.sku;
    if(!sku||schema.has(sku))throw Error('JACQUEMUS_JSONLD_SKU_MISSING_OR_DUPLICATE');
    schema.set(sku,item);
  }
  const tiles=[...html.matchAll(new RegExp('<product-tile\\b'+quotedAttributes+'>([\\s\\S]*?)<\\/product-tile>','gi'))];
  const grid=new Map();
  for(const [tileIndex,tile] of tiles.entries()){
    const outer=attributes(tile[1]),sku=outer['data-pid'];
    if(!/^FO[MWU][A-Z0-9]{10,}$/.test(sku||'')){errors.push({error:'JACQUEMUS_GRID_SKU_INVALID',sku});continue;}
    if(outer['data-is-merch-tile']==='true'&&outer['data-template']==='double'){
      const link=tile[2].match(/<a\b([^>]*)>/i),merchUrl=link&&productUrl(attributes(link[1]).href,sku);
      if(!merchUrl||new URL(outer['data-url-back-browser'],origin).pathname!==source.pathname){errors.push({sku,error:'JACQUEMUS_EDITORIAL_BINDING_INVALID'});continue;}
      const key='merch:'+root+':'+(start+tileIndex);
      const evidence={url,contentHash,tileHash:digest(tile[0]),marker:'data-is-merch-tile=true',template:'double'};
      gridItems.push({key,kind:'editorial-merch-placement',sku,url:merchUrl});
      outcomes.push({key,url:merchUrl,style:sku,outcome:'explicitlyexcluded',reason:'source-declared-editorial-merch-placement',evidence});
      continue;
    }
    if(grid.has(sku)){errors.push({error:'JACQUEMUS_REPEATED_TILE',sku});continue;}
    grid.set(sku,tile);
    gridItems.push({key:sku,kind:'product',sku});
    let pUrl;
    try{
      const inputs=[...tile[2].matchAll(new RegExp('<input\\b'+quotedAttributes+'>','gi'))].map(m=>attributes(m[1]));
      const models=inputs.filter(a=>a['data-gtmga4data']).map(a=>JSON.parse(a['data-gtmga4data']));
      if(models.length!==1)throw Error('JACQUEMUS_OWN_PRODUCT_MODEL_AMBIGUOUS');
      const model=models[0],item=schema.get(sku),back=outer['data-url-back-browser'];
      pUrl=productUrl(model.block_destination,sku);
      // GA4 category_1/2 is a marketing taxonomy (sometimes "New In" or
      // "Accessories"). Shelf membership is proved by the own tile's backlink
      // and the source's exact Sneakers breadcrumb, not that marketing label.
      if(model.id!==sku||!pUrl||text(String(model.brand)).toLowerCase()!==brand.toLowerCase()||new URL(back,origin).pathname!==source.pathname)throw Error('JACQUEMUS_TILE_MODEL_BINDING_INVALID');
      if(!item||item['@type']!=='Product'||item.brand?.name?.toLowerCase()!==brand.toLowerCase()||productUrl(item.url,sku)!==pUrl||productUrl(item.offers?.url,sku)!==pUrl||item.offers.sku!==sku||item.name!==model.name)throw Error('JACQUEMUS_JSONLD_TILE_IDENTITY_MISMATCH');
      const images=[...tile[2].matchAll(new RegExp('<img\\b'+quotedAttributes+'>','gi'))].flatMap(m=>{
        const a=attributes(m[1]);
        if(!a.class?.split(/\s+/).includes('product__visuals__content'))return [];
        const bound=imageBinding(a.src||a['data-src'],sku);return bound?[{...bound,alt:a.alt||''}]:[];
      });
      const own=[...new Map(images.map(i=>[i.url,i])).values()].sort((a,b)=>a.slot-b.slot);
      if(!own.length)throw Error('JACQUEMUS_OWN_FULL_SKU_IMAGE_MISSING');
      const chosen=own[0],name=String(model.name||'').trim();
      if(!name||/^(?:new|preorder|shop now|view product)$/i.test(name))throw Error('JACQUEMUS_PRODUCT_TITLE_UNVERIFIED');
      const base={verified:true,brand,style:sku,verifiedAt:checkedAt,verificationMethod:'official-new-listing-sku-image',contentHash};
      const price=Number(item.offers.price),currency=item.offers.priceCurrency;
      const p={id:'jacquemus-'+sku.toLowerCase(),brand,name,style:sku,styleType:'sku',url:pUrl,image:chosen.url,
        colorway:String(model.color||''),colors:[],gender:sku.startsWith('FOU')?'Unisex':source.pathname.endsWith('-women')?'Women':'Men',country:'US',officialCategory:'Sneakers',description:item.description||'Official sneaker category product',
        ...(Number.isFinite(price)&&price>0&&currency==='USD'?{price,currency,priceLabel:'$'+price.toFixed(2)}:{}),
        firstSeen:checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:url,sourceSignals:[],imageCandidates:own,
        arrivalEvidence:{verified:true,brand,style:sku,productUrl:pUrl,kind:'official-assortment-listing',url,verifiedAt:checkedAt,contentHash,excerpt:'Official SFCC sneaker tile: '+name+' '+String(model.color||'')},
        officialProductEvidence:{...base,url:pUrl},officialImageEvidence:{...base,url:chosen.url,sourceUrl:url},
        sourceTileBinding:{verified:true,brand,style:sku,url:pUrl,image:chosen.url,sourceUrl:url,contentHash,method:'official-sfcc-tile-model-and-jsonld',tilePid:sku,jsonLdSku:sku,modelId:model.id}};
      const official=officialEvidenceFor(p,kstDay(checkedAt)),curated=curateProduct(p,kstDay(checkedAt));
      if(!official||!curated.product)throw Error(!official?'JACQUEMUS_OFFICIAL_PROOF_INVALID':curated.reason);
      products.push(p);outcomes.push({url:pUrl,style:sku,outcome:'complete',contentHash});
    }catch(error){
      const candidate={brand,style:sku,url:pUrl||schema.get(sku)?.url||'',name:schema.get(sku)?.name||''};
      pending.push({brand,candidate,reason:error.message});outcomes.push({url:candidate.url,style:sku,outcome:'unverified',reason:error.message});
    }
  }
  for(const sku of schema.keys())if(!grid.has(sku))errors.push({sku,error:'JACQUEMUS_JSONLD_WITHOUT_OWN_GRID_TILE'});
  const totals=[...html.matchAll(/<span\b[^>]*\bid=["']applyResultsCount["'][^>]*>\s*(\d+)\s*<\/span>/gi)].map(m=>Number(m[1]));
  const followups=[];
  // The noscript links are observed category pagination, not sorting buttons,
  // colour swatches, or speculative Search-UpdateGrid requests.
  for(const block of html.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi)){
    for(const m of block[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
      const href=attributes(m[1]).href;if(!href)continue;
      const next=new URL(href,url);
      if(next.origin!==origin||next.pathname!==source.pathname)continue;
      sourceUrl(next.href);
      if(next.searchParams.has('start')&&next.searchParams.has('sz'))followups.push(next.href);
    }
  }
  const pager=[...html.matchAll(new RegExp('<div\\b'+quotedAttributes+'>','gi'))].map(m=>attributes(m[1])).filter(a=>a['data-page-size']&&a['data-page-number']);
  const sizes=[...new Set(pager.map(a=>Number(a['data-page-size'])))],requestedSize=source.searchParams.has('sz')?Number(source.searchParams.get('sz')):null;
  if(sizes.length>1||requestedSize!==null&&sizes.length&&requestedSize!==sizes[0])errors.push({error:'JACQUEMUS_PAGE_SIZE_MISMATCH'});
  const size=requestedSize??sizes[0]??null;
  if(pager.some(a=>Number(a['data-page-number'])*Number(a['data-page-size'])!==start))errors.push({error:'JACQUEMUS_PAGE_OFFSET_MISMATCH'});
  return {products,pending,outcomes,errors,followups:[...new Set(followups)],receipt:{url,checkedAt,contentHash,start,pageSize:size,
    gridSkus:[...grid.keys()],gridItems,sourceGridItemCount:gridItems.length,extractedCandidateUrlCount:grid.size,jsonLdItems:schema.size,verified:products.length,declaredTotalCounts:[...new Set(totals)],
    categoryEvidence:{kind:'official-sneaker-breadcrumb',url:root},followupUrls:[...new Set(followups)]}};
}

export async function collectJacquemusOfficial({read,sources=JACQUEMUS_SOURCES,now=new Date(),maxPagesPerSource=8,onProgress}={}){
  if(typeof read!=='function')throw Error('Jacquemus read(url) is required');
  if(!Number.isInteger(maxPagesPerSource)||maxPagesPerSource<0)throw Error('Invalid Jacquemus page budget');
  const states=sources.map(url=>{sourceUrl(url);return {url,queue:[url],failed:[],pages:[],products:new Map(),outcomes:new Map(),pending:new Map(),errors:[]};});
  const checkedAt=new Date(now).toISOString();
  function snapshot(){
    const products=[...new Map(states.flatMap(s=>[...s.products]).map(([key,p])=>[key,p])).values()];
    const summaries=states.map(s=>{
      const totals=[...new Set(s.pages.flatMap(p=>p.declaredTotalCounts))],total=totals.length===1?totals[0]:null;
      const grid=new Set(s.pages.flatMap(p=>p.gridSkus)),items=new Map(s.pages.flatMap(p=>p.gridItems).map(i=>[i.key,i])),reasons=[];
      const missing=s.pages.flatMap(p=>p.followupUrls).filter(u=>!s.pages.some(p=>canonicalUrl(p.url)===canonicalUrl(u)));
      const ranges=s.pages.map(p=>({start:p.start,end:p.start+p.gridItems.length})).sort((a,b)=>a.start-b.start);
      let end=0;for(const range of ranges){if(range.start>end)reasons.push('paging-offset-gap');end=Math.max(end,range.end);}
      const terminal=Number.isInteger(total)&&total>0&&ranges.some(r=>r.end===total);
      if(!s.pages.length)reasons.push('no-listing-receipt');
      if(total===null||total<=0||items.size!==total)reasons.push('declared-total-missing-mixed-zero-or-mismatch');
      if(!terminal)reasons.push('terminal-source-enumeration-unproven');
      if(s.queue.length||s.failed.length||missing.length)reasons.push('listing-pending-or-missing-receipt');
      const excluded=o=>o.outcome==='explicitlyexcluded'&&items.get(o.key)?.kind==='editorial-merch-placement'&&o.evidence?.marker==='data-is-merch-tile=true'&&s.pages.some(p=>p.url===o.evidence.url&&p.contentHash===o.evidence.contentHash&&p.gridItems.some(i=>i.key===o.key));
      if(s.pending.size||s.outcomes.size!==items.size||[...s.outcomes.values()].some(o=>o.outcome!=='complete'&&!excluded(o)))reasons.push('candidate-proof-pending');
      if(s.errors.length)reasons.push('source-or-product-errors');
      return {url:s.url,declaredTotal:total,uniqueObserved:grid.size,uniqueObservedGridItems:items.size,explicitEditorialExclusions:[...s.outcomes.values()].filter(excluded).length,verified:s.products.size,pages:s.pages.length,complete:!reasons.length,
        method:reasons.length?null:'source-declared-sfcc-grid-enumeration',terminalCounter:terminal,reasons:[...new Set(reasons)],errors:s.errors};
    });
    const complete=summaries.length>0&&summaries.every(s=>s.complete);
    return {brand,checkedAt,products,pending:states.flatMap(s=>[...s.pending.values()]),listingPending:states.flatMap(s=>[...s.queue,...s.failed].map(url=>({brand,source:{url,shelfUrl:s.url}}))),
      candidateOutcomes:states.flatMap(s=>[...s.outcomes.values()]),listingReceipts:states.flatMap(s=>s.pages),coverage:[{brand,checkedAt,status:complete?'complete':'partial',exhaustive:complete,
        responses:states.reduce((n,s)=>n+s.pages.length,0),verified:products.length,errors:states.flatMap(s=>s.errors),sources:summaries,
        completionProof:{complete,scope:'configured-official-US-sneaker-grid-products-and-explicit-editorial-exclusions',method:complete?'source-declared-sfcc-grid-enumeration':null,sources:summaries}}]};
  }
  for(const state of states){
    const seen=new Set();
    while(state.queue.length&&seen.size<maxPagesPerSource){
      const url=state.queue.shift(),key=canonicalUrl(url);if(seen.has(key))continue;seen.add(key);
      try{
        const capture=await read(url),html=typeof capture==='string'?capture:capture.rawHtml||capture.html;
        if(typeof capture!=='string'){
          const status=capture.status??capture.metadata?.statusCode,final=capture.url??capture.metadata?.url;
          if(!Number.isInteger(status)||status<200||status>=300||capture.metadata?.error)throw Error('JACQUEMUS_SOURCE_HTTP_OR_RENDER_ERROR');
          if(!final||canonicalUrl(final)!==key)throw Error('JACQUEMUS_SOURCE_REDIRECT_OR_QUERY_MISMATCH');
        }
        if(typeof html!=='string'||!html)throw Error('JACQUEMUS_SOURCE_HTML_MISSING');
        const result=parseJacquemusListing(html,{url,checkedAt:capture.checkedAt||checkedAt});
        if(state.pages.some(p=>p.gridSkus.length&&p.gridSkus.join('|')===result.receipt.gridSkus.join('|')))state.errors.push({url,error:'JACQUEMUS_REPEATED_GRID_EXHAUSTION_UNPROVEN'});
        state.pages.push(result.receipt);state.errors.push(...result.errors);
        for(const p of result.products){state.products.set(p.style,p);state.pending.delete(p.style);}
        for(const p of result.pending)if(!state.products.has(p.candidate.style))state.pending.set(p.candidate.style,p);
        for(const o of result.outcomes){const key=o.key||o.style;if(o.outcome==='complete'||state.outcomes.get(key)?.outcome!=='complete')state.outcomes.set(key,o);}
        for(const next of result.followups)if(!seen.has(canonicalUrl(next))&&!state.queue.includes(next))state.queue.push(next);
      }catch(error){state.errors.push({url,error:error.message});state.failed.push(url);}
      await onProgress?.(structuredClone(snapshot()));
    }
  }
  const result=snapshot();await onProgress?.(structuredClone(result));return result;
}

async function main(){
  const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
  const output=path.resolve(option('--output','reports/admin-recheck-followup-20261105/manual-jacquemus-products.json'));
  const cacheDir=path.resolve(option('--cache-dir',path.join(path.dirname(output),'manual-jacquemus-sources'))),captures=new Map();
  const index=JSON.parse(await fs.readFile('reports/admin-rendered-index.json','utf8').catch(()=> '{}'));
  for(const [url,entry] of Object.entries(index)){
    if(!JACQUEMUS_SOURCES.includes(url))continue;
    const page=JSON.parse(gunzipSync(await fs.readFile(entry.path)).toString('utf8'));captures.set(canonicalUrl(url),page);
  }
  for(const file of await fs.readdir(cacheDir).catch(()=>[])){
    if(!file.endsWith('.json'))continue;const page=JSON.parse(await fs.readFile(path.join(cacheDir,file),'utf8'));
    if(page.url||page.metadata?.url)captures.set(canonicalUrl(page.url||page.metadata.url),page);
  }
  const save=async result=>{await fs.mkdir(path.dirname(output),{recursive:true});const temporary=output+'.tmp';await fs.writeFile(temporary,JSON.stringify(result,null,2));await fs.rename(temporary,output);};
  const read=async url=>{
    if(captures.has(canonicalUrl(url)))return captures.get(canonicalUrl(url));
    if(args.includes('--allow-network'))return {url,status:200,rawHtml:await readPublicSource(url),checkedAt:new Date().toISOString()};
    throw Error('JACQUEMUS_CAPTURE_MISSING: '+url);
  };
  const result=await collectJacquemusOfficial({read,maxPagesPerSource:Number(option('--max-pages','8')),onProgress:save});await save(result);
  console.log(JSON.stringify({output,products:result.products.length,pending:result.pending.length,listingPending:result.listingPending.length,exhaustive:result.coverage[0].exhaustive,sources:result.coverage[0].sources}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
