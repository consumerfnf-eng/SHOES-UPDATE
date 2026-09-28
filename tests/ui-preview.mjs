// Read-only visual smoke test of the actual staged catalog, using installed browser fonts/images.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { kstToday, releaseState, keywordProductIds, trendKeywords } from '../public/assets/catalog-view.mjs';
const root=path.resolve('public'),out=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-live-preview-'));
const catalogFile=process.env.UI_CATALOG_PATH||path.join(root,'data/catalog.json'),catalogText=await fs.readFile(catalogFile,'utf8'),catalog=JSON.parse(catalogText),today=kstToday();
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(file===path.join(root,'data/catalog.json')?catalogText:await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.UI_BROWSER_CHANNEL||(process.platform==='win32'?'chrome':undefined)});
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[],failed=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('requestfailed',request=>failed.push({url:request.url(),error:request.failure()?.errorText}));
  const start=performance.now();await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#product-grid').getAttribute('aria-busy')==='false');
  const shellMs=Math.round(performance.now()-start);await page.evaluate(()=>Promise.race([Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise(resolve=>setTimeout(resolve,10000))]));
  assert.equal(await page.locator('#page-title').textContent(),'SHOES TRENDS');
  const current=trendKeywords(catalog.keywords),forecasts=trendKeywords(catalog.forecastKeywords||[],{forecast:true});
  assert.equal(await page.locator('#keyword-list .keyword-select').count(),current.length);assert.equal(await page.locator('#forecast-list .keyword-select').count(),forecasts.length);
  assert.deepEqual(await page.locator('#keyword-list .keyword-name').allTextContents(),current.map(k=>k.label),'Original source spellings must remain unchanged');
  assert.equal(Number(await page.locator('#result-count').textContent()),catalog.products.filter(p=>releaseState(p,today)==='released').length);
  await page.screenshot({path:path.join(out,'desktop-actual.png')});
  await page.locator('#search-rank-status summary').click();await page.locator('#search-rank-status').evaluate(e=>window.scrollTo(0,e.getBoundingClientRect().top+window.scrollY-110));await page.screenshot({path:path.join(out,'desktop-sources-actual.png')});await page.locator('#search-rank-status summary').click();
  await page.locator('#forecast-title').evaluate(e=>window.scrollTo(0,e.getBoundingClientRect().top+window.scrollY-110));await page.screenshot({path:path.join(out,'desktop-forecast-actual.png')});
  await page.locator('#results').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,'desktop-products-actual.png')});
  const state=await page.evaluate(()=>({releasedCount:Number(document.querySelector('#result-count').textContent),keywordCount:document.querySelectorAll('#keyword-list button').length,keywordCardHeights:[...document.querySelectorAll('#keyword-list .keyword')].map(e=>Math.round(e.getBoundingClientRect().height)),fonts:[...new Set([...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family))]}));
  const strongest=current.toSorted((a,b)=>keywordProductIds(b,catalog.products,today).size-keywordProductIds(a,catalog.products,today).size)[0];
  let matches=null;
  if(strongest){
  await page.locator('#category-filter').selectOption('sandal');await page.locator('#search').fill('no-matches-preview');
  matches=keywordProductIds(strongest,catalog.products,today).size;
  await page.getByRole('button',{name:`${strongest.label} 관련 상품 ${matches}개`,exact:true}).click();
  assert.equal(Number(await page.locator('#result-count').textContent()),matches);assert.equal(await page.locator('#search').inputValue(),'');assert.equal(await page.locator('#release-filter').inputValue(),'all');
  }
  await page.getByRole('button',{name:'필터 초기화',exact:true}).first().click();
  const localizedMatches=[];
  for(const [term,brand] of [['뉴발란스','New Balance'],['아디다스','adidas']]){
    const keyword=current.find(k=>k.sourceRanks.some(s=>s.term===term));if(!keyword)continue;
    const expected=catalog.products.filter(p=>p.brand===brand&&releaseState(p,today)).length,matched=keywordProductIds(keyword,catalog.products,today).size;assert.equal(matched,expected,`${term} must find all eligible ${brand} products`);
    await page.locator('#search').fill('nonmatching');await page.getByRole('button',{name:`${keyword.label} 관련 상품 ${matched}개`,exact:true}).click();assert.equal(Number(await page.locator('#result-count').textContent()),expected);localizedMatches.push({term,brand,matched});
  }
  await page.getByRole('button',{name:'필터 초기화',exact:true}).first().click();
  await page.locator('#release-filter').selectOption('all');
  const total=Number(await page.locator('#result-count').textContent());assert.equal(total,catalog.products.filter(p=>releaseState(p,today)).length);
  const imageHealth=[];
  for(let n=1;n<=Math.ceil(total/40);n++){
    if(n>1)await page.getByRole('button',{name:`${n}페이지`,exact:true}).click();
    for(const card of await page.locator('.product-card').all())await card.scrollIntoViewIfNeeded();
    await page.evaluate(()=>Promise.race([Promise.all([...document.querySelectorAll('.product-card img')].map(i=>i.decode().catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,10000))]));
    imageHealth.push(...await page.locator('.product-card').evaluateAll(cards=>cards.map(card=>({id:card.dataset.id,name:card.querySelector('.card-name')?.textContent,loaded:!!card.querySelector('img')?.naturalWidth,fallback:!!card.querySelector('.image-missing'),image:card.querySelector('img')?.currentSrc||''}))));
  }
  assert.equal(imageHealth.length,total,'Every eligible product must be reachable');
  await page.getByRole('button',{name:'필터 초기화',exact:true}).first().click();
  const sourceDescriptions={};for(const source of ['magazine','newsletter','sns','ecommerce']){await page.locator(`[data-source="${source}"]`).click();sourceDescriptions[source]=await page.locator('#result-description').textContent();}
  await page.getByRole('button',{name:'전체',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile must not overflow');
  assert.equal(await page.locator('#keyword-list .keyword-select').count(),current.length);
  await page.screenshot({path:path.join(out,'mobile-actual.png')});await page.screenshot({path:path.join(out,'mobile-full-actual.png'),fullPage:true});
  await page.locator('#forecast-title').evaluate(e=>window.scrollTo(0,e.getBoundingClientRect().top+window.scrollY-140));await page.screenshot({path:path.join(out,'mobile-forecast-actual.png')});
  await page.locator('#results').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,'mobile-products-actual.png')});
  console.log(JSON.stringify({shellMs,...state,totalEligible:total,keywordInteraction:strongest?{label:strongest.label,matched:matches}:null,localizedMatches,catalogFile,forecastCount:forecasts.length,imageHealth,sourceDescriptions,errors,failed,screenshots:['desktop-actual.png','desktop-products-actual.png','desktop-sources-actual.png','desktop-forecast-actual.png','mobile-actual.png','mobile-full-actual.png','mobile-products-actual.png','mobile-forecast-actual.png'].map(file=>path.join(out,file))},null,2));
  if(errors.length)process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
