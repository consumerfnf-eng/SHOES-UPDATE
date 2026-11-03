import {chromium} from 'playwright';import {createServer} from 'node:http';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.resolve('public'),mime={'.html':'text/html','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+(new URL(req.url,'http://local').pathname==='/'?'/index.html':new URL(req.url,'http://local').pathname));assert(file.startsWith(root+path.sep));res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('.product-card').first().waitFor({timeout:60000});
 await page.locator('[data-source="brand"]').click();
 await page.locator('[data-brand-group="SPORTS"]').click();await page.waitForFunction(()=>document.querySelectorAll('.product-card').length>0);
 const sports=await page.locator('#result-count').innerText();
 assert(await page.locator('#brand-list input[data-brand="FILA China"]').count(),'FILA China appears separately');
 await page.locator('#brand-list input[data-brand="FILA China"]').check();
 await page.waitForFunction(()=>[...document.querySelectorAll('.product-card')].every(c=>c.dataset.brand==='FILA China')&&document.querySelectorAll('.product-card').length>0);
 const fila=await page.locator('#result-count').innerText();assert.equal(Number(fila.replaceAll(',','')),66,'Reviewed FILA design families');
 assert(await page.locator('.product-card .color-chip').count()>0,'FILA variants appear as colour chips');
 await page.locator('.product-card img').first().evaluate(img=>img.decode());
 await fs.mkdir('reports',{recursive:true});await page.locator('#product-grid').scrollIntoViewIfNeeded();await page.screenshot({path:'reports/fila-china-official-live-preview.png'});
 await page.locator('#brand-list input[data-brand="FILA China"]').uncheck();await page.locator('#brand-list input[data-brand="Alo"]').check();
 await page.waitForFunction(()=>[...document.querySelectorAll('.product-card')].every(c=>c.dataset.brand==='Alo')&&document.querySelectorAll('.product-card').length>0);
 const aloCount=await page.locator('#result-count').innerText(),aloNames=await page.locator('.card-name').allTextContents();assert(aloNames.some(n=>/Malibu Low Boot/.test(n)));assert(aloNames.some(n=>/Malibu Boot/.test(n)));assert(aloNames.some(n=>/Recovery Slipper/.test(n)));assert(aloNames.some(n=>/Sunset/.test(n)));assert(aloNames.some(n=>/Trail/.test(n)));
 assert.equal(aloNames.filter(n=>/Sunset/.test(n)).length,1,'Sunset colourways share one card');
 await page.locator('#product-grid').scrollIntoViewIfNeeded();await page.screenshot({path:'reports/alo-official-live-preview.png'});
 await page.locator('[data-brand-group="CASUAL"]').click();await page.waitForFunction(()=>document.querySelectorAll('.product-card').length>0);
 const casual=await page.locator('#result-count').innerText();assert(Number(casual.replaceAll(',',''))>0);
 assert.equal(await page.locator('.product-card[data-brand="FILA China"]').count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,sports,filaChina:fila,casual,alo:aloCount,aloNames,screenshot:path.resolve('reports/alo-official-live-preview.png')}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
