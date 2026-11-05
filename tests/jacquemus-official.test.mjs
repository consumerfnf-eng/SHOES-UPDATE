import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectJacquemusOfficial,parseJacquemusListing,JACQUEMUS_SOURCES} from '../scripts/collect-jacquemus-official.mjs';
import {officialEvidenceFor,curateProduct} from '../scripts/curation.mjs';
import {mergeCollectedRuns} from '../scripts/admin-collected-union.mjs';

const [men,women]=JACQUEMUS_SOURCES,at='2026-11-05T10:00:00.000Z',now=new Date(at);
const first='FOM00175AC43M061JT',second='FOM00175AW00255990',unisex='FOU00176BW00712030';
const url=sku=>`https://www.jacquemus.com/en_us/the-tennis/${sku}.html`;
const image=(sku,slot=17)=>`https://www.jacquemus.com/dw/image/v2/BJFJ_PRD/on/demandware.static/-/Sites-master-jacquemus/default/dw12345/26H${sku}_${slot}.jpg?sw=500&q=100`;
const escaped=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
function item(sku){return {'@type':'Product',url:url(sku),name:'The Tennis',description:'Soft sneakers.',brand:{'@type':'Brand',name:'Jacquemus'},offers:{'@type':'Offer',url:url(sku),sku,price:'590.00',priceCurrency:'USD'}};}
function tile(sku,{source=men,src=image(sku),modelId=sku,destination=url(sku),outside=false,modelCategory=['Shoes','Sneakers'],merch=false,marked=merch}={}){
  const model={id:modelId,category_1:modelCategory[0],category_2:modelCategory[1],name:'The Tennis',price:590,brand:'Jacquemus<br>',color:'White / Red',block_destination:destination};
  const img=`<img class="product__visuals__content" alt="The Tennis" src="${escaped(src)}">`;
  return (outside?img:'')+`<product-tile data-pid="${sku}" ${marked?'data-is-merch-tile="true" data-template="double"':''} data-url-back-browser="${new URL(source).pathname}" data-breadcrumb="{&quot;html&quot;:&quot;<nav>Own breadcrumb</nav>&quot;}">`+
    (merch?`<a href="${url(sku)}">${outside?'':img}</a>`:`<div><input data-gtmga4data="${escaped(JSON.stringify(model))}"></div><div>${outside?'':img}</div><a href="${url(sku)}">The Tennis</a>`)+`</product-tile>`;
}
function page(skus,{source=men,total=skus.length,start=0,size=12,next=[],tiles,entries=skus.map(item),counter=true}={}){
  const root=new URL(source);root.search='';
  const schema={'@type':'ItemList',itemListElement:entries.map((item,i)=>({'@type':'ListItem',position:i+1,item}))};
  const breadcrumb={'@type':'BreadcrumbList',itemListElement:[{name:'Sneakers',item:root.href}]};
  return `<html><script type="application/ld+json">${JSON.stringify(schema)}</script><script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>`+
    (tiles??skus.map(sku=>tile(sku,{source})).join(''))+
    `<div data-page-size="${size}" data-page-number="${start/size}"></div>`+
    (counter?`<span id="applyResultsCount">${total}</span>`:'')+
    `<noscript>${next.map(u=>`<a href="${escaped(u)}">See next page</a>`).join('')}</noscript></html>`;
}

test('own sibling tile images and exact SFCC/JSON-LD identity produce typed names, colour and price without PDP reads',async()=>{
  const html=page([first]),calls=[];
  const run=await collectJacquemusOfficial({sources:[men],now,read:async source=>{calls.push(source);return html;}});
  assert.deepEqual(calls,[men]);
  assert.equal(run.pending.length,0);
  assert.equal(run.products.length,1);
  assert.equal(run.coverage[0].exhaustive,true);
  const p=run.products[0],hash=createHash('sha256').update(html).digest('hex');
  assert.equal(p.name,'The Tennis');assert.equal(p.colorway,'White / Red');assert.equal(p.priceLabel,'$590.00');
  assert.equal(p.style,first);assert.equal(p.image,image(first));assert.equal(p.productEvidenceUrl,men);
  assert.equal(p.sourceTileBinding.tilePid,first);assert.equal(p.sourceTileBinding.jsonLdSku,first);assert.equal(p.sourceTileBinding.modelId,first);
  for(const evidence of [p.arrivalEvidence,p.officialProductEvidence,p.officialImageEvidence,p.sourceTileBinding])assert.equal(evidence.contentHash,hash);
  assert(officialEvidenceFor(p,'2026-11-05'));
  const curated=curateProduct(p,'2026-11-05');assert(curated.product,curated.reason);
  assert.equal(mergeCollectedRuns([run],['Jacquemus']).length,1);
});

test('source pagination follows only observed noscript pages and checkpoints unread work',async()=>{
  const next=men+'?start=1&sz=1',calls=[],snapshots=[];
  const pages=new Map([[men,page([first],{total:2,size:1,next:[next]})],[next,page([second],{total:2,size:1,start:1,source:next})]]);
  const run=await collectJacquemusOfficial({sources:[men],now,read:async source=>{calls.push(source);return pages.get(source);},onProgress:s=>snapshots.push(s)});
  assert.deepEqual(calls,[men,next]);
  assert.equal(snapshots[0].listingReceipts.length,1);
  assert.equal(snapshots[0].listingPending[0].source.url,next);
  assert.equal(snapshots[0].coverage[0].exhaustive,false);
  assert.equal(run.coverage[0].exhaustive,true);
  assert.equal(run.products.length,2);
});

test('full colour SKU and own tile boundaries reject wrong-colour, model-only, foreign or adjacent images',()=>{
  for(const config of [
    {src:image(second)},
    {src:image('FOM00175')},
    {src:image(first).replace('www.jacquemus.com','images.example.com')},
    {outside:true},
  ]){
    const result=parseJacquemusListing(page([first],{tiles:tile(first,config)}),{url:men,checkedAt:at});
    assert.equal(result.products.length,0,JSON.stringify(config));
    assert.equal(result.pending[0].reason,'JACQUEMUS_OWN_FULL_SKU_IMAGE_MISSING');
  }
});

test('tile, explicit product model, destination and JSON-LD offer must agree on the exact SKU',()=>{
  for(const config of [{modelId:second},{destination:url(second)}]){
    const result=parseJacquemusListing(page([first],{tiles:tile(first,config)}),{url:men,checkedAt:at});
    assert.equal(result.products.length,0);
    assert.equal(result.pending[0].reason,'JACQUEMUS_TILE_MODEL_BINDING_INVALID');
  }
  const mismatched=item(first);mismatched.offers.url=url(second);
  const result=parseJacquemusListing(page([first],{entries:[mismatched]}),{url:men,checkedAt:at});
  assert.equal(result.products.length,0);
  assert.equal(result.pending[0].reason,'JACQUEMUS_JSONLD_TILE_IDENTITY_MISMATCH');
});

test('source-explicit editorial merchandise placements are bound exclusions, never duplicate products',async()=>{
  const html=page([first],{total:2,tiles:tile(first)+tile(first,{merch:true})});
  const run=await collectJacquemusOfficial({sources:[men],now,read:async()=>html});
  assert.equal(run.products.length,1);
  assert.equal(run.coverage[0].exhaustive,true);
  const source=run.coverage[0].sources[0];
  assert.equal(source.declaredTotal,2);assert.equal(source.uniqueObserved,1);assert.equal(source.uniqueObservedGridItems,2);assert.equal(source.explicitEditorialExclusions,1);
  const exclusion=run.candidateOutcomes.find(o=>o.outcome==='explicitlyexcluded');
  assert.equal(exclusion.evidence.marker,'data-is-merch-tile=true');
  assert.equal(exclusion.evidence.contentHash,run.listingReceipts[0].contentHash);
  assert.equal(exclusion.evidence.tileHash.length,64);
  const unknown=await collectJacquemusOfficial({sources:[men],now,read:async()=>page([],{total:1,tiles:tile(first,{merch:true,marked:false})})});
  assert.equal(unknown.coverage[0].exhaustive,false,'missing own metadata is not an editorial exclusion');
  assert.equal(unknown.pending.length,1);
});

test('unisex SKUs deduplicate across shelves while complete proof envelopes remain together',async()=>{
  const run=await collectJacquemusOfficial({now,read:async source=>page([unisex],{source})});
  assert.equal(run.products.length,1);
  assert.equal(run.products[0].gender,'Unisex');
  assert.equal(run.coverage[0].sources.length,2);
  assert.equal(run.coverage[0].exhaustive,true);
  const p=run.products[0];
  assert.equal(p.officialProductEvidence.contentHash,p.officialImageEvidence.contentHash);
  assert.equal(p.arrivalEvidence.contentHash,p.officialProductEvidence.contentHash);
  assert.equal(p.arrivalEvidence.url,p.officialImageEvidence.sourceUrl);
});

test('marketing categories do not override exact source Sneakers membership',()=>{
  for(const modelCategory of [['Accessories','Shoes'],['Men','New In - "Sapin"']]){
    const result=parseJacquemusListing(page([first],{tiles:tile(first,{modelCategory})}),{url:men,checkedAt:at});
    assert.equal(result.products.length,1);
  }
  assert.throws(()=>parseJacquemusListing(page([first]).replace('"name":"Sneakers"','"name":"Shoes"'),{url:men,checkedAt:at}),/SNEAKER_BREADCRUMB_UNVERIFIED/);
});

test('unknown, zero, mixed or mismatching counters and unverified items remain partial even without Next',async()=>{
  const cases=[
    page([first],{counter:false}),
    page([],{total:0}),
    page([first],{total:2}),
    page([first,second],{total:1}),
    page([first]).replace('</html>','<span id="applyResultsCount">2</span></html>'),
    page([first],{tiles:tile(first,{src:image(second)})}),
    page([first],{counter:false})+'<p>We offer 1 products.</p>',
  ];
  for(const html of cases){const run=await collectJacquemusOfficial({sources:[men],now,read:async()=>html});assert.equal(run.coverage[0].exhaustive,false);}
});

test('page limits and failed listing reads retain their frontier and errors',async()=>{
  const next=men+'?start=1&sz=1',firstPage=page([first],{total:2,size:1,next:[next]});
  const limited=await collectJacquemusOfficial({sources:[men],now,maxPagesPerSource:1,read:async()=>firstPage});
  assert.equal(limited.products.length,1);assert.equal(limited.coverage[0].exhaustive,false);assert.equal(limited.listingPending[0].source.url,next);
  const failed=await collectJacquemusOfficial({sources:[men],now,read:async source=>{if(source===next)throw Error('timeout');return firstPage;}});
  assert.equal(failed.products.length,1);assert.equal(failed.coverage[0].exhaustive,false);assert.equal(failed.listingPending[0].source.url,next);
  assert.equal(failed.coverage[0].errors[0].error,'timeout');
});

test('wrong offsets, repeated pages, redirects and forbidden filter URLs cannot prove exhaustion',async()=>{
  const next=men+'?start=1&sz=1';
  const repeat=await collectJacquemusOfficial({sources:[men],now,read:async source=>page([first],{total:2,size:1,start:source===men?0:1,next:source===men?[next]:[]})});
  assert.equal(repeat.coverage[0].exhaustive,false);
  assert(repeat.coverage[0].errors.some(e=>e.error==='JACQUEMUS_REPEATED_GRID_EXHAUSTION_UNPROVEN'));
  const redirected=await collectJacquemusOfficial({sources:[men],now,read:async()=>({url:women,status:200,rawHtml:page([first])})});
  assert.equal(redirected.coverage[0].exhaustive,false);assert.equal(redirected.listingPending.length,1);
  assert.throws(()=>parseJacquemusListing(page([first]),{url:men+'?prefn1=color',checkedAt:at}),/SOURCE_SCOPE/);
  const bad=parseJacquemusListing(page([first],{source:next,start:0,size:1}),{url:next,checkedAt:at});
  assert(bad.errors.some(e=>e.error==='JACQUEMUS_PAGE_OFFSET_MISMATCH'));
});
