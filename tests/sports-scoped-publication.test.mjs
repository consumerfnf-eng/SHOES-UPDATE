import test from 'node:test';import assert from 'node:assert/strict';
import {scopedSportsMerge,luxDigest} from '../scripts/publish-sports-casual.mjs';
import {unifyVariantGroups,groupProductVariants} from '../public/assets/catalog-view.mjs';
import {curateCatalog} from '../scripts/curation.mjs';
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
