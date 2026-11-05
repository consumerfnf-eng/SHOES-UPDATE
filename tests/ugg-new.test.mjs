import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {UGG_NEW_SHOES_URL as root, UGG_BROWSER_TRANSPORT as transport, UGG_BROWSER_EXTRACTION as extraction, parseUggNewPage, collectUggNew, readUggOfficial} from '../scripts/collect-ugg-new.mjs';
import {curateCatalog, officialEvidenceFor, kstDay} from '../scripts/curation.mjs';
import {productPresentation} from '../scripts/product-presentation.mjs';
import {reviewScopedNew} from '../scripts/review-scoped-new.mjs';
import {reviewAdminProducts} from '../scripts/admin-publication-review.mjs';
import {officialProductUrl, officialImageUrl, sourceMatches} from '../public/assets/catalog-view.mjs';
const now = new Date('2026-11-05T08:17:08.633Z');
const next = 'https://www.ugg.com/on/demandware.store/Sites-UGG-US-Site/en_US/Search-UpdateGrid?cgid=new-arrivals&prefn1=type&prefv1=shoes&start=3&sz=3';
const options = [
  {id:'199727000001',model:'1170910',color:'DCP',name:'Heritage Utility Sneaker',audience:"Men's",category:'men-shoes-sneakers',slug:'heritage-utility-sneaker'},
  {id:'199727000002',model:'1180001',color:'CHE',name:'Goldenstar Clog',audience:"Women's",category:'women-clogs-mules',slug:'goldenstar-clog'},
  {id:'199727000003',model:'1184790',color:'MDSD',name:'Quill Ballet Sneaker',audience:"Women's",category:'women-casuals-sneakers',slug:'quill-ballet-sneaker'},
  {id:'199727000004',model:'1184311I',color:'DYR',name:'Lowmel',audience:'Baby',category:'kids-baby-sneakers',slug:'lowmel'},
  {id:'199727000005',model:'1144032',color:'DYR',name:'Lowmel',audience:"Women's",category:'women-casuals-sneakers',slug:'lowmel'},
  {id:'199727000006',model:'1179999',color:'BLK',name:'Own Sneaker',audience:"Men's",category:'men-shoes-sneakers',slug:'own-sneaker',noImage:true},
];
const url = p => `/${p.category}/${p.slug}/${p.model}.html?dwvar_${p.model}_color=${p.color}`;
const image = p => `https://dms.deckers.com/ugg/image/upload/t_product-medium-wp/v1778627522/${p.model}-${p.color}_1.png?_s=RAABAB0`;
function card(p) {
  return `<div class="tile-row"><div class="product" data-pid="${p.id}"><div class="product-tile"><div class="image-container" data-product-id="${p.id}"><a class="image-link js-pdp-link" href="${url(p)}"><picture>${p.noImage?'':`<source srcset="${image(p)}"></source>`}<img src="data:image/png;base64,placeholder" alt="${p.name}"></img></picture></a></div><div class="tile-product-name"><div class="pdp-link"><a class="pdp-link" href="${url(p)}"><span class="product-group">${p.audience}</span>${p.name}</a></div></div><div class="price"><span class="sales">$145</span></div></div></div></div>`;
}
const footer = (more = false, viewed = false) => `<div class="grid-footer">${viewed?'<div class="viewed-count">You have viewed 3 of 6 products.</div>':''}${more?`<div class="show-more"><button disabled="" data-url="${next.replaceAll('&','&amp;')}" aria-label="LOAD MORE PRODUCTS">LOAD MORE PRODUCTS</button></div>`:''}</div>`;
function captures() {
  return [
    {brand:'UGG',url:root,checkedAt:now.toISOString(),transport,extraction,html:`<main id="main-content"><h1>New Arrivals</h1><div class="search-results-count"><span>6</span> Results <span class="d-none">/ Refine:</span></div><button id="producttype-shoes-selected"><span class="selected">Shoes</span></button><div class="product-grid">${options.slice(0,3).map(card).join('')}${footer(true,true)}</div></main>`},
    {brand:'UGG',url:next,parentUrl:root,checkedAt:now.toISOString(),transport,extraction,html:`<body>${options.slice(3).map(card).join('')}${footer()}</body>`},
  ];
}
const collect = (c = captures(), extra = {}) => collectUggNew({captures:c,now,...extra});

test('reconciles filtered count and classifies every selected card without claiming all holds publishable', async () => {
  const result=await collect();
  assert.deepEqual(result.errors,[]);
  assert.equal(result.complete,false);assert.equal(result.exhaustive,false);assert.equal(result.traversalComplete,true);assert.equal(result.coverage.exhausted,true);assert.equal(result.coverage.classificationComplete,false);
  assert.deepEqual([result.coverage.total,result.coverage.read,result.coverage.classified],[6,6,6]);
  assert.deepEqual([result.products.length,result.excluded.length,result.held.length],[1,2,3]);
  assert.equal(result.coverage.eligibilityComplete,false);
  assert.equal(result.products[0].style,'1170910-DCP');
  assert.ok(result.held.some(p=>p.name==='Quill Ballet Sneaker'&&p.reason==='hybrid-review-required'));
  assert.ok(result.held.some(p=>p.name==='Lowmel'&&/construction/.test(p.reason)));
});

test('browser receipts retain exact DOM/date/transport and never acquire HTTP status claims', async () => {
  const input=captures(),result=await collect(input);
  assert.deepEqual(result.sourceRecords.map(r=>r.record),input);
  assert.equal(result.checkedAt,now.toISOString());
  for(const page of result.pages){assert.equal(page.transport,transport);assert.equal(Object.hasOwn(page,'status'),false);assert.equal(Object.hasOwn(page,'statusCode'),false);assert.equal(page.checkedAt,now.toISOString());}
  assert.equal(result.pages[0].contentHash,createHash('sha256').update(input[0].html).digest('hex'));
  assert.equal(result.products[0].firstSeen,now.toISOString());
  assert.equal(result.products[0].officialProductEvidence.transport,transport);
  assert.equal(Object.hasOwn(result.products[0],'releaseDate'),false);
});

test('selected own source image survives admin scope, curation, presentation and public client gates', async () => {
  const result=await collect();
  const boundary=reviewAdminProducts(result.products,{});assert.equal(boundary.held.length,0);
  const scoped=reviewScopedNew(boundary.products);assert.equal(scoped.held.length,0);
  const curated=curateCatalog(scoped.products,{now});assert.equal(curated.snapshot.products.length,1);
  const p=productPresentation(curated.snapshot.products[0],{products:[]});assert(p);
  assert(officialEvidenceFor(p,kstDay(now)));
  assert.equal(p.presentation.image,image(options[0]));
  assert.equal(officialProductUrl(p,kstDay(now)),p.url);
  assert.equal(officialImageUrl(p,kstDay(now)),p.image);
  assert.equal(sourceMatches(p,'brand',kstDay(now)),true);
  assert.equal(p.releaseDate||'','');
});

test('strict receipt rejects wrong URL, unknown transport, future/stale date, HTTP impersonation and hidden scripts', async () => {
  const edits=[
    r=>{r.url='https://www.ugg.com/new-arrivals/';},r=>{r.brand='HOKA';},r=>{r.transport='http-200';},
    r=>{r.checkedAt='invalid';},r=>{r.checkedAt='2026-11-06T00:00:00Z';},r=>{r.checkedAt='2026-11-01T00:00:00Z';},
    r=>{r.status=200;},r=>{r.extraction='raw HTML with scripts';},r=>{r.html+='<script>hidden()</script>';},
  ];
  for(const edit of edits){const c=captures();edit(c[0]);let result;try{result=await collect(c);}catch{continue;}assert.equal(result.complete,false);assert.deepEqual(result.products,[]);assert.ok(result.errors.length);}
});

test('filtered root must visibly bind New, Shoes and its own count, ignoring unfiltered 457/458 elsewhere', async () => {
  for(const [before,after]of [['<h1>New Arrivals</h1>','<h1>Shoes</h1>'],['producttype-shoes-selected','producttype-boots-selected'],['<span>6</span> Results','<span>457</span> Results']]){
    const c=captures();c[0].html=c[0].html.replace(before,after);const result=await collect(c);assert.equal(result.complete,false);assert.deepEqual(result.products,[]);
  }
  const c=captures();c[0].html=c[0].html.replace('</main>','<aside>Unfiltered category: 457 then 458 results</aside></main>');
  assert.equal((await collect(c)).coverage.total,6);
});

test('only actual observed Load More links and matching parent receipts authorize continuation', async () => {
  for(const mode of ['missing','parent','offset','filter','chronology']){
    const c=captures();
    if(mode==='missing')c.pop();
    if(mode==='parent')c[1].parentUrl='https://www.ugg.com/new-arrivals/';
    if(mode==='offset')c[0].html=c[0].html.replace('start=3','start=4');
    if(mode==='filter')c[0].html=c[0].html.replace('prefv1=shoes','prefv1=boots');
    if(mode==='manufacturer')d.html=d.html.replace('Item No. 1144032','Item No. 1170750');
    if(mode==='chronology')c[1].checkedAt='2026-11-05T08:00:00.000Z';
    const result=await collect(c);assert.equal(result.complete,false,mode);assert.ok(result.products.every(p=>p.style==='1170910-DCP'),mode);
  }
});

test('repeated SKUs, missing/extra cards, counter drift and truncated DOM fail closed', async () => {
  for(const mode of ['repeated','missing','extra','counter','truncated','footer']){
    const c=captures();
    if(mode==='repeated')c[1].html=`<body>${[options[0],...options.slice(4)].map(card).join('')}${footer()}</body>`;
    if(mode==='missing')c[1].html=`<body>${options.slice(3,5).map(card).join('')}${footer()}</body>`;
    if(mode==='extra')c[1].html=c[1].html.replace('</body>',card({...options[0],id:'199727000099',model:'1178888'} )+'</body>');
    if(mode==='counter')c[0].html=c[0].html.replace('3 of 6','3 of 458');
    if(mode==='truncated')c[0].html=c[0].html.replace('</main>','');
    if(mode==='footer')c[1].html=c[1].html.replace(footer(),'');
    const result=await collect(c);assert.equal(result.complete,false,mode);assert.ok(result.products.every(p=>p.style==='1170910-DCP'),mode);
  }
});

test('wrong-color and neighboring photos cannot replace the selected SKU image', async () => {
  const c=captures();c[0].html=c[0].html.replaceAll(image(options[0]),image({...options[0],color:'BLK'}));
  const result=await collect(c);assert.equal(result.complete,false);
  assert.equal(result.products.length,0);
  assert.ok(result.held.some(p=>p.style==='1170910-DCP'&&p.reason==='own-selected-sku-image-not-rendered'));
});

test('offsite PDP URLs, mismatched title links and selected product IDs cannot bind source cards', async () => {
  for(const mode of ['domain','title-url','id']){
    const c=captures();
    if(mode==='domain')c[0].html=c[0].html.replaceAll(url(options[0]),'https://other.example'+url(options[0]));
    if(mode==='title-url')c[0].html=c[0].html.replace(`<a class="pdp-link" href="${url(options[0])}">`,`<a class="pdp-link" href="${url(options[1])}">`);
    if(mode==='id')c[0].html=c[0].html.replace('data-product-id="199727000001"','data-product-id="199727999999"');
    const result=await collect(c);assert.equal(result.complete,false,mode);assert.ok(result.products.every(p=>p.style==='1170910-DCP'),mode);
  }
});

test('clogs, loafers, hikers and children remain excluded despite sneaker-looking URLs', async () => {
  for(const name of ['Own Clog','Own Loafer','Own Hiker','Own Boots']){
    const c=captures();c[0].html=c[0].html.replaceAll('Heritage Utility Sneaker',name);
    const result=await collect(c);assert.ok(result.excluded.some(p=>p.style==='1170910-DCP'&&p.reason==='non-sneaker-form'));
    assert.equal(result.products.length,0);
  }
});

test('page bounds preserve known eligible products while coverage remains incomplete', async () => {
  const result=await collect(captures(),{maxPages:1});assert.equal(result.complete,false);assert.equal(result.reads,1);assert.equal(result.products.length,1);assert.equal(result.coverage.verified,1);assert.equal(result.coverage.exhaustive,false);assert.equal(result.traversalComplete,false);
  assert.match(result.errors[0].error,/limit/);
});

test('without captures, ordinary HTTP preserves actual status and never impersonates browser DOM', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return{url,status:403,text:async()=>'<html>Access denied</html>'};});
  const result=await collectUggNew({now});
  assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'error');
  assert.equal(result.complete,false);assert.deepEqual(result.products,[]);
  assert.match(result.errors[0].error,/HTTP 403/);
  assert.equal(result.sourceRecords[0].record.transport,'official-http-html');
  assert.equal(result.sourceRecords[0].record.status,403);
});

test('HTTP success is a distinct real-response contract, not a fabricated browser receipt', async () => {
  const c=captures();
  const reader=async(url,{now})=>readUggOfficial(url,{now,fetchImpl:async target=>({url:target,status:200,text:async()=>c.find(r=>r.url===target).html})});
  const result=await collectUggNew({now,read:reader});
  assert.equal(result.complete,false);assert.equal(result.products.length,1);
  assert.ok(result.pages.every(p=>p.transport==='official-http-html'&&p.status===200));
  assert.ok(result.sourceRecords.every(r=>r.record.extraction==='original-http-response-body'));
});

function detail(p=options[4], description='This sneaker has a rubber outsole and foam midsole.') {
  return {brand:'UGG',url:new URL(url(p),'https://www.ugg.com').href,checkedAt:now.toISOString(),transport,extraction,
    html:`<main id="main-content"><div class="product-detail" data-pid="${p.id}"><h1 class="product-name">${p.name}</h1><div class="product-description">${description} Item No. ${p.model}</div><div class="primary-images"><img src="${image(p)}"></div></div></main>`};
}
function endToEnd(products) {
  const boundary=reviewAdminProducts(products,{});
  const scoped=reviewScopedNew(boundary.products);
  const curated=curateCatalog(scoped.products,{now});
  return curated.snapshot.products.map(p=>productPresentation(p,{products:[]})).filter(p=>p&&officialEvidenceFor(p,kstDay(now))&&officialProductUrl(p,kstDay(now))&&officialImageUrl(p,kstDay(now))&&sourceMatches(p,'brand',kstDay(now)));
}

test('exact New-bound selected SKU PDP recovers construction through every publication gate',async()=>{
  const receipt=detail();
  const r=await collect(captures(),{detailCaptures:[receipt]});
  assert.deepEqual(r.detailErrors,[]);
  assert.deepEqual(r.detailSourceRecords,[{url:receipt.url,record:receipt}]);
  assert.equal(r.products.length,2);assert.equal(r.held.length,2);
  assert.equal(r.complete,false);assert.equal(r.coverage.exhaustive,false);
  const p=endToEnd(r.products).find(p=>p.style==='1144032-DYR');assert.ok(p);
  assert.equal(p.arrivalEvidence.url,next);assert.equal(p.officialImageEvidence.sourceUrl,receipt.url);
  assert.equal(r.products[1].constructionEvidence.contentHash,createHash('sha256').update(receipt.html).digest('hex'));
  assert.equal(r.products[1].constructionEvidence.verifiedAt,receipt.checkedAt);
  assert.equal(Object.hasOwn(r.detailSourceRecords[0].record,'status'),false);
});

test('held construction and wrong color cannot leak through the end-to-end publication gates',async()=>{
  for(const mode of ['absent','wrong-color-url','wrong-color-image','neighbor-id','neighbor-title','hidden','insole','inspiration','negative','status','future','stale','script','unbound-description','unbound-photo','nested-neighbor','chronology','manufacturer']){
    const d=detail();const c=captures();
    if(mode==='wrong-color-url')d.url=d.url.replace('DYR','BLK');
    if(mode==='wrong-color-image')d.html=d.html.replace(image(options[4]),image({...options[4],color:'BLK'}));
    if(mode==='neighbor-id')d.html=d.html.replace(options[4].id,options[0].id);
    if(mode==='neighbor-title')d.html=d.html.replace('<h1 class="product-name">Lowmel','<h1 class="product-name">Neighbor');
    if(mode==='hidden')d.html=d.html.replace('class="product-description"','class="product-description" hidden');
    if(mode==='insole')d.html=d.html.replace('rubber outsole and foam midsole','foam insole');
    if(mode==='inspiration')d.html=d.html.replace('This sneaker has','Inspired by a sneaker with');
    if(mode==='negative')d.html=d.html.replace('This sneaker has','This is not a sneaker with');
    if(mode==='status')d.status=200;
    if(mode==='future')d.checkedAt='2026-11-06T00:00:00Z';
    if(mode==='stale')d.checkedAt='2026-11-01T00:00:00Z';
    if(mode==='script')d.html+='<script>sneaker rubber sole</script>';
    if(mode==='manufacturer')d.html=d.html.replace('Item No. 1144032','Item No. 1170750');
    if(mode==='chronology')d.checkedAt='2026-11-05T08:16:00.000Z';
    if(mode==='nested-neighbor')d.html=d.html.replace('<div class="product-description">','<div class="product" data-pid="199727999999"><div class="product-description">').replace('<div class="primary-images">','</div><div class="primary-images">');
    if(mode==='unbound-description')d.html=d.html.replace('<div class="product-description">','</div><div class="product-description">');
    if(mode==='unbound-photo')d.html=d.html.replace('<div class="primary-images">','</div><div class="primary-images">');
    const r=await collect(c,{detailCaptures:mode==='absent'?[]:[d]});
    assert.equal(r.complete,false,mode);assert.equal(r.coverage.exhaustive,false,mode);
    assert.ok(r.held.some(p=>p.style==='1144032-DYR'),mode);
    assert.deepEqual(endToEnd(r.products).map(p=>p.style),['1170910-DCP'],mode);
  }
});

test('PDP never supplies New membership or repairs a missing/wrong-color New own photo',async()=>{
  for(const mode of ['no-root','different-card','wrong-tile-photo','missing-tile-photo']){
    const c=captures(),d=detail();
    if(mode==='no-root')c.shift();
    if(mode==='different-card')c[1].html=c[1].html.replaceAll(url(options[4]),url({...options[4],color:'BLK'}));
    if(mode==='wrong-tile-photo')c[1].html=c[1].html.replaceAll(image(options[4]),image({...options[4],color:'BLK'}));
    if(mode==='missing-tile-photo')c[1].html=c[1].html.replaceAll(image(options[4]),'data:image/png;base64,placeholder');
    const r=await collect(c,{detailCaptures:[d]});
    assert.ok(!endToEnd(r.products).some(p=>p.style.startsWith('1144032-')),mode);
    assert.equal(r.coverage.exhaustive,false,mode);
  }
});

test('hybrids need explicit official sneaker base construction, beyond inspiration or a generic rubber sole',async()=>{
  const p=options[2];
  for(const description of ['A Mary Jane inspired sneaker with rubber sole.','A sneaker with rubber sole.']){
    const c=captures();c[0].html=c[0].html.replaceAll('Quill Ballet Sneaker','Quill Mary Jane');
    const r=await collect(c,{detailCaptures:[detail({...p,name:'Quill Mary Jane'},description)]});
    assert.ok(r.held.some(q=>q.style===`${p.model}-${p.color}`));
    if(!description.includes('inspired'))assert.equal(r.held.find(q=>q.style===`${p.model}-${p.color}`).reason,'hybrid-review-required');
    assert.ok(!endToEnd(r.products).some(q=>q.style===`${p.model}-${p.color}`));
  }
  const r=await collect(captures(),{detailCaptures:[detail(p,'This ballet sneaker has a rubber outsole and foam midsole.')]});
  assert.ok(endToEnd(r.products).some(q=>q.style===`${p.model}-${p.color}`&&q.category==='hybrid'));
});

test('full completion requires resolved eligibility as well as traversal',async()=>{
  const c=captures();
  c[0].html=c[0].html.replaceAll('Quill Ballet Sneaker','Own Sneaker');
  c[1].html=c[1].html.replaceAll('Lowmel','Own Sneaker');
  c[1].html=c[1].html.replaceAll('data:image/png;base64,placeholder',image(options[5]));
  const r=await collect(c);
  assert.equal(r.held.length,0);assert.equal(r.complete,true);assert.equal(r.coverage.exhaustive,true);
  assert.equal(r.coverage.eligibilityComplete,true);assert.equal(r.coverage.classificationComplete,true);
});

test('PDP gallery renditions use actual PDP proof while retaining original New tile evidence',async()=>{
  const d=detail();d.html=d.html.replace('t_product-medium-wp','t_product-detail');
  const r=await collect(captures(),{detailCaptures:new Map([[d.url,d]])});
  assert.deepEqual(r.detailErrors,[]);
  const p=endToEnd(r.products).find(p=>p.style==='1144032-DYR');assert.ok(p);
  assert.equal(p.image,image(options[4]).replace('t_product-medium-wp','t_product-detail'));assert.equal(p.officialImageEvidence.sourceUrl,d.url);
  assert.equal(p.officialImageEvidence.verificationMethod,'official-new-arrivals-and-product-page');
  assert.equal(r.products[1].officialDetailEvidence.url,d.url);
});

function expandedDetail(p=options[4]) {
  const d=detail(p,'A sneaker inspired by the energy of the West Coast. Sugarcane EVA outsole.');
  d.html=d.html.replace(`data-pid="${p.id}"`,`data-pid="${p.model}"`)
    .replace('<div class="product-description">','<div class="card"><button aria-expanded="true"><h2>Details</h2></button><div id="description-info">')
    .replace('<div class="primary-images">','</div><div class="primary-images">');
  d.visibleDetails='untrusted summary; not used as evidence';
  d.visibleSnapshot='untrusted snapshot; not used as evidence';
  return d;
}

test('actual expanded own Details binds manufacturer model, selected gallery and original New proof',async()=>{
  const c=captures(),d=expandedDetail();d.checkedAt='2026-11-05T08:18:00.000Z';
  const later=new Date('2026-11-05T08:19:00.000Z');
  const r=await collect(c,{detailCaptures:[d],now:later});assert.deepEqual(r.detailErrors,[]);
  const p=r.products.find(p=>p.style==='1144032-DYR');assert.ok(p);
  assert.equal(p.arrivalEvidence.url,next);
  assert.equal(p.arrivalEvidence.productUrl,p.url);
  assert.equal(p.arrivalEvidence.contentHash,createHash('sha256').update(c[1].html).digest('hex'));
  assert.equal(p.arrivalEvidence.verifiedAt,c[1].checkedAt);
  assert.equal(p.officialProductEvidence.verifiedAt,d.checkedAt);
  assert.equal(p.officialProductEvidence.verificationMethod,'official-new-arrivals-and-product-page');
  assert.equal(p.officialImageEvidence.sourceUrl,d.url);
  assert.ok(endToEnd(r.products).some(p=>p.style==='1144032-DYR'));
  assert.equal(r.checkedAt,d.checkedAt);
});

test('closed Details and recommendation/summary-only construction never recover a held model',async()=>{
  for(const mode of ['collapsed','recommendation','summary','wrong-manufacturer','SVG']){
    const d=expandedDetail();
    if(mode==='collapsed')d.html=d.html.replace('aria-expanded="true"','aria-expanded="false"');
    if(mode==='recommendation')d.html=d.html.replace('A sneaker inspired by the energy of the West Coast. Sugarcane EVA outsole.','A casual shoe.').replace('</main>','<div class="product-recommendations"><div class="product-description">Sneaker with rubber outsole</div></div></main>');
    if(mode==='summary'){d.html=d.html.replace('A sneaker inspired by the energy of the West Coast. Sugarcane EVA outsole.','A casual shoe.');d.visibleDetails='A sneaker with rubber outsole. Item No. 1144032';d.visibleSnapshot=d.visibleDetails;}
    if(mode==='wrong-manufacturer')d.html=d.html.replace('Item No. 1144032','Item No. 1170750');
    if(mode==='SVG')d.html+='<svg><path></path></svg>';
    const r=await collect(captures(),{detailCaptures:[d]});
    assert.ok(r.held.some(p=>p.style==='1144032-DYR'),mode);
    assert.deepEqual(endToEnd(r.products).map(p=>p.style),['1170910-DCP'],mode);
  }
});


test('conventional closed mesh/laced construction with EVA outsole qualifies without a literal sneaker label',async()=>{
 const own='Suede and mesh upper. Padded collar. Oversized padded tongue. Two-tone laces. Molded footbed. Sugarcane EVA outsole.';
 const c=captures(),d=detail(options[4],own);
 const r=await collect(c,{detailCaptures:[d]});
 assert.deepEqual(r.detailErrors,[]);
 assert.ok(endToEnd(r.products).some(p=>p.style==='1144032-DYR'));
 assert.equal(r.products.find(p=>p.style==='1144032-DYR').constructionEvidence.constructionBasis,'own-closed-laced-mesh-upper-cushioned-outsole');
 for(const fragment of ['mesh','upper','Padded collar','padded tongue','laces','Molded footbed','Sugarcane EVA outsole']){
   const negative=await collect(c,{detailCaptures:[detail(options[4],own.replace(fragment,'unproven'))]});
   assert.ok(!endToEnd(negative.products).some(p=>p.style==='1144032-DYR'),fragment);
 }
 for(const name of ['Quill Mary Jane','Quill Ballet Sneaker','Tasman Weather Hybrid','Own Slip-On','Tazz Molded']){
   const mixed=captures();mixed[1].html=mixed[1].html.replaceAll('Lowmel',name);
   const negative=await collect(mixed,{detailCaptures:[detail({...options[4],name},own)]});
   assert.ok(!endToEnd(negative.products).some(p=>p.style==='1144032-DYR'),name);
 }
});
