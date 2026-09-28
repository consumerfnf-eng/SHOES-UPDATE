import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {POLICY,canonicalBrand,canonicalUrl,shiftMonth,kstDay,curateProduct,curateCatalog,popularity,validateSignals,rankKeywords} from '../scripts/curation.mjs';
import {releaseSentence,parseSalomonCalendar,productDetails,mergePreserving} from '../scripts/collect-evidence.mjs';
import {parseNikeLaunch,nikeProductDetails,parseAsicsCalendar} from '../scripts/official-feeds.mjs';
import {atomicJson,publishCurated} from '../scripts/publish-curated.mjs';
import {parseArticle,parseSocial,keywordsFromText} from '../scripts/collect-signals.mjs';
import {productKeywordIds} from '../scripts/keyword-taxonomy.mjs';
const day='2026-09-28',now=new Date('2026-09-28T01:00:00Z');
const product=(patch={})=>({id:'nike-sku1',brand:'Nike',name:'Retro running sneaker',productType:'sneaker',officialCategory:'Lifestyle sneakers',description:'Retro court silhouette with breathable mesh upper and lightweight cushioning.',style:'SKU001',url:'https://www.nike.com/t/retro/SKU001',image:'https://static.nike.com/SKU001.jpg',releaseDate:'2026-09-01',dateEvidence:{url:'https://www.nike.com/launch/t/retro',precision:'day',verified:true,official:true,verifiedAt:now.toISOString(),excerpt:'SKU001 launches September 1, 2026.'},productVerifiedAt:now.toISOString(),productEvidenceUrl:'https://www.nike.com/t/retro/SKU001',...patch});
test('calendar month boundaries, invalid approximate dates, and KST midnight',()=>{
  assert.equal(shiftMonth('2026-05-31',-3),'2026-02-28');assert.equal(shiftMonth('2024-05-31',-3),'2024-02-29');
  assert.equal(kstDay('2026-09-27T15:00:00Z'),day);
  assert(curateProduct(product({releaseDate:'2026-06-28'}),day).product);
  assert(curateProduct(product({releaseDate:'2026-06-27'}),day).expired);
  assert.match(curateProduct(product({releaseDate:'2026-08'}),day).reason,/release-day/);
});
test('mandatory25 preserved, aliases normalize, collaboration is not new brand',()=>{
  assert.equal(POLICY.brands.filter(x=>x.mandatory).length,25);assert.equal(canonicalBrand('HERMES'),'Hermès');assert.equal(canonicalBrand('Jordan Brand'),'Jordan');assert.equal(canonicalBrand('Cecilie Bahnsen × ASICS'),'ASICS');
  assert.equal(curateCatalog([],{now}).snapshot.brands.filter(x=>x.mandatory).length,25);
});
test('no grandfather exemption and actual structure required',()=>{
  for(const name of ['Classic leather loafer','Suede derby','Winter boot','Ballet flats','High heel sandal','Leather moccasin','Slingback pumps'])assert(curateProduct(product({name,catalogVerification:'official-catalog-2026-09-23'}),day).reason);
  assert.equal(curateProduct(product({name:'Fashion 001',officialCategory:'Shoes',description:'Classic calf leather',productType:'sneaker'}),day).reason,'footwear-type-unverified');
  assert.equal(curateProduct(product({name:'Shoe 001',officialCategory:'Shoes',description:'An elegant leather loafer.'}),day).reason,'excluded-footwear');
});
test('summer forms and reviewed hybrids pass, unreviewed hybrids do not',()=>{
  assert.equal(curateProduct(product({name:'Summer clog',officialCategory:'Clogs',description:'Vented EVA summer cushioning.'}),day).product.category,'clog');
  assert.equal(curateProduct(product({name:'Mary Jane sneaker'}),day).reason,'hybrid-review-required');
  assert.equal(curateProduct(product({name:'Mary Jane sneaker',hybridReview:{approved:true,url:'https://www.nike.com/t/example'}}),day).product.category,'hybrid');
  assert.equal(curateProduct(product({name:'Platform sandal',description:'Casual flat platform EVA cushioning.'}),day).product.category,'platform-sandal');
});
test('release evidence, verification and future official confirmation cannot be bypassed',()=>{
  assert(curateProduct(product({dateEvidence:undefined,firstSeen:now.toISOString()}),day).reason);
  assert(curateProduct(product({dateEvidence:{...product().dateEvidence,verified:false}}),day).reason);
  assert(curateProduct(product({productVerifiedAt:undefined}),day).reason);
  assert.equal(curateProduct(product({releaseDate:'2026-10-01',dateEvidence:{...product().dateEvidence,official:false}}),day).reason,'upcoming-evidence-or-range');
  assert.equal(curateProduct(product({releaseDate:'2026-12-29'}),day).reason,'upcoming-evidence-or-range');
  assert.equal(curateProduct(product({releaseDate:'2026-10-01'}),day).product.releaseStatus,'upcoming');
});
const signal=(i,patch={})=>({type:'sns',url:`https://www.instagram.com/p/p${i}/`,title:'Retro running sneaker',account:`account${i%3}`,publishedAt:'2026-09-25',checkedAt:now.toISOString(),modelMatched:true,sponsored:false,original:true,originalId:`p${i}`,seller:false,brandOwned:false,...patch});
test('SNS requires five originals three accounts fresh nonadvertising sources',()=>{
  const all=Array.from({length:5},(_,i)=>signal(i));assert(popularity(validateSignals(all,day),day).sns);
  assert(!popularity(validateSignals(all.slice(0,4),day),day).sns);
  assert(!popularity(validateSignals(all.map(x=>({...x,account:'same'})),day),day).sns);
  assert(!popularity(validateSignals(all.map(x=>({...x,publishedAt:'2026-09-17'})),day),day).sns);
  assert.equal(validateSignals([...all,signal(0),signal(6,{sponsored:true})],day).length,5);
});
test('editorial popularity counts independent domains and ranks are verified',()=>{
  const s=signal(0,{type:'magazine',independent:true,publisherId:'a'});assert(!popularity([s,{...s,url:'https://another/a'}],day).magazine);
  assert(popularity([s,{...s,publisherId:'b'}],day).magazine);
  assert.equal(validateSignals([signal(0,{type:'ecommerce',rank:1})],day).length,0);
});
test('keywords compare actual seven-day windows and not previous build counts',()=>{
  const a=product({id:'a',sourceSignals:[signal(0,{type:'magazine',keywords:['메쉬'],publishedAt:'2026-09-25'})]}),b=product({id:'b',sourceSignals:[signal(1,{type:'magazine',keywords:['메쉬'],publishedAt:'2026-09-20'})]});
  const result=rankKeywords([a,b],day),mesh=result.find(k=>k.id==='mesh-sheer');assert.equal(mesh.productCount,1);assert.equal(mesh.previousProductCount,1);assert.equal(mesh.growth,0);
  assert.equal(mesh.label,'Mesh / sheer footwear');assert.equal(mesh.matchedProductCount,2);assert.deepEqual(mesh.evidenceProductIds,['a']);
  const noEvidence=rankKeywords([product()],day);assert.equal(noEvidence.length,21);assert(noEvidence.every(k=>k.rank===null));assert.deepEqual(keywordsFromText('breathable mesh upper'),['mesh-sheer']);
  const rawMatch=curateCatalog([product({id:'without-article'})],{now}).snapshot;assert(rawMatch.keywords.find(k=>k.id==='mesh-sheer').productIds.includes('without-article'));assert.equal(rawMatch.keywords.find(k=>k.id==='mesh-sheer').productCount,0);
});
test('keyword color and licensed character matches cannot leak from another colorway or generic construction',()=>{
  const white={name:'CELL GEO CAGE',colorway:'White',colors:[{name:'White'}],description:'The original version was brown.',sourceSignals:[{keywords:['brown']}]};
  assert(!productKeywordIds(white).includes('brown'));assert(productKeywordIds({...white,colorway:'Bitter Chocolate'}).includes('brown'));
  assert(!productKeywordIds({name:'Summer EVA Clog',description:'Made in one piece from lightweight EVA foam'}).includes('character-collaboration'));
  assert(!productKeywordIds({name:'Summer EVA Clog',description:'Flexible one piece EVA construction'}).includes('character-collaboration'));
  assert(!productKeywordIds({name:'Nike one piece foam slide'}).includes('character-collaboration'));
  assert(productKeywordIds({name:'Air Max Plus x One Piece — Gomu Gomu'}).includes('character-collaboration'));
  assert(!productKeywordIds({name:'GENESIS 2 GORE-TEX',description:'Wider midsole platform for stability',sourceSignals:[{keywords:['platform']}]}).includes('platform'));
  assert(productKeywordIds({name:'Platform sneaker'}).includes('platform'));
  assert(productKeywordIds({name:'Court sneaker',description:'An elevated platform sole adds height.'}).includes('platform'));
  const ranked=rankKeywords([{...white,id:'white',keywordTags:productKeywordIds(white),sourceSignals:[signal(1,{type:'magazine',keywords:['brown']})]}],day).find(k=>k.id==='brown');assert.equal(ranked.rank,null);assert.deepEqual(ranked.productIds,[]);
});
test('generic release extraction refuses unrelated, footer, article-date and partial-date claims',()=>{
  assert.equal(releaseSentence('# Retro\nPublished Time: 2026-09-01\nThis item is new.',product()),null);
  assert.equal(releaseSentence('# Retro\nOther Shoe launches on September 1, 2026.',product()),null);
  assert.equal(releaseSentence('# Retro\n## Related\nSKU001 launches on September 1, 2026.',product()),null);
  assert.equal(releaseSentence('SKU001 launches on September 1, 2026.',product()).day,'2026-09-01');
});
test('product details cannot select a recommended product identity or an unrelated image',()=>{
  const text='# Some other product\n## Related\nSKU001 Retro running sneaker\n![related](https://static.nike.com/SKU001.jpg)';
  assert.equal(productDetails(text,product()),null);
});
test('Salomon calendar binds exact dated product and rejects snowclog',()=>{
  const text='\n* [](https://www.salomon.com/en-ca/product/xt-6/L1234) October 1, 2026\n## [XT-6](https://www.salomon.com/en-ca/product/xt-6/L1234)\nSneakers · Unisex $230\n* [](https://www.salomon.com/en-ca/product/snowclog/L5678) October 1, 2026\n## [SNOWCLOG](https://www.salomon.com/en-ca/product/snowclog/L5678)\nSneakers';
  const rows=parseSalomonCalendar(text,'https://www.salomon.com/en-ca/c/launch-calendar/upcoming',now.toISOString());assert.equal(rows.length,1);assert.equal(rows[0].releaseDate,'2026-10-01');assert.equal(rows[0].country,'CA');
});
test('Nike launch binds product id, skips commerce-only restock date and nonfootwear',()=>{
  const state={product:{}};
  state.product.products={data:{items:{a:{id:'a',styleColor:'AA001-100',title:'Air Jordan 1 Retro',productType:'FOOTWEAR',imageSrc:'https://static.nike.com/a.jpg'},b:{id:'b',styleColor:'BB001-100',title:'A jacket',productType:'APPAREL'}}}};
  state.product.threads={data:{items:{t:{productId:'a',seo:{slug:'a'}},u:{productId:'b',seo:{slug:'b'}}}}};
  state.product.launchViews={data:{items:{a:{startEntryDate:'2026-10-01T14:00:00Z'},b:{startEntryDate:'2026-10-01T14:00:00Z'}}}};
  const html=`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{initialState:JSON.stringify(state)}}})}</script>`;
  assert.equal(parseNikeLaunch(html,'https://www.nike.com/launch',now.toISOString()).length,1);
  delete state.product.launchViews.data.items.a.startEntryDate;state.product.products.data.items.a.commerceStartDate='2026-10-01T14:00:00Z';
  const noLaunch=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{initialState:JSON.stringify(state)}}})}</script>`;
  assert.equal(parseNikeLaunch(noLaunch,'https://www.nike.com/launch',now.toISOString()).length,0);
});
test('ASICS release tile requires exact product URL and explicit year/date',()=>{
  const html='<a href="/us/en-us/atmos/p/ANA_1203B092-100.html"><img src="https://images.asics.com/a.jpg"><div>October 9, 2026 <strong>ATMOS x GEL-KAYANO 12.1</strong></div></a>';
  const a=parseAsicsCalendar(html,'https://www.asics.com/us/en-us/releases/',now.toISOString());assert.equal(a.length,1);assert.equal(a[0].style,'1203B092-100');
});
test('merge retains original records and nonempty fields',()=>{
  const old=[product({custom:'human value'})];const merged=mergePreserving(old,[{id:old[0].id,image:'',description:'fresh',releaseDate:'2020-01-01'}]);assert.equal(merged[0].custom,'human value');assert.equal(merged[0].image,old[0].image);assert.equal(old[0].description,product().description);assert.equal(merged[0].releaseDate,old[0].releaseDate);assert.equal(merged[0].description,old[0].description);
  assert.notEqual(canonicalUrl('https://eu.puma.com/product?swatch=01'),canonicalUrl('https://eu.puma.com/product?swatch=02'));
});
test('editorial evidence excludes recommended-product identity and keywords',()=>{
  const config={magazineDomains:['example.com'],newsletterDomains:[]};
  const args={url:'https://example.com/story',type:'magazine',product:product(),checkedAt:now.toISOString(),config};
  assert.equal(parseArticle('Title: Different model\nPublished Time: 2026-09-25\nAn unrelated story.\n## Related products\nSKU001 breathable mesh upper',args),null);
  const article=parseArticle('Title: SKU001 review\nPublished Time: 2026-09-25\nSKU001 has a sculptural upper.\n## Read next\nAnother shoe has a breathable mesh upper',args);
  assert.deepEqual(article.keywords,['sculptural-upper']);
});
test('reviewed evidence rejects conflicting IDs and never joins a SKU across brands or variants',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'curated-identity-'));
  try {
    const existing=product({lastSignalCheckedAt:'2026-09-28T02:00:00Z',sourceSignals:[signal(0,{type:'magazine',keywords:['메쉬']})]});
    await atomicJson(path.join(dir,'data/catalog-source.json'),{products:[existing]});
    await atomicJson(path.join(dir,'data/release-evidence.json'),{products:[product({brand:'PUMA'})]});
    await assert.rejects(publishCurated({directory:dir,now}),/Conflicting reviewed product identity/);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'data/catalog-source.json'),'utf8')).products[0].brand,'Nike');
    await atomicJson(path.join(dir,'data/release-evidence.json'),{products:[{style:'SKU001',releaseDate:'2020-01-01'},product({sourceSignals:[]})]});
    const result=await publishCurated({directory:dir,now});assert.equal(result.snapshot.products[0].releaseDate,'2026-09-01');assert.equal(result.snapshot.products[0].sourceSignals.length,1);
    await atomicJson(path.join(dir,'data/release-evidence.json'),{products:[product({brand:'PUMA',id:'puma-same-sku'})]});
    await publishCurated({directory:dir,now});const raw=JSON.parse(await fs.readFile(path.join(dir,'data/catalog-source.json'),'utf8'));assert.equal(raw.products.length,2);assert.equal(raw.products[0].brand,'Nike');
    await atomicJson(path.join(dir,'data/catalog-source.json'),{products:[product({url:'https://www.nike.com/product?swatch=01'})]});
    await atomicJson(path.join(dir,'data/release-evidence.json'),{products:[product({url:'https://www.nike.com/product?swatch=02'})]});
    await assert.rejects(publishCurated({directory:dir,now}),/Conflicting reviewed product identity/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('publication preserves complete raw records, supports URL atomic files, expiry keeps successful publish stamp',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'curated-shoes-'));
  try{await atomicJson(new URL('file:///'+path.join(dir,'data/catalog-source.json').replaceAll('\\','/')),{schemaVersion:1,products:[product({custom:'preserve me'}),product({id:'unknown',dateEvidence:undefined})]});
    const first=await publishCurated({directory:dir,now});assert.equal(first.snapshot.products.length,1);
    const source=JSON.parse(await fs.readFile(path.join(dir,'data/catalog-source.json'),'utf8'));assert.equal(source.products.length,2);assert.equal(source.products[0].custom,'preserve me');
    const next=await publishCurated({directory:dir,now:new Date('2027-01-01T01:00:00Z'),maintenance:true});assert.equal(next.snapshot.products.length,0);assert.equal(next.queue.products.length,1);assert.equal(next.snapshot.publishedAt,first.snapshot.publishedAt);
    const previous=await fs.readFile(path.join(dir,'public/data/catalog.json'),'utf8');await fs.writeFile(path.join(dir,'data/catalog-source.json'),'bad json');await assert.rejects(publishCurated({directory:dir,now}));assert.equal(await fs.readFile(path.join(dir,'public/data/catalog.json'),'utf8'),previous);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
