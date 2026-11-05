import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {HOKA_NEW,HOKA_BROWSER_TRANSPORT,HOKA_HTTP_TRANSPORT,hokaBrowserNewPage,hokaHttpNewPage,collectHokaNew} from '../scripts/collect-hoka-new.mjs';
import {officialEvidenceFor,curateCatalog,kstDay} from '../scripts/curation.mjs';
import {productPresentation} from '../scripts/product-presentation.mjs';
import {officialImageUrl} from '../public/assets/catalog-view.mjs';
import {reviewAdminProducts} from '../scripts/admin-publication-review.mjs';
import {reviewScopedNew} from '../scripts/review-scoped-new.mjs';

const at='2026-11-05T08:09:15.303Z',now=new Date('2026-11-05T09:00:00Z');
const NEXT='https://www.hoka.com/on/demandware.store/Sites-HOKA-US-Site/en_US/Search-UpdateGrid?cgid=new-arrivals&start=36&sz=36';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;');
function tile({model='1171959',color='BDY',pid='198605922848',name='Challenger 8 GTX',category='womens-trail',audience="Women's",usage='Trail Running',image,extra=''}={}){
 const style=model+'-'+color,url=`/en/us/${category}/challenger-8-gtx/${model}.html?dwvar_${model}_color=${color}`;
 image??=`https://dms.deckers.com/hoka/image/upload/t_product-medium-wp/v1786541455/${style}_1.png?_s=RAABAB0`;
 return `<div class="tile-row"><div class="product" data-pid="${pid}" data-master-id="${model}"><div class="product-tile"><div class="product-tile__primary"><div class="image-container" data-product-color="${color}" data-product-id="${pid}" data-product-master-id="${model}" data-image-selector="${style}" data-product-name="${name}" data-product-price="165.00"><a class="js-pdp-link image-link pdp-link" href="${esc(url)}"><picture><img class="tile-image" src="${esc(image)}" alt="${name}" title="${name}"></picture></a></div><section class="product-image-color-swatch"><button data-product-color="${color}" aria-label="Select color Black / Varsity Burgundy" value="${esc(url.replace('dwvar_'+model,'dwvar_'+pid))}"><img src="https://dms.deckers.com/hoka/image/upload/${style}_1.png"></button><button data-product-color="OTHER" aria-label="Select color Other" value="/wrong"><img src="https://dms.deckers.com/hoka/image/upload/${model}-OTHER_1.png"></button></section><div class="tile-product-name"><div class="pdp-link"><a class="link" href="${esc(url)}"><span class="product-group">${audience}</span>${name}</a></div></div><div class="best-for"><div class="best-for__item">${usage}</div></div>${extra}</div></div></div></div>`;
}
function capture(html,{url=HOKA_NEW,checkedAt=at,...extra}={}){return {brand:'HOKA',url,checkedAt,transport:HOKA_BROWSER_TRANSPORT,html,...(url!==HOKA_NEW?{parentUrl:HOKA_NEW}:{}),...extra};}
function root(cards,{total=1,next=null,extra=''}={}){return capture(`<main id="main-content"><h1>HOKA New Arrivals</h1><span class="category-info-header__results-count">(${total})</span><div class="product-grid">${cards}</div>${next?`<button class="more" data-url="${esc(next)}">Load More</button>`:''}${extra}</main>`);}
const collect=captures=>collectHokaNew({captures,now});
const fullCards=()=>Array.from({length:40},(_,i)=>tile({model:String(1171000+i),pid:String(198605900000+i)}));

function downstream(rows,{transport=HOKA_BROWSER_TRANSPORT}={}){
 const boundary=reviewAdminProducts(rows,{});assert.deepEqual(boundary.held,[]);
 const scoped=reviewScopedNew(boundary.products);assert.deepEqual(scoped.held,[]);assert.deepEqual(scoped.repaired,[]);
 const curated=curateCatalog(scoped.products,{now});assert.deepEqual(curated.review.held,[]);assert.equal(curated.snapshot.products.length,rows.length);
 for(const p of rows){assert.ok(officialEvidenceFor(p,kstDay(now)));assert.equal(p.manufacturerStyle,p.style);
  assert.equal(p.officialProductEvidence.provenance.transport,transport);assert.equal(p.officialImageEvidence.sourceUrl,p.productEvidenceUrl);
  assert.equal(p.sourceTileBinding.style,p.style);assert.equal(p.sourceTileBinding.image,p.image);assert.equal(p.sourceTileBinding.url,p.url);
  assert.equal(p.sourceTileBinding.contentHash,p.arrivalEvidence.contentHash);assert.equal(p.sourceTileBinding.contentHash,p.officialImageEvidence.contentHash);
  assert.notEqual(p.productEvidenceUrl,p.url);assert.equal(p.releaseDate,undefined);assert.equal(p.dateEvidence,undefined);
 }
 for(const p of curated.snapshot.products){const shown=productPresentation(p,{products:[]});assert.ok(shown);assert.equal(officialImageUrl(shown,kstDay(now)),p.image);}
}

test('browser-only selected color proof passes downstream without any HTTP/PDP claim',t=>{
 t.mock.timers.enable({apis:['Date'],now:now.getTime()});
 const result=collect([root(tile())]);assert.equal(result.products.length,1);assert.equal(result.exhaustive,true);
 const p=result.products[0];assert.equal(p.style,'1171959-BDY');assert.equal(p.productVariantId,'1171959-BDY');
 assert.equal(p.colorway,'Black / Varsity Burgundy');assert.equal(p.gender,'Women');assert.match(p.image,/1171959-BDY_1\.png/);
 downstream(result.products);
 assert.ok(!/"(?:statusCode|httpStatus|upstreamStatus)"/.test(JSON.stringify(result)));
 assert.equal(p.officialProductEvidence.verificationMethod,'official-new-listing-sku-image');
});

test('actual 36 + 4 observed DOM pages reconcile 40 unique selected variants',t=>{
 t.mock.timers.enable({apis:['Date'],now:now.getTime()});
 const cards=fullCards(),result=collect([root(cards.slice(0,36).join(''),{total:40,next:NEXT}),capture('<body>'+cards.slice(36).join('')+'</body>',{url:NEXT})]);
 assert.equal(result.products.length,40);assert.equal(result.coverage.total,40);assert.equal(result.coverage.read,40);assert.equal(result.exhaustive,true);
 assert.equal(result.errors.length,0);assert.equal(result.sourceCaptures[1].transport,HOKA_BROWSER_TRANSPORT);
 downstream(result.products);
});

test('36/40 remains partial until the actual observed Load More fragment is present',()=>{
 const cards=fullCards();const r=collect([root(cards.slice(0,36).join(''),{total:40,next:NEXT})]);
 assert.equal(r.products.length,36);assert.equal(r.exhaustive,false);assert.equal(r.coverage.total,null);assert.equal(r.coverage.reportedTotal,40);assert.deepEqual(r.pendingUrls,[NEXT]);
});

test('duplicate last ALVB-style variant is not counted twice to force 40/40',()=>{
 const cards=fullCards(),r=collect([root(cards.slice(0,36).join(''),{total:40,next:NEXT}),capture('<body>'+cards[35]+cards.slice(37).join('')+'</body>',{url:NEXT})]);
 assert.equal(r.products.length,39);assert.equal(r.coverage.read,39);assert.equal(r.duplicates.length,1);assert.equal(r.exhaustive,false);assert.equal(r.coverage.total,null);
});

test('a fragment parent declaration cannot replace its observed navigation link',()=>{
 const next=NEXT.replace('start=36','start=1');
 const r=collect([root(tile(),{total:2}),capture('<body>'+tile({model:'1171928',pid:'198605914836'})+'</body>',{url:next})]);
 assert.equal(r.products.length,2);assert.equal(r.exhaustive,false);assert.match(r.errors[0].error,/Fragment link absent/);
});

test('wrong browser capture type, brand, locale, timestamp, parent and invented HTTP status fail closed',()=>{
 const good=root(tile());
 for(const change of [
  {transport:'firecrawl-html'}, {brand:'UGG'}, {url:HOKA_NEW.replace('/us/','/il/')}, {checkedAt:'invalid'},
  {checkedAt:'2026-11-07T00:00:00Z'}, {checkedAt:'2026-11-01T00:00:00Z'}, {statusCode:200}, {metadata:{statusCode:200}}, {rawHtml:good.html}
 ])assert.throws(()=>hokaBrowserNewPage({...good,...change},{now}));
 assert.throws(()=>hokaBrowserNewPage(capture('<body>'+tile()+'</body>',{url:NEXT,parentUrl:'https://www.hoka.com/en/us/shoes/'}),{now}),/parent/);
 assert.throws(()=>hokaBrowserNewPage(good.html,{now}),/capture required/);
});

for(const [label,options] of [
 ['road',{name:'Clifton 10',category:'mens-road',audience:"Men's",usage:'Road Running'}],
 ['trail',{name:'Speedgoat 7',category:'womens-trail',usage:'Trail Running'}],
 ['athletic lifestyle',{name:'Stealth/Tech Speedgoat 2',category:'mens-lifestyle',audience:"Men's",usage:'Lifestyle'}]
])test('own '+label+' adult sneaker type qualifies',()=>assert.equal(collect([root(tile(options))]).products.length,1));

for(const [label,options] of [
 ['hiking boot',{name:'Kaha 3 GTX',category:'mens-hiking',audience:"Men's",usage:'Hiking'}],
 ['moc',{name:'Kaha 2 Frost Moc GTX',category:'womens-lifestyle',usage:'Lifestyle'}],
 ['slipper',{name:'Ora Recovery Slipper',category:'mens-lifestyle',audience:"Men's",usage:'Recovery'}],
 ['sandals',{name:'Hopara 2',category:'womens-lifestyle',usage:'Hiking'}],
 ['kids',{name:'Clifton Kids',category:'kids-running',audience:'Kids',usage:'Running'}],
 ['apparel',{name:'Performance Running Hat',category:'mens-apparel',audience:"Men's",usage:'Running'}]
])test(label+' is explicitly excluded from the sneaker output',()=>{
 const r=collect([root(tile(options))]);assert.equal(r.products.length,0);assert.equal(r.excluded.length,1);assert.equal(r.coverage.read,1);assert.equal(r.exhaustive,true);
});

test('ambiguous athletic type is unresolved and never a completed exclusion',()=>{
 const r=collect([root(tile({name:'Unknown New Shoe',category:'womens-lifestyle',usage:'Lifestyle'}))]);assert.equal(r.products.length,0);assert.equal(r.missing.length,1);assert.equal(r.exhaustive,false);
});

test('hidden products and navigation do not grant New grid membership',()=>{
 const hidden='<div style="display:none">'+tile({model:'1171928',pid:'198605914836'})+'</div>';
 const r=collect([root(tile()+hidden)]);assert.equal(r.products.length,1);assert.equal(r.coverage.read,1);assert.equal(r.exhaustive,true);
});

test('a visible Coming soon badge is excluded rather than emitted as available New footwear',()=>{
 const r=collect([root(tile({extra:'<span class="product-badge-text">Coming Soon</span>'}))]);
 assert.equal(r.products.length,0);assert.equal(r.excluded[0].reason,'upcoming');
});

for(const [label,mutate] of [
 ['sibling color image',h=>h.replace(/1171959-BDY_1\.png/g,'1171959-OTHER_1.png')],
 ['wrong CDN',h=>h.replaceAll('https://dms.deckers.com','https://evil.example')],
 ['hover/outsole image',h=>h.replace(/1171959-BDY_1\.png/g,'1171959-BDY_8.png')],
 ['wrong selected container',h=>h.replace('data-image-selector="1171959-BDY"','data-image-selector="1171959-OTHER"')],
 ['wrong image link',h=>h.replace('dwvar_1171959_color=BDY','dwvar_1171959_color=OTHER')],
 ['wrong selected label destination',h=>h.replace('dwvar_198605922848_color=BDY','dwvar_198605922848_color=OTHER')],
 ['wrong product photo title',h=>h.replace('alt="Challenger 8 GTX" title="Challenger 8 GTX"','alt="Other Shoe" title="Other Shoe"')]
])test(label+' is held instead of borrowing a swatch or adjacent image',()=>{
 const r=collect([root(mutate(tile()))]);assert.equal(r.products.length,0);assert.equal(r.missing.length,1);assert.equal(r.exhaustive,false);
});

test('gallery JSON, analytics and script product inventories do not supply products or totals',()=>{
 const c=root(tile(),{total:40,extra:'<script>var hidden={products:Array(40)}</script><div data-search-analytics="{&quot;count&quot;:40}"></div>'});
 const r=collect([c]);assert.equal(r.products.length,1);assert.equal(r.coverage.read,1);assert.equal(r.exhaustive,false);
 const missingCount={...c,html:c.html.replace('<span class="category-info-header__results-count">(40)</span>','')};
 assert.throws(()=>collect([missingCount]),/visible source total/);
});

test('truncated giant gallery attribute keeps only closed earlier cards and cannot complete',()=>{
 const h=root(tile()+tile({model:'1171928',pid:'198605914836'}),{total:2}).html;
 const cut=h.indexOf('data-product-name="Challenger 8 GTX"',h.indexOf('198605914836'));
 const r=collect([capture(h.slice(0,cut)+' data-images="[Truncated]')]);
 assert.equal(r.products.length,1);assert.equal(r.exhaustive,false);assert.equal(r.coverage.reportedTotal,2);assert.ok(r.errors.some(e=>/truncated/i.test(e.error)));
});

test('editorial placements count only with explicit source markers, not inferred padding',()=>{
 const editorial='<div class="tile-row" data-is-merch-tile="true"><a href="/en/us/new-arrivals/">Editorial</a></div>';
 const good=collect([root(tile()+editorial,{total:2})]);assert.equal(good.products.length,1);assert.equal(good.coverage.read,2);assert.equal(good.excluded.length,1);assert.equal(good.exhaustive,true);
 const bad=collect([root(tile()+editorial.replace(' data-is-merch-tile="true"',''),{total:2})]);assert.equal(bad.exhaustive,false);assert.equal(bad.coverage.read,1);
});

test('gapped fragment offset is incomplete even when unique row counts match',()=>{
 const next=NEXT.replace('start=36','start=3');
 const r=collect([root(tile(),{total:2,next}),capture('<body>'+tile({model:'1171928',pid:'198605914836'})+'</body>',{url:next})]);assert.equal(r.coverage.read,2);assert.equal(r.exhaustive,false);assert.ok(r.errors.some(e=>/Noncontiguous/.test(e.error)));
});

test('actual saved Chrome captures retain honest count and browser provenance',async t=>{
 const base=new URL('../reports/admin-recheck-followup-20261105/',import.meta.url);
 const captures=[];
 for(const file of ['manual-hoka-browser-dom.json','manual-hoka-next-browser-dom.json']){
  try{captures.push(JSON.parse(await fs.readFile(new URL(file,base),'utf8')));}catch{return t.skip('Local Chrome DOM captures not installed');}
 }
 const time=new Date(Math.max(...captures.map(c=>Date.parse(c.checkedAt))));
 const r=collectHokaNew({captures,now:time});assert.equal(r.coverage.reportedTotal,40);
 if(captures.some(c=>c.html.includes('[Truncated]')))assert.equal(r.exhaustive,false);
 assert.ok(r.products.every(p=>p.officialImageEvidence.provenance.transport===HOKA_BROWSER_TRANSPORT));
 assert.equal(new Set(r.products.map(p=>p.style)).size,r.products.length);
 assert.ok(!/"(?:statusCode|httpStatus|upstreamStatus)"/.test(JSON.stringify(r)));
 if(r.products.length){t.mock.timers.enable({apis:['Date'],now:time.getTime()});downstream(r.products);}
});

test('sanitized DOM binds exact selected primary picture srcset without inventing color names',t=>{
 t.mock.timers.enable({apis:['Date'],now:now.getTime()});
 let html=tile().replace(/\sdata-(?:master-id|product-master-id|image-selector|product-color|product-name|product-price)="[^"]*"/g,'').replace(/\svalue="[^"]*"/g,'');
 const primary='https://dms.deckers.com/hoka/image/upload/t_product-medium-wp/v1786541455/1171959-BDY_1.png?_s=RAABAB0';
 html=html.replace('<picture><img class="tile-image" src="'+esc(primary)+'"','<picture><source srcset="'+esc(primary)+'"><img class="tile-image" src="data:image/png;base64,placeholder"');
 const c=root(html);c.extraction='DOM markup; scripts, SVG and nonessential attributes omitted';
 const r=collect([c]);assert.equal(r.products.length,1);const p=r.products[0];
 assert.equal(p.image,primary);assert.equal(p.colorCode,'BDY');assert.equal(p.colorway,'');assert.deepEqual(p.colors,[]);
 assert.equal(p.officialProductEvidence.provenance.extraction,c.extraction);downstream(r.products);
});

test('no primary img, lazy URL or picture srcset means no usable photo',()=>{
 const html=tile().replace(/src="https:\/\/dms\.deckers\.com[^\"]+"/g,'src="data:image/png;base64,placeholder"');
 const r=collect([root(html)]);assert.equal(r.products.length,0);assert.match(r.missing[0].reason,/lazy primary photo URL absent/);assert.equal(r.exhaustive,false);
});

const http=(c,extra={})=>({url:c.url,status:200,body:c.html,checkedAt:c.checkedAt,transport:HOKA_HTTP_TRANSPORT,...extra});

test('without local receipts, real HTTP envelopes follow only the observed root/next contract',async t=>{
 t.mock.timers.enable({apis:['Date'],now:now.getTime()});
 const cards=fullCards(),responses=new Map([
  [HOKA_NEW,http(root(cards.slice(0,36).join(''),{total:40,next:NEXT}))],
  [NEXT,http(capture('<body>'+cards.slice(36).join('')+'</body>',{url:NEXT}))]
 ]),reads=[];
 const r=await collectHokaNew({now,read:async url=>{reads.push(url);return responses.get(url);}});
 assert.deepEqual(reads,[HOKA_NEW,NEXT]);assert.equal(r.exhaustive,true);assert.equal(r.products.length,40);assert.equal(r.transport,HOKA_HTTP_TRANSPORT);
 assert.ok(r.sourceCaptures.every(p=>p.provenance.upstreamStatus===200&&p.transport===HOKA_HTTP_TRANSPORT));
 downstream(r.products,{transport:HOKA_HTTP_TRANSPORT});
});

test('default ordinary reader makes one official request and reports a real denial honestly',async t=>{
 const reads=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{reads.push(url);assert.equal(options.redirect,'error');return {url,status:403,text:async()=>'<title>Access Denied</title>'};});
 const r=await collectHokaNew({now});assert.deepEqual(reads,[HOKA_NEW]);assert.equal(r.status,'failed');assert.equal(r.products.length,0);assert.equal(r.exhaustive,false);
 assert.equal(r.transport,HOKA_HTTP_TRANSPORT);assert.match(r.errors[0].error,/HTTP 403/);assert.deepEqual(r.sourceCaptures,[]);
 assert.ok(!JSON.stringify(r).includes(HOKA_BROWSER_TRANSPORT));
});

for(const [label,mutate] of [
 ['upstream denial',r=>({...r,status:403})],
 ['contradictory metadata status',r=>({...r,metadata:{statusCode:403}})],
 ['redirect',r=>({...r,url:'https://www.hoka.com/en/us/shoes/'})],
 ['wrong sourceURL',r=>({...r,metadata:{sourceURL:'https://www.hoka.com/en/il/'}})],
 ['missing status',r=>{delete r.status;return r;}],
 ['missing response URL',r=>{delete r.url;return r;}],
 ['invalid observation timestamp',r=>({...r,checkedAt:'2026-11-05'})],
 ['provider-declared error',r=>({...r,error:'Forbidden'})],
 ['browser type disguised as HTTP',r=>({...r,transport:HOKA_BROWSER_TRANSPORT})]
])test('ordinary reader rejects '+label+' without relabeling the result',async()=>{
 const r=await collectHokaNew({now,read:async()=>mutate(http(root(tile())))});
 assert.equal(r.status,'failed');assert.equal(r.products.length,0);assert.equal(r.exhaustive,false);assert.equal(r.transport,HOKA_HTTP_TRANSPORT);
});

test('HTTP 200 challenge is unavailable, not a zero-product completed New page',async()=>{
 const r=await collectHokaNew({now,read:async()=>http(root(tile()),{body:'<title>Device check | HOKA</title><iframe src="https://geo.captcha-delivery.com/"></iframe>'})});
 assert.equal(r.status,'failed');assert.match(r.errors[0].error,/access challenge/);assert.equal(r.coverage.total,null);
});

test('browser receipt injection never fetches or borrows an HTTP success claim',async()=>{
 let reads=0;
 const r=await collectHokaNew({captures:[root(tile())],now,read:async()=>{reads++;throw Error('Must not fetch');}});
 assert.equal(reads,0);assert.equal(r.products.length,1);assert.equal(r.transport,HOKA_BROWSER_TRANSPORT);
 assert.ok(!/upstreamStatus|statusCode/.test(JSON.stringify(r)));
 assert.throws(()=>hokaBrowserNewPage(http(root(tile())),{now}),/Chrome DOM capture/);
 assert.throws(()=>hokaHttpNewPage(root(tile()),HOKA_NEW,{now}),/HTTP response required/);
});

test('HTTP continuation failure retains only previously validated rows and partial coverage',async()=>{
 const next=NEXT.replace('start=36','start=1');
 const r=await collectHokaNew({now,read:async url=>url===HOKA_NEW?http(root(tile(),{total:2,next})):({url,status:403,body:'Forbidden'})});
 assert.equal(r.products.length,1);assert.equal(r.status,'partial');assert.equal(r.exhaustive,false);assert.deepEqual(r.pendingUrls,[next]);
});
