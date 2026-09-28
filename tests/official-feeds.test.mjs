import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseNewBalanceCalendar,newBalanceProductDetails,NEW_BALANCE_CALENDAR} from '../scripts/new-balance-feed.mjs';
import {collectOfficialEvidence} from '../scripts/collect-evidence.mjs';
const now=new Date('2026-09-28T05:00:00Z');
test('New Balance dates require explicit year and are consumed per product; restocks and performance-only products are excluded',()=>{
 const page=`## Upcoming Launches
Coming soon
1 Oct 2026
[991](https://www.newbalance.com/pd/991/ONE.html)
[Undated](https://www.newbalance.com/pd/undated/NO.html)
Coming soon
1 Oct
[No year](https://www.newbalance.com/pd/no-year/YEAR.html)
## In-Stock Launches
Back in Stock
2 Sep 2026
[530](https://www.newbalance.com/pd/530/RESTOCK.html)
[Shop now](https://www.newbalance.com/pd/530/RESTOCK.html)
New
17 Sep 2026
[Made in UK 991V1 Luxe Suede](https://www.newbalance.com/pd/991/M991.html)
[Shop now](https://www.newbalance.com/pd/991/M991.html)
New
15 Sep 2026
[Maxey Basketball](https://www.newbalance.com/pd/maxey/MAX.html)
## More to explore
20 Sep 2026
[Recommended](https://www.newbalance.com/pd/recommended/OTHER.html)`;
 const rows=parseNewBalanceCalendar(page,NEW_BALANCE_CALENDAR,now.toISOString());
 assert.deepEqual(rows.map(p=>p.releaseDate),['2026-10-01','2026-09-17']);
 assert.deepEqual(rows.map(p=>p.name),['991','Made in UK 991V1 Luxe Suede']);
 assert(rows.every(p=>p.dateEvidence.field==='explicit calendar day/month/year'));
});
test('New Balance exact PDP title, SKU image and sneaker structure are required',()=>{
 const candidate={name:'Made in UK 991V1 Luxe Suede',url:'https://www.newbalance.com/pd/991/M991.html'};
 const page='# Made in UK 991V1 Luxe Suede\n$269.99\n![Product](https://nb.scene7.com/is/image/NB/m991br1_nb_02_i)\nColor: COCOA with CASTLEWALL\nExcluded from promotions\nPremium suede upper with ENCAP and ABZORB cushioning.\n### Material\n* Suede upper\nStyle #: M991BR1\n';
 assert.equal(newBalanceProductDetails(page,candidate,now.toISOString()).style,'M991BR1');
 assert.equal(newBalanceProductDetails(page.replace('nb_02_i','logo').replace('m991br1','other'),candidate),null);
 assert.equal(newBalanceProductDetails(page,{...candidate,name:'Other shoe'}),null);
 assert.equal(newBalanceProductDetails(page.replace('Premium suede upper','A formal aesthetic loafer'),candidate),null);
});
test('default evidence verification does not stop at 100 and missing identities stay private',async()=>{
 const products=Array.from({length:121},(_,i)=>({id:'candidate-'+i,brand:'Nike',name:'Retro running sneaker',style:`TEST${i}`,url:`https://www.nike.com/t/test/TEST${i}`}));
 products.push({id:'unidentifiable',brand:'Nike',name:'New sneaker',url:'https://www.nike.com/t/no-identity'});
 const result=await collectOfficialEvidence({products,now,log:()=>{},read:async url=>{
  if(url.includes('salomon.com'))throw Error('Fixture has no Salomon calendar');
  const style=url.split('/').pop();assert.notEqual(style,'no-identity');
  return `# Retro running sneaker\n${style} releases on September 1, 2026.\n![Retro running sneaker](https://static.nike.com/${style}.jpg)\nRetro lifestyle sneaker with breathable mesh upper and lightweight cushioning.`;
 }});
 assert.equal(result.products.length,121);assert(result.diagnostics.some(d=>d.id==='unidentifiable'&&d.reason==='exact-product-date-identity-required'));
});
test('weekly manual force is explicit and does not change scheduled retry guards',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/weekly-update.yml',import.meta.url),'utf8');
 assert.match(workflow,/force:[\s\S]*?type: boolean[\s\S]*?default: false/);
 assert.match(workflow,/github\.event_name.*workflow_dispatch.*inputs\.force/);
 assert.match(workflow,/npm run weekly -- --only-if-stale/);
 assert.match(workflow,/cron: '0 23 \* \* 6'/);
});
