import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/_middleware.js';

const context=(url,password,header)=>({request:new Request(url,{headers:header?{Authorization:header}:{}}),env:password?{INTERNAL_SITE_PASSWORD:password}:{},next:()=>new Response('protected asset',{status:200})});
test('the old site redirects paths and queries to the new primary host',async()=>{
 const r=await onRequest(context('https://shoes-update.pages.dev/data/catalog.json?v=2'));
 assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://shoes-update-internal.pages.dev/data/catalog.json?v=2');
});
test('internal pages and asset URLs require the existing password, including immutable deployments',async()=>{
 for(const host of ['shoes-update-internal.pages.dev','example.shoes-update-internal.pages.dev'])for(const path of ['/','/images/photo.jpg','/data/catwalk.json']){
  const url='https://'+host+path;
  assert.equal((await onRequest(context(url,'test-only-password'))).status,401);
  assert.equal((await onRequest(context(url))).status,503);
  assert.equal((await onRequest(context(url,'test-only-password','Basic '+btoa('any-user:test-only-password')))).status,200);
  assert.equal((await onRequest(context(url,'test-only-password','Basic '+btoa('any-user:wrong')))).status,401);
 }
});
