import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {SALOMON_NEW_URL,SALOMON_NEW_FILTER,salomonNewBootstrap,salomonSearchContract,salomonNewRows,collectSalomonNew,salomonSwatchTargets,collectSalomonNewVariants} from '../scripts/collect-salomon-new.mjs';
import {reviewAdminProducts} from '../scripts/admin-publication-review.mjs';
import {reviewScopedNew} from '../scripts/review-scoped-new.mjs';
import {classifyFootwear,curateCatalog,officialEvidenceFor,kstDay} from '../scripts/curation.mjs';
import {productPresentation} from '../scripts/product-presentation.mjs';

const index='prod_v2_en-US_products',at='2026-11-05T07:00:00.000Z';
const params={distinct:true,filters:SALOMON_NEW_FILTER,hitsPerPage:2,page:0,enableABTest:false};
const hit=(style='L49210800',overrides={})=>({objectID:style,modelName:'XT-4 OG GORE TEX',modelCode:'LI8806$',detailedTitle:'Unisex · Sneakers',gtmProductCategory1:'sportstyle_shoes-low',url:'https://www.salomon.com/en-us/product/xt-4-og-gore-tex-li8806/'+style,imageBaseUrl:'https://cdn.dam.salomon.com',image:'/actual-asset/'+style+'/PNG-2000px-max-72dpi.png',price:220,swatches:{[style]:{image:'/actual-asset/'+style+'/PNG-2000px-max-72dpi.png'},[style==='L45419000'?'L45419001':'L45419000']:{image:'/other-asset/'+(style==='L45419000'?'L45419001':'L45419000')+'/PNG-2000px-max-72dpi.png'}},...overrides});
const result=(hits,page=0,total=hits.length,size=2)=>({index,hits,page,nbHits:total,nbPages:Math.ceil(total/size),hitsPerPage:size});
const request={indexName:index,...params};
function htmlFor(r,filter=SALOMON_NEW_FILTER) {
  const data={[index]:{state:{index,filters:filter},requestParams:[{...params,filters:filter}],results:[r]}};
  const flight='e:'+JSON.stringify(['$','$Lba',null,{indexName:index,filters:filter,publicKey:'fixture-public-search-key'}])+'\n';
  return `<h1>New Arrivals</h1><script>window[Symbol.for("InstantSearchInitialResults")] = ${JSON.stringify(data)}</script><script>self.__next_f.push(${JSON.stringify([1,flight])})</script><script src="https://www.salomon.com/_next/static/immutable/chunks/40kktjibmen_n.js"></script>`;
}
const parse=r=>salomonNewRows(r,{indexName:index,request,at});

test('bootstrap reads exact New query JSON and source-bound public config without evaluating scripts',()=>{
  const b=salomonNewBootstrap(htmlFor(result([hit()])));assert.equal(b.indexName,index);assert.equal(b.params.filters,SALOMON_NEW_FILTER);assert.equal(b.searchKey,'fixture-public-search-key');
  assert.equal(b.result.hits[0].objectID,'L49210800');
  assert.throws(()=>salomonNewBootstrap(htmlFor(result([hit()]),'categoryPageId:"shoes"')),/exact New category/);
  assert.throws(()=>salomonNewBootstrap(htmlFor(result([hit()])),'https://www.salomon.com/en-us/c/shoes'),/Exact official/);
  assert.throws(()=>salomonNewBootstrap('<title>Access Denied</title>'),/CHALLENGE/);
});
test('public client contract must be observed on the official host and include actual read endpoint',()=>{
  const u='https://www.salomon.com/_next/static/immutable/chunks/40kktjibmen_n.js';
  const c=salomonSearchContract('e.s(["K",0,"K1N6GB06IP"];${e}-dsn.algolia.net;path:"/1/indexes/*/queries"',u);
  assert.equal(c.url,'https://k1n6gb06ip-dsn.algolia.net/1/indexes/*/queries');
  assert.throws(()=>salomonSearchContract('unrecognized',u),/changed/);
  assert.throws(()=>salomonSearchContract('unrecognized','https://fake.example/client.js'),/Unobserved/);
});
test('only the source primary SKU/image is emitted; neighboring swatches and source timestamps do not become New variants/dates',()=>{
  const r=parse(result([hit('L49210800',{releaseDateTime:1791381600000})]));assert.equal(r.products.length,1);
  const p=r.products[0];assert.equal(p.style,'L49210800');assert.match(p.image,/\/L49210800\//);assert.equal(p.arrivalEvidence.productUrl,p.url);assert.equal(p.arrivalEvidence.queryFilter,SALOMON_NEW_FILTER);
  assert.equal(p.releaseDate,undefined);assert.equal(p.arrivalEvidence.date,undefined);assert.equal(p.firstSeen,at);assert.equal(p.modelGroupId,'salomon|LI8806');
  assert.equal(reviewAdminProducts(r.products,{}).products.length,1);assert.equal(reviewScopedNew(r.products).products.length,1);assert.equal(classifyFootwear(p).category,'sneaker');
});
test('source low athletic classification accepts adult trail/road/gravel runners; excludes kids, skis, boots, clogs and slides',()=>{
  const rows=[
    hit('L49199100',{detailedTitle:'Men · Trail running shoes',gtmProductCategory1:'trail-running_shoes-low'}),
    hit('L45410400',{detailedTitle:'Unisex · Gravel running shoes',gtmProductCategory1:'road-running_shoes-low'}),
    hit('L45412000',{detailedTitle:'Women · Road running shoes',gtmProductCategory1:'road-running_shoes-low'}),
    hit('L49180400',{modelName:'SNOWCLOG OG',detailedTitle:'Unisex · Sneakers'}),
    hit('L45475700',{modelName:'RX SLIDE 3.0 ATQ'}),
    hit('L49281800',{modelName:'S/LAB EQUIPE SKATE BOA',detailedTitle:'Unisex · Nordic Boots · Skate',gtmProductCategory1:'racing_xc-boots'}),
    hit('L49189200',{modelName:'QST 100',detailedTitle:'Unisex · Alpine Skis',gtmProductCategory1:'freeride_ski'}),
    hit('L49300000',{detailedTitle:"Junior · Kids' shoes",gtmProductCategory1:'junior-performance_shoes-low'}),
    hit('L49196100',{modelName:'X-ALP MID LEATHER GORE-TEX',gtmProductCategory1:'sportstyle_shoes-mid'}),
  ];const r=parse(result(rows));assert.equal(r.products.length,3);assert.equal(r.excluded.length,5);assert.equal(r.held.length,1);
});
test('wrong SKU paths, offsite images and cross-brand product URLs cannot bind to a sneaker record',()=>{
  for(const overrides of [{url:'https://www.salomon.com/en-us/product/xt-4/L45419000'},{url:'https://fake.example/en-us/product/xt-4/L49210800'},{image:'/asset/L45419000/PNG.png'},{imageBaseUrl:'https://fake.example'}]){
    const r=parse(result([hit('L49210800',overrides)]));assert.equal(r.products.length,0);assert.equal(r.held.length,1);
  }
  assert.throws(()=>salomonNewRows(result([hit()]),{indexName:index,request:{...request,filters:'ordinary catalogue'}}),/provenance/);
});
test('all primary-result pages reconcile while color completeness and brand-wide completeness remain false',async()=>{
  const first=result([hit(),hit('L49306800')],0,3),last=result([hit('L45404200')],1,3);const calls=[];
  const r=await collectSalomonNew({now:new Date(at),readHtml:async()=>htmlFor(first),readSearch:async(body,context)=>{calls.push({body,context});return {results:[last]};}});
  assert.equal(r.products.length,3);assert.deepEqual(r.errors,[]);assert.equal(calls.length,1);assert.equal(calls[0].body.requests[0].filters,SALOMON_NEW_FILTER);assert.equal(calls[0].body.requests[0].page,1);
  const c=r.coverage[0];assert.equal(c.sourcePaginationComplete,true);assert.equal(c.read,3);assert.equal(c.total,null);assert.equal(c.exhaustive,false);assert.equal(c.exhausted,false);assert.equal(c.allColorVariantsVerified,false);assert.equal(r.sourceCoverage[0].exhausted,true);
  assert.ok(!JSON.stringify(r).includes('fixture-public-search-key'));
});
test('page bound stops requests and reports partial enumeration honestly',async()=>{
  const r=await collectSalomonNew({now:new Date(at),maxPages:1,readHtml:async()=>htmlFor(result([hit(),hit('L49306800')],0,3)),readSearch:async()=>{throw Error('must not request');}});
  assert.equal(r.products.length,2);assert.equal(r.coverage[0].sourcePaginationComplete,false);assert.equal(r.coverage[0].pages,1);assert.equal(r.coverage[0].pagesExpected,2);assert.deepEqual(r.errors,[]);
});
test('repeat pages, changing totals, mismatched page numbers and request failures never claim completion',async()=>{
  const first=result([hit(),hit('L49306800')],0,3);
  for(const failure of ['duplicate','total','page','network']) {
    const r=await collectSalomonNew({now:new Date(at),readHtml:async()=>htmlFor(first),readSearch:async()=>{
      if(failure==='network')throw Error('timeout');const last=result([hit(failure==='duplicate'?'L49210800':'L45404200')],1,3);if(failure==='total')last.nbHits=4;if(failure==='page')last.page=0;return {results:[last]};
    }});assert.equal(r.products.length,2);assert.equal(r.coverage[0].sourcePaginationComplete,false);assert.equal(r.errors.length,1);assert.equal(r.coverage[0].read,2);
  }
});
test('invalid New source reports failed scope instead of empty successful collection',async()=>{
  const r=await collectSalomonNew({readHtml:async()=>'<h1>Best Sellers</h1>'});assert.equal(r.products.length,0);assert.equal(r.coverage[0].status,'failed');assert.equal(r.coverage[0].scopedOfficialNew,false);
});
test('actual local cached New HTML yields bound adult primary products without swatch expansion',async t=>{
  let d;try{const idx=JSON.parse(await fs.readFile(new URL('../reports/admin-rendered-index.json',import.meta.url),'utf8')),entry=idx[SALOMON_NEW_URL];if(!entry){t.skip('Optional cache absent');return;}d=JSON.parse(gunzipSync(await fs.readFile(new URL('../'+entry.path,import.meta.url))));}catch(e){if(e.code==='ENOENT'){t.skip('Optional cache absent');return;}throw e;}
  const b=salomonNewBootstrap(d.html||d.rawHtml),r=salomonNewRows(b.result,{indexName:b.indexName,request:{indexName:b.indexName,...b.params},at:d.checkedAt});
  assert.equal(b.result.hits.length,24);assert.equal(b.result.nbHits,244);assert.equal(r.products.length,14);assert.ok(r.products.every(p=>p.image.includes('/'+p.style+'/')));
});

const colorResult=(hits,page,total)=>({...result(hits,page,total),params:new URLSearchParams({distinct:'false',filters:SALOMON_NEW_FILTER,ruleContexts:'subSegment-D2C'}).toString(),exhaustiveNbHits:true});
async function variantFixture() {
  const a=hit('L49210800',{swatches:{L49210800:{image:'/actual-asset/L49210800/PNG-2000px-max-72dpi.png'},L45419000:{image:'/actual-asset/L45419000/PNG-2000px-max-72dpi.png',stickers:[]},L49240200:{image:'/actual-asset/L49240200/PNG-2000px-max-72dpi.png',stickers:[],isInStock:true}}});
  const b=hit('L49306800',{swatches:{L49306800:{image:'/actual-asset/L49306800/PNG-2000px-max-72dpi.png'},L45404900:{image:'/actual-asset/L45404900/PNG-2000px-max-72dpi.png',stickers:[]}}});
  const primary=result([a,b]),html=htmlFor(primary);
  const previous=await collectSalomonNew({now:new Date(at),readHtml:async()=>html,maxPages:1});
  const pages=[colorResult([a,hit('L45419000')],0,5),colorResult([b,hit('L45404900')],1,5),colorResult([hit('L49189200',{modelName:'QST 100',detailedTitle:'Unisex · Alpine Skis',gtmProductCategory1:'freeride_ski'})],2,5)];
  return {previous,pages,html};
}
test('individual colors require their own New-filter response; a model swatch alone cannot supply membership',()=>{
  const h=hit('L45419000'),r=colorResult([h],0,1),req={...request,distinct:false};
  assert.throws(()=>salomonNewRows(r,{indexName:index,request:req}),/provenance/);
  const p=salomonNewRows(r,{indexName:index,request:req,membershipMode:'individual-color-record',at}).products[0];
  assert.equal(p.style,'L45419000');assert.equal(p.arrivalEvidence.queryDistinct,false);assert.equal(p.arrivalEvidence.membershipUnit,'individual-color-record');assert.match(p.image,/\/L45419000\//);
  assert.throws(()=>salomonNewRows({...r,params:new URLSearchParams({distinct:'false',filters:'ordinary catalogue'}).toString()},{indexName:index,request:req,membershipMode:'individual-color-record'}),/unchanged New filter/);
});
test('every retained swatch is reconciled; stocked colors absent from complete New results remain unresolved',async()=>{
  const f=await variantFixture(),targets=salomonSwatchTargets(f.previous);assert.equal(targets.references,3);assert.equal(targets.targets.length,3);
  const calls=[];const r=await collectSalomonNewVariants({previous:f.previous,now:new Date(at),readHtml:async()=>f.html,readSearch:async body=>{const q=body.requests[0];calls.push(q);return {results:[f.pages[q.page]]};}});
  assert.deepEqual(r.errors,[]);assert.equal(r.products.length,4);assert.equal(r.excluded.length,1);assert.equal(r.unresolved.length,1);assert.equal(r.unresolved[0].style,'L49240200');
  assert.match(r.unresolved[0].reason,/absent-from-complete-public-US/);assert.equal(r.unresolved[0].ownNewStickerPresent,false);assert.equal(r.unresolved[0].eligibilityStatus,'not-promoted');
  assert.deepEqual(r.swatchCoverage,{references:3,targets:3,checked:3,verifiedNewMembers:2,unresolved:1,pendingDueToIncompleteQuery:0,eligibleProductsAdded:2,allTargetsCheckedAgainstCompleteNewScope:true,ownBadgeOnlyPromotions:0});
  assert.ok(calls.every(q=>q.filters===SALOMON_NEW_FILTER&&q.distinct===false));assert.equal(r.coverage[0].sourcePaginationComplete,true);assert.equal(r.coverage[0].exhaustive,false);assert.equal(r.coverage[0].total,null);
  assert.equal(reviewAdminProducts(r.products,{}).products.length,4);assert.equal(reviewScopedNew(r.products).products.length,4);
  const curated=curateCatalog(r.products,{now:new Date(at)});assert.equal(curated.snapshot.products.length,4,JSON.stringify(curated.review.held));
  assert.ok(curated.snapshot.products.every(p=>officialEvidenceFor(p,kstDay(at))&&productPresentation(p,{products:[]})));
});
test('retained errors resume failed pages while successful pages keep their original observation times',async()=>{
  const f=await variantFixture();
  const first=await collectSalomonNewVariants({previous:f.previous,now:new Date(at),readHtml:async()=>f.html,readSearch:async b=>{const p=b.requests[0].page;if(p===1)throw Error('retained timeout');return {results:[f.pages[p]]};}});
  assert.equal(first.errors.length,1);assert.equal(first.errors[0].page,1);assert.deepEqual(first.variantCheckpoint.completedPages,[0,2]);assert.equal(first.coverage[0].sourcePaginationComplete,false);assert.equal(first.swatchCoverage.pendingDueToIncompleteQuery,2);
  const calls=[];const resumed=await collectSalomonNewVariants({previous:first,now:new Date(Date.parse(at)+1000),readHtml:async()=>f.html,readSearch:async b=>{const p=b.requests[0].page;calls.push(p);return {results:[f.pages[p]]};}});
  assert.deepEqual(calls,[0,1]);assert.equal(resumed.coverage[0].reusedPages,1);assert.deepEqual(resumed.errors,[]);assert.equal(resumed.retainedErrors[0].error,'retained timeout');assert.equal(resumed.retainedErrors[0].status,'resolved');assert.equal(resumed.variantEvidence.find(e=>e.request.page===2).observedAt,at);assert.equal(resumed.products.length,4);
});
test('initialization failure preserves prior verified products, page evidence, checkpoint and errors for later retry',async()=>{
  const f=await variantFixture(),done=await collectSalomonNewVariants({previous:f.previous,now:new Date(at),readHtml:async()=>f.html,readSearch:async b=>({results:[f.pages[b.requests[0].page]]})});
  const failed=await collectSalomonNewVariants({previous:done,now:new Date(Date.parse(at)+1000),readHtml:async()=>{throw Error('HTML 403');}});
  assert.equal(failed.products.length,4);assert.equal(failed.variantEvidence.length,3);assert.equal(failed.variantCheckpoint.fingerprint,done.variantCheckpoint.fingerprint);assert.equal(failed.variantCheckpoint.retainedEvidenceOnly,true);assert.equal(failed.coverage[0].sourcePaginationComplete,false);assert.equal(failed.errors[0].error,'HTML 403');
  const calls=[];const retry=await collectSalomonNewVariants({previous:failed,now:new Date(Date.parse(at)+2000),readHtml:async()=>f.html,readSearch:async b=>{calls.push(b.requests[0].page);return {results:[f.pages[b.requests[0].page]]};}});
  assert.deepEqual(calls,[0]);assert.equal(retry.products.length,4);assert.equal(retry.retainedErrors.find(e=>e.error==='HTML 403').status,'resolved');
});
test('changed page-zero cohort or expired pages forces fresh requests instead of silently reusing old evidence',async()=>{
  const f=await variantFixture(),done=await collectSalomonNewVariants({previous:f.previous,now:new Date(at),readHtml:async()=>f.html,readSearch:async b=>({results:[f.pages[b.requests[0].page]]})});
  for(const mode of ['expired','changed']) {
    const pages=structuredClone(f.pages);if(mode==='changed')pages[0].hits[0].price=221;
    const calls=[];const r=await collectSalomonNewVariants({previous:done,now:new Date(Date.parse(at)+(mode==='expired'?3600001:1000)),readHtml:async()=>f.html,readSearch:async b=>{calls.push(b.requests[0].page);return {results:[pages[b.requests[0].page]]};}});
    assert.deepEqual(calls,[0,1,2]);assert.equal(r.coverage[0].reusedPages,0);
  }
});
test('variant request bounds and approximate totals never turn missing colors into proven absence',async()=>{
  const f=await variantFixture();
  const bounded=await collectSalomonNewVariants({previous:f.previous,now:new Date(at),maxPages:1,readHtml:async()=>f.html,readSearch:async b=>({results:[f.pages[b.requests[0].page]]})});
  assert.equal(bounded.coverage[0].networkRequests,1);assert.equal(bounded.coverage[0].paginationLimitReached,true);assert.equal(bounded.coverage[0].sourcePaginationComplete,false);assert.ok(bounded.unresolved.every(s=>/incomplete-retry-pending/.test(s.reason)));
  const approximate=await collectSalomonNewVariants({previous:f.previous,now:new Date(at),readHtml:async()=>f.html,readSearch:async()=>({results:[{...f.pages[0],exhaustiveNbHits:false}]})});
  assert.equal(approximate.coverage[0].sourcePaginationComplete,false);assert.match(approximate.errors[0].error,/not exhaustive/);assert.equal(approximate.swatchCoverage.verifiedNewMembers,0);
});
