import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {curateCatalog,canonicalBrand,canonicalUrl,isOfficialProductUrl} from './curation.mjs';
import {mergePreserving} from './collect-evidence.mjs';
import {buildKeywordCatalog} from './search-keywords.mjs';
import {productPresentation} from './product-presentation.mjs';
import {withSocialComparisons} from './social-metrics.mjs';
import {buildStyleTrendBoard} from './style-trend-board.mjs';
import {isPublishedFootwear} from '../public/assets/footwear-policy.mjs';
import {publicationState} from '../public/assets/publication-window.mjs';
import {kstDay} from './curation.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
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
  const products=applyReviewedEvidence(applyReviewedEvidence(mergePreserving(source.products,incoming),evidence.products),socialPatches).map(p=>{
    const {firstPublishedAt,...unpublished}=p;
    return history.entries[p.id]?{...p,firstPublishedAt:history.entries[p.id].firstPublishedAt}:unpublished;
  });
  const socialStatus=(socialEvidence.sourceStatus||[]).map(s=>Object.fromEntries(['platform','name','url','status','reason','checkedAt','collectionMode','automatedAdapter'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]])));
  const effectiveCollection={...(collection||source.collection||{}),...(socialStatus.length?{socialMetricStatus:socialStatus}:{})};
  const result=curateCatalog(products,{now,previous:prior,collection:effectiveCollection});
  result.queue.products=result.queue.products.filter(p=>p.firstPublishedAt);
  // Preserve other records internally; publish the six requested footwear types.
  // Expired records still enter the archive independently of this display filter.
  result.snapshot.products=result.snapshot.products.filter(p=>isPublishedFootwear(p)&&p.releaseStatus==='released');
  if(maintenance&&Array.isArray(prior.products)){const priorIds=new Set(prior.products.map(p=>p.id));result.snapshot.products=result.snapshot.products.filter(p=>priorIds.has(p.id));}
  const photoReviews=await readJson(path.join(directory,'data/product-presentation.json'),null);
  if(photoReviews){
    result.snapshot.products=result.snapshot.products.flatMap(p=>{
      const presented=productPresentation(p,photoReviews);
      if(presented)return [presented];
      result.review.held.push({id:p.id,brand:p.brand,name:p.name,reason:'representative-photo-review-required'});return [];
    });
  }
  const photoCache=await readJson(path.join(directory,'data/photo-cache.json'),{images:{}});
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
