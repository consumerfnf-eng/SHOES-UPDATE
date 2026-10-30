import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {curateCatalog,canonicalBrand,canonicalUrl,isOfficialProductUrl,labelVariantColours,labelUrlVariantColours,labelNameVariantColours,modelIdentityKeys,preferLateralView} from './curation.mjs';
import {mergePreserving} from './collect-evidence.mjs';
import {buildKeywordCatalog} from './search-keywords.mjs';
import {productPresentation} from './product-presentation.mjs';
import {withSocialComparisons} from './social-metrics.mjs';
import {buildStyleTrendBoard} from './style-trend-board.mjs';
import {isPublishedFootwear} from '../public/assets/footwear-policy.mjs';
import {publicationState} from '../public/assets/publication-window.mjs';
import {kstDay} from './curation.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));

/** The colour words a brand's own product slug states, folded. */
function slugWords(url) {
  try { return new URL(url).pathname.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' '); }
  catch { return []; }
}
/** One canonical product URL publishes once.
 *
 *  The record kept is the one the page is evidence *for*: a brand writes the
 *  colour into its own slug - "triple-s.2-sneaker-black-dark-grey-865849..." -
 *  so the record whose colourway appears there is the one that page shows.
 *  With nothing to choose between them the first is kept, which is the order
 *  the collection already decided.
 */
export function keepOnePerProductUrl(products,held) {
  const groups=new Map();
  for(const p of products){const u=canonicalUrl(p.url);if(!u)continue;(groups.get(u)||groups.set(u,[]).get(u)).push(p);}
  const drop=new Set();
  for(const [url,group] of groups){
    if(group.length<2)continue;
    const words=new Set(slugWords(url));
    const scored=group.map(p=>({p,score:String(p.colorway||'').toLowerCase().split(/[^a-z0-9]+/)
      .filter(w=>w.length>2&&words.has(w)).length}));
    const best=scored.reduce((a,b)=>b.score>a.score?b:a,scored[0]);
    for(const {p} of scored){
      if(p===best.p)continue;
      held.push({id:p.id,brand:p.brand,name:p.name,colorway:p.colorway,reason:'duplicate-product-url',url});
      drop.add(p.id);
    }
  }
  return products.filter(p=>!drop.has(p.id));
}
/** A photograph shared by two different models is wrong for at least one.
 *
 *  Colour chips of one card may legitimately share a shot; two *models* may
 *  not. Which of them the picture actually shows is not knowable from the
 *  record - these are hashed CDN paths - so one is kept and the others are
 *  held with the reason, rather than three cards being published of which two
 *  show the wrong shoe.
 */
export function holdPhotosSharedAcrossModels(products,held) {
  const groups=new Map();
  for(const p of products){const i=p.presentation?.image;if(!i)continue;(groups.get(i)||groups.set(i,[]).get(i)).push(p);}
  const drop=new Set();
  for(const group of groups.values()){
    if(group.length<2)continue;
    const identity=p=>`${canonicalBrand(p.brand)}|${modelIdentityKeys(p)[0]||p.name}`;
    const models=[...new Set(group.map(identity))];
    if(models.length<2)continue;
    const keep=group[0];
    for(const p of group){
      if(p===keep||identity(p)===identity(keep))continue;
      held.push({id:p.id,brand:p.brand,name:p.name,reason:'photo-shared-across-models',
                 sharedWith:keep.name,image:p.presentation.image});
      drop.add(p.id);
    }
  }
  return products.filter(p=>!drop.has(p.id));
}
export async function readJson(file,fallback) {try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}}
export async function atomicJson(file,value) {file=file instanceof URL?fileURLToPath(file):file;await fs.mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;await fs.writeFile(tmp,JSON.stringify(value,null,2));await fs.rename(tmp,file);}
function compatibleEvidenceIdentity(product,evidence) {
  if(!evidence.brand||canonicalBrand(product.brand)!==canonicalBrand(evidence.brand))return false;
  if(product.style&&evidence.style&&product.style.toUpperCase()!==evidence.style.toUpperCase())return false;
  // A shared base SKU must not collapse explicitly selected color/variant URLs.
  try {
    const a=new URL(product.url),b=new URL(evidence.url);
    for(const field of ['swatch','color','colour','colorway','variant'])if(a.searchParams.has(field)&&b.searchParams.has(field)&&a.searchParams.get(field)!==b.searchParams.get(field))return false;
  }catch{}
  return true;
}
export function applyReviewedEvidence(input,evidence) {
  // Both stable-ID and exact-SKU joins require the same declared brand and compatible variant.
  let products=[...input];
  for(const e of evidence||[]) {
    const sameId=e.id&&products.find(p=>p.id===e.id);
    if(sameId&&!compatibleEvidenceIdentity(sameId,e))throw Error(`Conflicting reviewed product identity: ${e.id}`);
    const found=sameId||products.find(p=>e.style&&p.style?.toUpperCase()===e.style.toUpperCase()&&compatibleEvidenceIdentity(p,e));
    if(found) {
      const next={...e,id:found.id};
      // Reviewed bootstrap facts must never reset newer weekly verification or discard newly found signals.
      if((found.lastSignalCheckedAt||'')>(e.checkedAt||e.dateEvidence?.verifiedAt||''))delete next.sourceSignals;
      if(e.socialMetrics)next.socialMetrics=[...new Map([...(found.socialMetrics||[]),...e.socialMetrics].map(m=>[JSON.stringify(m),m])).values()];
      const proofAt=found.officialProductEvidence?.verifiedAt;
      if(found.officialProductEvidence?.verified===true&&proofAt>(e.officialProductEvidence?.verifiedAt||e.productVerifiedAt||e.dateEvidence?.verifiedAt||'')){
        // Keep the exact URL/image/identity pair checked together. A bootstrap source
        // may add release facts, but cannot attach an older image to a newer official proof.
        for(const field of ['name','brand','style','url','image','productEvidenceUrl','productVerifiedAt','officialProductEvidence','officialImageEvidence'])delete next[field];
      }
      products=mergePreserving(products,[next]);
      // A color-only review has its own proof date. It must not refresh the
      // whole product's verification, and a later blank listing cannot erase it.
      const colorProof=e.colorwayEvidence;
      if(e.colorway&&colorProof?.verified===true&&Number.isFinite(Date.parse(colorProof.checkedAt))
        &&isOfficialProductUrl(found.brand,colorProof.url)&&canonicalUrl(colorProof.url)===canonicalUrl(found.url)
        &&(!found.colorway||colorProof.checkedAt>=(found.colorwayEvidence?.checkedAt||found.productVerifiedAt||''))){
        products=products.map(p=>p.id===found.id?{...p,colorway:e.colorway,colors:e.colors||[e.colorway],colorwayEvidence:colorProof}:p);
      }
      const genderProof=e.genderEvidence;
      if(e.gender&&genderProof?.verified===true&&Number.isFinite(Date.parse(genderProof.checkedAt))
        &&isOfficialProductUrl(found.brand,genderProof.url)&&canonicalUrl(genderProof.url)===canonicalUrl(found.url)
        &&(!found.gender||genderProof.checkedAt>=(found.genderEvidence?.checkedAt||found.productVerifiedAt||''))){
        products=products.map(p=>p.id===found.id?{...p,gender:e.gender,genderEvidence:genderProof}:p);
      }
    }
    else if(!sameId&&e.id&&e.name&&e.brand) products=mergePreserving(products,[e]);
  }
  return products;
}
// An image inlined as base64 is not a photograph this site can use: every
// later check wants an https URL, so the record can never publish, and the
// blob rides along in every checkout - the August 2026 spreadsheet import
// alone carried 5.5 MB of it. Recorded as having no image, which is what it
// is, rather than carried as a kilobyte of unusable data.
export function dropInlineImages(products) {
  return (products||[]).map(p=>typeof p?.image==='string'&&p.image.startsWith('data:')
    ? {...p,image:'',imageNote:'inline-base64-dropped'} : p);
}

export async function publishCurated({directory=root,now=new Date(),incoming=[],collection,maintenance=false,keywordRefresh=false}={}) {
  const sourceFile=path.join(directory,'data/catalog-source.json'), prior=await readJson(path.join(directory,'public/data/catalog.json'),{});
  const source=await readJson(sourceFile), evidence=await readJson(path.join(directory,'data/release-evidence.json'),{products:[]});
  const socialEvidence=await readJson(path.join(directory,'data/social-metric-evidence.json'),{products:[],sourceStatus:[]});
  if(keywordRefresh&&incoming.length)throw Error('Keyword refresh cannot change product records');
  if(keywordRefresh){const fields=['sourceRanks','searchRankStatus','forecastStatus','editorialStatus','keywordCheckedAt','styleObservations','styleMarketStatus'];collection={...source.collection,...Object.fromEntries(fields.filter(k=>collection?.[k]!==undefined).map(k=>[k,collection[k]]))};}
  const socialPatches=(socialEvidence.products||[]).filter(e=>e.id&&e.brand&&e.style&&Array.isArray(e.socialMetrics)).map(e=>({id:e.id,brand:e.brand,style:e.style,socialMetrics:e.socialMetrics}));
  const historyFile=path.join(directory,'data/publication-history.json');
  const history=await readJson(historyFile,{schemaVersion:1,entries:{}});
  // Previous public rows are proof even in a fresh checkout; raw firstSeen is not.
  for(const p of prior.products||[])if(!history.entries[p.id])history.entries[p.id]={firstPublishedAt:p.firstPublishedAt||prior.publishedAt,brand:p.brand,style:p.style,url:p.url};
  const products=applyReviewedEvidence(applyReviewedEvidence(mergePreserving(dropInlineImages(source.products),dropInlineImages(incoming)),evidence.products),socialPatches).map(p=>{
    const {firstPublishedAt,...unpublished}=p;
    return history.entries[p.id]?{...p,firstPublishedAt:history.entries[p.id].firstPublishedAt}:unpublished;
  });
  const socialStatus=(socialEvidence.sourceStatus||[]).map(s=>Object.fromEntries(['platform','name','url','status','reason','checkedAt','collectionMode','automatedAdapter'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]])));
  const effectiveCollection={...(collection||source.collection||{}),...(socialStatus.length?{socialMetricStatus:socialStatus}:{})};
  // Evidence that a listing the brand still calls new is not: the weekly
  // retail run's index of when each model was first listed anywhere, plus
  // launch dates recorded by hand for what a person knows and no feed says.
  const firstListed={
    ...(await readJson(path.join(directory,'data/model-first-listed.json'),{})),
    ...(await readJson(path.join(directory,'data/model-launch-dates.json'),{dates:{}})).dates,
  };
  // When we started watching each brand, so a shoe that appeared after we
  // began looking can be published on that evidence rather than on a release
  // date its brand never printed.
  const watch=await readJson(path.join(directory,'data/source-watch.json'),{brands:{}});
  // A sole is not a representative photograph. Where the record already holds
  // the lateral still, take it before anything is curated from the other one.
  preferLateralView(products);
  const result=curateCatalog(products,{now,previous:prior,collection:effectiveCollection,firstListed,watch});
  result.queue.products=result.queue.products.filter(p=>p.firstPublishedAt);
  // Preserve other records internally; publish the six requested footwear types.
  // Expired records still enter the archive independently of this display filter.
  result.snapshot.products=result.snapshot.products.filter(p=>isPublishedFootwear(p)&&p.releaseStatus==='released');
  if(maintenance&&Array.isArray(prior.products)){const priorIds=new Set(prior.products.map(p=>p.id));result.snapshot.products=result.snapshot.products.filter(p=>priorIds.has(p.id));}
  // Where several colours of one shoe are published with no colour recorded,
  // the cards are identical. The brand's own URLs already tell them apart.
  labelNameVariantColours(labelVariantColours(labelUrlVariantColours(result.snapshot.products)));
  const photoReviews=await readJson(path.join(directory,'data/product-presentation.json'),null);
  if(photoReviews){
    result.snapshot.products=result.snapshot.products.flatMap(p=>{
      const presented=productPresentation(p,photoReviews);
      if(presented)return [presented];
      result.review.held.push({id:p.id,brand:p.brand,name:p.name,reason:'representative-photo-review-required'});return [];
    });
  }
  // A photograph shared by a shelf-full of products is a photograph of none of
  // them. Havaianas' 38 records all pointed at one image URL: whatever that
  // picture shows, it is not evidence of 38 different shoes.
  const photoUse=new Map();
  for(const p of result.snapshot.products)if(p.presentation?.image)photoUse.set(p.presentation.image,(photoUse.get(p.presentation.image)||0)+1);
  const shared=new Set([...photoUse].filter(([,n])=>n>=4).map(([image])=>image));
  if(shared.size){
    result.snapshot.products=result.snapshot.products.filter(p=>{
      if(!p.presentation||!shared.has(p.presentation.image))return true;
      result.review.held.push({id:p.id,brand:p.brand,name:p.name,reason:'shared-representative-photo'});return false;
    });
  }
  // One product URL publishes once. Balenciaga's colour swatches sit inside
  // one product page, so five records - Triple S.2 in five colourways - were
  // reading the same page and every one of them kept that page as its URL.
  // The page's own slug names one of those colours, and that is the record
  // the page is evidence for; the rest have no URL of their own.
  result.snapshot.products=keepOnePerProductUrl(result.snapshot.products,result.review.held);
  // Two different models cannot both be the shoe in one photograph. Brooks
  // published the Adrenaline GTS 10, the Ghost 18 and the Ghost Max 4 with a
  // single image between them, and the n>=4 rule above - written for
  // Havaianas' 38 - never saw a group of three.
  result.snapshot.products=holdPhotosSharedAcrossModels(result.snapshot.products,result.review.held);
  const photoCache=await readJson(path.join(directory,'data/photo-cache.json'),{images:{}});
  // A photograph the brand's CDN will not serve costs that one product its
  // card, the same answer the catalogue already gives a product with no
  // photograph at all. It is held with a reason rather than dropped silently,
  // so the queue report says which host refused and how many it cost.
  if(photoCache.unavailable){
    result.snapshot.products=result.snapshot.products.filter(p=>{
      if(!p.presentation||photoCache.images[p.presentation.image]||!photoCache.unavailable[p.presentation.image])return true;
      result.review.held.push({id:p.id,brand:p.brand,name:p.name,reason:'photo-unavailable'});return false;
    });
  }
  for(const p of result.snapshot.products){
    if(!history.entries[p.id])history.entries[p.id]={firstPublishedAt:new Date(now).toISOString(),brand:p.brand,style:p.style,url:p.url};
    p.firstPublishedAt=history.entries[p.id].firstPublishedAt;
  }
  result.snapshot.retentionBasis='first-published';
  result.snapshot.sourceStatus.selectionBasis=effectiveCollection.selectionBasis||'verified-release-legacy';
  result.snapshot.sourceStatus.catalogExhaustive=effectiveCollection.catalogExhaustive===true;
  if(effectiveCollection.selectionBasis==='official-new-arrivals')result.snapshot.sourceStatus.notes[0]='공식 New·New Arrivals 또는 상품별 NEW 표시와 품목·상품 정보를 확인합니다. 출시일이 미공개이면 비워 두며, 최초 게시일부터 3개월간 표시합니다.';
  for(const p of result.snapshot.products)if(p.presentation){const cached=photoCache.images[p.presentation.image];if(cached&&/^\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(cached.path))p.presentation.cachedPath=cached.path;}
  result.snapshot.products=withSocialComparisons(result.snapshot.products);
  Object.assign(result.snapshot,buildKeywordCatalog(result.snapshot.products,result.snapshot.sourceRanks,{now}));
  // Expiry and product matching run at the current instant without claiming
  // that a maintenance pass collected fresh keyword evidence.
  result.snapshot.keywordEvaluatedAt=new Date(now).toISOString();
  if(maintenance&&!keywordRefresh&&prior.keywordCheckedAt)result.snapshot.keywordCheckedAt=prior.keywordCheckedAt;
  result.snapshot.styleTrendKeywords=buildStyleTrendBoard(result.snapshot.products,effectiveCollection.styleObservations||[],{now,updated:effectiveCollection.keywordCheckedAt||result.snapshot.keywordCheckedAt,sourceRanks:result.snapshot.sourceRanks});
  result.snapshot.sourceStatus.styleMarketStatus=effectiveCollection.styleMarketStatus||[];
  result.snapshot.sourceStatus.counts.published=result.snapshot.products.length;
  const discovery=await readJson(path.join(directory,'data/discovery-checks.json'),null);
  if(discovery&&Date.parse(discovery.checkedAt)>Date.parse(effectiveCollection.checkedAt||0))result.snapshot.sourceStatus.discoveryRecheck=discovery;
  // Maintenance only removes expired entries / updates upcoming state and ages signals; it does not claim a new collection.
  if(maintenance&&!keywordRefresh&&prior.publishedAt) result.snapshot.publishedAt=prior.publishedAt;
  if(!Array.isArray(result.snapshot.products)||new Set(result.snapshot.products.map(p=>p.id)).size!==result.snapshot.products.length)throw Error('Invalid curated snapshot');
  if(!maintenance||keywordRefresh) {
    await fs.mkdir(path.join(directory,'logs/backups'),{recursive:true});
    await fs.copyFile(sourceFile,path.join(directory,'logs/backups/catalog-source-before.json'));
    await atomicJson(sourceFile,keywordRefresh?{...source,collection,lastKeywordsRefreshedAt:new Date(now).toISOString()}:{...source,products,collection:collection||source.collection||{},lastCuratedAt:new Date(now).toISOString()});
  }
  const priorQueue=await readJson(path.join(directory,'data/archive-queue.json'),{products:[]});
  // Retain retryable transfers even when a later source response omits the item.
  const active=new Set(result.snapshot.products.map(p=>p.id));
  const queued=[...new Map([...priorQueue.products,...(priorQueue.deferred||[]),...result.queue.products].filter(p=>!active.has(p.id)).map(p=>[p.id,history.entries[p.id]?{...p,firstPublishedAt:history.entries[p.id].firstPublishedAt}:p])).values()];
  // Old release-based retry rows may not yet be due under the new publication
  // clock. Preserve them separately and make them eligible again on that date.
  result.queue.deferred=queued.filter(p=>p.firstPublishedAt&&publicationState(p,kstDay(now))!=='expired');
  result.queue.products=queued.filter(p=>!result.queue.deferred.some(d=>d.id===p.id));
  result.queue.retentionBasis='first-published';
  await atomicJson(historyFile,history);
  await atomicJson(path.join(directory,'data/archive-queue.json'),result.queue);
  await atomicJson(path.join(directory,'data/curation-review.json'),result.review);
  // Public catalog is the last write: observers can only see a fully serialized snapshot.
  await atomicJson(path.join(directory,'public/data/catalog.json'),result.snapshot);
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)publishCurated({maintenance:process.argv.includes('--maintenance')}).then(r=>console.log(`Published ${r.snapshot.products.length}; held ${r.review.held.length}; archive queue ${r.queue.products.length}.`)).catch(e=>{console.error(e.message);process.exitCode=1;});
