import test from'node:test';import assert from'node:assert/strict';import{classifyFootwear}from'../scripts/curation.mjs';
test('official Hybrid RN training shoe classification survives Nike title prefix',()=>{
 const p={brand:'Nike',url:'https://www.nike.com/t/hybrid-rn-womens-training-shoes-gNDq4Wkp/IO3815-001',officialCategory:"Women's Training Shoes",productType:'sneaker'};
 assert.equal(classifyFootwear({...p,name:'Hybrid RN'}).category,'sneaker');
 assert.equal(classifyFootwear({...p,name:'Nike Hybrid RN'}).category,'sneaker');
 assert.equal(classifyFootwear({...p,name:'Nike Hybrid RN',url:'https://www.nike.com/t/other-hybrid-shoe/AB1234-001'}).reason,'hybrid-review-required');
});
