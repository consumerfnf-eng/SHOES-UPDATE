import test from 'node:test';
import assert from 'node:assert/strict';
import {buildKeywordCatalog} from '../scripts/search-keywords.mjs';
const now=new Date('2026-09-28T06:00:00Z');
const source=(patch={})=>({platform:'musinsa',term:'브라운 스니커즈',rank:2,sourceUrl:'https://www.musinsa.com/search',verified:true,kind:'search-rank',capturedAt:'2026-09-28T05:00:00Z',snapshotId:'today',rankingPeriod:null,scope:'all',...(patch.kind==='forecast-keyword'?{validUntil:'2027-08-31',validityBasis:'season-end-policy'}:{}),...(patch.kind==='editorial-keyword'?{publishedAt:'2026-09-27'}:{}),...(patch.kind==='composite-rank'?{latestPeriodVerified:true,reportId:'2026-Q2',periodEnd:'2026-06-30',validUntil:'2026-09-30',validityBasis:'quarter-end-policy'}:{}),...patch});
const p={id:'brown',brand:'New Balance',name:'991',category:'sneaker',material:'Suede upper',colorway:'Cocoa'};
test('same platform synonyms and repeat captures cannot multiply the reciprocal-rank contribution',()=>{
 const a=source(),b=source({term:'brown sneakers',rank:8}),c=source({platform:'29cm',rank:4,sourceUrl:'https://www.29cm.co.kr/search'});
 const result=buildKeywordCatalog([p],[a,a,b,c],{now});assert.equal(result.keywords.length,1);const k=result.keywords[0];
 assert.equal(k.score,1/2+1/4);assert.equal(k.sourceCount,2);assert.equal(k.sourceRanks.length,3);assert.equal(k.label,'브라운 스니커즈');assert.equal(k.rank,1);assert.deepEqual(k.productIds,['brown']);assert.equal(k.sourceRanks[2].term,'brown sneakers');
 const products=[{...p,id:'z'},p];assert.deepEqual(buildKeywordCatalog(products,[a],{now}),buildKeywordCatalog([...products].reverse(),[a],{now}));
});
test('latest complete source snapshot wins, even when its newest keywords are unrelated to shoes',()=>{
 const old=source({snapshotId:'old',capturedAt:'2026-09-27T01:00:00Z',rank:1});
 const latest=source({term:'나이키 패딩',snapshotId:'new',capturedAt:'2026-09-28T05:00:00Z',rank:99});
 assert.equal(buildKeywordCatalog([p],[old,latest],{now}).keywords.length,0);
});
test('source ranks remain original after clothing removal; zero-match shoe topics remain',()=>{
 const result=buildKeywordCatalog([],[source({term:'테이블',rank:1}),source({term:'스니커즈',rank:34})],{now});
 assert.equal(result.keywords[0].sourceRanks[0].rank,34);assert.equal(result.keywords[0].rank,1);assert.equal(result.keywords[0].matchedProductCount,0);
});
test('unranked official popularity stays unranked and forecasts cannot influence current scores',()=>{
 const result=buildKeywordCatalog([p],[source({platform:'lyst',term:'New Balance',kind:'composite-rank',rank:3}),source({platform:'editor',term:'뉴발란스',kind:'editorial-keyword',rank:null}),source({platform:'forecast',term:'뉴발란스',kind:'forecast-keyword',rank:null,forecastPeriod:'Spring/Summer 2027'}),source({platform:'popular',term:'스니커즈',kind:'search-popular',rank:null})],{now});
 assert.equal(result.keywords.length,2);assert.equal(result.keywords[0].score,1/3);assert.equal(result.keywords[0].sourceCount,2);
 assert.equal(result.keywords[1].rank,null);assert.equal(result.keywords[1].score,0);
 assert.equal(result.forecastKeywords.length,1);assert.equal(result.forecastKeywords[0].rank,null);assert.equal(result.forecastKeywords[0].sourceRanks[0].forecastPeriod,'Spring/Summer 2027');
});
test('seven-day expiry is exact, unavailable/fabricated data cannot create ranks and catalog themes are never a fallback',()=>{
 const old=source({capturedAt:'2026-09-21T05:59:59Z'}),future=source({capturedAt:'2026-09-28T06:00:01Z'});
 const result=buildKeywordCatalog([p],[old,future,source({verified:false}),source({rank:0}),source({rank:null}),source({kind:'forecast-keyword',rank:7})],{now});assert.deepEqual(result.keywords,[]);assert.deepEqual(result.forecastKeywords,[]);
 assert.equal(buildKeywordCatalog([p],[source({capturedAt:'2026-09-21T06:00:00Z'})],{now}).keywords.length,1);
});
test('forecast and ranked source kinds have independent records and preserve source language and period',()=>{
 const result=buildKeywordCatalog([p],[source({term:'Suede sneakers',kind:'hashtag-rank',platform:'tiktok',rankingPeriod:'7 days',rank:19}),source({term:'스웨이드 스니커즈',kind:'forecast-keyword',platform:'trendstop',rank:null,rankingPeriod:'Spring/Summer 2027'})],{now});
 assert.equal(result.keywords[0].label,'Suede sneakers');assert.equal(result.keywords[0].sourceRanks[0].rank,19);assert.equal(result.forecastKeywords[0].label,'스웨이드 스니커즈');assert.equal(result.forecastKeywords[0].score,0);
});
test('seasonal forecasts use the approved season end and exact color names, not generic colors or article age',()=>{
 const record=source({term:'Luminous Blue',kind:'forecast-keyword',platform:'wgsn',rank:null,scope:'fashion-colour-forecast',capturedAt:'2026-08-01T00:00:00Z',publishedAt:'2025-07-18',forecastPeriod:'S/S 2027'});
 const result=buildKeywordCatalog([{...p,id:'generic',colorway:'Blue'},{...p,id:'exact',colorway:'Luminous Blue'}],[record],{now});
 assert.equal(result.forecastKeywords.length,1);assert.deepEqual(result.forecastKeywords[0].productIds,['exact']);
 assert.equal(buildKeywordCatalog([p],[record],{now:new Date('2027-08-31T15:00:00Z')}).forecastKeywords.length,0);
});
test('maintenance removes old editorial publication and expired reports even after a fresh capture',()=>{
 const result=buildKeywordCatalog([p],[source({kind:'editorial-keyword',rank:null,publishedAt:'2026-09-20'}),source({platform:'lyst',kind:'composite-rank',validUntil:'2026-09-27'}),source({platform:'unverified-quarter',kind:'composite-rank',latestPeriodVerified:false})],{now});
 assert.deepEqual(result.keywords,[]);
 assert.equal(buildKeywordCatalog([p],[source({kind:'composite-rank',periodEnd:'2026-02-31'}),source({kind:'forecast-keyword',rank:null,validUntil:'2027-02-31'})],{now}).sourceRanks.length,0);
});
