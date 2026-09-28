import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEditorialFeed,parseRanking,articleFromHtml,configuredDirectory,readPublicSource} from '../scripts/source-feeds.mjs';
import {collectSignals,matchesModel,parseSocial} from '../scripts/collect-signals.mjs';
import {curateCatalog} from '../scripts/curation.mjs';

const now=new Date('2026-09-28T04:00:00Z'),checkedAt=now.toISOString();
const source={id:'news.example',name:'Original Publisher',domain:'news.example',type:'magazine',url:'https://news.example/',feedUrl:'https://news.example/feed'};
const item=(patch={})=>({id:'nike-a',brand:'Nike',name:'Mesh running sneaker',style:'AA1234-001',signalAliases:[],...patch});
const feed=(entries)=>`<?xml version="1.0"?><rss><channel>${entries.map(e=>`<item><title><![CDATA[${e.title||'AA1234-001 review'}]]></title><link>${e.url||'https://news.example/one'}</link><pubDate>${e.date||'Sun, 27 Sep 2026 20:00:00 GMT'}</pubDate><content:encoded><![CDATA[${e.body||'<p>Nike AA1234-001 features breathable mesh.</p>'}]]></content:encoded></item>`).join('')}</channel></rss>`;
const config={editorialSources:[source],magazineDomains:['news.example'],newsletterDomains:[],snsAccounts:[],rankingPages:[]};
const musinsa={id:'musinsa',name:'무신사',adapter:'musinsa',country:'KR',category:'스니커즈',categoryCode:'103004',period:'실시간',url:'https://www.musinsa.com/main/sneaker/ranking?categoryCode=103004',apiUrl:'https://client.musinsa.com/api/ranking',basis:'매출·조회수·후기'};
const rankItem=(patch={})=>({image:{rank:8},info:{productName:'Nike sneaker AA1234-001'},onClick:{url:'https://www.musinsa.com/products/123',eventLog:{ga4:{payload:{section_name:'ranking_goods_list',applied_tab:'ranking_cat',item_id:'123',item_brand:'nike',item_category_id:'103004'}}}},...patch});
const rankBody=(items)=>JSON.stringify({meta:{result:'SUCCESS'},data:{modules:[{type:'QUERY_UPDATEDAT',information:{updatedAt:now.getTime()-60000}},{type:'MULTICOLUMN',items}]}});

test('publisher RSS accepts original dated entries and rejects external, old, future, undated and entity declarations',()=>{
  const result=parseEditorialFeed(feed([{}, {url:'https://other.example/copy'}, {date:'2025-09-27'}, {date:'2027-01-01'}, {date:'unknown'}]),source,{now});
  assert.equal(result.length,1);assert.equal(result[0].publishedAt,'2026-09-28');assert.equal(result[0].publishedAtInstant,'2026-09-27T20:00:00.000Z');assert.match(result[0].text,/breathable mesh/);
  assert.throws(()=>parseEditorialFeed('<html>redirect</html>',source,{now}),/INVALID/);
  assert.throws(()=>parseEditorialFeed('<!DOCTYPE rss [<!ENTITY external SYSTEM "file:///x">]><rss/>',source,{now}),/INVALID/);
});

test('exact SKU rejects adjacent colorway suffixes while allowing source punctuation',()=>{
  assert(matchesModel('Nike AA1234-001',item()));assert(matchesModel('AA1234 001',item()));
  assert(!matchesModel('AA1234-0012',item()));assert(!matchesModel('BAA1234-001',item()));assert(!matchesModel('AA1234-002',item()));
});

test('public RSS works despite search authentication failure and checks every eligible product',async()=>{
  const calls=[];let searchCalls=0;
  const result=await collectSignals({products:[item(),item({id:'nike-b'})],config,now,maxProducts:1,read:async()=>{searchCalls++;throw Error('HTTP 401');},readPublic:async url=>{calls.push(url);return feed([{}]);}});
  assert.equal(searchCalls,1);assert.deepEqual(calls,[source.feedUrl]);assert.equal(result.products.length,2);
  for(const p of result.products){assert.equal(p.sourceSignals.length,1);assert.equal(p.sourceSignals[0].publisherName,'Original Publisher');assert.equal(p.sourceSignals[0].evidenceMethod,'publisher-rss');}
  assert(result.products.every(p=>p.lastSignalCheckedAt===checkedAt));assert.equal(result.products.filter(p=>p.lastSignalSearchCheckedAt===checkedAt).length,1);
  assert.equal(result.sourceDirectory.magazine.configured[0].name,'Original Publisher');assert.deepEqual(result.sourceDirectory.sns.configured,[]);
  assert.equal(result.diagnostics.find(d=>d.status==='fetched').matchedProductCount,2);
});

test('legacy publisher aliases normalize before popularity counting and new evidence survives reviewed merges',async()=>{
  const old={type:'magazine',url:'https://news.example/legacy',title:'Review',publishedAt:'2026-09-27',checkedAt:'2026-09-27T00:00:00Z',publisherId:'old-alias',modelMatched:true,independent:true};
  const result=await collectSignals({products:[item({sourceSignals:[old]})],config,now,maxProducts:0,readPublic:async url=>url.endsWith('/feed')?feed([{}]):'<html></html>'});
  assert.deepEqual(new Set(result.products[0].sourceSignals.map(s=>s.publisherId)),new Set(['news.example']));
  assert.equal(result.products[0].lastSignalCheckedAt,checkedAt);assert.equal(result.products[0].lastSignalSearchCheckedAt,undefined);
});

test('default source discovery checks every eligible product, with limits only when explicitly requested',async()=>{
  const products=Array.from({length:45},(_,i)=>item({id:`nike-${i}`})),empty={...config,editorialSources:[]};let searches=0;
  const all=await collectSignals({products,config:empty,now,read:async()=>{searches++;return '';},readPublic:async()=>{throw Error('Unexpected public read');}});
  assert.equal(searches,45);assert.equal(all.products.filter(p=>p.lastSignalSearchCheckedAt===checkedAt).length,45);
  searches=0;const limited=await collectSignals({products,config:empty,now,maxProducts:2,read:async()=>{searches++;return '';}});
  assert.equal(searches,2);assert.equal(limited.products.length,45);assert.equal(limited.products.filter(p=>p.lastSignalSearchCheckedAt===checkedAt).length,2);
});

test('original HTML parser refuses whole-page recommendation fallback',()=>{
  assert.equal(articleFromHtml('<main>AA1234-001</main>'),null);
  const text=articleFromHtml('<meta property="og:title" content="Sneaker story"><meta property="article:published_time" content="2026-09-27"><article>AA1234-001 <h2>Related products</h2>XX1234-002</article>');
  assert.match(text,/Title: Sneaker story/);assert.match(text,/## Related products/);
});

test('SNS account-wide originality flag cannot approve an unreviewed post',()=>{
  const account={handle:'shoe.reader',independent:true,seller:false,brandOwned:false,originalPostsVerified:true};
  const args={url:'https://www.instagram.com/p/abc/',product:item(),checkedAt,config:{snsAccounts:[account]}};
  const text='Instagram: shoe.reader\nPublished Time: 2026-09-27\nNike AA1234-001';
  assert.equal(parseSocial(text,args),null);
  account.reviewedOriginalPosts=[{url:args.url,original:true,verifiedAt:checkedAt,evidence:'Photographer caption and original post reviewed'}];
  assert.equal(parseSocial(text,args).platformName,'Instagram');
  assert.equal(parseSocial(text.replace('shoe.reader','shoeXreader'),args),null);
});

test('Musinsa requires explicit rank, exact brand/style/category and ranking-list context',()=>{
  const valid=parseRanking(rankBody([rankItem()]),musinsa,{checkedAt,product:item(),matchesModel});
  assert.equal(valid.length,1);assert.equal(valid[0].rank,8);assert.equal(valid[0].rankBasis,'platform-explicit-rank');assert.equal(valid[0].dateBasis,'platform-updated-at');assert.equal(valid[0].captureLimit,100);
  for(const mutate of [x=>x.image.rank=0,x=>x.image.rank=101,x=>delete x.image.rank,x=>x.info.productName='AA1234-002',x=>x.onClick.eventLog.ga4.payload.item_brand='puma',x=>x.onClick.eventLog.ga4.payload.item_category_id='103001',x=>x.onClick.eventLog.ga4.payload.section_name='recommended_products']){
    const row=rankItem();mutate(row);assert.equal(parseRanking(rankBody([row]),musinsa,{checkedAt,product:item(),matchesModel}).length,0);
  }
});

test('29CM keeps the original displayed BEST position and capture date, never sales rank or release date',()=>{
  const rankSource={...musinsa,id:'29cm',name:'29CM',adapter:'29cm',category:'여성슈즈',categoryCode:'270100100',period:'1주일 (ONE_WEEK)'};
  const rows=[{itemNo:1,itemName:'Other loafer',frontBrandNameEng:'PRADA',frontCategoryInfo:[{category1Code:270100100}]},{itemNo:2,itemName:'AA1234-001',frontBrandNameEng:'NIKE',frontCategoryInfo:[{category1Code:270100100}]}];
  const result=parseRanking(JSON.stringify({result:'SUCCESS',data:{content:rows}}),rankSource,{checkedAt,product:item(),matchesModel});
  assert.equal(result.length,1);assert.equal(result[0].rank,2);assert.equal(result[0].rankBasis,'platform-best-list-position');assert.equal(result[0].dateBasis,'observed-snapshot');assert.equal(result[0].publishedAt,'2026-09-28');assert.equal(result[0].releaseDate,undefined);
});

test('ranking fetch is once per category per run and retained evidence uses exact named platform',async()=>{
  let fetches=0;const result=await collectSignals({products:[item(),item({id:'nike-b'})],config:{...config,editorialSources:[],rankingPages:[musinsa]},now,maxProducts:0,readPublic:async()=>{fetches++;return rankBody([rankItem()]);}});
  assert.equal(fetches,1);assert.equal(result.products[0].sourceSignals[0].platformName,'무신사');assert.equal(result.sourceDirectory.ecommerce.configured[0].name,'무신사');
});

test('public source reader rejects HTTP failures and oversized bodies without partial evidence',async()=>{
  await assert.rejects(readPublicSource('https://news.example/feed',{fetchImpl:async()=>new Response('blocked',{status:403})}),/403/);
  await assert.rejects(readPublicSource('https://news.example/feed',{fetchImpl:async()=>new Response('large text'),maxBytes:4}),/TOO_LARGE/);
});

test('every eligible expired source enters archive queue, while held invalid/date-unknown history remains preserved',()=>{
  const product={...item(),productType:'sneaker',officialCategory:'Lifestyle sneakers',description:'Lightweight mesh running sneaker cushioning.',url:'https://www.nike.com/t/a/AA1234-001',image:'https://static.nike.com/a.jpg',releaseDate:'2026-06-27',dateEvidence:{url:'https://www.nike.com/launch/a',precision:'day',verified:true,official:true,verifiedAt:checkedAt,excerpt:'AA1234-001 launches June 27, 2026.'},productVerifiedAt:checkedAt,productEvidenceUrl:'https://www.nike.com/t/a/AA1234-001'};
  const raw=[product,{...product,id:'unknown-day',releaseDate:undefined},{...product,id:'held-shoe',name:'Leather loafer'},{...product,id:'no-date-proof',dateEvidence:undefined}];
  const result=curateCatalog(raw,{now});assert.equal(result.snapshot.products.length,0);assert.deepEqual(result.queue.products.map(p=>p.id),['nike-a']);assert.equal(result.review.held.length,3);assert.equal(raw.length,4);assert.equal(raw[1].releaseDate,undefined);
});
