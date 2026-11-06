import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {adminDb} from './helpers/admin-db.mjs';
import {hashPassword,sha256,ADMIN_COOKIE} from '../server/admin-auth.mjs';
import {onRequest as middleware} from '../functions/_middleware.js';
import {onRequest as overlay} from '../functions/api/visual-classifications.js';

test('owner review UI: collapsed loading, 20 lazy images, safe text, filtering, save, stale conflict and mobile layout',{skip:process.env.VISUAL_ADMIN_UI_BROWSER!=='1'},async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const db=adminDb();t.after(()=>db.sqlite.close());
 const origin='https://visual-admin.test',passwordHash=await hashPassword('owner-browser-fixture-12487923'),token='a'.repeat(43)+'.'+await sha256(passwordHash);
 db.sqlite.prepare('INSERT INTO admin_sessions VALUES (?,?,?)').run(await sha256(token),'csrf-browser',Math.floor(Date.now()/1000)+3600);
 const hash=n=>n.toString(16).padStart(64,'0');
 for(let n=1;n<=25;n++){
  const row={imageHash:hash(n),modelVersion:'clip-ui-v1',category:'chunky',confidence:.82,margin:.3,alternatives:[{category:'boot',score:.18}],thumbnail:`/images/${hash(n)}.png`,status:'review-needed',products:[{id:'p'+n,brand:n%2?'Nike':'PUMA',name:'Photo <img src=x onerror="window.injected=true">',url:'https://example.com/p',modelKey:'m'+n}]};
  db.sqlite.prepare('INSERT INTO visual_classification_candidates VALUES (?,?,?,?)').run(hash(n),row.modelVersion,JSON.stringify(row),'2026-11-06');
 }
 db.sqlite.prepare('INSERT INTO visual_classification_metadata VALUES (1,?,?)').run(JSON.stringify({version:'clip-ui-v1',encoder:'CLIP',validated:false}),'2026-11-06');
 const env={ADMIN_DB:db,ADMIN_PASSWORD_HASH:passwordHash,INTERNAL_SITE_PASSWORD:'team-ui',ASSETS:{async fetch(request){
  const route=new URL(request.url).pathname;
  if(route.startsWith('/images/'))return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9d8AAAAASUVORK5CYII=','base64'),{headers:{'Content-Type':'image/png'}});
  const file=route==='/admin/'?'/admin/index.html':route,mime=file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html';
  try{return new Response(await fs.readFile(new URL('../public'+file,import.meta.url)),{headers:{'Content-Type':mime}});}catch{return new Response(null,{status:404});}
 }}};
 const context=await browser.newContext();await context.addCookies([{name:ADMIN_COOKIE,value:token,url:origin,secure:true,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let queueRequests=0;
 await context.route(origin+'/**',async route=>{
  const req=route.request();if(req.url().includes('/api/admin/visual-classifications'))queueRequests++;
  const request=new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(req.postData()?{body:req.postData()}:{})});
  const response=await middleware({request,env,next:()=>overlay({request,env})});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto(origin+'/admin/');await page.locator('#message').filter({hasText:'관리자 전용 인증'}).waitFor();assert.equal(queueRequests,0);assert.equal(await page.locator('#visual-panel').getAttribute('open'),null);
 await page.locator('#visual-panel>summary').click();await page.locator('.visual-card').nth(19).waitFor();assert.equal(await page.locator('.visual-card').count(),20);assert.equal(await page.locator('.visual-card img[loading=lazy]').count(),20);
 assert.equal(await page.locator('.visual-card select option').first().count(),1);assert.equal(await page.locator('.visual-card select').first().locator('option').count(),9);
 assert((await page.locator('.visual-card').first().innerText()).includes('<img src=x'));assert.equal(await page.evaluate(()=>window.injected),undefined);
 await page.locator('#visual-next').click();await page.waitForFunction(()=>document.querySelectorAll('.visual-card').length===5);
 await page.locator('#visual-brand').selectOption('Nike');await page.waitForFunction(()=>document.querySelectorAll('.visual-card').length===13);
 await page.locator('#visual-category-0').selectOption('boot');await page.locator('[data-visual-index="0"][data-visual-action="approved"]').click();await page.getByText('검수 결과를 저장했습니다. 직원 화면을 다시 불러오면 반영됩니다.',{exact:true}).waitFor();
 const publicData=await page.evaluate(async()=>{const response=await fetch('/api/visual-classifications',{headers:{Authorization:'Basic '+btoa('team:team-ui')}});return response.json();});assert.deepEqual(publicData.records,[{imageHash:hash(1),category:'boot',status:'approved'}]);
 await page.locator('#visual-status').selectOption('approved');await page.waitForFunction(()=>document.querySelectorAll('.visual-card').length===1);
 // A second owner updates after the page was loaded.
 db.sqlite.prepare('UPDATE visual_classification_reviews SET revision=revision+1, category=? WHERE image_hash=?').run('sandal',hash(1));
 await page.locator('[data-visual-action="excluded"]').click();await page.getByText('모델 또는 검수 결과가 변경되었습니다. 목록을 새로고침해 주세요.',{exact:true}).waitFor();assert.equal(db.sqlite.prepare('SELECT category FROM visual_classification_reviews').get().category,'sandal');
 await page.locator('[data-visual-action="excluded"]').click();await page.getByText('검수 결과를 저장했습니다. 직원 화면을 다시 불러오면 반영됩니다.',{exact:true}).waitFor();
 await page.locator('#visual-status').selectOption('excluded');await page.waitForFunction(()=>document.querySelectorAll('.visual-card').length===1);
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);}
 assert.deepEqual(errors,[]);
});
