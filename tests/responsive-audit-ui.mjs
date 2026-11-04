import {chromium} from 'playwright';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('public'),mime={'.html':'text/html','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://local').pathname,file=path.resolve(root,'.'+(p==='/'?'/index.html':p));assert(file.startsWith(root+path.sep));res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),findings=[];
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
 await page.goto(url);await page.locator('.product-card').first().waitFor({timeout:60000});
 await fs.mkdir('reports',{recursive:true});
 for(const width of [320,390,460,768,1024,1440]){
  await page.setViewportSize({width,height:950});
  for(const source of await page.locator('.source-tab').evaluateAll(es=>es.filter(e=>!e.hidden).map(e=>e.dataset.source))){
   const tab=page.locator(`.source-tab[data-source="${source}"]`);if(!await tab.isVisible())continue;
   const started=performance.now();await tab.click();await page.waitForTimeout(50);console.log(JSON.stringify({width,source,transitionMs:Math.round(performance.now()-started)}));
   const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   if(overflow.scroll>width+2)findings.push({width,source,...overflow});
  }
  await page.locator('[data-source="brand"]').click();await page.locator('.card-name').first().click();
  const actions=page.locator('#detail-dialog .detail-actions');await actions.waitFor();
  const buttons=await actions.locator('a,button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {text:e.textContent,width:r.width,height:r.height,scroll:e.scrollWidth,client:e.clientWidth,inside:r.left>=p.left-1&&r.right<=p.right+1,nowrap:getComputedStyle(e).whiteSpace};}));
  for(const b of buttons){assert(b.inside,JSON.stringify({width,b}));assert(b.height>=44&&b.height<70,JSON.stringify({width,b}));assert(b.scroll<=b.client+1,JSON.stringify({width,b}));assert.equal(b.nowrap,'nowrap');}
  if(width===390||width===1440)await page.locator('#detail-dialog').screenshot({path:`reports/detail-ui-fixed-${width}.png`});
  await page.locator('#detail-save').click();await page.waitForFunction(()=>document.querySelector('#detail-save').textContent.includes('저장됨'));
  await page.locator('#detail-save').click();await page.locator('#detail-select').click();await page.waitForFunction(()=>document.querySelector('#detail-select').textContent.includes('선택 해제'));
  await page.locator('#detail-select').click();await page.locator('[data-close="detail-dialog"]').click();
 }
 console.log(JSON.stringify({findings,errors},null,2));assert.equal(findings.length,0,'Page horizontal overflow');assert.equal(errors.length,0,'Runtime errors');
}finally{await browser.close();await new Promise(r=>server.close(r));}
