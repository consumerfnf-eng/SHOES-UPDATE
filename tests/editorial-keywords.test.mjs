import test from 'node:test';
import assert from 'node:assert/strict';
import {collectEditorialKeywords,editorialTerms} from '../scripts/collect-editorial-keywords.mjs';

const dictionary={excludedQueryTerms:['jacket','loafers','boots'],entries:[
  {id:'nike',kind:'brand',aliases:['나이키'],match:{brands:['Nike']}},
  {id:'on',kind:'brand',aliases:['On Running'],match:{brands:['On']}},
  {id:'pane',kind:'brand',aliases:[],match:{brands:['Pane']}},
  {id:'suede',kind:'material',aliases:['suede','스웨이드']},
  {id:'sneakers',kind:'category',aliases:['sneakers','스니커즈']}
]};
const now=new Date('2026-09-28T05:00:00Z'),source={id:'publisher',name:'Publisher',domain:'news.example',url:'https://news.example/',feedUrl:'https://news.example/feed'};
const feed=entries=>'<rss><channel>'+entries.map(entry=>`<item><title>${entry.title}</title><link>https://news.example/${entry.id||'story'}</link><pubDate>${entry.date||'Sun, 27 Sep 2026 20:00:00 GMT'}</pubDate><description>Body</description></item>`).join('')+'</channel></rss>';

test('editorial keywords require explicit current trend headline and preserve literal original labels',()=>{
  assert.deepEqual(editorialTerms('The Hottest Nike Suede Sneakers',dictionary),['Nike','Suede','Sneakers']);
  for(const title of ['Nike Suede Sneakers Release Today','Trending Nike jacket','Trending loafers and sneakers','2027 Forecast: Nike Suede Sneakers','Sponsored: Hottest Nike Sneakers','Nike Sneakers Campaign Trends'])assert.deepEqual(editorialTerms(title,dictionary),[]);
  assert.deepEqual(editorialTerms('Trending sneakers on the runway',dictionary),[]);
  assert(!editorialTerms('Sneakers On Trend: transparent pane construction',dictionary).includes('On'));
  assert(!editorialTerms('Sneakers On Trend: transparent pane construction',dictionary).includes('pane'));
});

test('editorial collector uses only recent original feed headlines, has no rank, and records unavailable honestly',async()=>{
  const result=await collectEditorialKeywords({now,dictionary,config:{editorialSources:[source,{...source,id:'failed',feedUrl:'https://news.example/failed'}]},auditDir:null,readPublic:async url=>{
    if(url.endsWith('failed'))throw Error('HTTP 503');
    return feed([{title:'Hottest Nike Suede Sneakers'},{id:'old',title:'Trending Nike Sneakers',date:'Mon, 01 Sep 2026 00:00:00 GMT'},{id:'launch',title:'Nike Sneakers Release Tomorrow'}]);
  }});
  assert.equal(result.sourceRanks.length,3);
  assert(result.sourceRanks.every(row=>row.rank===null&&row.kind==='editorial-keyword'&&row.sourceOriginalContext==='Hottest Nike Suede Sneakers'));
  assert(result.sourceRanks.every(row=>row.sourceUrl==='https://news.example/story'&&row.publishedAt==='2026-09-27T20:00:00.000Z'));
  assert.equal(result.editorialStatus.find(row=>row.platform==='failed').status,'unavailable');
});

test('readable newsletter with no qualifying popularity claim has zero keywords and explicit reason',async()=>{
  const result=await collectEditorialKeywords({now,dictionary,config:{editorialSources:[source]},auditDir:null,readPublic:async()=>feed([{title:'Nike Sneakers Launch'}])});
  assert.deepEqual(result.sourceRanks,[]);assert.equal(result.editorialStatus[0].count,0);assert.match(result.editorialStatus[0].reason,/명시적/);
});

test('editorial 168-hour boundary uses original RSS instant without KST day truncation',async()=>{
  const result=await collectEditorialKeywords({now,dictionary,config:{editorialSources:[source]},auditDir:null,readPublic:async()=>feed([
    {id:'at-boundary',title:'Hottest Nike Sneakers',date:'2026-09-21T05:00:00.000Z'},
    {id:'just-old',title:'Hottest Nike Sneakers',date:'2026-09-21T04:59:59.999Z'},
    {id:'just-young',title:'Hottest Nike Sneakers',date:'2026-09-21T05:00:00.001Z'},
    {id:'future',title:'Hottest Nike Sneakers',date:'2026-09-28T05:00:00.001Z'}
  ])});
  assert.deepEqual(new Set(result.sourceRanks.map(row=>row.sourceUrl)),new Set(['https://news.example/at-boundary','https://news.example/just-young']));
  assert(result.sourceRanks.every(row=>row.publishedAt==='2026-09-21T05:00:00.000Z'||row.publishedAt==='2026-09-21T05:00:00.001Z'));
});
