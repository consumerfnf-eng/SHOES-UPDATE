// Decide, per maison, whether its own shop shows only what it currently
// sells - and if it does not, find the control that sorts the shelf newest
// first. Writes data/luxury-shelf-basis.json with the page it read it on.
//
//   node scripts/classify-luxury-shelf.mjs            # every maison
//   node scripts/classify-luxury-shelf.mjs "Zegna" "Saint Laurent"
//
// The test is deliberately one-sided. A shop that offers an outlet, a
// clearance section, a past-season shelf or a resale programme is keeping
// more than this season, so its shelf cannot be taken whole - that is
// `undetermined`, and the shelf is read newest first instead. A shop whose
// own pages offer none of those, on a page we actually read, is selling this
// season and nothing else: `current-season-only`. A shop we could not read at
// all gets no determination and keeps the behaviour it had.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createOfficialReader} from './official-reader.mjs';
import {createRenderedOfficialReader} from './rendered-official-reader.mjs';
import {createScrapingBeeReader} from './scrapingbee-reader.mjs';
import {createJinaClient} from './jina_client.mjs';
import {markdownLinks} from './new-arrivals.mjs';
import {readJson,atomicJson} from './publish-curated.mjs';
import {LUXURY_MAISONS,ARCHIVE_MARKERS,sneakerShelfLinks,latestSortUrl} from './luxury-shelves.mjs';

const root=new URL('../',import.meta.url);
const digest=s=>createHash('sha256').update(s).digest('hex');
const MAX_PAGES_PER_BRAND=4;

export function classifyShelfPages(brand,pages){
  // pages: [{url,text}] - everything we managed to read for this brand.
  const links=pages.flatMap(p=>markdownLinks(p.text).map(l=>({...l,from:p.url})));
  const archive=pages.flatMap(p=>{
    const hit=p.text.match(ARCHIVE_MARKERS);
    return hit?[{url:p.url,excerpt:p.text.slice(Math.max(0,hit.index-80),hit.index+80).replace(/\s+/g,' ').trim()}]:[];
  });
  // Six per page across four pages is up to twenty-four shelves for one
  // brand, and the collection reads at most sixteen pages for a brand - so a
  // single maison's regional duplicates would consume the whole budget.
  // Sneaker shelves first, then eight at most.
  const byPath=new Map();
  for(const p of pages){
    let origin;try{origin=new URL(p.url).origin;}catch{continue;}
    for(const href of sneakerShelfLinks(markdownLinks(p.text),{origin,pageUrl:p.url})){
      const u=new URL(href),key=u.pathname.replace(/\/+$/,'');
      if(!byPath.has(key))byPath.set(key,href);
    }
  }
  const shelves=[...byPath.values()]
    .sort((a,b)=>Number(/sneaker|trainer|스니커/i.test(b))-Number(/sneaker|trainer|스니커/i.test(a)))
    .slice(0,8);
  const latest={};
  for(const shelf of shelves){
    const found=latestSortUrl(links.filter(l=>{try{return new URL(l.from).origin===new URL(shelf).origin;}catch{return false;}}),shelf);
    if(found)latest[shelf]=found;
  }
  const read=pages.map(p=>p.url);
  if(!read.length)return null;
  return {
    brand,
    basis:archive.length?'undetermined':'current-season-only',
    reason:archive.length?'the shop keeps more than this season':'no outlet, clearance, past-season or resale section on the pages read',
    shelves,latest,
    evidence:{verified:true,kind:'official-shelf-basis',url:read[0],pagesRead:read,
      checkedAt:new Date().toISOString(),
      excerpt:archive.length?archive[0].excerpt:`No archive or outlet section across ${read.length} official page(s)`,
      contentHash:digest(pages.map(p=>p.text).join('\n'))},
    ...(archive.length?{archiveSeenAt:archive.map(a=>a.url)}:{}),
  };
}

async function main(){
  const only=process.argv.slice(2).filter(a=>!a.startsWith('--'));
  const sources=await readJson(new URL('config/daily_sources.json',root));
  const origins=Object.values(sources).flat().flatMap(s=>{const u=new URL(s.url);return u.hostname.startsWith('www.')?[s.url,u.origin.replace('://www.','://')]:[s.url];});
  const client=createJinaClient({key:process.env.JINA_API_KEY||''});
  const firecrawlKey=process.env.FIRECRAWL_API_KEY||'',scrapingBeeKey=process.env.SCRAPINGBEE_API_KEY||'';
  const rendered=createRenderedOfficialReader({origins,apiKey:firecrawlKey,maxRequests:200});
  const bee=createScrapingBeeReader({origins,apiKey:scrapingBeeKey,maxCreditsPerRun:Number(process.env.SCRAPINGBEE_SHELF_CREDITS||400)});
  const renderers=[...(firecrawlKey?[['firecrawl',rendered]]:[]),...(scrapingBeeKey?[['scrapingbee',bee]]:[])];
  const renderedRead=async target=>{
    let last=Error('RENDERED_OFFICIAL_NO_READER_CONFIGURED');
    for(const [name,reader] of renderers){try{return await reader.read(target);}catch(e){last=Error(`${name}: ${e.message}`);}}
    throw last;
  };
  const reader=createOfficialReader({read:client.read,origins,renderedRead});
  const previous=await readJson(new URL('data/luxury-shelf-basis.json',root),{schemaVersion:1,brands:{}});
  const brands=[...LUXURY_MAISONS].filter(b=>!only.length||only.includes(b));
  const out={schemaVersion:1,checkedAt:new Date().toISOString(),brands:{...previous.brands}},unreadable=[];
  for(const brand of brands){
    // Prefer the shop's own shoe shelves, then anything else configured: the
    // home page is enough to find the shelf and to see whether an outlet
    // exists, which is all this asks.
    const configured=(sources[brand]||[]).map(s=>s.url)
      .sort((a,b)=>Number(/sneaker|shoes|footwear/i.test(b))-Number(/sneaker|shoes|footwear/i.test(a)));
    const pages=[];
    for(const url of configured.slice(0,MAX_PAGES_PER_BRAND)){
      try{pages.push({url,text:await reader.read(`https://r.jina.ai/${url}`)});}
      catch(e){unreadable.push({brand,url,error:e.message});}
    }
    const record=classifyShelfPages(brand,pages);
    if(!record){console.log(`${brand}: no official page could be read; keeping ${previous.brands?.[brand]?.basis||'no determination'}.`);continue;}
    out.brands[brand]=record;
    console.log(`${brand}: ${record.basis} (${record.shelves.length} sneaker shelves, ${Object.keys(record.latest).length} with a newest-first sort) - ${record.reason}`);
  }
  out.unreadable=unreadable;
  await atomicJson(new URL('data/luxury-shelf-basis.json',root),out);
  console.log(`Wrote determinations for ${Object.keys(out.brands).length} maisons; ${unreadable.length} pages unreadable.`);
}

if(process.argv[1]===fileURLToPath(import.meta.url))await main();
