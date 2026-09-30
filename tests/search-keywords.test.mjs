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
 const result=buildKeywordCatalog([],[source({term:'테이블',rank:1}),source({term:'메리제인 스니커즈',rank:34})],{now});
 assert.equal(result.keywords[0].sourceRanks[0].rank,34);assert.equal(result.keywords[0].rank,1);assert.equal(result.keywords[0].matchedProductCount,0);
});
test('unranked official popularity stays unranked and forecasts cannot influence current scores',()=>{
 const result=buildKeywordCatalog([p],[source({platform:'lyst',term:'Suede sneakers',kind:'composite-rank',rank:3}),source({platform:'editor',term:'스웨이드 스니커즈',kind:'editorial-keyword',rank:null}),source({platform:'forecast',term:'스웨이드 스니커즈',kind:'forecast-keyword',rank:null,forecastPeriod:'Spring/Summer 2027'}),source({platform:'popular',term:'메리제인 스니커즈',kind:'search-popular',rank:null})],{now});
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
 const result=buildKeywordCatalog([p],[source({kind:'editorial-keyword',rank:null,publishedAt:'2026-08-28'}),source({platform:'lyst',kind:'composite-rank',validUntil:'2026-09-27'}),source({platform:'unverified-quarter',kind:'composite-rank',latestPeriodVerified:false})],{now});
 assert.deepEqual(result.keywords,[]);
 assert.equal(buildKeywordCatalog([p],[source({kind:'composite-rank',periodEnd:'2026-02-31'}),source({kind:'forecast-keyword',rank:null,validUntil:'2027-02-31'})],{now}).sourceRanks.length,0);
});
test('style view rejects brand/generic terms, keeps model names, and retains real original style evidence only',()=>{
 const rows=['나이키','뉴발란스530','신발','운동화','스니커즈','PUMA Speedcat','나이키 브라운 스니커즈','브라운 스니커즈','메리제인','gorpcore'].map((term,i)=>source({term,rank:i+1}));
 const result=buildKeywordCatalog([p],rows,{now});
 assert.deepEqual(new Set(result.keywords.map(k=>k.label)),new Set(['뉴발란스530','PUMA Speedcat','브라운 스니커즈','메리제인','gorpcore']));
 assert(result.keywords.every(k=>k.keywordType==='style'));assert.deepEqual(buildKeywordCatalog([p],[],{now}).keywords,[]);
});
test('editorial trend publication uses exact 30-day window while capture remains seven days',()=>{
 const at=new Date(now.getTime()-30*86400000).toISOString();
 assert.equal(buildKeywordCatalog([p],[source({kind:'editorial-keyword',rank:null,publishedAt:at})],{now}).keywords.length,1);
 assert.equal(buildKeywordCatalog([p],[source({kind:'editorial-keyword',rank:null,publishedAt:new Date(Date.parse(at)-1).toISOString()})],{now}).keywords.length,0);
});
test('composite reports reject future, reversed and impossible validity periods',()=>{
 for(const patch of [{periodStart:'2026-12-30',periodEnd:'2026-10-01'},{periodEnd:'2026-10-01'},{periodEnd:'2026-09-20',validUntil:'2026-09-19'}])assert.equal(buildKeywordCatalog([p],[source({kind:'composite-rank',...patch})],{now}).keywords.length,0);
});
test('ecommerce ranking combines only musinsa/29cm/eql/wconcept and ignores site product count',()=>{
 const rows=[source({platform:'musinsa',term:'브라운 스니커즈',rank:2}),source({platform:'29cm',term:'브라운 스니커즈',rank:4}),
   source({platform:'eql',term:'메리제인',rank:1}),source({platform:'tiktok',kind:'hashtag-rank',term:'브라운 스니커즈',rank:1}),
   source({platform:'lyst',kind:'composite-rank',term:'브라운 스니커즈',rank:1,latestPeriodVerified:true,reportId:'2026-Q2',periodEnd:'2026-06-30',validUntil:'2026-09-30',validityBasis:'quarter-end-policy'})];
 const result=buildKeywordCatalog([],rows,{now});
 assert.deepEqual(result.ecommerceKeywords.map(k=>[k.label,k.rank,k.score]),[['메리제인',1,1],['브라운 스니커즈',2,1/2+1/4]]);
 assert(result.ecommerceKeywords.every(k=>k.sourceRanks.every(s=>['musinsa','29cm','eql','wconcept'].includes(s.platform))));
 assert.equal(result.ecommerceKeywords.every(k=>k.matchedProductCount===0),true,'zero on-site matches must not exclude or reorder ecommerce ranks');
 assert(result.ecommerceKeywords.length<=20);
});
test('media ranking requires 5+ posts from the same outlet and merges only qualifying outlets',()=>{
 const editorial=(platform,term,i)=>({platform,term,rank:null,sourceUrl:`https://${platform}.example/post-${term}-${i}`,verified:true,kind:'editorial-keyword',capturedAt:'2026-09-28T05:00:00Z',publishedAt:`2026-09-2${i}T00:00:00Z`,rankingPeriod:null,scope:'all',snapshotId:`${platform}:2026-09-28:${term}-${i}`});
 const belowThreshold=[0,1,2,3].map(i=>editorial('magA','고프코어',i));
 const result=buildKeywordCatalog([],belowThreshold,{now});
 assert.deepEqual(result.editorialKeywords.map(k=>k.label),[],'below the 5-post outlet minimum must not surface');
 const qualifiesA=[0,1,2,3,4].map(i=>editorial('magA','메리제인',i));
 const qualifiesB=[0,1,2].map(i=>editorial('magB','메리제인',i));
 const merged=buildKeywordCatalog([],[...qualifiesA,...qualifiesB],{now});
 assert.deepEqual(merged.editorialKeywords.map(k=>[k.label,k.rank,k.score,k.sourceCount]),[['메리제인',1,5,1]],'a second outlet below its own 5-post minimum cannot contribute posts to the merged count');
 const twoOutlets=[...qualifiesA,...[0,1,2,3,4].map(i=>editorial('magB','메리제인',i))];
 const bothQualify=buildKeywordCatalog([],twoOutlets,{now});
 assert.deepEqual(bothQualify.editorialKeywords.map(k=>[k.label,k.rank,k.score,k.sourceCount]),[['메리제인',1,10,2]]);
});
test('editorial evidence accumulates across collection runs instead of collapsing to the latest snapshot',()=>{
 const rows=[0,1,2,3,4].map(i=>({platform:'magA',term:'고프코어',rank:null,sourceUrl:`https://magA.example/post-${i}`,verified:true,kind:'editorial-keyword',capturedAt:'2026-09-28T05:00:00Z',publishedAt:`2026-09-2${i}T00:00:00Z`,rankingPeriod:null,scope:'all',snapshotId:'magA:2026-09-28'}));
 const result=buildKeywordCatalog([],rows,{now});
 assert.deepEqual(result.editorialKeywords.map(k=>[k.label,k.score]),[['고프코어',5]]);
 const duplicate=[...rows,{...rows[0],capturedAt:'2026-09-27T05:00:00Z',snapshotId:'magA:2026-09-27'}];
 const deduped=buildKeywordCatalog([],duplicate,{now});
 assert.deepEqual(deduped.editorialKeywords.map(k=>k.score),[5],'the same article recollected in an earlier run must not double count');
});
