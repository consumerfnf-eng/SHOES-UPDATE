import test from 'node:test';import assert from 'node:assert/strict';
import {scopedSportsMerge,luxDigest} from '../scripts/publish-sports-casual.mjs';
import {unifyVariantGroups,groupProductVariants} from '../public/assets/catalog-view.mjs';
import {curateCatalog} from '../scripts/curation.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const lux={id:'lux',brand:'Prada',name:'Original LUX',presentation:{cachedPath:'/images/original.jpg'},modelGroupId:'unchanged'};
test('cross-day scoped publication advances keyword evaluation and calendar cutoff while retaining source verification time',()=>{
 const checked='2026-11-03T01:00:00Z',at='2026-11-04T01:00:00Z';const out=scopedSportsMerge({products:[lux],brands:[],keywordCheckedAt:checked,keywordEvaluatedAt:checked,sourceRanks:[]},{products:[lux]},[],[],{today:'2026-11-04',at});assert.equal(out.snapshot.keywordCheckedAt,checked);assert.equal(out.snapshot.keywordEvaluatedAt,at);assert.equal(out.snapshot.periodStart,'2026-08-04');assert.deepEqual(out.snapshot.products,[lux]);
});
test('scoped updates preserve every LUX field and relative order in both snapshots',()=>{
 const c={products:[lux,{...lux,id:'lux2',brand:'Dior'}],brands:[]},s={products:[{...lux,rawEvidence:{keep:true}}]};
 const out=scopedSportsMerge(c,s,[],[{id:'new',brand:'FILA China',name:'Raw'}],{today:'2026-11-03'});
 assert.deepEqual(out.snapshot.products,c.products);assert.deepEqual(out.source.products[0],s.products[0]);assert.equal(luxDigest(out.source.products),luxDigest(s.products));assert(out.report.lux.unchanged);
 assert.throws(()=>scopedSportsMerge(c,s,[lux],[],{today:'2026-11-03'}),/cannot contain LUX/);
 assert.throws(()=>scopedSportsMerge(c,s,[],[lux],{today:'2026-11-03'}),/cannot contain LUX/);
});
test('FILA China reviewed code families group colors without merging different designs with repeated names',()=>{
 const rows=[{id:'a',brand:'FILA China',name:'Mountain Chunky Sneakers',modelGroupId:'filachina|T12-643319',colorway:'White'},{id:'b',brand:'FILA China',name:'Mountain Chunky Sneakers',modelGroupId:'filachina|T12-643319',colorway:'Black'},{id:'c',brand:'FILA China',name:'Mountain Chunky Sneakers',modelGroupId:'filachina|T12-643311',colorway:'White'}];
 unifyVariantGroups(rows);const groups=groupProductVariants(rows);assert.equal(groups.length,2);assert.equal(groups.find(g=>g.length===2).length,2);
});
test('a fresh official New check updates an existing sports record instead of skipping it as a duplicate',()=>{
 const at='2026-11-03T01:00:00Z',url='https://www.nike.com/t/runner/HN1234-001',image='https://static.nike.com/a/images/runner.jpg',proof={verified:true,brand:'Nike',style:'HN1234-001',verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:'hash'};
 const raw={id:'nike',brand:'Nike',style:'HN1234-001',name:'Runner Sneaker',url,image,productType:'sneaker',officialCategory:'Sneakers',productVerifiedAt:at,productEvidenceUrl:url,firstSeen:at,sourceSignals:[],arrivalEvidence:{...proof,kind:'new-arrivals-listing',url:'https://www.nike.com/w/new-shoes',productUrl:url,excerpt:'Runner Sneaker'},officialProductEvidence:{...proof,url},officialImageEvidence:{...proof,url:image,sourceUrl:url}};
 const p=curateCatalog([raw],{now:new Date(at)}).snapshot.products[0];assert(p);p.presentation={image,cachedPath:'/images/'+ 'a'.repeat(64)+'.jpg'};
 const old={...p,arrivalEvidence:{...p.arrivalEvidence,kind:'catalogue-listing'},firstPublishedAt:'2026-10-15T01:00:00Z'};
 const out=scopedSportsMerge({products:[lux,old],brands:[]},{products:[lux,{...raw,legacySourceNote:'preserve'}]},[p],[raw],{today:'2026-11-03'});assert.equal(out.report.added.length,0);assert.equal(out.report.refreshed.length,1);assert.equal(out.snapshot.products[1].id,old.id);assert.equal(out.snapshot.products[1].firstPublishedAt,old.firstPublishedAt);assert.equal(out.snapshot.products[1].arrivalEvidence.kind,'new-arrivals-listing');assert.equal(out.source.products[1].legacySourceNote,'preserve');assert(out.report.lux.unchanged);
 const fresh={...p,presentation:{...p.presentation},scopedNewReview:{verified:true,brand:p.brand,style:p.style,url:p.url,image,checkedAt:at}};
 const previous={...p,firstPublishedAt:'2026-10-01T00:00:00Z',dateEvidence:{verified:true,url},releaseDate:'2026-10-01',releaseDatePrecision:'day',sourceSignals:[{type:'legacy',url}]};
 const refreshed=scopedSportsMerge({products:[lux,previous],brands:[]},{products:[lux,raw]},[fresh],[raw],{today:'2026-11-03'});
 assert.equal(refreshed.report.refreshed.length,1);assert.equal(refreshed.snapshot.products[1].firstPublishedAt,previous.firstPublishedAt);assert.equal(refreshed.snapshot.products[1].releaseDate,previous.releaseDate);assert(refreshed.snapshot.products[1].sourceSignals.some(s=>s.type==='legacy'));assert(refreshed.report.lux.unchanged);
});

test('reviewed model groups preserve Converse high/low while consolidating colorways',()=>{
 const rows=[{id:'h1',brand:'Converse',name:'Chuck Taylor',modelGroupId:'converse|high',colorway:'Black'},{id:'h2',brand:'Converse',name:'Chuck Taylor',modelGroupId:'converse|high',colorway:'White'},{id:'l',brand:'Converse',name:'Chuck Taylor',modelGroupId:'converse|low',colorway:'Black'}];unifyVariantGroups(rows);assert.deepEqual(groupProductVariants(rows).map(g=>g.length).sort(),[1,2]);
});

const recheckAt='2026-11-05T01:00:00Z';
function luxRecheckFixture(){
 const brand='Prada',style='2EE364_3LKG_F0002',url='https://www.prada.com/us/en/p/downtown-sneakers/'+style;
 const image='https://www.prada.com/content/dam/pradabkg_products/2/2EE/2EE364/3LKGF0002/2EE364_3LKG_F0002.jpg';
 const proof={verified:true,brand,style,verifiedAt:recheckAt,verificationMethod:'official-new-listing-sku-image',contentHash:'lux-recheck-proof'};
 const raw={id:'prada-alternate',brand,style,name:'Downtown Sneakers',url,image,productType:'sneaker',officialCategory:'Sneakers',productVerifiedAt:recheckAt,productEvidenceUrl:url,firstSeen:recheckAt,sourceSignals:[],arrivalEvidence:{...proof,kind:'new-arrivals-listing',url:'https://www.prada.com/us/en/new-in.html',productUrl:url,excerpt:'Downtown Sneakers'},officialProductEvidence:{...proof,url},officialImageEvidence:{...proof,url:image,sourceUrl:url}};
 const curated=curateCatalog([raw],{now:new Date(recheckAt)}).snapshot.products;
 assert.equal(curated.length,1,'the fixture must pass real curation');
 const prepared={...curated[0],modelGroupId:'prada|incoming-group',presentation:{image,cachedPath:'/images/'+ 'b'.repeat(64)+'.jpg'},scopedNewReview:{verified:true,brand,style,url,image,checkedAt:recheckAt}};
 const old={...structuredClone(prepared),id:'prada-canonical',modelGroupId:'prada|reviewed-downtown',firstPublishedAt:'2026-09-12T03:00:00Z',lastVerifiedAt:'2026-11-04T01:00:00Z',scopedNewReview:{...prepared.scopedNewReview,checkedAt:'2026-11-04T01:00:00Z'}};
 const oldRaw={...structuredClone(raw),id:old.id,productVerifiedAt:'2026-11-04T01:00:00Z',firstSeen:'2026-09-10T03:00:00Z',legacySourceNote:{reviewed:true}};
 const otherLux={...lux,id:'unrelated-lux',brand:'Dior',review:{keep:['all','fields']}};
 const sports={id:'unrelated-sports',brand:'Nike',name:'Existing Runner',review:{keep:true}};
 const catalog={products:[otherLux,old,sports],brands:[{name:'Dior'}],sourceStatus:{counts:{source:3,published:3}}};
 const source={products:[{...otherLux,rawEvidence:{keep:true}},oldRaw,{...sports,rawEvidence:{keep:true}}]};
 return {raw,prepared,old,oldRaw,catalog,source};
}
const authorizedLuxOptions={today:'2026-11-05',at:recheckAt,includeLux:true,allowedBrands:['Prada']};

test('includeLux requires an explicit brand whitelist for prepared and raw inputs',()=>{
 const {catalog,source,prepared,raw}=luxRecheckFixture();
 for(const allowedBrands of [undefined,null])for(const [products,rows] of [[[prepared],[]],[[],[raw]]]){
  assert.throws(()=>scopedSportsMerge(catalog,source,products,rows,{today:'2026-11-05',includeLux:true,allowedBrands}),/whitelist|allowedBrands|excluded brands/i);
 }
});

test('authorized LUX publication rejects brands outside the whitelist in either input',()=>{
 const {catalog,source,prepared,raw}=luxRecheckFixture();
 for(const allowedBrands of [[],['Dior']])for(const [products,rows] of [[[prepared],[]],[[],[raw]]]){
  assert.throws(()=>scopedSportsMerge(catalog,source,products,rows,{...authorizedLuxOptions,allowedBrands}),/excluded brands/);
 }
});

test('authorized LUX refresh retains the canonical physical variant and reviewed metadata without duplicate raw IDs',()=>{
 const {catalog,source,prepared,raw,old,oldRaw}=luxRecheckFixture();
 const before=structuredClone({catalog,source,prepared,raw});
 const out=scopedSportsMerge(catalog,source,[prepared],[raw],authorizedLuxOptions);
 assert.deepEqual(out.report.added,[]);assert.deepEqual(out.report.held,[]);
 assert.deepEqual(out.report.refreshed,[{id:old.id,fromId:prepared.id,brand:'Prada',reason:'fresh-New-evidence-for-existing-variant'}]);
 assert.equal(out.report.duplicates[0].reason,'exact-manufacturer-code');
 assert.deepEqual(out.snapshot.products.map(p=>p.id),catalog.products.map(p=>p.id));
 const refreshed=out.snapshot.products[1];
 assert.equal(refreshed.id,old.id);assert.equal(refreshed.modelGroupId,old.modelGroupId);assert.equal(refreshed.firstPublishedAt,old.firstPublishedAt);
 assert.equal(refreshed.scopedNewReview.checkedAt,recheckAt);
 assert.equal(out.source.products.length,source.products.length);
 assert.deepEqual(out.source.products.map(p=>p.id),source.products.map(p=>p.id));
 assert.equal(out.source.products.filter(p=>p.id===old.id).length,1);
 assert(!out.source.products.some(p=>p.id===prepared.id));
 assert.equal(out.source.products[1].productVerifiedAt,raw.productVerifiedAt);
 assert.equal(out.source.products[1].firstSeen,oldRaw.firstSeen);
 assert.deepEqual(out.source.products[1].legacySourceNote,oldRaw.legacySourceNote);
 for(const index of [0,2]){
  assert.deepEqual(out.snapshot.products[index],catalog.products[index]);
  assert.deepEqual(out.source.products[index],source.products[index]);
 }
 assert(out.report.lux.authorizedUpdate);assert.equal(out.report.lux.unchanged,false);
 assert.deepEqual({catalog,source,prepared,raw},before,'merge must not mutate its inputs');
 const again=scopedSportsMerge(out.snapshot,out.source,[prepared],[raw],authorizedLuxOptions);
 assert.deepEqual(again.snapshot.products,out.snapshot.products);assert.deepEqual(again.source.products,out.source.products);
});

test('authorized LUX refresh inserts missing canonical raw evidence without an alternate ID',()=>{
 const {catalog,source,prepared,raw,old}=luxRecheckFixture();
 source.products=source.products.filter(p=>p.id!==old.id);
 const out=scopedSportsMerge(catalog,source,[prepared],[raw],authorizedLuxOptions);
 assert.equal(out.report.refreshed.length,1);assert.equal(out.report.added.length,0);
 assert.deepEqual(out.source.products.slice(0,2),source.products);
 assert.deepEqual(out.source.products[2],{...raw,id:old.id});
 assert.equal(out.source.products.filter(p=>p.brand==='Prada').length,1);
});
test('a sparse official recheck cannot erase existing price, material or reviewed metadata',()=>{
 const {catalog,source,prepared,raw}=luxRecheckFixture();
 catalog.products[1].priceLabel='USD 990';catalog.products[1].material='Reviewed leather';catalog.products[1].notes={reviewed:'retain'};
 source.products[1].priceLabel='USD 990';source.products[1].material='Reviewed leather';
 prepared.priceLabel='';prepared.material='';raw.priceLabel='';raw.material='';
 const out=scopedSportsMerge(catalog,source,[prepared],[raw],authorizedLuxOptions);
 assert.equal(out.snapshot.products[1].priceLabel,'USD 990');assert.equal(out.snapshot.products[1].material,'Reviewed leather');assert.deepEqual(out.snapshot.products[1].notes,{reviewed:'retain'});
 assert.equal(out.source.products[1].priceLabel,'USD 990');assert.equal(out.source.products[1].material,'Reviewed leather');
});

test('authorized LUX additions remain scoped and omit held or unprepared raw candidates',()=>{
 const {prepared,raw}=luxRecheckFixture();
 const catalog={products:[lux],brands:[]},source={products:[lux]};
 const held={...prepared,id:'held-prada',style:'held-999',presentation:{}};
 const out=scopedSportsMerge(catalog,source,[prepared,held],[raw,{...raw,id:held.id,style:held.style},{...raw,id:'unprepared-prada'}],{...authorizedLuxOptions,brandPolicy:[{name:'Prada'},{name:'Dior'},{name:'Nike'}]});
 assert.deepEqual(out.report.added,[{id:prepared.id,brand:'Prada'}]);assert.equal(out.report.held.length,1);
 assert.deepEqual(out.snapshot.products.map(p=>p.id),[lux.id,prepared.id]);
 assert.deepEqual(out.source.products,[lux,raw]);assert.deepEqual(out.snapshot.brands,[{name:'Prada'}]);
 assert.equal(out.snapshot.products[1].firstPublishedAt,recheckAt);
 assert.equal(out.snapshot.sourceStatus.lastVerifiedAdditionAt,recheckAt);
});

test('a whitelist alone never disables default LUX protection',()=>{
 const {catalog,source,prepared,raw}=luxRecheckFixture();
 for(const includeLux of [undefined,false])for(const [products,rows] of [[[prepared],[]],[[],[raw]]]){
  assert.throws(()=>scopedSportsMerge(catalog,source,products,rows,{...authorizedLuxOptions,includeLux}),/cannot contain LUX/);
 }
 const out=scopedSportsMerge(catalog,source,[],[],{today:'2026-11-05',allowedBrands:['Prada']});
 assert.deepEqual(out.snapshot.products,catalog.products);assert.deepEqual(out.source.products,source.products);
 assert.equal(out.report.lux.unchanged,true);assert.equal(out.report.lux.authorizedUpdate,false);
});

test('admin recheck entry point requires explicit CLI LUX authorization before reading publication files',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/publish-admin-rechecked.mjs',import.meta.url))],{cwd:process.env.TEMP||process.cwd(),encoding:'utf8'});
 assert.equal(result.error,undefined);assert.equal(result.status,1);
 assert.match(result.stderr,/requires the explicit LUX authorization flag/);
 assert.doesNotMatch(result.stderr,/ENOENT/);
});
