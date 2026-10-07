import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderedOfficialReader} from '../scripts/rendered-official-reader.mjs';
import {createOfficialReader} from '../scripts/official-reader.mjs';
const target='https://official.example/jp/sneakers';
const text='Public official sneaker catalogue with shoe specifications and product links. '.repeat(4);
const page=(override={})=>Response.json({success:true,data:{markdown:text,metadata:{url:target,statusCode:200,title:'Official Sneakers'},...override}});
test('rendered detail mode reads HTML galleries omitted from markdown and caches by mode',async()=>{
 const requests=[],client=createRenderedOfficialReader({origins:[target],sleep:async()=>{},fetchImpl:async(_,options)=>{requests.push(JSON.parse(options.body));return page({html:'<h1>Runner sneakers</h1><p>Official product description with rubber outsole and mesh upper. Verified shoes are available in the official catalogue.</p><img alt="Runner side" src="https://official.example/runner-side.jpg">'});}});
 const result=await client.readHtml(target);assert(result.includes('runner-side.jpg'));await client.readHtml(target);assert.equal(requests.length,1);assert.deepEqual(requests[0].formats,['markdown','html']);assert.equal(requests[0].onlyMainContent,false);await client.read(target);assert.equal(requests.length,2);
});
test('public rendering sends only an official URL, caches repeats, and caps requests',async()=>{
  const calls=[],client=createRenderedOfficialReader({origins:[target],sleep:async()=>{},maxRequests:1,fetchImpl:async(url,options)=>{calls.push({url,options});return page();}});
  const [a,b]=await Promise.all([client.read(target),client.read(target)]);assert.equal(a,b);assert(a.includes('URL Source: '+target));assert.equal(calls.length,1);
  const body=JSON.parse(calls[0].options.body);assert.equal(body.proxy,'auto');assert.equal(body.maxAge,0);assert(!('profile' in body));assert(!('headers' in body));assert(!calls[0].options.headers.Authorization);assert.equal(calls[0].options.redirect,'error');
  await assert.rejects(client.read('https://unreviewed.example/'),/NOT_ALLOWED/);
  await assert.rejects(client.read('https://user:secret@official.example/'),/NOT_ALLOWED/);
  await assert.rejects(client.read('https://official.example/?access_token=secret'),/NOT_ALLOWED/);
  await assert.rejects(client.read(target+'?page=2'),/RUN_LIMIT/);assert.equal(calls.length,1);
});
test('provider quota stops subsequent fallbacks without retries or leaked error bodies',async()=>{
  let calls=0;const client=createRenderedOfficialReader({origins:[target],sleep:async()=>{},fetchImpl:async()=>{calls++;return new Response('private provider error',{status:429});}});
  await assert.rejects(client.read(target),/^Error: RENDERED_OFFICIAL_HTTP_429$/);
  await assert.rejects(client.read(target+'?page=2'),/QUOTA_STOPPED/);assert.equal(calls,1);assert(client.stats.quotaStopped);
});
test('failed pages, cross-origin redirects and challenges cannot become readable',async()=>{
  for(const response of [page({metadata:{url:target,statusCode:403}}),page({metadata:{url:target,statusCode:302}}),page({metadata:{sourceURL:target,statusCode:200}}),page({metadata:{url:target,statusCode:200,error:'failed'}}),page({metadata:{url:'https://other.example/',statusCode:200}}),...['Just a moment...','CAPTCHA verification','Robot Check','Sign In'].map(title=>page({metadata:{url:target,statusCode:200,title}}))]){
    const client=createRenderedOfficialReader({origins:[target],fetchImpl:async()=>response});await assert.rejects(client.read(target));assert.equal(client.stats.readable,0);
  }
});
test('renderer runs only after primary and direct public official readers fail',async()=>{
  let rendered=0;const reader=createOfficialReader({origins:[target],read:async()=>{throw Error('unavailable');},fetchImpl:async()=>new Response('',{status:403}),renderedRead:async url=>{assert.equal(url,target);rendered++;return text;}});
  assert.equal(await reader.read('https://r.jina.ai/'+target),text);assert.equal(rendered,1);assert.equal(reader.diagnostics.at(-1).method,'rendered-public-official');
  await assert.rejects(reader.read('https://r.jina.ai/https://unknown.example/'));assert.equal(rendered,1);
});
