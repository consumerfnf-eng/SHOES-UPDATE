import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareUggDetailReplay} from '../scripts/prepare-ugg-detail-replay.mjs';
import {UGG_NEW_SHOES_URL as root, UGG_BROWSER_TRANSPORT as transport, UGG_BROWSER_EXTRACTION as extraction} from '../scripts/collect-ugg-new.mjs';
import {auditBrand} from '../scripts/admin-monitor-runner.mjs';
const now = new Date('2026-11-05T08:30:00.000Z');
const checkedAt = '2026-11-05T08:20:00.000Z';
const next = 'https://www.ugg.com/on/demandware.store/Sites-UGG-US-Site/en_US/Search-UpdateGrid?cgid=new-arrivals&prefn1=type&prefv1=shoes&start=1&sz=1';
const pdp = 'https://www.ugg.com/women-casuals-sneakers/lowmel/1144032.html?dwvar_1144032_color=DYR';
const img = (model, color) => `https://dms.deckers.com/ugg/image/upload/t_product-medium-wp/v1/${model}-${color}_1.png`;
const photo = img('1144032', 'DYR');
const card = (id, name, url, image, audience) => `<div class="product" data-pid="${id}"><div class="image-container" data-product-id="${id}"><a class="image-link" href="${url}"><img src="${image}"></a></div><div class="tile-product-name"><a class="pdp-link" href="${url}"><span class="product-group">${audience}</span>${name}</a></div></div>`;
const receipt = (url, html, extra = {}) => ({brand:'UGG',url,html,checkedAt,transport,extraction,...extra});
function inputs() {
  const own = 'https://www.ugg.com/men-shoes-sneakers/own-sneaker/1170910.html?dwvar_1170910_color=DCP';
  return [
    receipt(root, `<main id="main-content"><h1>New Arrivals</h1><div class="search-results-count">2 Results</div><button id="producttype-shoes-selected"><span class="selected">Shoes</span></button><div class="product-grid">${card('199727000001','Own Sneaker',own,img('1170910','DCP'),"Men's")}<div class="grid-footer"><div class="viewed-count">You have viewed 1 of 2 products.</div><div class="show-more"><button data-url="${next}">Load More</button></div></div></div></main>`),
    receipt(next, `<body>${card('199727000002','Lowmel',pdp,photo,"Women's")}<div class="grid-footer"></div></body>`, {parentUrl:root}),
    receipt(pdp, `<main><div class="product-detail" data-pid="1144032"><h1>Women's Lowmel</h1><div class="card"><button aria-expanded="true"><h2>Details</h2></button><div id="description-info">This sneaker has a sugarcane EVA outsole. Item No. 1144032</div></div><div class="primary-images"><img src="${photo}"></div></div></main>`),
  ];
}
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ugg-replay-test-'));
  const details = path.join(dir, 'ugg-detail-dom');fs.mkdirSync(details);
  const records = inputs();
  const files = ['manual-ugg-browser-dom.json','manual-ugg-next-browser-dom.json','ugg-detail-dom/8.json'];
  files.forEach((file, i) => fs.writeFileSync(path.join(dir,file),JSON.stringify(records[i])));
  t.after(() => {
    for (const file of [...files,'manual-ugg-products.json']) {const target=path.join(dir,file);if(fs.existsSync(target))fs.unlinkSync(target);}
    fs.rmdirSync(details);fs.rmdirSync(dir);
  });
  return {dir,records};
}
test('replay writes verified products with both exact original receipt arrays',async t=>{
  const {dir,records}=setup(t);
  const summary=await prepareUggDetailReplay({reportDir:dir,now});
  assert.equal(summary.products,2);assert.equal(summary.complete,true);assert.equal(summary.detailRejected,0);
  const report=JSON.parse(fs.readFileSync(summary.output));
  assert.deepEqual(report.sourceRecords.map(r=>r.record),records.slice(0,2));
  assert.deepEqual(report.detailSourceRecords.map(r=>r.record),records.slice(2));
  assert.equal(report.products.find(p=>p.style==='1144032-DYR').arrivalEvidence.verifiedAt,checkedAt);
});
test('failed listing replay preserves the previous file, while rejected optional PDP stays held',async t=>{
  const {dir,records}=setup(t),output=path.join(dir,'manual-ugg-products.json');
  records[2].html=records[2].html.replace('aria-expanded="true"','aria-expanded="false"');
  fs.writeFileSync(path.join(dir,'ugg-detail-dom/8.json'),JSON.stringify(records[2]));
  const summary=await prepareUggDetailReplay({reportDir:dir,now});
  assert.equal(summary.products,1);assert.equal(summary.held,1);assert.equal(summary.complete,false);assert.equal(summary.detailRejected,1);
  const before=fs.readFileSync(output);
  records[0].html='<main>Incomplete</main>';fs.writeFileSync(path.join(dir,'manual-ugg-browser-dom.json'),JSON.stringify(records[0]));
  await assert.rejects(prepareUggDetailReplay({reportDir:dir,now}));assert.ok(fs.readFileSync(output).equals(before));
  assert.ok(!fs.readdirSync(dir).some(name=>name.endsWith('.tmp')));
});
test('runner reads the UGG detail directory and keeps the original PDP receipt offline',async t=>{
  const {dir,records}=setup(t);let collected;
  const stateDirectory=path.join(dir,'state');
  const report=await auditBrand('UGG',{stateDirectory,now,onCollected:async result=>{collected=result;},readHtml:async()=>{throw Error('unexpected network');}});
  assert.equal(report.verified,2);assert.equal(report.exhaustive,true);
  assert.deepEqual(collected.detailSourceRecords.map(r=>r.record),records.slice(2));
});
