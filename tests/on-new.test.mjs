import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {ON_NEW,onNewPage,collectOnNew,collectCachedOnNew} from '../scripts/collect-on-new.mjs';
import {hasArrivalEvidence} from '../public/assets/publication-window.mjs';
import {officialEvidenceFor,curateCatalog,kstDay} from '../scripts/curation.mjs';
import {productPresentation} from '../scripts/product-presentation.mjs';
import {officialImageUrl} from '../public/assets/catalog-view.mjs';
import {reviewAdminProducts} from '../scripts/admin-publication-review.mjs';
import {reviewScopedNew} from '../scripts/review-scoped-new.mjs';

const at='2026-11-05T06:52:07.326Z';
const now=new Date('2026-11-05T08:00:00Z');
const copy=value=>JSON.parse(JSON.stringify(value));
const image='https://images.ctfassets.net/hnk2vsx53n6l/6LvMm0tnW1n5mWcsgVGnwo/7a9026f5c677afdc2862a53c43ad5208/d9cb66673e39049db0d07300ab19e600fc65f4aa.png';
const secondImage='https://images.ctfassets.net/hnk2vsx53n6l/other-asset/hash/other.png';
const makeUrl=(group,sku,{model='cloudmonster-bb-m',audience='mens',color='sienna-sienna'}={})=>`https://www.on.com/en-us/products/${model}-${group.toLowerCase()}/${audience}/${color}-shoes-${sku}`;
function group({id='3MG3124',sku='3MG31246884',name="Men's Cloudmonster BB",description='Men – All-day comfort',url=makeUrl(id,sku),asset=image}={}){
 return {'@type':'ProductGroup',name,description,url,productGroupID:id,brand:{'@type':'Brand',name:'On'},hasVariant:[
  {'@type':'Product',name:name+' Sienna | Sienna',sku,image:asset,color:'Sienna | Sienna',offers:{'@type':'Offer',url,price:180,priceCurrency:'USD',availability:'https://schema.org/InStock',itemCondition:'https://schema.org/NewCondition'}}
 ]};
}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;');
function card(g,{sku=g.hasVariant[0].sku,url=g.url,asset=g.hasVariant[0].image,badge='New color',summary=g.description,name=g.name.replace(/^(?:Men|Women)'s\s+/,'')}={}){
 // Same nesting and public attributes as the captured On productResults grid.
 return `<li><article data-sku="${sku}" data-test-id="productCard-0"><a href="${url}" data-wk-name="productCardLink"><picture><source srcset="${escape(asset)}?w=1500&amp;h=1500 1500w"><img src="${escape(asset)}?fm=webp" alt="${name}"></picture></a><div><ul><li><a href="${url}" data-sku="${sku}" data-test-id="productSiblingButton-0"><img src="${escape(asset)}?w=96"></a></li></ul></div><a href="${url}" data-wk-name="productCardLink"><p class="_label_capture_102">${badge}</p><p data-test-id="productTitle">${name}</p><p data-test-id="productSummary">${summary}</p></a></article></li>`;
}
function page({groups=[group()],cards,total=groups.length,visibleTotal=total,positions=groups.map((_,i)=>i+1),extra='',canonical=ON_NEW,heading='New arrivals: Shoes',itemType='ItemList'}={}){
 const data={'@context':'https://schema.org','@graph':[{'@type':itemType,numberOfItems:total,itemListElement:groups.map((g,i)=>({'@type':'ListItem',position:positions[i],item:g}))}]};
 return `<html><head><title>New arrivals: Shoes | On United States</title><link rel="canonical" href="${canonical}"><script id="json-ld" type="application/ld+json">${JSON.stringify(data)}</script></head><body><nav>Kids Sandals Boots</nav><h1>${heading}</h1><div class="ais-Stats"><div>${visibleTotal} Results</div></div><div class="ais-InfiniteHits"><ul data-test-id="productResults">${cards??groups.map(g=>card(g)).join('')}</ul></div>${extra}</body></html>`;
}

function downstream(rows,checkedAt){
 const time=new Date(checkedAt),today=kstDay(time);
 for(const row of rows){
  assert.ok(officialEvidenceFor(row,today),row.style+' official evidence');
  assert.equal(officialImageUrl(row,today),row.image);
  assert.equal(row.officialProductEvidence.verificationMethod,'official-new-listing-sku-image');
  assert.equal(row.officialImageEvidence.sourceUrl,ON_NEW);
  assert.notEqual(row.officialImageEvidence.sourceUrl,row.url); // no fabricated PDP read
  const binding=row.sourceTileBinding;
  assert.equal(binding.verified,true);assert.equal(binding.brand,'On');
  assert.equal(binding.style,row.style);assert.equal(binding.tileSku,row.style);assert.equal(binding.jsonLdSku,row.style);
  assert.equal(binding.manufacturerStyle,row.manufacturerStyle);assert.equal(binding.productVariantId,row.productVariantId);
  assert.equal(binding.url,row.url);assert.equal(binding.image,row.image);assert.equal(binding.sourceUrl,ON_NEW);
  assert.equal(binding.contentHash,row.arrivalEvidence.contentHash);assert.equal(binding.contentHash,row.officialProductEvidence.contentHash);
  assert.equal(binding.contentHash,row.officialImageEvidence.contentHash);assert.equal(binding.verifiedAt,row.productVerifiedAt);
  assert.match(binding.tileHash,/^[a-f0-9]{64}$/);
 }
 const boundary=reviewAdminProducts(rows,{});assert.deepEqual(boundary.held,[]);
 const scoped=reviewScopedNew(boundary.products);assert.deepEqual(scoped.held,[]);assert.deepEqual(scoped.repaired,[]);
 const curated=curateCatalog(scoped.products,{now:time});assert.deepEqual(curated.review.held,[]);
 assert.equal(curated.snapshot.products.length,rows.length);
 for(const row of curated.snapshot.products){
  const original=rows.find(p=>p.id===row.id);
  assert.equal(row.style,original.style);assert.equal(row.manufacturerStyle,original.manufacturerStyle);
  assert.equal(row.productVariantId,original.productVariantId);assert.equal(row.url,original.url);assert.equal(row.image,original.image);
  assert.equal(row.officialImageEvidence.sourceUrl,ON_NEW);assert.ok(officialEvidenceFor(row,today));
  const presented=productPresentation(row,{products:[]});assert.ok(presented,row.style+' presentation');
  assert.equal(presented.presentation.method,'brand-own-product-photo');assert.equal(presented.presentation.sourceUrl,ON_NEW);
  assert.equal(presented.presentation.image,original.image);assert.equal(officialImageUrl(presented,today),original.image);
 }
}

test('selected On listing proof clears admin, curation, presentation and client image gates',t=>{
 t.mock.timers.enable({apis:['Date'],now:now.getTime()});
 const html=page(),r=onNewPage(html,ON_NEW,{at}),p=r.products[0];
 downstream(r.products,at);
 assert.equal(p.manufacturerStyle,'3MG31246884');assert.equal(p.sourceTileBinding.productGroupId,'3MG3124');
 assert.equal(p.sourceTileBinding.position,1);
 assert.equal(p.sourceTileBinding.tileHash,createHash('sha256').update(card(group()).match(/<article\b[\s\S]*<\/article>/)[0]).digest('hex'));
 assert.equal(p.sourceTileBinding.contentHash,createHash('sha256').update(html).digest('hex'));
});

test('listing contract remains closed to wrong SKU, photo, source and mixed hashes downstream',t=>{
 t.mock.timers.enable({apis:['Date'],now:now.getTime()});
 const p=onNewPage(page(),ON_NEW,{at}).products[0];
 for(const change of [
  row=>{row.style='3MG31241043';},
  row=>{row.image=secondImage;},
  row=>{row.url=makeUrl('3MG3124','3MG31241043');},
  row=>{row.officialImageEvidence.sourceUrl='https://www.on.com/en-us/shop/shoes';},
  row=>{row.arrivalEvidence.contentHash='f'.repeat(64);},
 ]){
  const broken=copy(p);change(broken);
  assert.equal(officialEvidenceFor(broken,'2026-11-05'),null);
  assert.equal(officialImageUrl(broken,'2026-11-05'),'');
  assert.equal(productPresentation(broken,{products:[]}),null);
 }
});

test('recognized listing proof preserves expiry and explicit photograph refusals',t=>{
 t.mock.timers.enable({apis:['Date'],now:now.getTime()});
 const p=onNewPage(page(),ON_NEW,{at}).products[0];
 assert.equal(productPresentation(p,{products:[{id:p.id,brand:p.brand,style:p.style,originalImage:p.image,approved:false}]}),null);
 const expired=new Date('2027-02-06T08:00:00Z');
 assert.equal(officialEvidenceFor(p,kstDay(expired)),null);
 assert.equal(officialImageUrl(p,kstDay(expired)),'');
 const result=curateCatalog([p],{now:expired});
 assert.equal(result.snapshot.products.length,0);assert.equal(result.review.held.length,1);
});

test('exact selected New SKU and primary card image produce normalized On evidence without an invented date',()=>{
 const r=onNewPage(page(),ON_NEW,{at});
 assert.equal(r.products.length,1);assert.equal(r.excluded.length,0);assert.equal(r.coverage.total,1);assert.equal(r.coverage.exhaustive,true);
 const p=r.products[0];
 assert.equal(p.brand,'On');assert.equal(p.style,'3MG31246884');assert.equal(p.image,image);assert.equal(p.url,group().url);
 assert.equal(p.name,'Cloudmonster BB');assert.equal(p.gender,'Men');assert.equal(p.colorway,'Sienna / Sienna');assert.equal(p.productType,'sneaker');
 assert.equal(p.arrivalEvidence.productUrl,p.url);assert.equal(p.arrivalEvidence.style,p.style);assert.equal(p.arrivalEvidence.brand,'On');
 assert.equal(p.arrivalEvidence.kind,'new-arrivals-listing');assert.equal(p.officialImageEvidence.sourceUrl,ON_NEW);
 assert.equal(p.productVerifiedAt,at);assert.equal(p.firstSeen,at);assert.equal(p.releaseDate,undefined);assert.equal(p.dateEvidence,undefined);
 assert.equal(hasArrivalEvidence(p,'2026-11-05'),true);
});

test('color siblings, NewCondition and recommendations never become independent New products',()=>{
 const g=group(),sibling=copy(g.hasVariant[0]);sibling.sku='3MG31241043';sibling.image=secondImage;sibling.offers.url=makeUrl(g.productGroupID,sibling.sku,{color:'black-black'});g.hasVariant.push(sibling);
 const recommendation=group({id:'3WF1010',sku:'3WF10105070',name:"Women's Cloudsurfer 2",description:'Women – Everyday running',url:makeUrl('3WF1010','3WF10105070',{audience:'womens',model:'cloudsurfer-2'})});
 const outside=`<section data-test-id="productRecommendations">${card(recommendation)}</section>`;
 const r=onNewPage(page({groups:[g],extra:outside}),ON_NEW,{at});
 assert.deepEqual(r.products.map(p=>p.style),['3MG31246884']);assert.equal(r.coverage.read,1);
});

for(const [name,change] of [
 ['image from a different product',g=>{g.hasVariant[0].image=secondImage;}],
 ['image host lookalike',g=>{g.hasVariant[0].image=image.replace('images.ctfassets.net','images.ctfassets.net.evil.example');}],
 ['style URL mismatch',g=>{g.hasVariant[0].offers.url=makeUrl(g.productGroupID,'3MG31241043');}],
 ['foreign product host',g=>{g.url=g.url.replace('www.on.com','evil.example');g.hasVariant[0].offers.url=g.url;}],
 ['missing exact variant',g=>{g.hasVariant[0].sku='3MG31241043';}],
 ['wrong group representative',g=>{g.url=makeUrl(g.productGroupID,'3MG31241043');}]
])test(`strict own-card binding rejects ${name}`,()=>{
 const g=group(),originalCard=card(g);change(g);
 const r=onNewPage(page({groups:[g],cards:originalCard}),ON_NEW,{at});
 assert.equal(r.products.length,0);assert.equal(r.missing.length,1);assert.equal(r.coverage.exhaustive,false);assert.equal(r.coverage.total,null);
});

test('a correct image in a sibling swatch cannot rescue a wrong primary image',()=>{
 const g=group(),bad=card(g,{asset:secondImage}).replace('</ul></div>',`<li><img src="${image}"></li></ul></div>`);
 const r=onNewPage(page({cards:bad}),ON_NEW,{at});assert.equal(r.products.length,0);assert.equal(r.missing[0].reason,'own-selected-sku-image-mismatch');
});

test('adult type comes from its own title, audience and summary, excluding children and non-sneakers',()=>{
 const candidates=[
  group({id:'3KF1004',sku:'3KF10045147',name:'Cloudswift Kids',description:'Kids – All-day play',url:makeUrl('3KF1004','3KF10045147',{audience:'unisex',model:'cloudswift-kids'})}),
  group({id:'3YG1005',sku:'3YG10055142',name:'Cloudsurfer Youth',description:'Youth – Running, 8-12 year olds',url:makeUrl('3YG1005','3YG10055142',{audience:'unisex',model:'cloudsurfer-youth'})}),
  group({id:'3MG3091',sku:'3MG30910553',name:"Men's Cloudsolo Hiker",description:'Men – Lifestyle, all-day',url:makeUrl('3MG3091','3MG30910553',{model:'cloudsolo-hiker-m'})}),
  group({id:'3WG3058',sku:'3WG30586230',name:"Women's Cloudnova Moon Mary Jane",description:'Women – All-day comfort',url:makeUrl('3WG3058','3WG30586230',{audience:'womens',model:'cloudnova-moon-mary-jane-w'})}),
 ];
 const r=onNewPage(page({groups:[group(),...candidates]}),ON_NEW,{at});
 assert.equal(r.products.length,1);assert.deepEqual(r.excluded.map(e=>e.reason),['not-adult','not-adult','not-confirmed-sneaker','not-confirmed-sneaker']);assert.equal(r.coverage.read,5);assert.equal(r.coverage.exhaustive,true);
});

test('adult unisex long-run athletic shoes qualify and audience contradictions do not',()=>{
 const g=group({id:'3UG1001',sku:'3UG10015799',name:'LightSpray Cloudmonster 3 Hyper',description:'Unisex – Long runs, tempo runs, responsive ride',url:makeUrl('3UG1001','3UG10015799',{audience:'unisex',model:'cloudmonster-3-hyper-ls-u'})});
 assert.equal(onNewPage(page({groups:[g]}),ON_NEW,{at}).products[0].gender,'Unisex');
 g.description='Men – Long runs, smooth ride';
 assert.equal(onNewPage(page({groups:[g]}),ON_NEW,{at}).excluded[0].reason,'not-confirmed-adult');
});

test('Coming soon card overrides generic JSON-LD InStock and NewCondition',()=>{
 const r=onNewPage(page({cards:card(group(),{badge:'Coming soon'})}),ON_NEW,{at});
 assert.equal(r.products.length,0);assert.equal(r.excluded[0].reason,'coming-soon');assert.equal(r.coverage.exhaustive,true);
});

test('missing product type or own-card summary mismatch cannot be repaired by navigation',()=>{
 const g=group();
 assert.equal(onNewPage(page({groups:[g],cards:card(g,{summary:'Women – Everyday running'})}),ON_NEW,{at}).missing[0].reason,'own-card-name-or-type-mismatch');
 g.description='Men – Premium materials';
 assert.equal(onNewPage(page({groups:[g]}),ON_NEW,{at}).excluded[0].reason,'not-confirmed-sneaker');
});

test('actual total is not inferred from extracted rows; incomplete rendered pagination stays partial',async()=>{
 const html=page({total:2});
 const r=onNewPage(html,ON_NEW,{at});
 assert.equal(r.products.length,1);assert.equal(r.coverage.total,null);assert.equal(r.coverage.reportedTotal,2);assert.equal(r.coverage.read,1);
 assert.equal(r.coverage.exhaustive,false);assert.match(r.errors[0].error,/no public next-page contract/);
 let reads=0;
 await assert.rejects(collectOnNew({at,readHtml:async url=>{assert.equal(url,ON_NEW);reads++;return html;}}),e=>e.partial.products.length===1);
 assert.equal(reads,1);
 assert.equal((await collectOnNew({at,allowPartial:true,readHtml:async()=>html})).products.length,1);
});

test('incomplete grid with complete JSON-LD does not promote unseen variants',()=>{
 const a=group(),b=group({id:'3MG3128',sku:'3MG31286457',name:"Men's THE ROGER Clubhouse BB",url:makeUrl('3MG3128','3MG31286457',{model:'the-roger-clubhouse-bb-m'})});
 const r=onNewPage(page({groups:[a,b],cards:card(a)}),ON_NEW,{at});
 assert.equal(r.products.length,1);assert.equal(r.coverage.sourceExhaustive,false);assert.equal(r.coverage.reportedTotal,2);
});

test('disagreeing totals, repeated cards/positions/groups and truncated grids fail closed',()=>{
 assert.throws(()=>onNewPage(page({visibleTotal:2}),ON_NEW,{at}),/totals disagree/);
 assert.throws(()=>onNewPage(page({cards:card(group())+card(group())}),ON_NEW,{at}),/repeated.*SKU/);
 assert.throws(()=>onNewPage(page({groups:[group(),group()],positions:[1,1]}),ON_NEW,{at}),/repeated.*group/);
 assert.throws(()=>onNewPage(page().replace('</ul></div></body>','</div></body>'),ON_NEW,{at}),/truncated/);
});

test('page identity and New section are required; JSON-LD NewCondition is insufficient',()=>{
 assert.throws(()=>onNewPage(page(),ON_NEW.replace('/new-arrivals',''),{at}),/official US New/);
 assert.throws(()=>onNewPage(page({canonical:'https://www.on.com/en-us/shop/shoes'}),ON_NEW,{at}),/identity/);
 assert.throws(()=>onNewPage(page({heading:'Shoes'}),ON_NEW,{at}),/identity/);
 assert.throws(()=>onNewPage('<title>Access Denied</title>',ON_NEW,{at}),/blocked/);
 assert.throws(()=>onNewPage(page().replace('"@context":"https://schema.org"','not valid JSON'),ON_NEW,{at}),/Malformed/);
});

function mockCache(t,{statusCode=200,sourceURL=ON_NEW,checkedAt=at,path='logs/admin-rendered/'+ 'a'.repeat(64)+'.json.gz'}={}){
 const original=fs.readFile.bind(fs);
 t.mock.method(fs,'readFile',async(file,...args)=>{
  if(String(file).endsWith('fixture-on-index.json'))return JSON.stringify({[ON_NEW]:{path,checkedAt}});
  if(String(file).replaceAll('\\','/').endsWith(path))return gzipSync(JSON.stringify({html:page(),rawHtml:page(),checkedAt,requestedUrl:ON_NEW,metadata:{statusCode,sourceURL,url:sourceURL}}));
  return original(file,...args);
 });
}

test('cache capture time is preserved, no requests or output writes during library collection',async t=>{
 mockCache(t);t.mock.method(globalThis,'fetch',async()=>{throw Error('Network forbidden');});t.mock.method(fs,'writeFile',async()=>{throw Error('Write forbidden');});
 const r=await collectCachedOnNew({indexPath:'fixture-on-index.json',now});
 assert.equal(r.checkedAt,at);assert.equal(r.products[0].arrivalEvidence.verifiedAt,at);assert.equal(r.sourceCapture.checkedAt,at);assert.equal(r.products[0].brand,'On');
});

test('blocked, stale, redirected and traversal cache entries are rejected',async t=>{
 for(const options of [{statusCode:403},{sourceURL:'https://www.on.com/en-us/shop/shoes'},{path:'../outside.json.gz'}, {checkedAt:'2026-11-01T00:00:00Z'}]){
  await t.test(JSON.stringify(options),async t=>{mockCache(t,options);await assert.rejects(collectCachedOnNew({indexPath:'fixture-on-index.json',now}),/identity|missing|stale/);});
 }
});

test('read failures propagate; there is no generic or guessed-URL fallback',async()=>{
 const reads=[];
 await assert.rejects(collectOnNew({at,readHtml:async url=>{reads.push(url);throw Error('HTTP 403');}}),/403/);
 assert.deepEqual(reads,[ON_NEW]);
});

test('real cached official snapshot reconciles 55 results while excluding 10 recommendations and related colors',async t=>{
 let index;
 try{index=JSON.parse(await fs.readFile(new URL('../reports/admin-rendered-index.json',import.meta.url),'utf8'));}
 catch{return t.skip('Local official capture not installed');}
 if(!index[ON_NEW])return t.skip('Local official On capture not installed');
 const r=await collectCachedOnNew({now:new Date(index[ON_NEW].checkedAt)});
 assert.equal(r.coverage.total,55);assert.equal(r.coverage.read,55);assert.equal(r.coverage.exhaustive,true);
 assert.equal(r.products.length,43);assert.equal(r.excluded.length,12);assert.equal(r.missing.length,0);
 assert.equal(r.excluded.filter(e=>e.reason==='not-adult').length,5);
 assert.equal(r.excluded.filter(e=>e.reason==='coming-soon').length,4);
 assert.ok(!r.products.some(p=>p.style==='3WF10105070')); // recommendation
 assert.ok(!r.products.some(p=>p.style==='3WE30221200')); // related colour, not selected New card
 assert.equal(new Set(r.products.map(p=>p.style)).size,43);
 assert.ok(r.products.every(p=>p.brand==='On'&&p.arrivalEvidence.verifiedAt===r.sourceCapture.checkedAt));
 t.mock.timers.enable({apis:['Date'],now:new Date(r.sourceCapture.checkedAt).getTime()});
 downstream(r.products,r.sourceCapture.checkedAt);
});
