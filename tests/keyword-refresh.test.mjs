import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {refreshKeywords} from '../scripts/refresh-keywords.mjs';
import {atomicJson,readJson,publishCurated} from '../scripts/publish-curated.mjs';
import {validateSnapshot} from '../scripts/validate_catalog.mjs';
const now=new Date('2026-09-28T06:00:00Z');
const product={id:'sku1',brand:'Nike',name:'Retro suede sneaker',category:'sneaker',officialCategory:'Lifestyle sneakers',description:'Retro court style with suede upper and cushioning.',material:'Suede upper',style:'SKU001',url:'https://www.nike.com/t/retro/SKU001',image:'https://static.nike.com/SKU001.jpg',releaseDate:'2026-09-01',dateEvidence:{url:'https://www.nike.com/launch/t/retro',precision:'day',verified:true,official:true,verifiedAt:'2026-09-28T00:00:00Z',excerpt:'SKU001 releases September 1, 2026.'},productVerifiedAt:'2026-09-28T00:00:00Z',productEvidenceUrl:'https://www.nike.com/t/retro/SKU001',sourceSignals:[],customUserField:'must stay'};
const rank={platform:'musinsa',term:'스웨이드 스니커즈',rank:17,sourceUrl:'https://www.musinsa.com/search',verified:true,kind:'search-rank',capturedAt:now.toISOString(),snapshotId:'latest',rankingPeriod:null,scope:'all'};
test('keyword-only refresh preserves all product raw fields, signals and product collection timestamps',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-keywords-'));
 try{
  const original={products:[product],collection:{checkedAt:'2026-09-28T00:00:00Z',lastSuccessfulCollectionAt:'2026-09-28T00:30:00Z',coverage:[{brand:'Nike',responses:1}]},lastCuratedAt:'2026-09-28T00:30:00Z'};
  await atomicJson(path.join(dir,'data/catalog-source.json'),original);
  await atomicJson(path.join(dir,'data/style-trend-keywords.json'),{items:[{label:'Stale ranking should never override',productIds:[]}]});
  const result=await refreshKeywords({directory:dir,now,searchCollector:async()=>({sourceRanks:[rank],searchRankStatus:[{platform:'musinsa',status:'available'}],diagnostics:[]}),forecastCollector:async()=>({sourceRanks:[],forecastStatus:[],diagnostics:[]}),editorialCollector:async()=>({sourceRanks:[],editorialStatus:[],diagnostics:[]}),styleCollector:async()=>({sourceRanks:[],editorialStatus:[],diagnostics:[]}),marketCollector:async()=>({observations:[],diagnostics:[]})});
  const actual=await readJson(path.join(dir,'data/catalog-source.json'));
  assert.deepEqual(actual.products,original.products);assert.deepEqual(actual.collection.coverage,original.collection.coverage);assert.equal(actual.collection.lastSuccessfulCollectionAt,original.collection.lastSuccessfulCollectionAt);assert.equal(actual.collection.checkedAt,original.collection.checkedAt);assert.equal(actual.lastCuratedAt,original.lastCuratedAt);
  assert.equal(result.snapshot.styleTrendKeywords.items[0].label,'스웨이드');assert.deepEqual(result.snapshot.styleTrendKeywords.items[0].productIds,['sku1']);assert.equal(result.snapshot.styleTrendKeywords.updated,now.toISOString());assert.equal(result.snapshot.keywords[0].label,'스웨이드 스니커즈');assert.deepEqual(result.snapshot.keywords[0].productIds,['sku1']);assert.equal(result.snapshot.sourceStatus.lastSuccessfulCollectionAt,original.collection.lastSuccessfulCollectionAt);assert(validateSnapshot(result.snapshot));
  const tampered=structuredClone(result.snapshot);tampered.keywords[0].score=99;assert.throws(()=>validateSnapshot(tampered),/Current keyword score/);
  const expired=await publishCurated({directory:dir,now:new Date('2026-10-06T06:00:00Z'),maintenance:true});assert.deepEqual(expired.snapshot.keywords,[]);assert.equal(expired.snapshot.products.length,1);assert.equal(expired.snapshot.keywordCheckedAt,now.toISOString());assert.equal(expired.snapshot.keywordEvaluatedAt,'2026-10-06T06:00:00.000Z');assert(validateSnapshot(expired.snapshot));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('maintenance preserves actual keyword collection time while expiring products and ranks at the evaluation instant',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-keyword-maintenance-'));
 try{
  const older={...product,id:'older',style:'OLD001',name:'Older suede sneaker',url:'https://www.nike.com/t/older/OLD001',releaseDate:'2026-06-28',dateEvidence:{...product.dateEvidence,excerpt:'OLD001 releases June 28, 2026.'}};
  const original={products:[product,older],collection:{keywordCheckedAt:now.toISOString(),sourceRanks:[rank],checkedAt:'2026-09-28T00:00:00Z',lastSuccessfulCollectionAt:'2026-09-28T00:30:00Z'}};
  await atomicJson(path.join(dir,'data/catalog-source.json'),original);
  const initial=await publishCurated({directory:dir,now});
  const sourceBefore=await fs.readFile(path.join(dir,'data/catalog-source.json'));
  assert.equal(initial.snapshot.keywords[0].matchedProductCount,2);
  const legacy=structuredClone(initial.snapshot);delete legacy.keywordEvaluatedAt;assert(validateSnapshot(legacy));
  const maintenanceAt=new Date('2026-09-29T06:00:00Z'),daily=await publishCurated({directory:dir,now:maintenanceAt,maintenance:true});
  assert.equal(daily.snapshot.publishedAt,initial.snapshot.publishedAt);assert.equal(daily.snapshot.keywordCheckedAt,now.toISOString());assert.equal(daily.snapshot.keywordEvaluatedAt,maintenanceAt.toISOString());
  assert.equal(daily.snapshot.styleTrendKeywords.updated,now.toISOString());assert.equal(daily.snapshot.keywords[0].matchedProductCount,1);assert.deepEqual(daily.snapshot.keywords[0].productIds,['sku1']);assert.equal(daily.queue.products[0].id,'older');assert(validateSnapshot(daily.snapshot));
  assert((await fs.readFile(path.join(dir,'data/catalog-source.json'))).equals(sourceBefore));
  const staleEvaluation=structuredClone(daily.snapshot);staleEvaluation.keywordEvaluatedAt=now.toISOString();assert.throws(()=>validateSnapshot(staleEvaluation),/Invalid keyword evaluation time/);
  const futureCheck=structuredClone(daily.snapshot);futureCheck.keywordCheckedAt='2026-09-29T07:00:00Z';assert.throws(()=>validateSnapshot(futureCheck),/verification cannot be after evaluation/);
  const futureCapture=structuredClone(daily.snapshot);futureCapture.sourceRanks[0].capturedAt='2026-09-29T07:00:00Z';assert.throws(()=>validateSnapshot(futureCapture),/Invalid, expired or superseded original keyword source/);
  const expiredAt=new Date(now.getTime()+7*86400000+1),expired=await publishCurated({directory:dir,now:expiredAt,maintenance:true});
  assert.equal(expired.snapshot.keywordCheckedAt,now.toISOString());assert.deepEqual(expired.snapshot.keywords,[]);assert.deepEqual(expired.snapshot.sourceRanks,[]);assert(validateSnapshot(expired.snapshot));
  const staleRank=structuredClone(expired.snapshot);staleRank.sourceRanks=[rank];assert.throws(()=>validateSnapshot(staleRank),/Invalid, expired or superseded original keyword source/);
  const refreshedAt=new Date('2026-10-06T07:00:00Z');
  const refreshed=await publishCurated({directory:dir,now:refreshedAt,maintenance:true,keywordRefresh:true,collection:{keywordCheckedAt:refreshedAt.toISOString(),sourceRanks:[{...rank,capturedAt:refreshedAt.toISOString(),snapshotId:'refreshed'}]}});
  assert.equal(refreshed.snapshot.keywordCheckedAt,refreshedAt.toISOString());assert.equal(refreshed.snapshot.keywordEvaluatedAt,refreshedAt.toISOString());assert.equal(refreshed.snapshot.publishedAt,refreshedAt.toISOString());assert.equal(refreshed.snapshot.styleTrendKeywords.updated,refreshedAt.toISOString());assert.equal(refreshed.snapshot.keywords.length,1);assert(validateSnapshot(refreshed.snapshot));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
