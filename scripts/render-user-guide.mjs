import {chromium} from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

// Input screenshots contain internal research imagery. Reports and deployment
// copies stay ignored; only the generator and prose belong in the public repo.
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:1200}});
 await page.goto(pathToFileURL(path.resolve('reports/shoes-user-guide.html')).href);
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('.page').count(),3);
 assert.equal(await page.locator('.tab-path').count(),7);
 assert.equal(await page.locator('.shot').count(),6);
 assert(await page.locator('.shot img').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0)));
 assert.equal(await page.locator('#guide-pdf-download').getAttribute('href'),'./shoes-user-guide.pdf');
 assert(!/합니다|하세요|됩니다/.test(await page.locator('.page').allInnerTexts().then(xs=>xs.join('\n'))),'Guide prose must use nominal endings');
 for(const row of await page.locator('.page').evaluateAll(xs=>xs.map(x=>({id:x.id,height:x.clientHeight,scroll:x.scrollHeight}))))assert(row.scroll<=row.height+2,'Guide overflow: '+row.id);
 for(let i=0;i<3;i++)await page.locator('.page').nth(i).screenshot({path:`reports/shoes-user-guide-a4-page-${i+1}.png`});
 await page.pdf({path:'reports/shoes-user-guide.pdf',preferCSSPageSize:true,printBackground:true});
 const check=spawnSync('python',['-X','utf8','-c','import pymupdf; d=pymupdf.open("reports/shoes-user-guide.pdf"); assert len(d)==3; assert all(abs(p.rect.width-595.3)<1 and abs(p.rect.height-841.9)<1 for p in d); [p.get_pixmap(matrix=pymupdf.Matrix(1.5,1.5)).save("reports/shoes-user-guide-a4-print-"+str(i+1)+".png") for i,p in enumerate(d)]'],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
 await page.locator('.shot').first().click();assert(await page.locator('#zoom').isVisible());await page.locator('#close').click();
 await page.setViewportSize({width:390,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Guide mobile overflow');
 await fs.mkdir('public/guides',{recursive:true});
 for(const extension of ['html','pdf'])await fs.copyFile(`reports/shoes-user-guide.${extension}`,`public/guides/shoes-user-guide.${extension}`);
 console.log('Guide ready: A4 portrait, 3 pages, 7 tab paths, 6 enlargable screenshots, nominal prose, PDF and private deployment copies verified.');
}finally{await browser.close();}
