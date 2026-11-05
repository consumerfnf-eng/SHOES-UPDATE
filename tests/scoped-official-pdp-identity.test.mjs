import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dedupeScopedPrepared,bindPreparedRaw,exactOfficialPdpKey,sameExactOfficialPdp,retainScopedVariantFields} from '../scripts/scoped-prepared.mjs';
import {scopedSportsMerge} from '../scripts/publish-sports-casual.mjs';
import {curateCatalog,officialEvidenceFor,popularity} from '../scripts/curation.mjs';
import {samePhysicalVariant} from '../public/assets/product-identity.mjs';

const at='2026-11-05T07:14:43.859Z',today='2026-11-05',brand='Lanvin',sku='FUSKDK12ECSKA2610';
const productUrl=`https://www.lanvin.com/en-us/woman/shoes/sneakers/curb-snake-sneakers-in-leather-${sku}.html`;
const image='https://www.lanvin.com/dw/image/v2/BGDG_PRD/on/demandware.static/-/Sites-57/default/dw7fe4fc8f/images/zoom/FUSKDK12ECSKA26_10_1.jpg';
const cached='/images/'+'a'.repeat(64)+'.webp';
function raw({id='new-lanvin',style=sku,url=productUrl,img=image,officialId=false,...patch}={}){
  const proof={verified:true,brand,style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:'complete-proof-'+id,...(officialId?{identifierType:'official-product-id'}:{})};
  const source='https://www.lanvin.com/en-us/woman/shoes/sneakers/';
  return {id,brand,name:'CURB SNAKE SNEAKERS IN LEATHER',style,...(officialId?{styleType:'official-product-id'}:{}),url,image:img,officialCategory:'Sneakers',productVerifiedAt:at,productEvidenceUrl:source,firstSeen:at,priceLabel:'',sourceSignals:[],
    officialProductEvidence:{...proof,url},officialImageEvidence:{...proof,url:img,sourceUrl:source},arrivalEvidence:{...proof,kind:'official-assortment-listing',url:source,productUrl:url,excerpt:'Official CURB sneaker category card'},...patch};
}
function prepared(r,{cache=cached}={}){
  const result=curateCatalog([r],{now:new Date(at)});assert.equal(result.snapshot.products.length,1);
  const p=result.snapshot.products[0];return {...p,presentation:{image:p.image,cachedPath:cache},scopedNewReview:{verified:true,brand:p.brand,style:p.style,url:p.url,image:p.image,checkedAt:at}};
}
function fixture(){
  const oldRaw=raw({id:'baseline-lanvin',style:'curb-snake-sneakers-in-leather-'+sku,officialId:true,img:image+'?sw=280&sh=373',priceLabel:'USD 1290',price:1290,currency:'USD'});
  const old={...prepared(oldRaw),price:1290,currency:'USD',manufacturerStyle:'previous-family-code',modelGroupId:'lanvin|reviewed-curb-snake',colorway:'White / Black',bodyColor:'#dedddd',colorSwatches:['#dedddd','#222222'],firstPublishedAt:'2026-09-01T00:00:00Z'};
  old.colourReview={verified:true,id:old.id,brand,style:old.style,url:old.url,image:old.image,presentationImage:old.presentation.image,checkedAt:'2026-11-02T00:00:00Z'};
  old.colorEvidence={method:'reviewed-product-photo',image:old.image,label:old.colorway};
  const r=raw({manufacturerStyle:sku}),p=prepared(r);
  return {oldRaw,old,r,p,catalog:{products:[old],brands:[]},source:{products:[oldRaw]}};
}
const options={today,at,includeLux:true,allowedBrands:[brand]};

test('exact verified official PDP outranks legacy slug and image-rendition differences',()=>{
  const f=fixture(),before=structuredClone(f);
  assert.equal(sameExactOfficialPdp(f.old,f.p,today),true);
  const out=scopedSportsMerge(f.catalog,f.source,[f.p],[f.r],options),p=out.snapshot.products[0],r=out.source.products[0];
  assert.equal(out.report.added.length,0);assert.equal(out.report.refreshed.length,1);assert.equal(out.report.duplicates[0].reason,'exact-official-product-url');
  assert.equal(p.id,f.old.id);assert.equal(r.id,f.old.id);assert.equal(p.style,sku);assert.equal(r.style,sku);assert.equal(p.manufacturerStyle,sku);
  assert.equal(p.priceLabel,'USD 1290');assert.equal(p.price,1290);assert.equal(p.currency,'USD');assert.equal(r.priceLabel,'USD 1290');assert.equal(r.price,1290);
  assert.equal(p.modelGroupId,f.old.modelGroupId);assert.equal(p.colorway,f.old.colorway);assert.deepEqual(p.colorSwatches,f.old.colorSwatches);
  assert.equal(p.colourReview.style,sku);assert.equal(p.colourReview.url,p.url);assert.equal(p.colourReview.image,p.image);assert.equal(p.colourReview.id,p.id);assert.equal(p.colourReview.checkedAt,f.old.colourReview.checkedAt);
  assert.equal(p.colourReview.retentionBasis,'identical-sha256-product-photo');assert.equal(p.firstPublishedAt,f.old.firstPublishedAt);
  assert.equal(Object.hasOwn(p,'styleType'),false);assert.equal(Object.hasOwn(r,'styleType'),false);
  assert.ok(officialEvidenceFor(p,today));assert.ok(officialEvidenceFor(r,today));assert.deepEqual(f,before);
  const again=scopedSportsMerge(out.snapshot,out.source,[f.p],[f.r],options);
  assert.deepEqual(again.snapshot.products,out.snapshot.products);assert.deepEqual(again.source.products,out.source.products);
});

test('fresh verified prices win; no old styleType survives a replaced raw proof envelope',()=>{
  const f=fixture();f.p.priceLabel='USD 1390';f.r.priceLabel='USD 1390';f.r.styleType='official-product-id';
  const out=scopedSportsMerge(f.catalog,f.source,[f.p],[f.r],options);
  assert.equal(out.snapshot.products[0].priceLabel,'USD 1390');assert.equal(out.source.products[0].priceLabel,'USD 1390');
  assert.equal(Object.hasOwn(out.source.products[0],'styleType'),false);assert.ok(officialEvidenceFor(out.source.products[0],today));
});

test('dedupe retains the complete winning proof and missing prices without splicing identity fields',()=>{
  const f=fixture(),strong={...f.p,productVariantId:sku},weak={...f.old,id:'alternate-old'};
  const out=dedupeScopedPrepared([weak,strong],{today});assert.equal(out.length,1);
  assert.equal(out[0].id,strong.id);assert.equal(out[0].style,sku);assert.equal(Object.hasOwn(out[0],'styleType'),false);
  assert.equal(out[0].priceLabel,'USD 1290');assert.equal(out[0].manufacturerStyle,sku);assert.equal(out[0].modelGroupId,f.old.modelGroupId);
  assert.deepEqual(out[0].officialProductEvidence,strong.officialProductEvidence);assert.deepEqual(out[0].officialImageEvidence,strong.officialImageEvidence);assert.ok(officialEvidenceFor(out[0],today));
});

test('all variant/color queries stay significant even when SKU and photograph match',()=>{
  for(const key of ['c','variant','color','dwvar_ARTICLE_color','selection']){
    const a=prepared(raw({id:'color-a',url:productUrl+`?${key}=1`})),b=prepared(raw({id:'color-b',url:productUrl+`?${key}=16`}));
    assert.equal(sameExactOfficialPdp(a,b,today),false,key);assert.equal(dedupeScopedPrepared([a,b],{today}).length,2,key);
    const out=scopedSportsMerge({products:[a],brands:[]},{products:[raw({id:a.id,url:a.url})]},[b],[raw({id:b.id,url:b.url})],options);
    assert.equal(out.report.added.length,1,key);assert.equal(out.snapshot.products.length,2,key);
    assert.throws(()=>dedupeScopedPrepared([a,{...b,id:a.id}],{today}),/different products|different color/,key);
  }
});

test('different explicit color variants on an unqualified model URL remain distinct',()=>{
  const a={...prepared(raw({id:'a'})),productVariantId:'color-1'},b={...prepared(raw({id:'b'})),productVariantId:'color-16'};
  assert.equal(dedupeScopedPrepared([a,b],{today}).length,2);
  const out=scopedSportsMerge({products:[a],brands:[]},{products:[]},[b],[raw({id:'b'})],options);assert.equal(out.report.added.length,1);
});

test('raw binding cannot borrow another selected color with the same model style',()=>{
  const first=raw({id:'first-color',url:productUrl+'?variant=1'}),second=raw({id:'second-color',url:productUrl+'?variant=16'});
  const p=prepared(second);assert.equal(bindPreparedRaw([p],[first,second])[0].url,second.url);
  assert.throws(()=>bindPreparedRaw([p],[first]),/No matching reviewed raw SKU/);
});

test('tracking and query order normalize, but locale storefront paths are not inferred equivalent',()=>{
  const a=prepared(raw({id:'a',url:productUrl+'?c=1&variant=55&utm_source=a#top'}));
  const b=prepared(raw({id:'b',url:productUrl+'?variant=55&c=1&fbclid=tracking'}));
  assert.equal(sameExactOfficialPdp(a,b,today),true);assert.equal(dedupeScopedPrepared([a,b],{today}).length,1);
  const f=fixture(),locale=prepared(raw({url:productUrl.replace('/en-us/','/en-gb/'),img:image+'?new-photo=1'}),{cache:'/images/'+'b'.repeat(64)+'.webp'});
  assert.equal(sameExactOfficialPdp(f.old,locale,today),false);
  const out=scopedSportsMerge(f.catalog,f.source,[locale],[raw({url:locale.url,img:locale.image})],options);assert.equal(out.report.added.length,1);
});

test('unverified or wrong-brand evidence cannot establish an exact official PDP match',()=>{
  const f=fixture();f.old.officialProductEvidence.verified=false;
  assert.equal(exactOfficialPdpKey(f.old,today),'');assert.equal(sameExactOfficialPdp(f.old,f.p,today),false);
  const p={...f.p,officialProductEvidence:{...f.p.officialProductEvidence,brand:'Prada'}};
  assert.equal(exactOfficialPdpKey(p,today),'');assert.equal(dedupeScopedPrepared([f.old,f.p],{today}).length,2);
});

test('an exact verified PDP beats a misleading photo/code collision with another record',()=>{
  const f=fixture(),otherRaw=raw({id:'other',url:productUrl.replace(sku,'FUSKOTHER00001')}),other={...prepared(otherRaw),id:'other'};
  const catalog={products:[other,f.old],brands:[]},source={products:[otherRaw,f.oldRaw]};
  const out=scopedSportsMerge(catalog,source,[f.p],[f.r],options);
  assert.equal(out.report.refreshed[0].id,f.old.id);assert.deepEqual(out.snapshot.products[0],other);assert.equal(out.report.added.length,0);
});

test('different photographs do not inherit stale photo reviews; same-variant group and price remain',()=>{
  const f=fixture(),changed={...f.p,image:image+'?different=1',presentation:{image:image+'?different=1',cachedPath:'/images/'+'c'.repeat(64)+'.webp'}};
  const retained=retainScopedVariantFields(changed,f.old);
  assert.equal(retained.colourReview,undefined);assert.equal(retained.colorEvidence,undefined);assert.equal(retained.bodyColor,undefined);assert.equal(retained.colorSwatches,undefined);
  assert.equal(retained.modelGroupId,f.old.modelGroupId);assert.equal(retained.priceLabel,f.old.priceLabel);
});

const root=new URL('../',import.meta.url);
const read=async path=>JSON.parse(await fs.readFile(new URL(path,root),'utf8'));
async function savedInputs(t,files){try{return await Promise.all(files.map(read));}catch(e){if(e.code==='ENOENT'){t.skip('Local follow-up baseline/artifacts are not present');return null;}throw e;}}
test('saved follow-up Lanvin baseline: 40 exact PDP refreshes and 25 additions, keeping all 65 new SKU proofs',async t=>{
  const data=await savedInputs(t,['.secrets/admin-followup-before/catalog.json','.secrets/admin-followup-before/catalog-source.json','reports/admin-recheck-followup-20261105/manual-lanvin-products.json']);if(!data)return;
  const [base,source,run]=data,old=base.products.filter(p=>p.brand===brand),rows=curateCatalog(run.products,{now:new Date(at)}).snapshot.products;
  assert.equal(old.length,40);assert.equal(rows.length,65);
  const incoming=rows.map(p=>({...p,presentation:{image:p.image,cachedPath:'/images/'+createHash('sha256').update(p.id+'new-rendition').digest('hex')+'.jpg'},scopedNewReview:{verified:true,brand,style:p.style,url:p.url,image:p.image,checkedAt:at}}));
  assert.equal(incoming.filter(p=>old.some(q=>samePhysicalVariant(q,p))).length,0,'the legacy matcher misses every baseline URL overlap');
  const out=scopedSportsMerge({products:old,brands:[]},{products:source.products.filter(p=>p.brand===brand)},incoming,run.products,options);
  assert.equal(out.report.refreshed.length,40);assert.equal(out.report.added.length,25);assert.equal(out.report.held.length,0);assert.equal(out.snapshot.products.length,65);
  // The raw baseline already has 80 Lanvin records. Existing historical IDs
  // are retained; this change must add only the 25 genuinely new PDPs.
  const oldSource=source.products.filter(p=>p.brand===brand);assert.equal(oldSource.length,80);
  assert.equal(out.source.products.length,oldSource.length+25);
  for(const p of oldSource)assert.ok(out.source.products.some(q=>q.id===p.id));
  const byUrl=new Map(out.snapshot.products.map(p=>[p.url,p]));assert.equal(byUrl.size,65);
  for(const p of old)assert.equal(byUrl.get(p.url).id,p.id);
  for(const p of run.products){const q=byUrl.get(p.url);assert.equal(q.style,p.style);assert.ok(officialEvidenceFor(q,today));}
});

test('saved TOM FORD input: 66 records become 43 proven color PDPs, baseline IDs retained',async t=>{
  const data=await savedInputs(t,['.secrets/admin-followup-before/catalog.json','.secrets/admin-followup-before/catalog-source.json','reports/admin-recheck-followup-20261105/87a2879e3c7df83d097f3fc1d0170bdd-products.json','reports/admin-recheck-followup-20261105/manual-tomford-products.json']);if(!data)return;
  const [base,source,older,fresh]=data,rawRows=[...older.products,...fresh.products];assert.equal(rawRows.length,66);
  // Curation may itself dedupe identical style/color pairs. Exercise the actual
  // 66 prepared inputs separately, as preparation can combine already-curated runs.
  const all=rawRows.map(p=>curateCatalog([p],{now:new Date(at)}).snapshot.products[0]);assert.ok(all.every(Boolean));
  const unique=dedupeScopedPrepared(all,{today});assert.equal(unique.length,43);assert.equal(new Set(unique.map(p=>p.url)).size,43);
  const old=base.products.filter(p=>p.brand==='TOM FORD'),incoming=all.map(p=>({...p,presentation:{image:p.image,cachedPath:'/images/'+createHash('sha256').update(p.id).digest('hex')+'.jpg'},scopedNewReview:{verified:true,brand:p.brand,style:p.style,url:p.url,image:p.image,checkedAt:at}}));
  const out=scopedSportsMerge({products:old,brands:[]},{products:source.products.filter(p=>p.brand==='TOM FORD')},incoming,rawRows,{...options,allowedBrands:['TOM FORD']});
  assert.equal(out.report.added.length,0);assert.equal(out.report.refreshed.length,43);assert.equal(out.report.held.length,0);assert.equal(out.snapshot.products.length,44);
  for(const p of fresh.products){const q=out.snapshot.products.find(q=>q.url===p.url);assert.equal(q.id,old.find(o=>o.url===p.url).id);assert.ok(officialEvidenceFor(q,today));}
});


test('exact PDP refresh retains old sourceSignals and recomputes popularity after an empty incoming scrape',()=>{
 const f=fixture();
 const signals=['editor-one.example','editor-two.example'].map((host,i)=>({type:'magazine',url:`https://${host}/curb-snake`,title:'Curb Snake sneakers',checkedAt:at,publishedAt:today,modelMatched:true,independent:true,sponsored:false,publisherId:`editor-${i}`}));
 f.old.sourceSignals=structuredClone(signals);
 f.old.popularity={magazine:false,newsletter:true,media:false,sns:true,brand:false,ecommerce:true};
 f.p.sourceSignals=[];f.p.popularity=structuredClone(f.old.popularity);
 const before=structuredClone(f);
 const out=scopedSportsMerge(f.catalog,f.source,[f.p],[f.r],options),p=out.snapshot.products[0];
 assert.equal(out.report.refreshed.length,1);assert.equal(p.id,f.old.id);
 assert.deepEqual(p.sourceSignals,signals);
 assert.deepEqual(p.popularity,popularity(signals,today,{product:p,socialMetrics:p.socialMetrics||[],officialEligible:!!officialEvidenceFor(p,today)}));
 assert.equal(p.popularity.magazine,true);assert.equal(p.popularity.media,true);
 assert.equal(p.popularity.newsletter,false);assert.equal(p.popularity.sns,false);assert.equal(p.popularity.ecommerce,false);
 assert.deepEqual(f,before);
 const again=scopedSportsMerge(out.snapshot,out.source,[f.p],[f.r],options);
 assert.deepEqual(again.snapshot.products[0].sourceSignals,signals);assert.deepEqual(again.snapshot.products[0].popularity,p.popularity);
});

test('exact PDP refresh merges independent sourceSignals once and gives refreshed evidence precedence',()=>{
 const f=fixture();
 const old={type:'newsletter',url:'https://editor-one.example/curb-snake',title:'Curb Snake',checkedAt:at,publishedAt:today,modelMatched:true,independent:true,sponsored:false,publisherId:'one'};
 const refreshed={...old,title:'Updated Curb Snake sneaker coverage'};
 const added={...old,url:'https://editor-two.example/curb-snake',publisherId:'two'};
 f.old.sourceSignals=[old];f.p.sourceSignals=[refreshed,added];
 const out=scopedSportsMerge(f.catalog,f.source,[f.p],[f.r],options),p=out.snapshot.products[0];
 assert.deepEqual(p.sourceSignals,[refreshed,added]);
 assert.equal(p.popularity.newsletter,true);assert.equal(p.popularity.media,true);assert.equal(p.popularity.magazine,false);
 assert.deepEqual(p.popularity,popularity(p.sourceSignals,today,{product:p,socialMetrics:p.socialMetrics||[],officialEligible:true}));
});
