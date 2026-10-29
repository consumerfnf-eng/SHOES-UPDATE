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
import {readPublicSource} from './source-feeds.mjs';

const root=new URL('../',import.meta.url),now=new Date(),today=kstDay(now),source=await readJson(new URL('data/catalog-source.json',root));
const kst=new Date(now.getTime()+9*3600000),sunday=new Date(kst);sunday.setUTCDate(kst.getUTCDate()-kst.getUTCDay());
const weekStart=sunday.toISOString().slice(0,10);
if(process.argv.includes('--only-if-stale')&&source.collection?.selectionBasis==='official-new-arrivals'&&source.collection?.lastSuccessfulCollectionAt&&kstDay(source.collection.lastSuccessfulCollectionAt)>=weekStart){console.log('This week already has a completed New Arrivals collection; no duplicate collection.');process.exit(0);}
const client=createJinaClient({key:process.env.JINA_API_KEY||''});
const officialSources=await readJson(new URL('config/daily_sources.json',root));
const origins=Object.values(officialSources).flat().flatMap(s=>{const u=new URL(s.url);return u.hostname.startsWith('www.')?[s.url,u.origin.replace('://www.','://')]:[s.url];});
let phaseBudget=createCollectionBudget({durationMs:75*60_000,label:'OFFICIAL_NEW'});
const firecrawlKey=process.env.FIRECRAWL_API_KEY||'',scrapingBeeKey=process.env.SCRAPINGBEE_API_KEY||'';
const rendered=createRenderedOfficialReader({origins,apiKey:firecrawlKey,maxRequests:600,shouldContinue:()=>!phaseBudget.exhausted()});
// ScrapingBee is the other rendered fallback. Its ceiling rises when it is
// the only one with a key, because then it is not a last resort - it is the
// renderer, and 125 credits does not cover sixty brands.
const scrapingBee=createScrapingBeeReader({origins,apiKey:scrapingBeeKey,
  maxCreditsPerRun:Number(process.env.SCRAPINGBEE_OFFICIAL_CREDITS||(firecrawlKey?125:400)),
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
  const policy=await readJson(new URL('config/brand-policy.json',root));
  const brands=policy.brands.filter(b=>b.mandatory||b.policy==='core').sort((a,b)=>Number(b.group==='luxury')-Number(a.group==='luxury')).map(b=>b.name);
  const run=await collectNewArrivals({read:phaseBudget.wrap(reader.read),readDetails:phaseBudget.wrap(renderedCombined.readHtml),sources:officialSources,brands,existing:source.products,now,
    maxDetailMsPerBrand:120_000,canReadDetails:()=>!phaseBudget.exhausted(),
    onProgress:progress=>atomicJson(new URL('logs/weekly-progress.json',root),progress)});
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
  const collection={checkedAt:now.toISOString(),lastSuccessfulCollectionAt:new Date().toISOString(),coverage:run.coverage,unavailableBrands:run.coverage.filter(x=>!x.responses).map(x=>x.brand),scope:'weekly',selectionBasis:'official-new-arrivals',catalogExhaustive:false,sourceDirectory:signals.sourceDirectory,keywordCheckedAt:keywordNow.toISOString(),sourceRanks:[...search.sourceRanks,...forecast.sourceRanks,...editorial.sourceRanks,...style.sourceRanks],styleObservations:[...style.observations,...market.observations],styleMarketStatus:market.diagnostics,searchRankStatus:search.searchRankStatus,forecastStatus:forecast.forecastStatus,editorialStatus:[...editorial.editorialStatus,...style.editorialStatus]};
  await atomicJson(new URL('logs/weekly-diagnostics.json',root),{checkedAt:now.toISOString(),releaseChecks:[...verified.diagnostics,...structured.diagnostics],signalChecks:signals.diagnostics,keywordChecks:[...search.diagnostics,...forecast.diagnostics,...editorial.diagnostics,...style.diagnostics,...market.diagnostics],crawler:client.stats,officialFallbacks:reader.diagnostics,renderedOfficial:rendered.stats,sitemap:sitemap.stats,scrapingBeeOfficial:scrapingBee.stats});
  const result=await publishCurated({now:new Date(),incoming:[...run.products,...verified.products,...structured.products,...signals.products],collection});
  console.log(`Weekly snapshot complete: ${result.snapshot.products.length} public products; ${result.review.held.length} held for verification.`);
} catch(e) {await fs.mkdir(new URL('logs/',root),{recursive:true});await atomicJson(new URL('logs/weekly-error.json',root),{error:e.message,at:new Date().toISOString()});throw e;}
