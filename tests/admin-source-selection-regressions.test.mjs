import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {isAdminNewSource,selectAdminSources,allowAdminListingFollowup,adminReaderMarkdown} from '../scripts/admin-source-selection.mjs';
import {isNewListing,listingFollowups,parseArrivalListing} from '../scripts/new-arrivals.mjs';
import {assertReadableOfficial} from '../scripts/official-reader.mjs';
import {auditBrand} from '../scripts/admin-monitor-runner.mjs';

const brand='Rockfish Weatherwear',parent='https://en.rockfish-weatherwear.co.kr/category/new/230/',url='https://en.rockfish-weatherwear.co.kr/NODE/product/list.html?cate_no=626';
const source={url,sectionEvidence:{kind:'new-arrivals-navigation',url:parent,targetUrl:url,contentHash:'a'.repeat(64)}};
test('admin selector requires bound official evidence and ignores New source names',()=>{
  assert(isAdminNewSource(brand,source));
  for(const change of [{targetUrl:parent},{url:'https://unrelated.example/'},{contentHash:''},{kind:'catalogue-listing'}])assert(!isAdminNewSource(brand,{...source,sectionEvidence:{...source.sectionEvidence,...change}}));
  assert(!isAdminNewSource(brand,{url,name:'Official New'}));
  assert(!isAdminNewSource(brand,{url:url+'&sort_method=5',name:'Official New'}));
});
test('LUX seeds prefer sneakers, retain both genders shoe catalogs and constrain followups',()=>{
  const rows=['https://www.celine.com/','https://www.celine.com/en-us/new/','https://www.celine.com/en-us/women/shoes/','https://www.celine.com/en-us/men/shoes/sneakers/','https://unrelated.example/sneakers/'].map(url=>({url}));
  const selected=selectAdminSources('Celine',rows);
  assert.deepEqual(selected.map(s=>s.url),[rows[3].url,rows[2].url]);
  assert(allowAdminListingFollowup('Celine',selected,{url:rows[3].url+'?page=2'},rows[3]));
  assert(!allowAdminListingFollowup('Celine',selected,rows[1],rows[3]));
  assert.deepEqual(selectAdminSources('Celine',[rows[0]]),[rows[0]]);
});
test('cached Markdown gains a complete reader envelope while preserving warnings',()=>{
  const body='# Shoes\n[Official store]('+parent+')';
  const wrapped=adminReaderMarkdown(body,url);
  assert(wrapped.includes('Title: Official listing\n'));
  assert(wrapped.includes('URL Source: '+url+'\n'));
  assert(wrapped.includes('Markdown Content:\n\n'+body));
  assert.equal(adminReaderMarkdown(wrapped,url),wrapped);
  assert.equal(assertReadableOfficial(wrapped),wrapped);
  assert.throws(()=>assertReadableOfficial(adminReaderMarkdown('Warning: requiring CAPTCHA\n'+body,url)),/CHALLENGE/);
  assert.throws(()=>assertReadableOfficial(adminReaderMarkdown('# Empty',url)),/NO_LINKS/);
});
test('verified Jordan and Lululemon New routes match only their specific host and path',()=>{
  for(const target of ['https://www.nike.com/w/new-jordan-shoes-37eefz3n82yzy7ok','https://shop.lululemon.com/c/whats-new-sneakers/n1d852zq0cf']){
    assert(isNewListing(target));
    assert(!isNewListing(target.replace(new URL(target).hostname,'unrelated.example')));
  }
  assert(!isNewListing('https://www.nike.com/w/jordan-shoes-37eefzy7ok'));
  assert(!isNewListing('https://shop.lululemon.com/c/sneakers/n1d852zq0cf'));
});
test('sports New footer Shoes navigation cannot turn a general catalog into New',()=>{
  const root='https://www.diadora.com/en/us/new-arrivals/';
  const broad='https://www.diadora.com/en/us/shoes/';
  const next=listingFollowups('[Shoes]('+broad+')\n[Next]('+broad+'?page=2)',root,'diadora');
  assert.deepEqual(next,[]);
  assert.deepEqual(parseArrivalListing('# Shoes\n[Example Sneaker](https://www.diadora.com/en/us/example/123456.html)',{brand:'diadora',url:broad,checkedAt:'2026-11-05T00:00:00Z'}),[]);
});
test('New subsets and numeric Cafe24 pagination preserve evidence, category switches do not',()=>{
  const page=url+'&page=2';
  const next=listingFollowups('[Next]('+page+')\n[Shoes]('+url.replace('626','487')+')',url,brand,source.sectionEvidence);
  assert.equal(next.length,1);
  assert.equal(next[0].sectionEvidence.targetUrl,page);
  const bare=listingFollowups(page+'\n'+url.replace('626','487')+'&page=3',url,brand,source.sectionEvidence);
  assert.deepEqual(bare.map(s=>s.url),[page]);
  assert.equal(bare[0].sectionEvidence.targetUrl,page);
  assert.equal(listingFollowups('[Shoes]('+parent+'shoes/)',parent,brand).length,1);
  assert.equal(listingFollowups('[Shoes](https://en.rockfish-weatherwear.co.kr/shoes/)', 'https://en.rockfish-weatherwear.co.kr/',brand).length,0);
});
test('LUX legacy footwear navigation still reaches official assortment shelves',()=>{
  const root='https://www.celine.com/en-us/new/';
  const shelf='https://www.celine.com/en-us/men/shoes/sneakers/';
  assert.deepEqual(listingFollowups('[Sneakers]('+shelf+')',root,'Celine').map(s=>s.url),[shelf]);
});
test('Cafe24 product detail paths remain products while list.html is a listing',()=>{
  const links=listingFollowups('[New]('+url+')\n[New](https://en.rockfish-weatherwear.co.kr/product/real-sneaker/4318/)',parent,brand);
  assert.deepEqual(links.map(s=>s.url),[url]);
});
test('cached generic runner remains offline and delivers both callbacks',async t=>{
  const original=fs.readFile.bind(fs),reads=[],progress=[],collected=[];
  t.mock.method(fs,'readFile',async(file,...args)=>{
    if(file==='config/daily_sources.json')return JSON.stringify({[brand]:[source]});
    if(file==='reports/admin-rendered-index.json')return JSON.stringify({[url]:{path:'logs/admin-rendered/fixture.json.gz',checkedAt:'2026-11-05T00:00:00Z'}});
    if(file==='logs/admin-rendered/fixture.json.gz')return gzipSync(JSON.stringify({checkedAt:'2026-11-05T00:00:00Z',metadata:{statusCode:200,sourceURL:url,url},markdown:'# Shoes\n[Official store](https://en.rockfish-weatherwear.co.kr/)'}));
    if(file==='public/data/catalog.json')return '{"products":[],"keywords":[]}';
    return original(file,...args);
  });
  t.mock.method(globalThis,'fetch',async()=>{throw Error('NETWORK_DISABLED');});
  const result=await auditBrand(brand,{now:new Date('2026-11-05T00:00:00Z'),readHtml:async target=>{reads.push(target);throw Error('Unexpected HTML read');},onProgress:async value=>progress.push(value),onCollected:async value=>collected.push(value)});
  assert.deepEqual(reads,[]);assert(progress.length>0);assert.equal(collected.length,1);assert.deepEqual(result.errors,[]);
});
