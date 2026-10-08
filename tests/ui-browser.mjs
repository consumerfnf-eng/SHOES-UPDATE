import {chromium} from 'playwright';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {kstToday,shiftCalendarMonths} from '../public/assets/catalog-view.mjs';
import {EXPORT_COLUMNS} from '../public/assets/export.mjs';
const root=path.resolve('public'),out=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-ui-'));
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local'),file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`,today=kstToday(),at=new Date().toISOString();
const products=Array.from({length:48},(_,i)=>({id:`p${i}`,brand:'Nike',name:`Retro Runner ${String(i).padStart(2,'0')}`,category:'sneaker',productType:'sneaker',fit:['MLB'],fitReasons:['레트로 스포츠 캐주얼'],releaseDate:today,dateEvidence:{verified:true,official:true,precision:'day',url:'https://example.org/release',verifiedAt:at},url:`https://example.org/p${i}`,image:'https://example.org/white.svg',presentation:{image:'https://example.org/white.svg',scale:1},style:`SKU-${i}`,colorway:'White',keywords:['레트로','Retro'],sourceSignals:[],popularity:{},archiveGroup:'outdoor'}));
products.push({...products[0],id:'black',style:'SKU-0-B',colorway:'Black',image:'https://example.org/black.svg',presentation:{image:'https://example.org/black.svg',scale:1}});
products.push({...products[0],id:'white-women',style:'SKU-0-W',colorway:'WHITE'});
products.push({...products[1],id:'expired',releaseDate:'2020-01-01'},{...products[1],id:'future',releaseDate:shiftCalendarMonths(today,1)},{...products[1],id:'unknown',releaseDate:''},{...products[1],id:'sandal',category:'sandal'});
const keyword={keywordType:'style',id:'retro',label:'레트로',aliases:['Retro'],rank:1,score:1,productIds:products.map(p=>p.id),sourceRanks:[{sourceUrl:'https://hidden-source.example/article',platform:'source',kind:'editorial-keyword',verified:true,rank:null,term:'Retro',capturedAt:at,publishedAt:at}]};
const fixture={schemaVersion:1,publishedAt:at,asOf:today,brands:[{name:'Nike',mandatory:true}],products,keywords:[keyword],styleTrendKeywords:{updated:at,items:[keyword]},sourceStatus:{lastSuccessfulCollectionAt:at,unavailableBrands:[]}};
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_CHANNEL?{channel:process.env.UI_BROWSER_CHANNEL}:{})});const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 // All UI checks run against local code and fixtures; never contact live sites.
 await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
 await context.route('https://example.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${r.request().url().includes('black')?'#222':'#ddd'}"/></svg>`}));
 await context.route('**/data/catalog.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(fixture)}));
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 await page.goto(url);await page.locator('.product-card').first().waitFor();
 assert.equal(await page.locator('#result-count').textContent(),'48');assert.equal(await page.locator('.product-card').count(),40);
 assert.equal(await page.locator('#keyword-list a,#style-status a').count(),0,'No source links under style keywords');
 assert.equal(await page.locator('#ecommerce-keyword-list,#editorial-keyword-list').count(),0);
 assert.equal(await page.locator('[data-source="sns"]').count(),1);
 await page.locator('[data-source="sns"]').click();assert.equal(await page.locator('.product-card').count(),0);assert(await page.locator('#empty-title').isVisible());await page.locator('[data-source="all"]').click();
 assert.equal(await page.locator('#release-filter option').count(),1,'Only released products are offered');
 assert.equal(await page.locator('.color-chip img').count(),0,'Chips show color fills, not thumbnail photos');
 await page.locator('#search').fill('White');assert.equal(await page.locator('.product-card').filter({has:page.locator('[data-variant="black"]')}).locator('.color-chip').count(),2,'A color search retains the other active colors of the matching model');await page.locator('#search').fill('');
 const group=page.locator('.product-card').filter({has:page.locator('[data-variant="black"]')});
 await group.locator('[data-variant="black"]').click();assert((await group.locator('.card-open img').getAttribute('src')).endsWith('black.svg'));
 await group.locator('.card-name').click();assert.equal(await page.locator('#detail-content .color-chip').count(),2);
 await page.locator('#detail-content [data-variant="p0"]').click();assert((await page.locator('.detail-visual img').getAttribute('src')).endsWith('white.svg'));
 await page.locator('#detail-select').click();await page.getByRole('button',{name:'상세정보 닫기',exact:true}).click();
 await page.locator('#export-open').click();assert.equal(await page.locator('#export-columns input').count(),17);
 const [csv]=await Promise.all([page.waitForEvent('download'),page.locator('#download-csv').click()]);const csvPath=path.join(out,'selected.csv');await csv.saveAs(csvPath);const body=await fs.readFile(csvPath,'utf8');assert(body.includes('Retro Runner 00'));assert(body.includes('white.svg'));assert(!body.includes('hidden-source'));assert.equal(body.replace(/^\uFEFF/,'').split('\r\n')[0],EXPORT_COLUMNS.map(([key])=>`"${key}"`).join(','));
 await page.locator('#export-open').click();
 const [xlsx]=await Promise.all([page.waitForEvent('download'),page.locator('#download-xlsx').click()]);const xlsxPath=path.join(out,'selected.xlsx');await xlsx.saveAs(xlsxPath);assert.equal((await fs.readFile(xlsxPath)).subarray(0,2).toString(),'PK');
 await page.locator('#search').fill('no-match');await page.locator('#keyword-list .keyword-select').click();assert.equal(await page.locator('#result-count').textContent(),'48');assert.equal(await page.locator('#search').inputValue(),'');assert.equal(await page.locator('#release-filter').inputValue(),'released');
 await page.getByRole('button',{name:'2페이지',exact:true}).click();assert.equal(await page.locator('.product-card').count(),8);
 assert.equal(requests.filter(r=>r.url.endsWith('/data/catalog.json')).length,1);assert(requests.every(r=>r.method==='GET'),'Visit never starts a collection');
 await page.screenshot({path:path.join(out,'desktop.png')});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'mobile.png')});
 // Use the reported catalog names/colors, with local fixture photos and dates
 // so grouping regressions do not depend on external sites or release windows.
 const actual=JSON.parse(await fs.readFile(path.join(root,'data/catalog.json'),'utf8')).products;
 const variantProducts=actual.filter(p=>p.brand==='ASICS'||p.brand==='PANE'||p.brand==='adidas'&&['KI8294','KI8293'].includes(p.style)).map(p=>({
  ...products[0],id:p.id,brand:p.brand,name:p.name,style:p.style,modelKey:p.modelKey,colorway:p.colorway,gender:p.gender,
  image:`https://example.org/${p.id}.svg`,presentation:{image:`https://example.org/${p.id}.svg`,scale:1}
 }));
 const variantFixture={...fixture,products:variantProducts,brands:['ASICS','PANE','adidas'].map(name=>({name,mandatory:true})),keywords:[],styleTrendKeywords:{updated:at,items:[]}};
 const variantPage=await context.newPage();variantPage.on('pageerror',e=>errors.push(e.message));
 await variantPage.route('**/data/catalog.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(variantFixture)}));
 await variantPage.goto(url);await variantPage.locator('.product-card').first().waitFor();
 assert.equal(await variantPage.locator('#result-count').textContent(),'11','7 ASICS, 3 PANE and 1 adidas model cards');
 const cardFor=id=>variantPage.locator('.product-card').filter({has:variantPage.locator(`[data-variant="${id}"]`)});
 for(const model of ['GEL-KAYANO 33 LITE-SHOW','GT-2000 15 LITE-SHOW']){
  const pair=variantProducts.filter(p=>p.brand==='ASICS'&&p.name.startsWith(model));
  assert.equal(pair.length,2);
  const men=pair.find(p=>p.name.includes("Men's")),women=pair.find(p=>p.name.includes("Women's")),card=cardFor(women.id);
  assert.equal(await card.count(),1);assert.equal(await card.locator('.color-chip').count(),1);
  assert.equal(await cardFor(men.id).count(),0,'Male counterpart has no card or color chip');
  assert(!(await card.locator('.card-name').textContent()).match(/Men|Women/));
  await card.locator(`[data-variant="${women.id}"]`).click();
  assert.equal(await card.locator('.card-open img').getAttribute('src'),women.image);
  assert.equal(await card.locator(`[data-variant="${women.id}"]`).getAttribute('aria-pressed'),'true');
  await card.locator('.card-name').click();
  assert.equal(await variantPage.locator('#detail-content .color-chip').count(),1);
  assert.equal(await variantPage.locator('.detail-visual img').getAttribute('src'),women.image);
  assert.equal(await variantPage.locator(`#detail-content [data-variant="${men.id}"]`).count(),0);
  await variantPage.getByRole('button',{name:'상세정보 닫기',exact:true}).click();
 }
 assert.equal(await variantPage.locator('.card-name').filter({hasText:/^GEL-KAYANO 33 Running Shoes$/}).count(),1,'Standard edition has its own card');
 assert.equal(await variantPage.locator('.card-name').filter({hasText:/^GEL-KAYANO 14$/}).count(),1,'Older generation has its own card');
 const adidasCard=variantPage.locator('.product-card').filter({has:variantPage.locator('.card-name').filter({hasText:'ADIZERO ADIOS PRO 5'})});
 assert.equal(await adidasCard.count(),1);assert.equal(await adidasCard.locator('.color-chip').count(),1,'Previously fixed adidas duplicate color stays collapsed');
 assert.equal(await adidasCard.getAttribute('data-id'),variantProducts.find(p=>p.style==='KI8293').id,'adidas representative is the confirmed female SKU');
 for(const [name,count] of [['Pane Light Training Nogi Shoes',22],['Pane Zephyr Training Shoes',4],['Pane Zephyr Training Pouching Shoes',5]]){
  const card=variantPage.locator('.product-card').filter({has:variantPage.getByRole('button',{name,exact:true})});
  assert.equal(await card.count(),1);assert.equal(await card.locator('.color-chip').count(),count);
  const colors=card.locator('.color-chip'),firstId=await colors.first().getAttribute('data-variant'),secondId=await colors.nth(1).getAttribute('data-variant');
  assert(variantProducts.find(p=>p.id===firstId).name.includes('Women'));
  await colors.nth(1).click();
  assert.equal(await card.locator('.card-open img').getAttribute('src'),variantProducts.find(p=>p.id===secondId).image);
  await card.locator('.card-name').click();
  assert.equal(await variantPage.locator('#detail-content .color-chip').count(),count);
  await variantPage.locator(`#detail-content [data-variant="${firstId}"]`).click();
  assert.equal(await variantPage.locator('.detail-visual img').getAttribute('src'),variantProducts.find(p=>p.id===firstId).image);
  await variantPage.getByRole('button',{name:'상세정보 닫기',exact:true}).click();
 }
 await variantPage.locator('#search').fill('Lite Show/Orange Glow');
 await variantPage.waitForFunction(()=>document.getElementById('result-count').textContent==='0');
 const kayanoWomen=variantProducts.find(p=>p.name.startsWith('GEL-KAYANO 33 LITE-SHOW Women'));
 await variantPage.locator('#search').fill('GEL-KAYANO 33 LITE-SHOW Women');
 await variantPage.waitForFunction(()=>document.getElementById('result-count').textContent==='1');
 assert.equal(await variantPage.locator('.product-card .color-chip').count(),1,'Search only exposes female colors');
 assert.equal(await variantPage.locator(`[data-variant="${kayanoWomen.id}"]`).count(),1);
 await variantPage.locator('.card-name').click();
 await variantPage.locator('#detail-select').click();await variantPage.getByRole('button',{name:'상세정보 닫기',exact:true}).click();
 await variantPage.locator('#export-open').click();
 const [womenCsv]=await Promise.all([variantPage.waitForEvent('download'),variantPage.locator('#download-csv').click()]);
 const womenPath=path.join(out,'women-selected.csv');await womenCsv.saveAs(womenPath);
 const womenBody=await fs.readFile(womenPath,'utf8');assert(womenBody.includes(kayanoWomen.name));assert(womenBody.includes(kayanoWomen.image));assert(!womenBody.includes('Orange Glow'));
 await variantPage.setViewportSize({width:390,height:844});
 assert(await variantPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.equal(await variantPage.locator('.color-chip').first().evaluate(el=>getComputedStyle(el).borderRadius),'50%');
 await variantPage.screenshot({path:path.join(out,'asics-variants-mobile.png')});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,browser:process.env.UI_BROWSER_CHANNEL||'chromium',screenshots:out,downloads:[csvPath,xlsxPath,womenPath],checks:'women-only counterparts, male-only editions retained, adidas female representative, female card/detail color switching, suppressed male-color search, female CSV export, 17-column CSV/XLSX, pagination, mobile, local fixtures only'},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
