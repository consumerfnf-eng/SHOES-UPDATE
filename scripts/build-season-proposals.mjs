import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {prepareCatalog} from '../public/assets/catalog-runtime.mjs';
import {variantGroupKey,isOverlay,kstToday,filterProducts} from '../public/assets/catalog-view.mjs';
import {reportSeason} from '../public/assets/forecast.mjs';
import {proposalSheet,seasonSheet,proposalDocument,BOARD_VERSION,BOARD_SIZE} from '../public/assets/proposal-template.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const read=async file=>JSON.parse(await fs.readFile(path.join(ROOT,file),'utf8'));
const text=p=>[p.name,p.fullName,p.colorway,p.material,p.description,p.excerpt,...(p.keywords||[])].filter(Boolean).join(' ');
const distinct=(rows,key)=>[...new Map(rows.map(p=>[key(p),p])).values()];
export function proposalEvidence(idea,{runtime,monthly,ranks,social,keywords,catwalk}){
 const re=new RegExp(idea.pattern,'iu'),matches=p=>re.test(text(p));
 const official=runtime.products.filter(p=>!isOverlay(p)&&matches(p));
 const retail=runtime.products.filter(p=>p.overlay&&String(p.source).startsWith('retail-')&&matches(p));
 const articles=distinct(runtime.products.filter(p=>p.overlay&&String(p.source).startsWith('newsletter-')&&matches(p)),p=>p.url);
 const ranking=ranks.boards.flatMap(b=>(b.items||[]).filter(matches).map(p=>({rank:p.rank,name:p.name,brand:p.brand,url:p.url,board:b.label,basis:b.basis,checkedAt:b.checkedAt,staleSince:b.staleSince||null})));
 const topics=keywords.filter(k=>re.test([k.label,k.englishLabel,...(k.aliases||[])].join(' ')));
 const editorial=distinct(topics.flatMap(k=>k.evidence||[]).filter(e=>e.kind==='editorial'),p=>p.sourceUrl);
 return {officialModels:new Set(official.map(variantGroupKey)).size,retailModels:new Set(retail.map(variantGroupKey)).size,articles:articles.length,articleSources:articles.slice(0,5).map(p=>({title:p.fullName||p.name,url:p.url,publishedAt:p.publishedAt})),ranking,social:(social.keywords||[]).filter(k=>re.test([k.hashtag,k.concept,...(k.aliases||[])].join(' '))).map(k=>k.hashtag),editorial:editorial.map(e=>({url:e.sourceUrl,source:e.sourceId,capturedAt:e.capturedAt,publishedAt:e.publishedAt})),feedTags:catwalk.looks.filter(l=>re.test((l.hashtags||[]).join(' '))).length};
}
export function validateProposalConfig(config,forecasts){
 if(config.schemaVersion!==2||!Array.isArray(config.ideas))throw Error('Invalid season proposal configuration');
 const ids=new Set();
 for(const season of ['27SS','27FW','28SS'])if(config.ideas.filter(i=>i.season===season).length<5)throw Error('At least five proposals required for '+season);
 for(const idea of config.ideas){
  if(ids.has(idea.id)||!/^[a-z0-9-]+$/.test(idea.id))throw Error('Duplicate or invalid proposal id');ids.add(idea.id);
  if(idea.references.length!==6||new Set(idea.references.map(r=>r.kind+':'+r.id)).size!==6)throw Error('Six distinct reviewed references required: '+idea.id);
  if(idea.tags.length<3||idea.strategies.length<4||!idea.pattern||!idea.insight)throw Error('Incomplete design proposal: '+idea.id);
  for(const f of idea.forecast){const report=forecasts.find(r=>r.id===f.id);if(!report||reportSeason(report.title)!==idea.season.replace('FW','AW')||!Number.isInteger(f.page)||f.page<1||f.page>report.pages.length)throw Error('Wrong season or page in forecast evidence: '+idea.id);}
 }
}
export async function buildSeasonProposals({now=new Date()}={}){
 const config=await read('data/season-proposals.json').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(!config){console.log('Internal season proposal configuration absent; no private research copied into a public build.');return null;}
 const catalog=await read('public/data/catalog.json'),monthly=await read('public/data/monthly-catalog.json'),ranks=await read('public/data/rank-boards.json'),social=await read('public/data/trend-keywords.json'),catwalk=await read('public/data/catwalk.json'),forecast=await read('public/data/forecast.json');
 validateProposalConfig(config,forecast.reports);
 await fs.mkdir(path.join(ROOT,'logs/20261103/proposal-work'),{recursive:true});
 execFileSync('python',['scripts/prepare-proposal-references.py'],{cwd:ROOT,stdio:'inherit'});
 const images=await read('logs/20261103/proposal-work/reference-images.json');
 const productMap=new Map(catalog.products.map(p=>[p.id,p])),lookMap=new Map(catwalk.looks.map(l=>[l.id,l]));
 const runtime=prepareCatalog(catalog,monthly,social,kstToday(now));
 runtime.products=filterProducts(runtime.products,{source:'all',search:'',brands:new Set(),category:'all',release:'released',sort:'newest'},kstToday(now));
 const context={runtime,monthly,ranks,social,keywords:catalog.styleTrendKeywords?.items||[],catwalk};
 const ideas=config.ideas.map(idea=>({...idea,evidence:proposalEvidence(idea,context),references:idea.references.map(ref=>{const source=(ref.kind==='product'?productMap:lookMap).get(ref.id),image=images[ref.kind+':'+ref.id];if(!source||!image)throw Error('Reference source missing: '+ref.id);return {...ref,...image,brand:source.brand,name:source.name||source.brand,season:source.season||'',url:source.url||source.sourceUrl||source.originalUrl,credit:ref.kind==='product'?`${source.brand} · 브랜드 공식`:`${source.brand} · ${source.season} 런웨이 / WGSN`};}),forecast:idea.forecast.map(f=>{const r=forecast.reports.find(r=>r.id===f.id);return {...f,title:r.title,shortTitle:r.title.replace('Men’s & Women’s ','').replace('Forecast ','').replace('Key Silhouettes: ','Silhouettes · '),url:r.url};})}));
 const coverage={officialRecords:catalog.products.length,retailRecords:monthly.retail.length,newsletterRecords:monthly.newsletter.length,eligibleNewsletterRecords:runtime.products.filter(p=>p.overlay&&String(p.source).startsWith('newsletter-')).length,publishedModels:new Set(runtime.products.map(variantGroupKey)).size,rankItems:ranks.boards.reduce((n,b)=>n+b.items.length,0),styleKeywords:catalog.styleTrendKeywords?.items?.length||0,socialKeywords:social.keywords.length,catwalkLooks:catwalk.looks.length,runwayLooks:catwalk.looks.filter(l=>l.collection!=='fashion-feed').length,feedLooks:catwalk.looks.filter(l=>l.collection==='fashion-feed').length,forecastReports:forecast.reports.length,forecastPages:forecast.reports.reduce((n,r)=>n+r.pages.length,0)};
 const output={schemaVersion:2,asOf:kstToday(now),brand:'MLB',boardSize:BOARD_SIZE,coverage,sourceDates:{catalog:catalog.sourceStatus,monthly:monthly.publishedAt,keywords:catalog.styleTrendKeywords?.updated,social:social.generatedAt,catwalk:catwalk.builtAt,forecast:forecast.checkedAt,rankings:ranks.boards.map(b=>({label:b.label,checkedAt:b.checkedAt,staleSince:b.staleSince||null,basis:b.basis}))},method:'사이트 보유 자료 전체의 문자 정보·검증된 모델 그룹을 집계하고, 검토한 공식·쇼 사진 및 시즌별 Forecast를 MLB 기획 가설로 해석했습니다. 카탈로그 구성·원문 인기순·SNS 연결을 판매량이나 미래 수요로 간주하지 않습니다. 쇼 레퍼런스는 모두 실제 27SS이며 27FW·28SS 쇼 사진으로 표기하지 않습니다.',seasons:config.seasons,ideas};
 const publicRoot=path.join(ROOT,'public');let browser,server;
 try{
  server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local'),file=path.resolve(publicRoot,'.'+url.pathname);if(!file.startsWith(publicRoot+path.sep))throw Error('path');const type={'.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:3});await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const page=await ctx.newPage();
  async function render(name,body,recipe){
   const dir=path.join(publicRoot,'proposals',name);await fs.mkdir(dir,{recursive:true});
   const digest=createHash('sha256').update(JSON.stringify({version:BOARD_VERSION,asOf:output.asOf,recipe})).digest('hex');const stamp=path.join(ROOT,'logs/20261103/proposal-work',`board-${name}.sha256`);
   const exists=await fs.readFile(stamp,'utf8').catch(()=>null);
   if(exists!==digest){
    const html=proposalDocument(body).replace('<meta charset="utf-8">',`<meta charset="utf-8"><base href="${origin}/">`);await page.setContent(html);await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
    const overflow=await page.evaluate(()=>({height:document.querySelector('.proposal-copy')?.scrollHeight||0,width:document.querySelector('#proposal-sheet').scrollWidth}));if(overflow.height>810||overflow.width>1600)throw Error('Proposal text overflows one page: '+name+' '+JSON.stringify(overflow));
    await page.locator('#proposal-sheet').screenshot({path:path.join(dir,'board.png')});await fs.writeFile(stamp,digest);
   }
   return {download:`/proposals/${name}/board.png`,preview:`/proposals/${name}/preview.webp`};
  }
  for(const idea of ideas){const assets=await render(idea.id,proposalSheet(idea,output),idea);Object.assign(idea,assets);}
  output.seasonBoards={};for(const season of output.seasons){const list=ideas.filter(i=>i.season===season);output.seasonBoards[season]=await render('season-'+season.toLowerCase(),seasonSheet(season,list,output),list);}
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
 execFileSync('python',['-c',`from pathlib import Path\nfrom PIL import Image\nfor p in Path('public/proposals').glob('*/board.png'):\n im=Image.open(p);im.thumbnail((1600,900),Image.Resampling.LANCZOS);im.save(p.with_name('preview.webp'),quality=86,method=4)`],{cwd:ROOT,stdio:'inherit'});
 await fs.writeFile(path.join(publicRoot,'data/season-proposals.json'),JSON.stringify(output)+'\n');
 await fs.unlink(path.join(publicRoot,'data/research-brief.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});
 console.log(`MLB proposals: ${ideas.length} item boards + ${output.seasons.length} season summaries at ${BOARD_SIZE.width}×${BOARD_SIZE.height}; all source classes analysed.`);return output;
}
if(process.argv[1]?.endsWith('build-season-proposals.mjs'))await buildSeasonProposals();
