import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {auditBrand} from '../scripts/admin-monitor-runner.mjs';

const now=new Date('2026-11-05T00:00:00Z');
const source='https://www.adidas.com/us/shoes-new_arrivals?sort=newest-to-oldest';
const product='https://www.adidas.com/us/runner-shoes/AB1234.html';
const image='https://assets.adidas.com/images/w_1000,h_1000/Runner_Shoes_White_AB1234_01_standard.jpg';
function fixture(t,markdown,{html='<title>New shoes</title><h1>New shoes</h1>'}={}){
  const original=fs.readFile.bind(fs),collected=[],progress=[];
  const cache={
    [source]:{html,markdown},
    [product]:{html:'<title>Runner Shoes</title>',markdown:'# Runner Shoes\n[Official store](https://www.adidas.com/us/)'},
  };
  const urls=Object.keys(cache),paths=urls.map((_,i)=>'logs/admin-rendered/fallback-fixture-'+i+'.json.gz');
  t.mock.method(fs,'readFile',async(file,...args)=>{
    if(file==='config/daily_sources.json')return JSON.stringify({adidas:[{url:source}]});
    if(file==='public/data/catalog.json')return '{"products":[],"keywords":[]}';
    if(file==='reports/admin-rendered-index.json')return JSON.stringify(Object.fromEntries(urls.map((url,i)=>[url,{path:paths[i],checkedAt:now.toISOString()}])));
    if(paths.includes(file)){const url=urls[paths.indexOf(file)];return gzipSync(JSON.stringify({...cache[url],checkedAt:now.toISOString(),metadata:{statusCode:200,sourceURL:url,url}}));}
    return original(file,...args);
  });
  t.mock.method(globalThis,'fetch',async()=>{throw Error('NETWORK_DISABLED');});
  return {collected,progress,run:()=>auditBrand('adidas',{now,onCollected:async result=>collected.push(result),onProgress:async value=>progress.push(value)})};
}
test('missing Adidas hydration falls through to cached Markdown with bound official cards',async t=>{
  const f=fixture(t,'# New Shoes\n[![Runner Shoes - White]('+image+')]('+product+')');
  const report=await f.run();
  assert.equal(report.verified,1);
  assert.equal(report.status,'partial');
  assert.equal(report.exhaustive,false);
  assert(report.errors.some(error=>/adidas original New page data missing/.test(error)));
  assert.equal(report.candidates[0].url,product);
  assert.equal(f.collected.length,1);assert(f.progress.length>0);
  const row=f.collected[0].products[0];
  assert.equal(row.officialImageEvidence.url,image);
  assert.equal(row.officialImageEvidence.sourceUrl,source);
  assert.equal(row.arrivalEvidence.kind,'new-arrivals-listing');
});
test('structured fallback does not verify a shoe whose image is not bound to its card',async t=>{
  const f=fixture(t,'# New Shoes\n![Runner Shoes - White]('+image+')\n[Runner Shoes]('+product+')');
  const report=await f.run();
  assert.equal(report.verified,0);
  assert.deepEqual(report.candidates,[]);
  assert.equal(report.exhaustive,false);
  assert.equal(report.status,'partial');
});
test('a successful structured output does not trigger generic discovery',async t=>{
  const html='<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{taxonomy:'shoes-new_arrivals',products:[],info:{count:0,startIndex:0}}}})+'</script>';
  const f=fixture(t,'# New Shoes\n[![Runner Shoes - White]('+image+')]('+product+')',{html});
  const report=await f.run();
  assert.equal(report.verified,0);
  assert.equal(f.progress.length,0);
  assert.equal(f.collected.length,1);
  assert.deepEqual(report.errors,[]);
});
