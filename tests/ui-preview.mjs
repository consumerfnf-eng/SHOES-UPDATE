// Read-only visual smoke test of the actual staged catalog, using installed browser fonts/images.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve('public'),out=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-live-preview-'));
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.UI_BROWSER_CHANNEL||(process.platform==='win32'?'chrome':undefined)});
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[],failed=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('requestfailed',request=>failed.push({url:request.url(),error:request.failure()?.errorText}));
  const start=performance.now();await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#product-grid').getAttribute('aria-busy')==='false');
  const shellMs=Math.round(performance.now()-start);await page.evaluate(()=>Promise.race([Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise(resolve=>setTimeout(resolve,10000))]));
  await page.screenshot({path:path.join(out,'desktop-actual.png')});
  const state=await page.evaluate(()=>({count:document.querySelector('#result-count').textContent,fonts:[...new Set([...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family))],loadedImages:[...document.images].filter(i=>i.complete&&i.naturalWidth>0).length}));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile-actual.png')});
  console.log(JSON.stringify({shellMs,...state,errors,failed,screenshots:[path.join(out,'desktop-actual.png'),path.join(out,'mobile-actual.png')]},null,2));
  if(errors.length)process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
