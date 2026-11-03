import {chromium} from 'playwright';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {kstToday} from '../public/assets/catalog-view.mjs';
const root=path.resolve('public'),mime={'.html':'text/html','.mjs':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+path.sep))throw Error('path');res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/json'}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}}),today=kstToday(),at=new Date().toISOString();
 const json=(r,value)=>r.fulfill({contentType:'application/json',body:JSON.stringify(value)});
 const products=['Nike','adidas'].map((brand,i)=>({id:'shoe-'+i,brand,name:'Originals Retro Runner '+i,priceLabel:i?'99,000원':'199,000원',productType:'sneaker',category:'sneaker',style:'SKU-'+i,colorway:'White',releaseDate:today,dateEvidence:{verified:true,official:true,precision:'day',url:'https://example.org/release',verifiedAt:at},url:'https://example.org/'+i,image:'https://example.org/white.svg',presentation:{image:'https://example.org/white.svg',scale:1},sourceSignals:[],keywords:['Retro'],fit:[],popularity:{}}));
 const keywords=Array.from({length:15},(_,i)=>({keywordType:'style',id:'style-'+i,label:'키워드 '+(i+1),rank:i+1,productIds:['shoe-0','shoe-1']}));
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await context.route('**/data/catalog-index.json',r=>json(r,{schemaVersion:1,total:2,base:{schemaVersion:1,brands:products.map(p=>({name:p.brand,group:'SPORTS'})),keywords:[],styleTrendKeywords:{updated:at,items:keywords},products:[]},chunks:products.map((p,i)=>({url:'./data/fixture-'+i+'.json',count:1}))}));
 for(let i=0;i<2;i++)await context.route('**/data/fixture-'+i+'.json',r=>json(r,{products:[products[i]]}));
 await context.route('**/data/monthly-catalog.json',r=>json(r,{schemaVersion:2,retail:[],newsletter:[]}));
 await context.route('**/data/trend-keywords.json',r=>json(r,{keywords:[]}));
 await context.route('**/data/mlb-price-benchmark.json',r=>json(r,{products:[{style:'MLB-a',listPrice:99000},{style:'MLB-b',listPrice:149000},{style:'MLB-c',listPrice:199000}],sourceUrls:[],checkedAt:at}));
 const idea=(season,i)=>({id:'mock-'+season.toLowerCase()+'-'+i,season,title:'MLB '+season+' Item '+i,subtitle:'Sneaker direction',tags:['Mesh','Retro','MLB'],insight:'Independent season design hypothesis',preview:'/proposals/mock-'+season.toLowerCase()+'-'+i+'/preview.webp',download:'/proposals/mock-'+season.toLowerCase()+'-'+i+'/board.png',references:[],forecast:[],evidence:{officialModels:1,retailModels:1,articles:0,ranking:[],social:[],articleSources:[]}});
 const brief={schemaVersion:2,asOf:today,seasons:['27SS','27FW','28SS'],coverage:{officialRecords:2,retailRecords:0,newsletterRecords:0,rankItems:30,styleKeywords:15,socialKeywords:0,catwalkLooks:3,forecastReports:3,forecastPages:60},sourceDates:{keywords:at,social:at,forecast:today},method:'Published source evidence, not sales',ideas:['27SS','27FW','28SS'].flatMap(season=>Array.from({length:6},(_,i)=>idea(season,i))),seasonBoards:Object.fromEntries(['27SS','27FW','28SS'].map(season=>[season,{download:'/proposals/season-'+season.toLowerCase()+'/board.png'}]))};
 await context.route('**/data/season-proposals.json',r=>json(r,brief));
 await context.route('**/proposals/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="4800" height="2700"><rect width="4800" height="2700" fill="white"/></svg>'}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='2');
 assert.equal(page.workers().length,1,'Catalogue preparation still runs in the module worker');assert.equal(await page.locator('#keyword-list .keyword:visible').count(),15);
 await page.locator('#keyword-list .keyword-select').nth(14).click();assert.equal(await page.locator('#result-count').textContent(),'2');
 await page.locator('[data-source="analysis"]').click();await page.locator('[data-price-reference="MLB"]').waitFor();assert.equal(await page.locator('[data-price-brand]').count(),2);assert((await page.locator('#panel-brand').innerText()).includes('MLB보다 50,000원 저렴'));assert((await page.locator('#panel-brand').innerText()).includes('MLB보다 50,000원 높음'));assert.equal(await page.locator('.price-count-table').count(),0);assert.deepEqual(await page.locator('.price-brand-label strong').allTextContents(),['Adidas Originals','MLB','Nike']);
 const csvEvent=page.waitForEvent('download');await page.locator('#download-brand-prices').click();const csv=await fs.readFile(await(await csvEvent).path(),'utf8');assert(!csv.includes('상품 개수'));assert(!csv.includes('가격 확인 모델'));assert(csv.includes('149000'));assert.deepEqual(csv.split(/\r?\n/).slice(1).map(line=>line.split(',')[0].replace(/^"|"$/g,'')),['Adidas Originals','MLB','Nike']);
 for(const width of [1280,900,390]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Price chart does not overflow at '+width);assert(await page.locator('.price-bar-track').evaluateAll(bars=>bars.every(bar=>bar.getBoundingClientRect().width>50)));}
 await page.setViewportSize({width:1280,height:900});
 await page.locator('[data-source="brief"]').click();await page.locator('.season-proposal-card').first().waitFor();assert.equal(await page.locator('.season-proposal-card').count(),6);assert.equal(await page.locator('#brand-group-tabs').isVisible(),false);assert.equal(await page.locator('#review-panel').count(),0,'The old review board was removed');
 for(const season of ['27SS','27FW','28SS']){await page.locator('[data-proposal-season="'+season+'"]').click();assert.equal(await page.locator('.season-proposal-card').count(),6);assert((await page.locator('.season-proposal-card h3').first().textContent()).includes(season));}
 await page.locator('[data-proposal]').first().click();assert.equal(await page.locator('#proposal-viewer').isVisible(),true);await page.locator('#proposal-zoom').click();assert((await page.locator('#proposal-viewer-image').getAttribute('class')).includes('actual-size'));await page.keyboard.press('Escape');assert.equal(await page.locator('#proposal-viewer').isVisible(),false);
 const dl=page.waitForEvent('download');await page.locator('#proposal-season-download').click();const exported=await dl;assert(exported.suggestedFilename().includes('28SS-SEASON-4800'));
 for(const width of [1280,900,390]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow at '+width);assert.equal(await page.locator('.source-tab:visible').count(),9);}
 assert.deepEqual(errors,[]);console.log('PASS: compact module worker, all 15 visible keywords, 18 seasonal proposals, old brief removed, season-specific viewer/download, zoom/Escape and responsive navigation');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
