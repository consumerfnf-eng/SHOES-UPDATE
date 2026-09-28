// Read-only visual smoke test of the actual staged catalog, using installed browser fonts/images.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { kstToday, releaseState, keywordProductIds, trendKeywords, sourceMatches, productBrandNames, releaseDateLabel } from '../public/assets/catalog-view.mjs';
import { exportRows } from '../public/assets/export.mjs';
const root=path.resolve('public'),out=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-live-preview-'));
const catalogFile=process.env.UI_CATALOG_PATH||path.join(root,'data/catalog.json'),catalogText=await fs.readFile(catalogFile,'utf8'),catalog=JSON.parse(catalogText),today=kstToday();
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.json':'application/json'};
function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=c;}if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}return rows;}
function xlsxRows(bytes){let at=0,sheet;while(bytes.readUInt32LE(at)===0x04034b50){assert.equal(bytes.readUInt16LE(at+8),0);const len=bytes.readUInt32LE(at+18),nameLen=bytes.readUInt16LE(at+26),extraLen=bytes.readUInt16LE(at+28),start=at+30+nameLen+extraLen,name=bytes.subarray(at+30,at+30+nameLen).toString();if(name==='xl/worksheets/sheet1.xml')sheet=bytes.subarray(start,start+len).toString();at=start+len;}assert(sheet);assert(!/<f[ >]/.test(sheet));const unescape=s=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&');return [...sheet.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)].map(m=>[...m[1].matchAll(/<t\b[^>]*>(.*?)<\/t>/gs)].map(v=>unescape(v[1])));}
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(file===path.join(root,'data/catalog.json')?catalogText:await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.UI_BROWSER_CHANNEL||(process.platform==='win32'?'chrome':undefined)});
  const page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true}),errors=[],failed=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('requestfailed',request=>failed.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
  const start=performance.now();await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#product-grid').getAttribute('aria-busy')==='false');
  const shellMs=Math.round(performance.now()-start);await page.evaluate(()=>Promise.race([Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise(resolve=>setTimeout(resolve,10000))]));
  assert.equal(await page.locator('#page-title').textContent(),'SHOES TRENDS');
  const current=trendKeywords(catalog.keywords),forecasts=trendKeywords(catalog.forecastKeywords||[],{forecast:true});
  assert(current.every(k=>k.keywordType==='style'));assert(!current.some(k=>/^(?:나이키|뉴발란스|아디다스|살로몬|신발|운동화|스니커즈)$/.test(k.label)),'Brand/model/generic terms are not style popularity');
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
  const keywordMatches=[];
  for(const keyword of current){
    const matched=keywordProductIds(keyword,catalog.products,today).size;
    await page.locator('[data-source="sns"]').click();await page.locator('#search').fill('nonmatching');await page.locator('#category-filter').selectOption('sandal');
    await page.getByRole('button',{name:`${keyword.label} 관련 상품 ${matched}개`,exact:true}).click();assert.equal(Number(await page.locator('#result-count').textContent()),matched);assert.equal(await page.locator('#search').inputValue(),'');assert.equal(await page.locator('#category-filter').inputValue(),'all');assert.equal(await page.locator('#release-filter').inputValue(),'all');assert.equal(await page.locator('[data-source="all"]').getAttribute('aria-pressed'),'true');keywordMatches.push({term:keyword.label,matched});
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
  assert(imageHealth.every(i=>i.loaded&&!i.fallback),'All actual eligible products must show their verified official image');
  for(const row of imageHealth)assert.equal(row.image,catalog.products.find(p=>p.id===row.id).image);
  const collaborationChecks=[];
  for(const brand of ['Cecilie Bahnsen','Celine']){
    await page.getByRole('button',{name:'필터 초기화',exact:true}).first().click();await page.locator('#release-filter').selectOption('all');
    const expected=catalog.products.filter(p=>releaseState(p,today)&&productBrandNames(p,today).includes(brand));
    await page.locator(`[data-brand="${brand}"]`).check();assert.equal(Number(await page.locator('#result-count').textContent()),expected.length);
    collaborationChecks.push({brand,count:expected.length,primaryBrands:[...new Set(expected.map(p=>p.brand))]});
  }
  const month=catalog.products.find(p=>p.dateEvidence.precision==='month');
  if(month){await page.getByRole('button',{name:'필터 초기화',exact:true}).first().click();await page.locator('#search').fill(month.style);await page.waitForTimeout(180);await page.locator(`[data-id="${month.id}"] .card-name`).click();assert((await page.locator('#detail-content').textContent()).includes(releaseDateLabel(month)));await page.getByRole('button',{name:'상세정보 닫기',exact:true}).click();}
  await page.getByRole('button',{name:'필터 초기화',exact:true}).first().click();await page.locator('#release-filter').selectOption('all');await page.locator('#search').fill('Palmes');await page.waitForTimeout(180);
  const selectedIds=await page.locator('.product-card').evaluateAll(cards=>cards.map(c=>c.dataset.id)),selected=catalog.products.filter(p=>selectedIds.includes(p.id));assert.equal(selected.length,2);
  for(const input of await page.locator('[data-select]').all())await input.check();await page.locator('.card-name').first().click();const officialLink=await page.getByRole('link',{name:'공식 상품 보기 ↗',exact:true}).getAttribute('href');assert(selected.some(p=>p.url===officialLink));await page.getByRole('button',{name:'상세정보 닫기',exact:true}).click();
  await page.locator('#export-open').click();assert.equal(await page.locator('#export-columns input:checked').count(),17);let pending=page.waitForEvent('download');await page.locator('#download-csv').click();let download=await pending;const csvPath=path.join(out,'selected.csv');await download.saveAs(csvPath);const csv=parseCsv((await fs.readFile(csvPath,'utf8')).replace(/^\uFEFF/,''));assert.deepEqual(csv,exportRows(selectedIds.map(id=>catalog.products.find(p=>p.id===id))));
  await page.locator('#export-open').click();pending=page.waitForEvent('download');await page.locator('#download-xlsx').click();download=await pending;const xlsxPath=path.join(out,'selected.xlsx');await download.saveAs(xlsxPath);assert.deepEqual(xlsxRows(await fs.readFile(xlsxPath)),csv);await page.locator('#clear-selection').click();
  await page.getByRole('button',{name:'필터 초기화',exact:true}).first().click();
  const sourceDescriptions={};for(const source of ['media','sns','ecommerce','brand']){await page.locator(`[data-source="${source}"]`).click();sourceDescriptions[source]=await page.locator('#result-description').textContent();if(source!=='sns'||!await page.locator('#social-group').inputValue())assert.equal(Number(await page.locator('#result-count').textContent()),catalog.products.filter(p=>releaseState(p,today)==='released'&&sourceMatches(p,source,today)).length);}
  await page.getByRole('button',{name:'전체',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile must not overflow');
  assert.equal(await page.locator('#keyword-list .keyword-select').count(),current.length);
  await page.screenshot({path:path.join(out,'mobile-actual.png')});await page.screenshot({path:path.join(out,'mobile-full-actual.png'),fullPage:true});
  await page.locator('#forecast-title').evaluate(e=>window.scrollTo(0,e.getBoundingClientRect().top+window.scrollY-140));await page.screenshot({path:path.join(out,'mobile-forecast-actual.png')});
  await page.locator('#results').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,'mobile-products-actual.png')});
  assert.equal(requests.filter(r=>r.method!=='GET').length,0);assert.equal(requests.filter(r=>new URL(r.url).pathname==='/data/catalog.json').length,1);
  const report={shellMs,...state,totalEligible:total,keywordInteraction:strongest?{label:strongest.label,matched:matches}:null,keywordMatches,collaborationChecks,monthLabel:month?releaseDateLabel(month):null,export:{rows:2,columns:17,csvMatchesXlsx:true},catalogFile,forecastCount:forecasts.length,imageHealth,sourceDescriptions,errors,failed,screenshots:['desktop-actual.png','desktop-products-actual.png','desktop-sources-actual.png','desktop-forecast-actual.png','mobile-actual.png','mobile-full-actual.png','mobile-products-actual.png','mobile-forecast-actual.png'].map(file=>path.join(out,file))};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(errors.length)process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
