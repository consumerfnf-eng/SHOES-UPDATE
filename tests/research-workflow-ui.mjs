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
 const products=['Nike','adidas'].map((brand,i)=>({id:'shoe-'+i,brand,name:'Retro Runner '+i,productType:'sneaker',category:'sneaker',style:'SKU-'+i,colorway:'White',releaseDate:today,dateEvidence:{verified:true,official:true,precision:'day',url:'https://example.org/release',verifiedAt:at},url:'https://example.org/'+i,image:'https://example.org/white.svg',presentation:{image:'https://example.org/white.svg',scale:1},sourceSignals:[],keywords:['Retro'],fit:[],popularity:{}}));
 const keywords=Array.from({length:15},(_,i)=>({keywordType:'style',id:'style-'+i,label:'키워드 '+(i+1),rank:i+1,productIds:['shoe-0','shoe-1']}));
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await context.route('**/data/catalog-index.json',r=>json(r,{schemaVersion:1,total:2,base:{schemaVersion:1,brands:products.map(p=>({name:p.brand,group:'SPORTS'})),keywords:[],styleTrendKeywords:{updated:at,items:keywords},products:[]},chunks:products.map((p,i)=>({url:'./data/fixture-'+i+'.json',count:1}))}));
 for(let i=0;i<2;i++)await context.route('**/data/fixture-'+i+'.json',r=>json(r,{products:[products[i]]}));
 await context.route('**/data/monthly-catalog.json',r=>json(r,{schemaVersion:2,retail:[],newsletter:[]}));
 await context.route('**/data/trend-keywords.json',r=>json(r,{keywords:[]}));
 const brief=JSON.parse(await fs.readFile('public/data/research-brief.json','utf8'));assert.equal(brief.ideas.length,5);
 await context.route('**/data/research-brief.json',r=>json(r,brief));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='2').catch(async e=>{console.log({errors,body:(await page.locator('body').innerText()).slice(0,1500),workers:page.workers().map(w=>w.url())});throw e;});
 assert.equal(page.workers().length,1,'The catalogue is actually prepared in the module worker');
 assert.equal(await page.locator('#keyword-list .keyword:visible').count(),15,'All 15 ranks are visible without expanding');
 await page.locator('#keyword-list .keyword-select').nth(14).click();assert.equal(await page.locator('#result-count').textContent(),'2');
 await page.locator('[data-source="brief"]').click();await page.locator('.brief-card').first().waitFor();
 assert.equal(await page.locator('.brief-card').count(),5);assert.equal(await page.locator('#brand-group-tabs').isVisible(),false);assert.equal(await page.locator('#product-grid').isVisible(),false);
 await page.locator('[data-brief-view="review"]').click();const metric=page.locator('[data-review-field="metric"]').first();await metric.fill('Same exposure, 7 days, preference rate');await metric.press('Tab');
 assert((await page.locator('#review-save-status').textContent()).includes('이 브라우저'));
 const downloaded=page.waitForEvent('download');await page.locator('#review-export').click();const backup=await downloaded;const backupData=await fs.readFile(await backup.path(),'utf8');assert(backupData.includes('Same exposure'));
 await page.reload();await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='2');await page.locator('[data-source="brief"]').click();await page.locator('.brief-card').first().waitFor();await page.locator('[data-brief-view="review"]').click();assert.equal(await metric.inputValue(),'Same exposure, 7 days, preference rate');
 const dl=page.waitForEvent('download');await page.locator('#brief-html').click();const exported=await dl;assert((await fs.readFile(await exported.path(),'utf8')).includes('SHOES 주간 기획 브리프'));
 for(const width of [1280,900,390]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal overflow at ${width}`);assert.equal(await page.locator('.source-tab:visible').count(),9);}
 assert.deepEqual(errors,[]);console.log('PASS: real module worker, all 15 visible keywords, TOP5 brief, source isolation, persistent review notes, JSON backup, HTML export and responsive menu');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
