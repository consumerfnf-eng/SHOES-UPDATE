import fs from 'node:fs/promises';
import {createOfficialReader} from './official-reader.mjs';
import {createRenderedOfficialReader} from './rendered-official-reader.mjs';
import {createSitemapReader,localeAlternates} from './fallback-sources.mjs';
import {createScrapingBeeReader} from './scrapingbee-reader.mjs';
import {createJinaClient} from './jina_client.mjs';
import {mergePreserving} from './collect-evidence.mjs';
import {collectSignals} from './collect-signals.mjs';
import {collectStructuredFeeds} from './official-feeds.mjs';
import {collectSearchKeywords} from './collect-search-keywords.mjs';
import {collectForecastKeywords} from './collect-forecast-keywords.mjs';
import {collectEditorialKeywords} from './collect-editorial-keywords.mjs';
import {collectStyleEditorials} from './collect-style-editorials.mjs';
import {collectStyleMarket} from './collect-style-market.mjs';
import {publishCurated,readJson,atomicJson,applyReviewedEvidence} from './publish-curated.mjs';
import {curateCatalog,kstDay} from './curation.mjs';
import {collectNewArrivals} from './new-arrivals.mjs';
import {createCollectionBudget} from './collection-budget.mjs';
import {collectedBrandList,brandFingerprint} from './collection-scope.mjs';
import {withLuxuryShelves} from './luxury-shelves.mjs';
import {readPublicSource} from './source-feeds.mjs';

const root=new URL('../',import.meta.url),now=new Date(),today=kstDay(now),source=await readJson(new URL('data/catalog-source.json',root));
const kst=new Date(now.getTime()+9*3600000),sunday=new Date(kst);sunday.setUTCDate(kst.getUTCDate()-kst.getUTCDay());
const weekStart=sunday.toISOString().slice(0,10);
// A maison's own sneaker shelf, where we have established that its shop shows
// only what it currently sells. See scripts/luxury-shelves.mjs.
const shelfBasis=await readJson(new URL('data/luxury-shelf-basis.json',root),{brands:{}});
const officialSources=withLuxuryShelves(await readJson(new URL('config/daily_sources.json',root)),shelfBasis);
const policy=await readJson(new URL('config/brand-policy.json',root));
const collectedBrands=collectedBrandList(policy);
const fingerprint=brandFingerprint(collectedBrands,officialSources);
if(process.argv.includes('--only-if-stale')&&source.collection?.selectionBasis==='official-new-arrivals'&&source.collection?.lastSuccessfulCollectionAt&&kstDay(source.collection.lastSuccessfulCollectionAt)>=weekStart){
  if(source.collection.brandFingerprint===fingerprint){console.log('This week already has a completed New Arrivals collection over the same brands and shelves; no duplicate collection.');process.exit(0);}
  console.log(`The collected brand list or its shelves changed since the last completed collection (${source.collection.brandFingerprint||'none recorded'} -> ${fingerprint}); collecting again.`);
}
const client=createJinaClient({key:process.env.JINA_API_KEY||''});
const origins=Object.values(officialSources).flat().flatMap(s=>{const u=new URL(s.url);return u.hostname.startsWith('www.')?[s.url,u.origin.replace('://www.','://')]:[s.url];});
// The job allows 180 minutes and the collection phase was taking 75 of them,
// which is where 1,681 of the 3,105 held records come from: their listings
// were read, their candidates were found, and the clock ran out before any of
// them could be checked against their own product page. 150 minutes leaves
// the signal, keyword and publication phases the half hour they use.
let phaseBudget=createCollectionBudget({durationMs:Number(process.env.OFFICIAL_NEW_BUDGET_MINUTES||150)*60_000,label:'OFFICIAL_NEW'});
const firecrawlKey=process.env.FIRECRAWL_API_KEY||'',scrapingBeeKey=process.env.SCRAPINGBEE_API_KEY||'';
const rendered=createRenderedOfficialReader({origins,apiKey:firecrawlKey,maxRequests:600,shouldContinue:()=>!phaseBudget.exhausted()});
// ScrapingBee is the other rendered fallback, and on a luxury shelf it is not
// a fallback at all: ysl.com, fendi.com, chanel.com and valentino.com answer
// the plain reader with a 403 or with an empty client-rendered shell, so the
// only way in is a premium render at 25 credits. 125 credits is five of those
// for the whole run, and the 2026-10-29 collection recorded 203
// SCRAPINGBEE_RUN_BUDGET_EXHAUSTED errors against it - Saint Laurent, Fendi
// and Loro Piana among them, every one reported as a brand with no new shoes.
// The ceiling is now set to cover a luxury-first pass and is overridable, so
// a tighter account can lower it without editing the collection.
const scrapingBee=createScrapingBeeReader({origins,apiKey:scrapingBeeKey,
  maxCreditsPerRun:Number(process.env.SCRAPINGBEE_OFFICIAL_CREDITS||800),
  shouldContinue:()=>!phaseBudget.exhausted()});
// Only readers that have a key are tried. Firecrawl without one answers 401
// on its first request, which latches `quotaStopped` for the whole run and
// made every brand report RENDERED_OFFICIAL_QUOTA_STOPPED - including the
// ones ScrapingBee could have rendered, because the combined reader always
// re-threw Firecrawl's error and hid what actually happened.
const renderers=[
  ...(firecrawlKey?[['firecrawl',rendered]]:[]),
  ...(scrapingBeeKey?[['scrapingbee',scrapingBee]]:[]),
  ...(firecrawlKey||scrapingBeeKey?[]:[['firecrawl',rendered]]),
];
const viaRenderers=method=>async target=>{
  let last=Error('RENDERED_OFFICIAL_NO_READER_CONFIGURED');
  for(const [name,reader] of renderers){
    try{return await reader[method](target);}
    catch(error){last=Error(`${name}: ${error.message}`);}
  }
  throw last;
};
const renderedCombined={read:viaRenderers('read'),readHtml:viaRenderers('readHtml')};
// Two more ways in for the stores that refuse the ones above: the same page
// in another country, and the store's own sitemap. Both read public pages
// only and neither needs an account.
const sitemap=createSitemapReader({shouldContinue:()=>!phaseBudget.exhausted()});
const localeRead=async target=>{
  let last=Error('LOCALE_NO_ALTERNATE');
  for(const alternate of localeAlternates(target)){
    try{return await client.read('https://r.jina.ai/'+alternate);}
    catch(error){last=Error(`${new URL(alternate).host}: ${error.message}`);}
  }
  throw last;
};
const reader=createOfficialReader({read:client.read,origins,renderedRead:renderedCombined.read,
  localeRead,sitemapRead:sitemap.read});
try {
  // Candidates the last run found and never got to check. They are already
  // discovered - the listing read, the card parsed - so re-discovering them
  // costs a page request for nothing, and dropping them is why
  // product-verification-required is the catalogue's largest hold: the
  // backlog reset to zero every Sunday instead of draining.
  const carried=await readJson(new URL('data/pending-candidates.json',root),{candidates:[]});
  const run=await collectNewArrivals({read:phaseBudget.wrap(reader.read),readDetails:phaseBudget.wrap(renderedCombined.readHtml),sources:officialSources,brands:collectedBrands,existing:source.products,now,
    carriedPending:carried.candidates,
    maxDetailMsPerBrand:Number(process.env.OFFICIAL_DETAIL_MS_PER_BRAND||240_000),canReadDetails:()=>!phaseBudget.exhausted(),
    onProgress:progress=>atomicJson(new URL('logs/weekly-progress.json',root),{...progress,brandFingerprint:fingerprint})});
  await atomicJson(new URL('data/pending-candidates.json',root),
    {schemaVersion:1,savedAt:new Date().toISOString(),checkedAt:run.checkedAt,candidates:run.pending||[]});
  if(!run.coverage.some(c=>c.responses))throw Error('ALL_OFFICIAL_SOURCES_UNAVAILABLE');
  const combined=mergePreserving(source.products,run.products);
  const verified={products:run.products,diagnostics:run.coverage};
  phaseBudget=createCollectionBudget({durationMs:10*60_000,label:'OFFICIAL_CALENDAR'});
  const structured=await collectStructuredFeeds({read:phaseBudget.wrap(reader.read),fetchHtml:phaseBudget.wrap(url=>readPublicSource(url,{maxBytes:6_000_000})),now});
  // A crawl response alone cannot establish a newly completed verified catalog.
  // Daily maintenance still expires old records if all live product verification is unavailable.
  if(!run.products.length&&!structured.products.length)throw Error('NO_OFFICIAL_PRODUCT_PROOFS: keeping the previous snapshot and collection date');
  const staged=mergePreserving(combined,[...verified.products,...structured.products]);
  const evidence=await readJson(new URL('data/release-evidence.json',root),{products:[]});
  const withEvidence=applyReviewedEvidence(staged,evidence.products);
  const eligibleIds=new Set(curateCatalog(withEvidence,{now}).snapshot.products.map(p=>p.id));
  phaseBudget=createCollectionBudget({durationMs:10*60_000,label:'SIGNAL'});
  const signalNow=new Date(),signals=await collectSignals({products:withEvidence.filter(p=>eligibleIds.has(p.id)),read:phaseBudget.wrap(reader.read),readPublic:phaseBudget.wrap(readPublicSource),now:signalNow});
  const keywordNow=new Date(),[search,forecast,editorial,style,market]=await Promise.all([collectSearchKeywords({now:keywordNow}),collectForecastKeywords({now:keywordNow}),collectEditorialKeywords({now:keywordNow}),collectStyleEditorials({now:keywordNow}),collectStyleMarket({now:keywordNow,previousObservations:source.collection?.styleObservations||[]})]);
  const collection={checkedAt:now.toISOString(),lastSuccessfulCollectionAt:new Date().toISOString(),brandFingerprint:fingerprint,coverage:run.coverage,unavailableBrands:run.coverage.filter(x=>!x.responses).map(x=>x.brand),scope:'weekly',selectionBasis:'official-new-arrivals',catalogExhaustive:false,sourceDirectory:signals.sourceDirectory,keywordCheckedAt:keywordNow.toISOString(),sourceRanks:[...search.sourceRanks,...forecast.sourceRanks,...editorial.sourceRanks,...style.sourceRanks],styleObservations:[...style.observations,...market.observations],styleMarketStatus:market.diagnostics,searchRankStatus:search.searchRankStatus,forecastStatus:forecast.forecastStatus,editorialStatus:[...editorial.editorialStatus,...style.editorialStatus]};
  await atomicJson(new URL('logs/weekly-diagnostics.json',root),{checkedAt:now.toISOString(),releaseChecks:[...verified.diagnostics,...structured.diagnostics],signalChecks:signals.diagnostics,keywordChecks:[...search.diagnostics,...forecast.diagnostics,...editorial.diagnostics,...style.diagnostics,...market.diagnostics],crawler:client.stats,officialFallbacks:reader.diagnostics,renderedOfficial:rendered.stats,sitemap:sitemap.stats,scrapingBeeOfficial:scrapingBee.stats});
  const result=await publishCurated({now:new Date(),incoming:[...run.products,...verified.products,...structured.products,...signals.products],collection});
  console.log(`Weekly snapshot complete: ${result.snapshot.products.length} public products; ${result.review.held.length} held for verification.`);
} catch(e) {await fs.mkdir(new URL('logs/',root),{recursive:true});await atomicJson(new URL('logs/weekly-error.json',root),{error:e.message,at:new Date().toISOString()});throw e;}
