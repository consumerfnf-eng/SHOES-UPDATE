import test from 'node:test';
import assert from 'node:assert/strict';
import {TOMFORD_OFFICIAL_SOURCES as sources,parseTomFordOfficialPage,collectTomFordOfficial} from '../scripts/collect-tomford-official.mjs';
import {officialEvidenceFor} from '../scripts/curation.mjs';
import {hasArrivalEvidence} from '../public/assets/publication-window.mjs';

const at='2026-11-05T06:00:00.000Z',origin='https://www.tomfordfashion.com';
const source=i=>sources[i];
const category=i=>i?'women-shoes-sneakers':'men-shoes-sneakers';
const next=(start,i=0)=>`${origin}/on/demandware.store/Sites-tomford-Site/en_US/Search-UpdateGrid?cgid=${category(i)}&start=${start}&sz=2`;
const pid=n=>`J1644-LCL457N-COLOR${n}`;
const url=n=>`${origin}/en-us/suede-aston-sneaker/${pid(n)}.html`;
const image=n=>`https://cdn.media.amplience.net/i/tom_ford/EXACT-REAL-PHOTO-${n}`;
const esc=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
function card(n=1,{name='SUEDE ASTON SNEAKER',img=image(n),id=pid(n),href=url(n)}={}){
  return `<div class="product" data-pid="${id}"><div class="product-tile"><a class="tile-image-container" href="${href}"><img class="tile-image tile-image-primary" src="${img}"><img class="tile-image-alt" src="${image('ADJACENT-COLOR')}"></a><div class="pdp-link"><a href="${href}">${name}</a></div><div class="color-swatches"><a href="${href}?dwvar_${id}_color=OTHER"><img class="swatch" src="${image('SWATCH')}"></a></div></div></div>`;
}
function page({items=[card()],total=items.length,i=0,start=0,more=null,hidden=true,sort=false,full=true}={}){
  const settings=sort?`data-sort-options="${esc(JSON.stringify({options:[{id:'Recommended',url:next(0,i)}]}))}"`:'';
  const footer=`<div class="grid-footer" data-page-number="${start/2}" data-page-size="2.0" ${settings}>${more?`<div class="show-more"><button class="btn more" data-url="${esc(more)}">View More</button></div>`:''}${hidden?`<input type="hidden" class="category-id" value="${category(i)}">`:''}</div>`;
  const count=total===null?'':`<span class="search-result-count">${total} results for</span>`;
  const grid=items.join('')+footer;
  return `${count}${full?`<div class="product-grid">${grid}</div><aside>${card(999)}</aside>`:grid}`;
}
const collect=options=>collectTomFordOfficial({now:at,...options});
function fixture(men=page(),women=page({items:[],i:1})){const calls=[];return Object.assign(async u=>{calls.push(u);if(u===source(0))return men;if(u===source(1))return women;throw Error('unexpected '+u);},{calls});}

test('binds official product ID, PDP and actual primary image inside one category tile',()=>{
  const r=parseTomFordOfficialPage(page(),source(0),{at});
  assert.deepEqual(r.ids,[pid(1)]);assert.equal(r.products.length,1);
  const p=r.products[0];assert.equal(p.url,url(1));assert.equal(p.image,image(1));assert.deepEqual(p.gallery,[image(1)]);
  assert.equal(p.style,pid(1));assert.equal(p.styleType,'official-product-id');assert.equal(p.manufacturerStyle,undefined);
  assert.equal(p.gender,'Men');assert.equal(p.colorway,undefined);assert.equal(p.arrivalEvidence.kind,'official-assortment-listing');
  assert.ok(officialEvidenceFor(p,'2026-11-05'));assert.equal(hasArrivalEvidence(p,'2026-11-05'),true);
  assert.equal(p.officialImageEvidence.contentHash,p.arrivalEvidence.contentHash);assert.equal(p.productEvidenceUrl,source(0));
});

test('rendered cached HTML retains category proof in footer sort configuration after hidden inputs disappear',()=>{
  const r=parseTomFordOfficialPage(page({hidden:false,sort:true}),source(0),{at});assert.equal(r.products.length,1);
  assert.throws(()=>parseTomFordOfficialPage(page({hidden:false}),source(0)),/SCOPE_MISMATCH/);
  assert.throws(()=>parseTomFordOfficialPage(page({i:1}),source(0)),/SCOPE_MISMATCH/);
});

test('accepts official AJAX continuation fragments and only emitted same-category forward cursor',()=>{
  const r=parseTomFordOfficialPage(page({items:[card(3),card(4)],total:null,start:2,more:next(4),full:false}),next(2),{at});
  assert.equal(r.next,next(4));assert.equal(r.start,2);assert.equal(r.total,undefined);
  for(const more of [next(0),next(4),next(2,1),next(2).replace(origin,'https://evil.example'),next(2)+'&prefn1=color']){
    assert.throws(()=>parseTomFordOfficialPage(page({items:[card(1),card(2)],total:4,more}),source(0)));
  }
});

test('rejects homepage, wrong category, filter leakage and unsupported source routes',()=>{
  for(const u of [origin,source(0).replace('sneakers','boots'),source(0)+'?prefn1=color',next(0)+'&srule=newarrivals',next(0)+'&cgid=women-shoes-sneakers'])assert.throws(()=>parseTomFordOfficialPage(page(),u));
});

test('missing primary image never falls back to hover, swatch, srcset or another card',()=>{
  for(const html of [page().replace('tile-image tile-image-primary','tile-image-alt'),page().replace(`src="${image(1)}"`,'src=""'),page().replace(`src="${image(1)}"`,`srcset="${image(1)} 100w"`)])assert.throws(()=>parseTomFordOfficialPage(html,source(0)),/IMAGE_ABSENT/);
  assert.throws(()=>parseTomFordOfficialPage(page({items:[card(1,{img:'https://evil.example/photo.jpg'})]}),source(0)),/UNOFFICIAL_IMAGE/);
});

test('rejects mismatched PID/PDP and duplicate cards',()=>{
  assert.throws(()=>parseTomFordOfficialPage(page({items:[card(1,{id:pid(2)})]}),source(0)),/IDENTITY_MISMATCH/);
  assert.throws(()=>parseTomFordOfficialPage(page({items:[card(),card()]}),source(0)),/DUPLICATE_TILE/);
  assert.throws(()=>parseTomFordOfficialPage(page({items:[card(1,{href:url(1)+'?dwvar_color=OTHER'})]}),source(0)),/PRODUCT_URL_REQUIRED/);
});

test('collects all pages and reconciles male/female category totals before exhaustion',async()=>{
  const calls=[],readHtml=async u=>{calls.push(u);if(u===source(0))return page({items:[card(1),card(2)],total:3,more:next(2)});if(u===next(2))return page({items:[card(3)],total:null,start:2,full:false});return page({items:[card(4)],i:1});};
  const r=await collect({readHtml});assert.equal(r.exhausted,true);assert.equal(r.products.length,4);assert.equal(r.errors.length,0);
  assert.deepEqual(calls,[source(0),next(2),source(1)]);
  assert.deepEqual(r.coverage.map(c=>[c.total,c.cards,c.pages,c.exhausted]),[[3,3,2,true],[1,1,1,true]]);
});

test('short terminal page, missing terminal footer and changed totals never count as exhausted',async()=>{
  const mismatch=await collect({readHtml:fixture(page({total:2}))});assert.equal(mismatch.exhausted,false);assert.match(mismatch.errors[0].error,/TOTAL_MISMATCH/);assert.equal(mismatch.products.length,0);
  const missing=await collect({readHtml:fixture('<div class="product-grid">'+card()+'</div>')});assert.match(missing.errors[0].error,/FOOTER_REQUIRED/);
  const changed=await collect({readHtml:async u=>u===source(0)?page({items:[card(1),card(2)],total:3,more:next(2)}):page({items:[card(3)],total:4,start:2,full:false})});assert.match(changed.errors[0].error,/TOTAL_CHANGED/);assert.equal(changed.exhausted,false);
});

test('repeated pagination is rejected without duplicating previously accepted rows',async()=>{
  const r=await collect({readHtml:async u=>u===source(0)?page({items:[card(1),card(2)],total:3,more:next(2)}):page({items:[card(1)],total:null,start:2,full:false})});
  assert.equal(r.exhausted,false);assert.equal(r.products.length,2);assert.match(r.errors[0].error,/REPEATED_PAGE/);assert.equal(r.pending[0],next(2));
});

test('resumes bounded work from serialized checkpoints without refetching accepted pages',async()=>{
  const readHtml=fixture();let saved;
  const a=await collect({readHtml,maxPages:1,onProgress:p=>{saved=p.checkpoint;}});assert.equal(a.exhausted,false);assert.equal(a.products.length,1);
  const b=await collect({readHtml,resume:JSON.parse(JSON.stringify(saved))});assert.equal(b.exhausted,true);assert.equal(b.checkedAt,at);assert.deepEqual(readHtml.calls,sources);
  const c=await collect({readHtml,resume:b.checkpoint});assert.equal(c.products.length,1);assert.equal(readHtml.calls.length,2);
});

test('empty explicit zero-count category is exhaustive; missing count or blank shell is not',async()=>{
  const r=await collect({readHtml:fixture(page({items:[]}),page({items:[],i:1}))});assert.equal(r.exhausted,true);assert.equal(r.products.length,0);
  const missing=await collect({readHtml:fixture(page({total:null}))});assert.match(missing.errors[0].error,/TOTAL_REQUIRED/);
  const shell=await collect({readHtml:fixture('<html></html>')});assert.equal(shell.exhausted,false);
});

test('accepts cached rawHtml envelopes; rejects HTTP failures, redirects and challenges',async()=>{
  const r=await collect({readHtml:async u=>({rawHtml:page({i:u===source(1)?1:0}),metadata:{url:u,statusCode:200}})});assert.equal(r.exhausted,true);
  for(const envelope of [{body:page(),status:503},{rawHtml:page(),metadata:{url:'https://evil.example',statusCode:200}},{rawHtml:page(),metadata:{url:origin+'/',statusCode:200}},{html:'<title>Just a moment</title>'}]){
    const failed=await collect({readHtml:async()=>envelope});assert.equal(failed.exhausted,false);assert.equal(failed.products.length,0);assert.equal(failed.errors.length,1);
  }
});

test('non-sneaker footwear is excluded explicitly and does not break category count proof',async()=>{
  const r=await collect({readHtml:fixture(page({items:[card(1,{name:'SNEAKER SOLE BOOT'})]}))});
  assert.equal(r.exhausted,true);assert.equal(r.products.length,0);assert.equal(r.excluded.length,1);assert.equal(r.coverage[0].cards,1);
});

test('zero budgets prove nothing and invalid limits are rejected',async()=>{
  const readHtml=async()=>{throw Error('must not read');};
  for(const options of [{maxPages:0},{maxDurationMs:0}]){const r=await collect({readHtml,...options});assert.equal(r.exhausted,false);assert.deepEqual(r.pending,sources);}
  await assert.rejects(collect({maxPages:-1}),/INVALID_LIMIT/);await assert.rejects(collect({maxPages:0.5}),/INVALID_LIMIT/);
});

test('persistence callback failure propagates rather than becoming an ordinary source error',async()=>{
  await assert.rejects(collect({readHtml:fixture(),onProgress:async()=>{throw Error('storage failed');}}),/storage failed/);
});
