import test from'node:test';import assert from'node:assert/strict';import{readShopifyInventory}from'../scripts/collect-official-inventory.mjs';
test('a bounded official feed response still requires its empty terminal page',async()=>{
 const seen=[];const result=await readShopifyInventory({brand:'PANE',root:'https://paneshoes.com',pageSize:50},{read:async url=>{seen.push(url);return JSON.stringify({products:seen.length===1?[{id:1}]:[]});}});
 assert.equal(result.exhausted,true);assert.equal(result.products.length,1);assert.equal(seen.length,2);assert(seen.every(url=>new URL(url).searchParams.get('limit')==='50'));
});
