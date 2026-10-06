import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStyleTrendBoard,validStyleObservations,STYLE_TOPICS} from '../scripts/style-trend-board.mjs';
import {resolveSearchTerm} from '../scripts/keyword-taxonomy.mjs';
import {parseRetailStyles,parseCalendarStyles,collectStyleMarket} from '../scripts/collect-style-market.mjs';

const now=new Date('2026-10-06T07:00:00Z');
const observation={topicId:'suede',kind:'editorial',sourceId:'magazine',sourceUrl:'https://magazine.example/sneaker-trends',evidenceId:'article',publishedAt:'2026-08-10T10:00:00Z',capturedAt:now.toISOString(),verified:true};
test('Style board keeps actual evidence types and counts, deduplicates captures, and matches both languages',()=>{
  const products=[{id:'en',name:'Suede runner',material:'Suede',category:'sneaker'},{id:'ko',name:'스웨이드 스니커즈',material:'스웨이드',category:'sneaker'},{id:'unrelated',name:'Leather runner',material:'Leather',category:'sneaker'}];
  const retail={...observation,kind:'retail',sourceId:'musinsa',evidenceId:'sku1',itemName:'스웨이드 스니커즈',sourceRank:2};
  const board=buildStyleTrendBoard(products,[observation,{...observation},retail],{now});
  assert.equal(board.items.length,1);assert.equal(board.items[0].label,'스웨이드');assert.deepEqual(board.items[0].productIds,['en','ko']);assert.equal(board.items[0].sourceCount,2);assert.equal(board.items[0].editorialCount,1);assert.equal(board.items[0].retailCount,1);assert.equal(board.items[0].rankSignal,.5);
  assert.equal(board.items[0].rank,1);assert(!('searchVolume' in board.items[0]));
});
test('All board queries resolve without brand, model or arbitrary literal keywords',()=>{
  for(const t of STYLE_TOPICS)for(const q of t.queries){const r=resolveSearchTerm(q);assert(r.key,q);assert.deepEqual(r.literalTerms,[],q);assert(r.conceptIds.every(id=>!/^brand:|^model:/.test(id)),q);}
});
test('Evidence expires by original capture, calendar date and calendar three-month article cutoff',()=>{
  assert.equal(validStyleObservations([{...observation,publishedAt:'2026-07-06T00:00:00Z'}],{now}).length,1);
  for(const row of [{...observation,publishedAt:'2026-07-05T00:00:00Z'},{...observation,capturedAt:'2026-09-28T06:00:00Z'},{...observation,capturedAt:'2026-10-07T06:00:00Z'},{...observation,publishedAt:'2026-10-07T06:00:00Z'},{...observation,sourceUrl:'javascript:alert(1)'},{...observation,kind:'calendar',releaseDate:'2027-01-01',itemName:'Suede sneaker'}])assert.equal(validStyleObservations([row],{now}).length,0);
});
test('Mixed footwear BEST lists exclude dress shoes while preserving original sneaker rank',()=>{
  const source={id:'29cm',adapter:'29cm',categoryCode:'270100100',url:'https://www.29cm.co.kr/store/best-items'};
  const row=(itemNo,itemName,category2Name)=>({itemNo,itemName,frontCategoryInfo:[{category1Code:270100100,category2Name}]});
  const body=JSON.stringify({result:'SUCCESS',data:{content:[row(1,'Suede pumps','펌프스'),row(2,'Brown suede sneaker','스니커즈'),row(3,'Brown boots','부츠')]}});
  const r=parseRetailStyles(body,source,{now});assert.equal(r.itemCount,1);assert.deepEqual(r.observations.map(x=>x.topicId),['suede','brown']);assert(r.observations.every(x=>x.sourceRank===2));
});
test('Calendar joins item name, date and SKU, never calls release ordering a popularity rank',()=>{
  const body='# Sneaker Release Dates\n\nUpcoming Releases\n\n![Puma Suede](https://images.example/p.jpg)\n\nOctober 9, 2026\n\nPuma Suede\n\n$100• ABC123\n\n[**News**](https://example.com/news)\n\nSuede next year';
  const r=parseCalendarStyles(body,{now});assert.equal(r.observations.length,1);assert.equal(r.observations[0].releaseDate,'2026-10-09');assert.equal(r.observations[0].sourceRank,undefined);assert.throws(()=>parseCalendarStyles('Just a moment...', {now}),/SCHEMA/);
  assert.deepEqual(parseCalendarStyles(body.replace('![Puma Suede]','![Image 11: Puma Suede]'),{now}).observations.map(x=>x.evidenceId),['ABC123']);
});
test('Unavailable calendar retains a checked capture for at most seven days without restamping it',async()=>{
  const capture={capturedAt:'2026-10-05T00:00:00Z',observations:[{...observation,kind:'calendar',sourceId:'sole-retriever',itemName:'Suede sneaker',releaseDate:'2026-10-09',capturedAt:'2026-10-05T00:00:00Z'}]};
  const options={config:{rankingPages:[]},previousObservations:capture.observations,auditDir:null,readPublic:async()=>{throw Error('403');}};
  const r=await collectStyleMarket({...options,now});assert.equal(r.observations[0].capturedAt,capture.capturedAt);assert.equal(r.diagnostics[0].status,'recent-verified-capture');
  const stale=await collectStyleMarket({...options,now:new Date('2026-10-13T00:00:00Z')});assert.equal(stale.observations.length,0);assert.equal(stale.diagnostics[0].status,'unavailable');
});
