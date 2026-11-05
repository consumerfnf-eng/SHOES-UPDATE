import test from 'node:test';import assert from 'node:assert/strict';import {mergeCollectedRuns}from'../scripts/admin-collected-union.mjs';
test('a smaller resumed result contributes new variants and replaces only its exact whole proof',()=>{
 const p={id:'a',brand:'Prada',url:'https://www.prada.com/p/a',officialProductEvidence:{verified:true,contentHash:'old'},image:'old'},q={...p,id:'b',url:'https://www.prada.com/p/b'},fresh={...p,image:'fresh',officialProductEvidence:{verified:true,contentHash:'fresh'}};
 const out=mergeCollectedRuns([{checkedAt:'2026-11-05T00:00:00Z',products:[p,q]},{checkedAt:'2026-11-05T01:00:00Z',products:[fresh]}],['Prada']);assert.deepEqual(out,[fresh,q]);assert.equal(out[0].officialProductEvidence.contentHash,'fresh');
});
test('raw feed checkpoints and brands outside the explicitly requested scope cannot enter publication input',()=>{
 const out=mergeCollectedRuns([{products:[{id:1,title:'Raw Shopify'},{id:'x',brand:'Nike',url:'https://www.nike.com/x',officialProductEvidence:{verified:true}}]}],['Prada']);assert.deepEqual(out,[]);
});
