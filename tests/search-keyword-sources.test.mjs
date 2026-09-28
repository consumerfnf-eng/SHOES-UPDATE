import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectSearchKeywords,parseSearchKeywordSnapshot,readSearchSource,latestLystReport} from '../scripts/collect-search-keywords.mjs';

const config=JSON.parse(await readFile(new URL('../config/search-keyword-sources.json',import.meta.url),'utf8'));
const [musinsa,cm,tiktok]=config.sources,now=new Date('2026-09-28T05:00:00Z'),capturedAt=now.toISOString();
const musinsaBody=JSON.stringify({meta:{result:'SUCCESS'},data:{componentList:[
  {key:'rising',meta:{title:'급상승 검색어'},items:[{text:'Fake rising',rankIncrement:99}]},
  {key:'popular',meta:{title:'인기 검색어',updateDate:'09.28 14:00, 기준'},items:[{text:'아디다스',rankIncrement:50},{text:'New Balance',rankIncrement:-7}]}
]}});
const cmBody=JSON.stringify({data:{popularKeywords:{title:{text:'인기 검색어',subText:'09.28 기준'},rankings:[{title:'살로몬',rank:10},{title:'NIKE',rank:27}]},popularBrands:{rankings:[{title:'Not a general keyword',rank:1}]}}});
const tiktokBody=JSON.stringify({BaseResp:{StatusCode:0},items:[{hashtagName:'추석',rankIndex:1,hashtagID:'123'},{hashtagName:'gorpcore',rankIndex:3,hashtagID:'456'}],pagination:{totalCount:2,limit:3}});

test('Musinsa preserves original terms and displayed order, ignoring change and rising ranks',()=>{
  const parsed=parseSearchKeywordSnapshot(musinsaBody,musinsa,{capturedAt});
  assert.deepEqual(parsed.sourceRanks.map(row=>[row.term,row.rank]),[['아디다스',1],['New Balance',2]]);
  assert(parsed.sourceRanks.every(row=>row.kind==='search-rank'&&row.rankingPeriod===null&&row.scope==='all'));
  assert.equal(parsed.sourceUpdatedAt,'09.28 14:00, 기준');assert.equal(parsed.sourceRanks[0].sourceUrl,musinsa.url);
});

test('29CM uses explicit search ranks without renumbering or adding separate brand popularity',()=>{
  const rows=parseSearchKeywordSnapshot(cmBody,cm,{capturedAt}).sourceRanks;
  assert.deepEqual(rows.map(row=>[row.term,row.rank]),[['살로몬',10],['NIKE',27]]);
  assert.equal(rows[0].sourceUpdatedAt,'09.28 기준');assert.equal(rows[0].rankingPeriod,null);
});

test('TikTok preserves actual KR seven-day hashtag ranks and anonymous capture size',()=>{
  const rows=parseSearchKeywordSnapshot(tiktokBody,tiktok,{capturedAt}).sourceRanks;
  assert.deepEqual(rows.map(row=>[row.term,row.rank]),[['추석',1],['gorpcore',3]]);
  assert(rows.every(row=>row.kind==='hashtag-rank'&&row.country==='KR'&&row.rankingPeriod==='7 days'));
  assert.throws(()=>parseSearchKeywordSnapshot(tiktokBody,{...tiktok,country:'US'},{capturedAt}),/UNVERIFIED/);
  assert.throws(()=>parseSearchKeywordSnapshot('{"items":[]}',tiktok,{capturedAt}),/UNVERIFIED/);
});

test('product BEST, changed labels, missing ranks, duplicates and sample text cannot enter search ranks',()=>{
  for(const body of [JSON.stringify({data:{content:[{itemName:'Sneaker',rank:1}]}}),cmBody.replace('인기 검색어','추천 상품'),cmBody.replace('"rank":10','"rank":null'),cmBody.replace('"rank":27','"rank":10')]){
    assert.throws(()=>parseSearchKeywordSnapshot(body,cm,{capturedAt}));
  }
  assert.throws(()=>parseSearchKeywordSnapshot(musinsaBody,musinsa,{capturedAt:'unknown'}),/DATE_INVALID/);
});

test('collection keeps working sources and immutable raw snapshots while failures add no stale ranks',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'search-keywords-'));
  try {
    const calls=[];
    const opts={config:{...config,sources:config.sources.slice(0,3)},now,auditDir:dir,readPublic:async(url,options)=>{calls.push([url,options]);if(url===cm.apiUrl)throw Error('HTTP 503 internal');return url===tiktok.apiUrl?tiktokBody:musinsaBody;}};
    const result=await collectSearchKeywords(opts);
    assert.equal(result.sourceRanks.length,4);assert.equal(calls.length,3);
    assert.deepEqual(calls.find(([url])=>url===tiktok.apiUrl)[1],{method:'POST',requestBody:tiktok.requestBody});
    assert.equal(result.searchRankStatus.find(row=>row.platform==='29cm').reason,'공개 검색순위 원문 확인 불가');
    assert.equal(result.searchRankStatus.find(row=>row.platform==='instagram').status,'unavailable');
    const files=await readdir(dir);assert.equal(files.length,2);
    const before=await Promise.all(files.map(file=>readFile(join(dir,file),'utf8')));
    await collectSearchKeywords(opts);assert.deepEqual(await readdir(dir),files);
    assert.deepEqual(await Promise.all(files.map(file=>readFile(join(dir,file),'utf8'))),before);
    const snapshot=JSON.parse(before[0]);assert.equal(snapshot.request.cookies,false);assert.equal(snapshot.request.authenticated,false);assert(snapshot.body);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('unreviewed API origin is rejected before network access',async()=>{
  let calls=0;
  const result=await collectSearchKeywords({config:{sources:[{...musinsa,apiUrl:'https://unreviewed.example/ranks'}]},now,auditDir:null,readPublic:async()=>{calls++;return musinsaBody;}});
  assert.equal(calls,0);assert.deepEqual(result.sourceRanks,[]);assert.equal(result.searchRankStatus[0].status,'unavailable');
});

test('public hashtag POST is bounded and sends no authorization or cookies',async()=>{
  let request;
  const text=await readSearchSource(tiktok.apiUrl,{method:'POST',requestBody:tiktok.requestBody,fetchImpl:async(url,options)=>{request={url,options};return new Response(tiktokBody,{status:200});}});
  assert.equal(text,tiktokBody);assert.equal(request.options.method,'POST');assert.equal(request.options.redirect,'error');
  assert.deepEqual(JSON.parse(request.options.body),tiktok.requestBody);
  assert(!Object.keys(request.options.headers).some(key=>/authorization|cookie/i.test(key)));
});

test('Tagwalk uses only named ranking section and rejects stale or future report periods',()=>{
  const source=config.sources.find(row=>row.id==='tagwalk');
  const html='<section class="brands-ranking titled-section">Basado en el tráfico de Tagwalk (20 Sep 2026 - 27 Sep 2026)<span class="rank-number">1</span><span class="brand">Prada</span><span class="rank-evolution">70</span></section><section><span class="rank-number">1</span><span class="brand">Wrong template</span></section>';
  const rows=parseSearchKeywordSnapshot(html,source,{capturedAt}).sourceRanks;
  assert.equal(rows.length,1);assert.equal(rows[0].term,'Prada');assert.equal(rows[0].rank,1);assert.equal(rows[0].metric,'brand-traffic');assert.equal(rows[0].periodEnd,'2026-09-27');assert.equal(rows[0].latestPeriodVerified,true);
  assert.throws(()=>parseSearchKeywordSnapshot(html.replaceAll('Sep','Aug'),source,{capturedAt}),/DATE_INVALID/);
  assert.throws(()=>parseSearchKeywordSnapshot(html.replaceAll('Sep','Oct'),source,{capturedAt}),/DATE_INVALID/);
  assert.throws(()=>parseSearchKeywordSnapshot(html.replace('20 Sep 2026 - 27 Sep 2026','25 Sep 2026 - 31 Sep 2026'),source,{capturedAt:'2026-10-02T05:00:00Z'}),/DATE_INVALID/);
});

test('Lyst discovers latest completed report and accepts only exact current chart ranks',()=>{
  const index='<a href="https://www.lyst.com/the-lyst-index/Q4-25">old</a><a href="https://www.lyst.com/the-lyst-index/Q2-26">latest</a>';
  const report=latestLystReport(index,{now});assert.equal(report.reportId,'lyst:Q2-26');assert.equal(report.periodEnd,'2026-06-30');
  const source={...config.sources.find(row=>row.id==='lyst'),...report,apiUrl:report.url,latestReportVerified:true};
  const html='<link rel="canonical" href="https://www.lyst.com/the-lyst-index/Q2-26/"><meta content="Q2-26" property="og:title"><div class="text-block-4 right">Q2-26</div>'+Array.from({length:20},(_,index)=>`<div class="chart-text-left"><div class="mono-type update">${index+1}</div><div class="mono-type">BRAND ${index+1}</div></div>`).join('')+'<div class="old-template">MIU MIU 1</div>';
  const rows=parseSearchKeywordSnapshot(html,source,{capturedAt}).sourceRanks;
  assert.equal(rows.length,20);assert.equal(rows[0].term,'BRAND 1');assert(rows.every(row=>row.latestPeriodVerified&&row.reportId==='lyst:Q2-26'&&row.rankingPeriod==='Q2 2026'));
  assert.throws(()=>latestLystReport(index,{now:new Date('2027-09-28')}),/UNVERIFIED/);
  assert.throws(()=>latestLystReport(index+'<a href="https://www.lyst.com/the-lyst-index/Q4-26">future</a>',{now}),/UNVERIFIED/);
  assert.throws(()=>parseSearchKeywordSnapshot(html.replace('BRAND 1','').replace('>1</div>','>2</div>'),source,{capturedAt}));
  assert.throws(()=>parseSearchKeywordSnapshot(html.replaceAll('Q2-26','Q1-26'),source,{capturedAt}),/IDENTITY_MISMATCH/);
  assert.throws(()=>parseSearchKeywordSnapshot(html.replace('right">Q2-26','right">Q1-26'),source,{capturedAt}),/IDENTITY_MISMATCH/);
  assert.throws(()=>parseSearchKeywordSnapshot(html.replace('property="og:title"','property="og:ignored"'),source,{capturedAt}),/IDENTITY_MISMATCH/);
});
