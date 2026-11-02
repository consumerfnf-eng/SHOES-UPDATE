import {displayBrandGroup} from '../public/assets/brand-groups.mjs';
import {collectNewArrivals} from './new-arrivals.mjs';
import {createJinaClient} from './jina_client.mjs';
import {createOfficialReader} from './official-reader.mjs';
import {createRenderedOfficialReader} from './rendered-official-reader.mjs';
import {createScrapingBeeReader} from './scrapingbee-reader.mjs';
import {createCollectionBudget} from './collection-budget.mjs';
import {readJson,atomicJson,publishCurated} from './publish-curated.mjs';
const root=new URL('../',import.meta.url),now=new Date(),apply=process.argv.includes('--publish');
const previous=await readJson(new URL('public/data/catalog.json',root));
const source=await readJson(new URL('data/catalog-source.json',root));
const configured=await readJson(new URL('config/daily_sources.json',root));
const shelves=await readJson(new URL('data/luxury-shelf-basis.json',root),{brands:{}});
const brands=previous.brands.filter(b=>displayBrandGroup(b)==='LUX').map(b=>b.name);
const sources=Object.fromEntries(brands.map(b=>[b,[...new Map([...(shelves.brands[b]?.shelves||[]).map(url=>({url})),...(configured[b]||[])].map(s=>[s.url,{...s,basis:'assortment'}])).values()]]));
const origins=Object.values(sources).flat().map(s=>s.url);
const client=createJinaClient({key:process.env.JINA_API_KEY||''});
const budget=createCollectionBudget({durationMs:Number(process.env.LUX_BUDGET_MINUTES||150)*60_000,label:'LUX_ASSORTMENT'});
const rendered=createRenderedOfficialReader({origins,apiKey:process.env.FIRECRAWL_API_KEY||'',maxRequests:600});
const bee=createScrapingBeeReader({origins,apiKey:process.env.SCRAPINGBEE_API_KEY||'',maxCreditsPerRun:Number(process.env.SCRAPINGBEE_OFFICIAL_CREDITS||800)});
const renderedRead=async url=>{
 let error=Error('No rendered reader configured');
 for(const [key,reader] of [[process.env.FIRECRAWL_API_KEY,rendered],[process.env.SCRAPINGBEE_API_KEY,bee]]){
  if(!key)continue;try{return await reader.read(url);}catch(e){error=e;}
 }throw error;
};
const reader=createOfficialReader({read:client.read,origins,renderedRead});
const run=await collectNewArrivals({read:budget.wrap(reader.read),sources,brands,catalogueBrands:brands,existing:source.products,now,
 maxPagesPerBrand:Number(process.env.LUX_MAX_PAGES||512),maxDetailMsPerBrand:Number(process.env.LUX_DETAIL_MS||120000),canReadDetails:()=>!budget.exhausted(),
 onProgress:p=>atomicJson(new URL('logs/lux-assortment-progress.json',root),p)});
const report={schemaVersion:1,checkedAt:run.checkedAt,scope:'official-lux-sneakers-all-release-dates',publicationRequested:apply,brands:run.coverage.map(c=>({...c,
 scopeComplete:false,reason:!sources[c.brand].length?'no configured official source':!c.responses?'official pages unavailable':c.truncated?'listing page limit or budget reached':c.errors.length?'unresolved page or product errors':'read pages verified; official total and all regions not independently reconciled'})),
 caveat:'No brand is marked exhaustive without an official total reconciliation. Errors and partial coverage must be reported.'};
await atomicJson(new URL('logs/lux-assortment-report.json',root),report);
if(apply){
 if(budget.exhausted()||run.coverage.some(c=>c.truncated))throw Error('Collection truncated; report saved, publication withheld');
 if(!run.products.length)throw Error('No verified LUX sneakers; preserving existing catalogue');
 await publishCurated({now:new Date(),incoming:run.products,collection:{...source.collection,luxAssortmentCheckedAt:run.checkedAt}});
 await atomicJson(new URL('data/lux-assortment-report.json',root),report);
 await atomicJson(new URL('public/data/lux-assortment-report.json',root),report);
}
console.log(JSON.stringify({brands:brands.length,verified:run.products.length,published:apply,report:'logs/lux-assortment-report.json'}));
