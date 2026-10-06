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
  const result=await refreshKeywords({directory:dir,now,searchCollector:async()=>({sourceRanks:[rank],searchRankStatus:[{platform:'musinsa',status:'available'}],diagnostics:[]}),forecastCollector:async()=>({sourceRanks:[],forecastStatus:[],diagnostics:[]}),editorialCollector:async()=>({sourceRanks:[],editorialStatus:[],diagnostics:[]}),styleCollector:async()=>({sourceRanks:[],editorialStatus:[],diagnostics:[]})});
  const actual=await readJson(path.join(dir,'data/catalog-source.json'));
  assert.deepEqual(actual.products,original.products);assert.deepEqual(actual.collection.coverage,original.collection.coverage);assert.equal(actual.collection.lastSuccessfulCollectionAt,original.collection.lastSuccessfulCollectionAt);assert.equal(actual.collection.checkedAt,original.collection.checkedAt);assert.equal(actual.lastCuratedAt,original.lastCuratedAt);
  assert.equal(result.snapshot.styleTrendKeywords.items[0].label,'스웨이드 스니커즈');assert.deepEqual(result.snapshot.styleTrendKeywords.items[0].productIds,['sku1']);assert.equal(result.snapshot.styleTrendKeywords.updated,now.toISOString());assert.equal(result.snapshot.keywords[0].label,'스웨이드 스니커즈');assert.deepEqual(result.snapshot.keywords[0].productIds,['sku1']);assert.equal(result.snapshot.sourceStatus.lastSuccessfulCollectionAt,original.collection.lastSuccessfulCollectionAt);assert(validateSnapshot(result.snapshot));
  const tampered=structuredClone(result.snapshot);tampered.keywords[0].score=99;assert.throws(()=>validateSnapshot(tampered),/Current keyword score/);
  const expired=await publishCurated({directory:dir,now:new Date('2026-10-06T06:00:00Z'),maintenance:true});assert.deepEqual(expired.snapshot.keywords,[]);assert.equal(expired.snapshot.products.length,1);assert(validateSnapshot(expired.snapshot));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
