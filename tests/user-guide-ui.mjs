import {chromium} from 'playwright';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve('public'),out=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-guide-'));
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.json':'application/json','.woff2':'font/woff2','.pdf':'application/pdf'};
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));assert(file.startsWith(root+path.sep));res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:950},acceptDownloads:true}),page=await context.newPage();
 await context.route('**/data/*.json',r=>r.fulfill({status:404,body:''}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const link=page.locator('#user-guide-open');assert.equal(await link.innerText(),'사용설명서');
 for(const width of [320,390,640,900,1280,1920]){await page.setViewportSize({width,height:950});assert(await link.isVisible());const bounds=await link.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,'Guide link overflow '+width);assert(await page.locator('.topbar').evaluate(el=>el.scrollWidth<=innerWidth),'Header overflow '+width);}
 await page.setViewportSize({width:1280,height:950});await page.screenshot({path:path.join(out,'site-header.png')});
 const opened=context.waitForEvent('page');await link.click();const guide=await opened;await guide.waitForLoadState();assert.equal(await guide.locator('.page').count(),3);assert.equal(await guide.locator('.tab-path').count(),7);assert.equal(await page.locator('#user-guide-open').count(),1);
 const download=guide.waitForEvent('download');await guide.locator('#guide-pdf-download').click();const file=await download,pdf=path.join(out,'downloaded-guide.pdf');await file.saveAs(pdf);
 const downloaded=await fs.readFile(pdf),expected=await fs.readFile('public/guides/shoes-user-guide.pdf');assert.equal(downloaded.subarray(0,5).toString(),'%PDF-');assert.equal(createHash('sha256').update(downloaded).digest('hex'),createHash('sha256').update(expected).digest('hex'));
 console.log(JSON.stringify({passed:true,pdf,headerScreenshot:path.join(out,'site-header.png'),checks:'Header at 320–1920px; separate-tab guide; 3 pages and 7 tab paths; actual PDF download matches deployed artifact'},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
