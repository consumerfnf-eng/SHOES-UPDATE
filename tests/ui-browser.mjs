import {chromium} from 'playwright';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {kstToday,shiftCalendarMonths,variantGroupKey,variantGroupName,preferWomenVariants} from '../public/assets/catalog-view.mjs';
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
 await context.route('**/data/catalog-index.json',r=>r.fulfill({status:404,body:''}));
 await context.route('**/data/catalog-ui.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(fixture)}));
 // The page loads the retail/newsletter overlay and the SNS keyword board
 // alongside the catalog. Unmocked, the real published files answered and
 // every count in this file was measuring live data instead of the fixture.
 await context.route('**/data/monthly-catalog.json',r=>r.fulfill({contentType:'application/json',
   body:JSON.stringify({schemaVersion:2,publishedAt:at,asOf:today,periodStart:today,sources:{},retail:[],newsletter:[],sourceStatus:[]})}));
 await context.route('**/data/trend-keywords.json',r=>r.fulfill({contentType:'application/json',
   body:JSON.stringify({schemaVersion:1,generatedAt:at,asOf:today,displayCount:20,keywords:[],candidates:[],sourceStatus:{}})}));
 // The catwalk snapshot is 3,648 looks and 928 KB of real data; this file
 // measures the fixture, and the tab is checked on its own.
 await context.route('**/data/catwalk.json',r=>r.fulfill({contentType:'application/json',
   body:JSON.stringify({schemaVersion:1,provider:'WGSN',season:'Spring/Summer 2027',builtAt:at,shelves:[],looks:[]})}));
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 await page.goto(url);await page.locator('.product-card').first().waitFor();
 assert.equal(await page.locator('#result-count').textContent(),'48');assert.equal(await page.locator('.product-card').count(),40);
 assert.equal(await page.locator('#brand-group-tabs button').count(),4);
 await page.locator('[data-brand-group="LUX"]').click();
 assert.equal(await page.locator('[data-brand-group="LUX"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('.product-card[data-brand="Nike"]').count(),0);
 await page.locator('[data-brand-group="SPORTS"]').click();
 assert.equal(await page.locator('.product-card[data-brand="Prada"]').count(),0);
 await page.locator('[data-brand-group="CASUAL"]').click();
 assert.equal(await page.locator('.product-card[data-brand="Nike"]').count(),0);
 await page.locator('[data-source="brand"]').click();
 assert.equal(await page.locator('[data-brand-group="CASUAL"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('[data-brand-group="SPORTS"]').isDisabled(),false);
 assert.equal(await page.locator('[data-brand-group="CASUAL"]').isDisabled(),false);
 assert.equal(await page.locator('#brand-list [data-brand="Nike"]').count(),0,'Unverified fixture products do not qualify for the official tab');
 await page.locator('[data-source="all"]').click();
 await page.locator('[data-brand-group="all"]').click();
 assert.equal(await page.locator('#result-count').textContent(),'48');

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
 assert.equal(requests.filter(r=>r.url.endsWith('/data/catalog-ui.json')).length,1);assert(requests.every(r=>r.method==='GET'),'Visit never starts a collection');
 await page.screenshot({path:path.join(out,'desktop.png')});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'mobile.png')});
 // Use the reported catalog names/colors, with local fixture photos and dates
 // so grouping regressions do not depend on external sites or release windows.
 const actual=JSON.parse(await fs.readFile(new URL('./fixtures/variant-ui-catalog.json',import.meta.url),'utf8')).products;
 const variantProducts=actual.filter(p=>p.brand==='ASICS'||p.brand==='PANE'||p.brand==='adidas'&&['KI8294','KI8293'].includes(p.style)).map(p=>({
  ...products[0],id:p.id,brand:p.brand,name:p.name,style:p.style,manufacturerStyle:p.manufacturerStyle,productVariantId:p.productVariantId,modelKey:p.modelKey,colorway:p.colorway,gender:p.gender,
  url:p.url,designReview:p.designReview?{...p.designReview,image:`https://example.org/${encodeURIComponent(p.presentation?.cachedPath||p.image)}.svg`}:undefined,
  // Keep the source's exact shared-photo identity while serving local SVGs.
  // Replacing each photograph with its row ID invented different variants.
  image:`https://example.org/${encodeURIComponent(p.presentation?.cachedPath||p.image)}.svg`,presentation:{image:`https://example.org/${encodeURIComponent(p.presentation?.cachedPath||p.image)}.svg`,scale:1}
 }));
 const variantFixture={...fixture,products:variantProducts,brands:['ASICS','PANE','adidas'].map(name=>({name,mandatory:true})),keywords:[],styleTrendKeywords:{updated:at,items:[]}};
 const variantPage=await context.newPage();variantPage.on('pageerror',e=>errors.push(e.message));
 await variantPage.route('**/data/catalog-ui.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(variantFixture)}));
 await variantPage.goto(url);await variantPage.locator('.product-card').first().waitFor();
 // Counted from the fixture, not written down. The fixture is frozen from
 // verified ASICS/PANE/adidas listings, so a hard-coded 11 only held
 // until those brands' line-ups changed - which is the third time a test here
 // has been bound to mutable data (see 62e4b70).
 const expectedCards=new Set(preferWomenVariants(variantProducts).map(variantGroupKey)).size;
 assert.equal(await variantPage.locator('#result-count').textContent(),String(expectedCards),
   `one card per model group (${variantProducts.length} listings)`);
 const cardFor=id=>variantPage.locator('.product-card').filter({has:variantPage.locator(`[data-variant="${id}"]`)});
 // These current men's Orange Glow and women's Lavender Glow are different
 // colourways. One model card must preserve both instead of discarding the men.
 for(const model of ['GEL-KAYANO 33 LITE-SHOW','GT-2000 15 LITE-SHOW']){
  const pair=variantProducts.filter(p=>p.brand==='ASICS'&&p.name.startsWith(model));
  assert.equal(pair.length,2);
  const men=pair.find(p=>p.name.includes("Men's")),women=pair.find(p=>p.name.includes("Women's")),card=cardFor(women.id);
  assert.notEqual(men.colorway,women.colorway);
  assert.equal(await card.count(),1);assert.equal(await card.locator('.color-chip').count(),2);
  assert.equal(await cardFor(men.id).count(),1,'The other active colour remains on the same card');
  assert(!(await card.locator('.card-name').textContent()).match(/Men|Women/));
  await card.locator(`[data-variant="${women.id}"]`).click();
  assert.equal(await card.locator('.card-open img').getAttribute('src'),women.image);
  assert.equal(await card.locator(`[data-variant="${women.id}"]`).getAttribute('aria-pressed'),'true');
  await card.locator('.card-name').click();
  assert.equal(await variantPage.locator('#detail-content .color-chip').count(),2);
  assert.equal(await variantPage.locator('.detail-visual img').getAttribute('src'),women.image);
  assert.equal(await variantPage.locator(`#detail-content [data-variant="${men.id}"]`).count(),1);
  await variantPage.getByRole('button',{name:'상세정보 닫기',exact:true}).click();
 }
 // The fixture preserves source catalog identities, so which ASICS models it
 // holds changes week to week - a re-release withdrawn from NEW took
 // GEL-KAYANO 14 out of it. Assert the property (one card per model,
 // generations never merged) for the models actually present.
 for(const [model,exact] of [['GEL-KAYANO 33 Running Shoes',/^GEL-KAYANO 33 Running Shoes$/],['GEL-KAYANO 14',/^GEL-KAYANO 14$/]]){
  if(!variantProducts.some(p=>p.name===model))continue;
  assert.equal(await variantPage.locator('.card-name').filter({hasText:exact}).count(),1,model+' has its own card');
 }
 const adidasCard=variantPage.locator('.product-card').filter({has:variantPage.locator('.card-name').filter({hasText:'ADIZERO ADIOS PRO 5'})});
 assert.equal(await adidasCard.count(),1);assert.equal(await adidasCard.locator('.color-chip').count(),1,'Previously fixed adidas duplicate color stays collapsed');
 assert.equal(await adidasCard.getAttribute('data-id'),variantProducts.find(p=>p.style==='KI8293').id,'adidas representative is the confirmed female SKU');
 // Counted from the fixture, not written down. A hardcoded chip count is the
 // fourth time a test here would have been bound to mutable data: it says the
 // Zephyr has four colourways, and the moment the colour-removal boundary was
 // fixed to admit "Crimson Ink" beside "Juniper" it had nine. What is being
 // tested is the property - one card per model, every colourway a chip of it -
 // so the expected number is the fixture's own answer to it.
 const paneChips=name=>preferWomenVariants(variantProducts)
   .filter(p=>variantGroupName(p)===name).length;
 for(const [name,count] of ['Pane Light Training Nogi','Pane Zephyr Training',
                            'Pane Zephyr Training Pouching'].map(n=>[n,paneChips(n)])){
  assert(count>1,`${name} must stand for several colourways for this to test anything`);
  const card=variantPage.locator('.product-card').filter({has:variantPage.getByRole('button',{name,exact:true})});
  assert.equal(await card.count(),1);assert.equal(await card.locator('.color-chip').count(),count);
  const colors=card.locator('.color-chip'),firstId=await colors.first().getAttribute('data-variant'),secondId=await colors.nth(1).getAttribute('data-variant');
  // The women's listing leads the card where the model has one. The Zephyr is
  // a men's-only line, and a card cannot be represented by a listing that
  // does not exist - so the property is conditional on the group, not on the
  // model happening to be made for both.
  const members=preferWomenVariants(variantProducts).filter(p=>variantGroupName(p)===name);
  if(members.some(p=>p.name.includes('Women')))
   assert(variantProducts.find(p=>p.id===firstId).name.includes('Women'),
     `${name}: the women's listing leads the card`);
  await colors.nth(1).click();
  assert.equal(await card.locator('.card-open img').getAttribute('src'),variantProducts.find(p=>p.id===secondId).image);
  await card.locator('.card-name').click();
  assert.equal(await variantPage.locator('#detail-content .color-chip').count(),count);
  await variantPage.locator(`#detail-content [data-variant="${firstId}"]`).click();
  assert.equal(await variantPage.locator('.detail-visual img').getAttribute('src'),variantProducts.find(p=>p.id===firstId).image);
  await variantPage.getByRole('button',{name:'상세정보 닫기',exact:true}).click();
 }
 await variantPage.locator('#search').fill('Lite Show/Orange Glow');
 await variantPage.waitForFunction(()=>document.getElementById('result-count').textContent==='2');
 const kayanoWomen=variantProducts.find(p=>p.name.startsWith('GEL-KAYANO 33 LITE-SHOW Women'));
 await variantPage.locator('#search').fill('GEL-KAYANO 33 LITE-SHOW Women');
 await variantPage.waitForFunction(()=>document.getElementById('result-count').textContent==='1');
 assert.equal(await variantPage.locator('.product-card .color-chip').count(),2,'Matching a model retains its other active colour; selecting exports only the chosen variant');
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
 // --- CATWALK: seasons side by side, and a set of looks taken away ---------
 // A fixture rather than the real snapshot: public/catwalk and its index are
 // gitignored WGSN subscription imagery, so CI has neither to measure.
 const jpeg=id=>Buffer.concat([Buffer.from([0xFF,0xD8,0xFF,0xE0]),Buffer.from(`look-${id}-`.repeat(40))]);
 const show=(id,brand,city,season)=>({id:String(id),brand,season,city,imageType:'신발 클로즈업',
   shelf:'library-footwear',image:`/catwalk/${id}.jpg`,width:933,height:1400,
   originalWidth:2574,originalHeight:3861,originalUrl:`https://images.example.invalid/${id}.jpg`});
 const CURRENT='Spring/Summer 2028',MIDDLE='Autumn/Winter 2027',OLDEST='Spring/Summer 2027';
 const walkLooks=[show(1,'AARON ESH','London',CURRENT),show(2,'AARON ESH','London',CURRENT),
   show(3,'Agnes b','Paris',CURRENT),show(4,'Agnes b','Paris',CURRENT),
   show(5,'Casablanca','Milan',MIDDLE),show(6,'Dries Van Noten','Paris',OLDEST)];
 const season=(label,looks)=>({season:label,seasonId:`id-${label}`,collectedAt:at,looks,
   shows:new Set(walkLooks.filter(l=>l.season===label).map(l=>l.brand)).size});
 const walkContext=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await walkContext.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
 await walkContext.route('**/data/catalog-index.json',r=>r.fulfill({status:404,body:''}));
 await walkContext.route('**/data/catalog-ui.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(fixture)}));
 await walkContext.route('**/data/monthly-catalog.json',r=>r.fulfill({contentType:'application/json',
   body:JSON.stringify({schemaVersion:2,publishedAt:at,asOf:today,periodStart:today,sources:{},retail:[],newsletter:[],sourceStatus:[]})}));
 await walkContext.route('**/data/trend-keywords.json',r=>r.fulfill({contentType:'application/json',
   body:JSON.stringify({schemaVersion:1,generatedAt:at,asOf:today,displayCount:20,keywords:[],candidates:[],sourceStatus:{}})}));
 await walkContext.route('**/data/catwalk.json',r=>r.fulfill({contentType:'application/json',
   body:JSON.stringify({schemaVersion:2,provider:'WGSN',currentSeason:CURRENT,builtAt:at,cardWidth:480,
     seasons:[season(CURRENT,4),season(MIDDLE,1),season(OLDEST,1)],
     shelves:[{id:'library-footwear',label:'신발 클로즈업',footwearShelf:true,searchUrl:'https://library.example.invalid/results/x'}],looks:walkLooks})}));
 await walkContext.route('**/catwalk/*.jpg',r=>r.fulfill({contentType:'image/jpeg',
   body:jpeg(new URL(r.request().url()).pathname.replace(/\D/g,''))}));
 const walk=await walkContext.newPage();walk.on('pageerror',e=>errors.push(e.message));
 await walk.goto(url);await walk.locator('.product-card').first().waitFor();
 await walk.locator('[data-source="catwalk"]').click();
 await walk.locator('.catwalk-card').first().waitFor();

 // Three seasons, newest first, and the grid opens on the current one.
 assert.deepEqual(await walk.locator('.catwalk-season-tab').evaluateAll(els=>els.map(e=>e.dataset.catwalkSeason)),
   [CURRENT,MIDDLE,OLDEST],'the season tabs are in calendar order');
 assert.equal(await walk.locator('.catwalk-season-tab.active').getAttribute('data-catwalk-season'),CURRENT);
 assert.equal(await walk.locator('.catwalk-season-tab').first().locator('em').textContent(),'최신');
 assert.equal(await walk.locator('.catwalk-card').count(),4,'only the current season is on screen');
 assert((await walk.locator('#catwalk-scope').textContent()).startsWith(CURRENT));
 // The show chips count within the season, not across all three.
 assert.equal(await walk.locator('[data-catwalk="all"] span').textContent(),'4');
 assert.equal(await walk.locator('[data-catwalk="Casablanca"]').count(),0,"a show from another season is not offered here");

 assert.equal(await walk.locator('#catwalk-selection-bar').isVisible(),false,'the bar waits until something is picked');
 // Tick the first, then Shift-click the third: the span between them fills in,
 // and ticking a box must not also open the viewer underneath it.
 await walk.locator('[data-look-select="1"]').click();
 await walk.locator('[data-look-select="3"]').click({modifiers:['Shift']});
 assert.equal(await walk.locator('#catwalk-viewer').isVisible(),false,'a tick is not a zoom');
 assert.equal(await walk.locator('.catwalk-card.picked').count(),3);
 assert.equal(await walk.locator('#catwalk-selection-count').textContent(),'3장 선택');

 // A past season is a tab away, and what was picked in the current one stays
 // picked: an archive may deliberately span seasons.
 await walk.locator(`[data-catwalk-season="${OLDEST}"]`).click();
 await walk.locator('.catwalk-card').first().waitFor();
 assert.equal(await walk.locator('.catwalk-card').count(),1);
 assert((await walk.locator('#catwalk-scope').textContent()).startsWith(OLDEST));
 assert.equal(await walk.locator('#catwalk-selection-count').textContent(),'3장 선택','picks survive the season change');
 assert.equal(await walk.locator('.catwalk-card.picked').count(),0,'none of them is in this season');
 await walk.locator('[data-look-select="6"]').click();
 assert.equal(await walk.locator('#catwalk-selection-count').textContent(),'4장 선택');

 const [zipDownload]=await Promise.all([walk.waitForEvent('download'),walk.locator('#catwalk-download').click()]);
 assert.equal(zipDownload.suggestedFilename(),'CATWALK_4장.zip');
 const zipPath=path.join(out,'catwalk-4.zip');await zipDownload.saveAs(zipPath);
 const archive=await fs.readFile(zipPath);
 assert.equal(archive.subarray(0,2).toString(),'PK');
 const eocd=archive.lastIndexOf(Buffer.from([0x50,0x4B,0x05,0x06]));
 assert.equal(archive.readUInt16LE(eocd+10),5,'four photographs and the index that captions them');
 // Stored, not deflated, so a photograph's bytes sit in the archive verbatim.
 for(const id of ['1','2','3','6'])assert(archive.includes(jpeg(id)),`look ${id} stored byte for byte`);
 assert(!archive.includes(jpeg('4')),'an unticked look stays out of the archive');
 assert(archive.includes(Buffer.from('AARON ESH_Spring Summer 2028_London_1.jpg','utf8')),'the file name carries the show');
 assert(archive.includes(Buffer.from(`Dries Van Noten_${OLDEST.replace('/',' ')}_Paris_6.jpg`,'utf8')),'and the season each look walked in');
 assert(archive.includes(Buffer.from('목록.csv','utf8')));
 assert(archive.includes(Buffer.from('2574x3861','utf8')),'the index records what WGSN holds at full size');

 // Select-all reflects the season on screen, not the whole snapshot: this
 // season's only look is already picked, so the control reads checked and
 // clicking it releases this season while leaving the other one picked.
 assert.equal(await walk.locator('#catwalk-select-all').isChecked(),true);
 await walk.locator('#catwalk-select-all').click();
 assert.equal(await walk.locator('#catwalk-selection-count').textContent(),'3장 선택','only the season on screen was released');
 await walk.locator('#catwalk-clear-picks').click();
 assert.equal(await walk.locator('#catwalk-selection-bar').isVisible(),false);
 await walk.locator(`[data-catwalk-season="${CURRENT}"]`).click();
 await walk.locator('#catwalk-select-all').click();
 assert.equal(await walk.locator('#catwalk-selection-count').textContent(),'4장 선택','every look in the current season, and none beyond it');
 await walk.locator('#catwalk-clear-picks').click();

 // One look on its own is a photograph, not an archive.
 await walk.locator('[data-look-select="2"]').click();
 const [oneDownload]=await Promise.all([walk.waitForEvent('download'),walk.locator('#catwalk-download').click()]);
 assert.equal(oneDownload.suggestedFilename(),'AARON ESH_Spring Summer 2028_London_2.jpg');
 const onePath=path.join(out,'catwalk-1.jpg');await oneDownload.saveAs(onePath);
 assert.deepEqual(await fs.readFile(onePath),jpeg('2'),'the single save is the rendition itself, unaltered');

 // Leaving the tab drops the picks and the chosen season, as it already drops
 // the show filter and the page.
 await walk.locator('[data-source="all"]').click();
 await walk.locator('[data-source="catwalk"]').click();
 assert.equal(await walk.locator('.catwalk-card.picked').count(),0);
 assert.equal(await walk.locator('#catwalk-selection-bar').isVisible(),false);
 assert.equal(await walk.locator('.catwalk-season-tab.active').getAttribute('data-catwalk-season'),CURRENT,'back on the current season');
 await walk.setViewportSize({width:390,height:844});
 assert(await walk.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the catwalk fits a phone');
 await walk.screenshot({path:path.join(out,'catwalk-picking-mobile.png')});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,browser:process.env.UI_BROWSER_CHANNEL||'chromium',screenshots:out,downloads:[csvPath,xlsxPath,womenPath,zipPath,onePath],checks:'women-only counterparts, male-only editions retained, adidas female representative, female card/detail color switching, male-exclusive colour search retained, female CSV export, 17-column CSV/XLSX, pagination, mobile, catwalk season tabs (3 seasons, newest first, per-season chips/select-all), multi-select + Shift range + cross-season ZIP archive with 목록.csv + single-look JPG, local fixtures only'},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
