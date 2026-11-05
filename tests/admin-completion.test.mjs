import test from 'node:test';import assert from 'node:assert/strict';
import{adminCoverageExhaustive,validAdminCapture}from'../scripts/admin-monitor-runner.mjs';
test('finished listing pagination cannot hide pending colour PDP work',()=>{
 const listing={sourceUrl:'https://en.miharayasuhiro.jp/products/list.php',total:125,cards:125,exhausted:true};
 assert.equal(adminCoverageExhaustive({coverage:[listing],exhausted:false,pending:{productUrls:['colour-pdp']}}),false);
 assert.equal(adminCoverageExhaustive({coverage:[listing],exhausted:true}),true);
 assert.equal(adminCoverageExhaustive({coverage:[{total:10,read:10,exhaustive:false}]}),false);
 assert.equal(adminCoverageExhaustive({coverage:[{total:10,read:10,exhausted:true,exhaustive:false}]}),false);
 assert.equal(adminCoverageExhaustive({coverage:[{exhaustive:true}],complete:false}),false);
 assert.equal(adminCoverageExhaustive({coverage:[]}),false);
});
test('rendered cache cannot turn a denial or different category into a valid New source',()=>{
 const url='https://www.on.com/en-us/shop/new-arrivals/shoes',at='2026-11-05T06:00:00Z',good={checkedAt:at,requestedUrl:url,metadata:{statusCode:200,sourceURL:url,url}};
 assert(validAdminCapture(good,url,new Date(at)));
 assert.equal(validAdminCapture({...good,metadata:{...good.metadata,statusCode:403}},url,new Date(at)),false);
 assert.equal(validAdminCapture({...good,metadata:{...good.metadata,url:'https://www.on.com/en-us/shop/shoes'}},url,new Date(at)),false);
 assert.equal(validAdminCapture({...good,checkedAt:'2026-11-03T06:00:00Z'},url,new Date(at)),false);
 const pipe='https://www.adidas.com/us/men|women-athletic_sneakers-shoes-new_arrivals';
 assert(validAdminCapture({checkedAt:at,requestedUrl:pipe,metadata:{statusCode:200,url:pipe.replace('|','%7C')}},pipe,new Date(at)));
});
