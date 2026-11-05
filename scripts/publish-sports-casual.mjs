import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {siteBrandGroup} from '../public/assets/site-brand-policy.mjs';
import {sourceMatches} from '../public/assets/catalog-view.mjs';
import {samePhysicalVariant,manufacturerCode,identityFold} from '../public/assets/product-identity.mjs';
import {normalizeDisplayLanguage,hasForeignDisplayScript} from './normalize-display-language.mjs';
import {repairSourceLabels} from './repair-source-labels.mjs';
import {productKeywordIds,productSearchConceptIds} from './keyword-taxonomy.mjs';
import {encodeCatalog} from '../public/assets/catalog-wire.mjs';
import {buildCatalogChunks} from './build-catalog-chunks.mjs';
import {buildKeywordCatalog} from './search-keywords.mjs';
import {buildStyleTrendBoard} from './style-trend-board.mjs';
import {curateProduct,shiftMonth} from './curation.mjs';
import {reviewScopedNew} from './review-scoped-new.mjs';
import {dedupeScopedPrepared,bindPreparedRaw} from './scoped-prepared.mjs';

export const luxDigest=products=>createHash('sha256').update(JSON.stringify(products.filter(p=>siteBrandGroup(p.brand)==='LUX'))).digest('hex');
const permitted=p=>['SPORTS','CASUAL'].includes(siteBrandGroup(p.brand));
export function scopedSportsMerge(catalog,source,products,raw,{today,at=new Date().toISOString(),brandPolicy=[],includeLux=false,allowedBrands}={}){
 if(includeLux)assert(Array.isArray(allowedBrands),'LUX updates require an explicit allowedBrands whitelist');
 const permitted=p=>['SPORTS','CASUAL',...(includeLux?['LUX']:[])].includes(siteBrandGroup(p.brand))&&(!allowedBrands||allowedBrands.includes(p.brand));
 assert(products.every(permitted)&&raw.every(permitted),'SPORTS/CASUAL updates cannot contain LUX or excluded brands');
 const freshReviewed=p=>{const r=p.scopedNewReview;return r?.verified===true&&r.brand===p.brand&&r.style===p.style&&r.url===p.url&&r.image===(p.presentation?.image||p.image)&&Number.isFinite(Date.parse(r.checkedAt));};
 const before={published:luxDigest(catalog.products),source:luxDigest(source.products)};
 const snapshot=structuredClone(catalog),nextSource=structuredClone(source),added=[],duplicates=[],held=[],refreshed=[],canonicalRawIds=new Map();
 const ids=new Set(snapshot.products.map(p=>p.id)),positions=new Map(),identityIndex=new Map();
 const identityKeys=p=>{const brand=identityFold(p.brand),code=manufacturerCode(p),photo=p.presentation?.cachedPath||p.image;return [code&&brand+'|code|'+code,photo&&brand+'|photo|'+photo].filter(Boolean);};
 const indexProduct=(p,index)=>{positions.set(p.id,index);for(const key of identityKeys(p)){if(!identityIndex.has(key))identityIndex.set(key,new Set());identityIndex.get(key).add(index);}};
 snapshot.products.forEach(indexProduct);
 const physicalMatch=p=>[...new Set(identityKeys(p).flatMap(key=>[...(identityIndex.get(key)||[])]))].sort((a,b)=>a-b).map(i=>snapshot.products[i]).find(old=>samePhysicalVariant(old,p));
 for(const input of products){
  const existingId=positions.has(input.id)?snapshot.products[positions.get(input.id)]:undefined;
  if(existingId){assert.equal(existingId.brand,input.brand,'A scoped update cannot reuse another brand ID');if(sourceMatches(existingId,'brand',today)&&!freshReviewed(input))continue;}
  const p=normalizeDisplayLanguage(repairSourceLabels(input));
  p.name=p.name.replace(/^Product Name\s*:\s*/i,'').trim();
  if(p.brand==='Calvin Klein Jeans'&&/^사이즈 선택/.test(p.name)){
   p.sourceName=p.name;p.name=decodeURIComponent(new URL(p.url).pathname).split('/').filter(Boolean).at(-2).replaceAll('-',' ');
  }
  if(!sourceMatches(p,'brand',today)||!p.presentation?.cachedPath||hasForeignDisplayScript(p.name)){held.push({id:p.id,brand:p.brand,reason:'official-sneaker-photo-or-language-gate'});continue;}
  const rechecked=curateProduct({...p,productVerifiedAt:p.lastVerifiedAt},today);
  if(!rechecked.product||rechecked.expired){held.push({id:p.id,brand:p.brand,reason:rechecked.reason||'expired-after-label-repair'});continue;}
  const match=existingId||physicalMatch(p);
  if(match){
   canonicalRawIds.set(input.id,match.id);
   const reason=existingId?'same-official-record':samePhysicalVariant(match,p);duplicates.push({id:p.id,existingId:match.id,reason});
   if(!sourceMatches(match,'brand',today)||freshReviewed(p)){
    const fromId=p.id;p.id=match.id;p.firstPublishedAt=match.firstPublishedAt||at;
    p.sourceSignals=[...new Map([...(match.sourceSignals||[]),...(p.sourceSignals||[])].map(signal=>[signal.type+'|'+signal.url,signal])).values()];
    if(p.style===match.style&&!p.dateEvidence&&match.dateEvidence?.verified)for(const field of ['releaseDate','releaseDateEnd','releaseDatePrecision','dateEvidence'])if(match[field]!==undefined)p[field]=structuredClone(match[field]);
    // Sparse listing records must not erase existing prices or reviewed metadata.
    for(const [field,value] of Object.entries(match))if(p[field]===undefined)p[field]=structuredClone(value);
    for(const field of ['priceLabel','price','currency','material','gender','country','description','manufacturerStyle'])if((p[field]===undefined||p[field]===null||p[field]==='')&&match[field]!==undefined)p[field]=structuredClone(match[field]);
    if((match.presentation?.image||match.image)===(p.presentation?.image||p.image)){
     if(match.presentation?.frame)p.presentation={...p.presentation,...match.presentation};
     const colour=match.colourReview;if(colour?.verified&&colour.style===p.style&&colour.url===p.url&&colour.image===p.image)for(const field of ['colourReview','colorway','colorSwatches','colorEvidence'])if(match[field]!==undefined)p[field]=match[field];
    }
    if(match.modelGroupId)p.modelGroupId=match.modelGroupId;
    p.keywordTags=productKeywordIds(p);p.searchConceptIds=productSearchConceptIds(p);
    const position=positions.get(match.id);snapshot.products[position]=p;indexProduct(p,position);refreshed.push({id:p.id,fromId,brand:p.brand,reason:'fresh-New-evidence-for-existing-variant'});
    const rawRow=raw.find(r=>r.id===fromId),sourceIndex=nextSource.products.findIndex(r=>r.id===p.id);
    if(rawRow&&sourceIndex>=0){const old=nextSource.products[sourceIndex];assert(permitted(old));const merged={...old,...rawRow,id:p.id,firstSeen:old.firstSeen||rawRow.firstSeen};for(const field of ['priceLabel','price','currency','material','gender','country','description','manufacturerStyle'])if((merged[field]===undefined||merged[field]===null||merged[field]==='')&&old[field]!==undefined)merged[field]=structuredClone(old[field]);nextSource.products[sourceIndex]=merged;}
   }continue;
  }
  p.firstPublishedAt??=at;p.keywordTags=productKeywordIds(p);p.searchConceptIds=productSearchConceptIds(p);
  snapshot.products.push(p);indexProduct(p,snapshot.products.length-1);ids.add(p.id);canonicalRawIds.set(input.id,p.id);added.push({id:p.id,brand:p.brand});
 }
 const sourceIds=new Set(nextSource.products.map(p=>p.id));
 for(const input of raw){const id=includeLux?canonicalRawIds.get(input.id):input.id;if(!id)continue;const p=id===input.id?input:{...input,id};if(!sourceIds.has(p.id)){nextSource.products.push(p);sourceIds.add(p.id);}}
 snapshot.publishedAt=at;snapshot.asOf=today;snapshot.periodStart=shiftMonth(today,-3);
 for(const b of brandPolicy)if(permitted({brand:b.name})&&!snapshot.brands.some(old=>old.name===b.name))snapshot.brands.push(b);
 snapshot.sourceStatus={...snapshot.sourceStatus,lastSportsCasualUpdateAt:at};
 if(includeLux)snapshot.sourceStatus={...snapshot.sourceStatus,lastRecheckUpdateAt:at,...(added.length?{lastVerifiedAdditionAt:at}:{})};
 if(snapshot.sourceStatus.counts)snapshot.sourceStatus.counts={...snapshot.sourceStatus.counts,source:nextSource.products.length,published:snapshot.products.length};
 if(snapshot.keywordCheckedAt){
  const checked=snapshot.keywordCheckedAt;
  Object.assign(snapshot,buildKeywordCatalog(snapshot.products,snapshot.sourceRanks,{now:at}));snapshot.keywordCheckedAt=checked;snapshot.keywordEvaluatedAt=at;
  if(snapshot.styleTrendKeywords?.method==='verified-style-board-v1')snapshot.styleTrendKeywords=buildStyleTrendBoard(snapshot.products,snapshot.styleTrendKeywords.observations,{now:at,updated:snapshot.styleTrendKeywords.updated,sourceRanks:snapshot.sourceRanks});
 }
 const after={published:luxDigest(snapshot.products),source:luxDigest(nextSource.products)};
 if(!includeLux)assert.deepEqual(after,before,'Existing LUX product objects and order must be identical');
 assert(snapshot.products.length>=catalog.products.length,'A recheck must never remove existing catalog records');
 return {snapshot,source:nextSource,report:{checkedAt:at,added,duplicates,held,refreshed,lux:{before,after,unchanged:JSON.stringify(before)===JSON.stringify(after),authorizedUpdate:includeLux}}};
}
export async function publishSportsCasual({preparedFiles,rawFiles,today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)}={}){
 const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
 const catalog=await read('public/data/catalog.json'),source=await read('data/catalog-source.json'),policy=await read('config/brand-policy.json');
 const reviews=await read('data/sports-casual-photo-reviews.json').catch(()=>({products:[]}));
 const prepared=dedupeScopedPrepared((await Promise.all(preparedFiles.map(read))).flatMap(d=>d.products).filter(p=>!reviews.products.some(r=>r.approved===false&&r.brand===p.brand&&r.image===(p.presentation?.image||p.image))));
 const incomingRaw=(await Promise.all(rawFiles.map(read))).flatMap(d=>d.products);
 assert(incomingRaw.every(permitted),'SPORTS/CASUAL raw input cannot contain LUX or excluded brands');
 // Keep rejected garments, navigation images and uncached candidates out of
 // the canonical source too; a later full curation must not reintroduce them.
 const raw=bindPreparedRaw(prepared,reviewScopedNew(incomingRaw).products);
 const result=scopedSportsMerge(catalog,source,prepared,raw,{today,brandPolicy:policy.brands});
 // Verify all new originals and card renditions before writing either snapshot.
 for(const {id} of [...result.report.added,...result.report.refreshed]){const p=result.snapshot.products.find(p=>p.id===id);for(const asset of [p.presentation.cachedPath,p.presentation.thumbnail?.path].filter(Boolean)){
  assert(/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(asset));const bytes=await fs.readFile('public'+asset);assert.equal(createHash('sha256').update(bytes).digest('hex'),path.basename(asset).split('.')[0]);
 }}
 await fs.writeFile('data/catalog-source.json',JSON.stringify(result.source)+'\n');
 await fs.writeFile('public/data/catalog.json',JSON.stringify(result.snapshot)+'\n');
 await buildCatalogChunks(result.snapshot,'public/data');
 await fs.writeFile('public/data/catalog-ui.json',JSON.stringify(encodeCatalog(result.snapshot))+'\n');
 await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/sports-casual-update.json',JSON.stringify(result.report,null,2)+'\n');
 console.log(JSON.stringify({added:result.report.added.length,refreshed:result.report.refreshed.length,duplicates:result.report.duplicates.length,held:result.report.held.length,lux:result.report.lux}));
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const arg=name=>process.argv[process.argv.indexOf(name)+1];
 if(!process.argv.includes('--prepared')||!process.argv.includes('--raw'))throw Error('Pass comma-separated --prepared and --raw JSON files; LUX is immutable');
 await publishSportsCasual({preparedFiles:arg('--prepared').split(','),rawFiles:arg('--raw').split(',')});
}
