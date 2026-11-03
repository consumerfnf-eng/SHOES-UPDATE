import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDisplayLanguage} from '../scripts/normalize-display-language.mjs';
import {classifyFootwear} from '../scripts/curation.mjs';
test('a colour-only heading is recovered from the verified official readable product slug',()=>{
 for(const [brand,url,name]of [
  ['Nike','https://www.nike.com/t/hybrid-rn-womens-training-shoes-gNDq4Wkp/IO3815-002','Hybrid Rn Training Shoes'],
  ['Melissa','https://www.shopmelissa.com/products/cozy-platform-36158-bq229','Cozy Platform'],
  ['Merrell','https://www.merrell.com/US/en/wrapt-sneaker/60644M.html','Wrapt Sneaker']
 ]){
  const p={brand,url,name:'/Black/White',officialProductEvidence:{verified:true,brand,url}};
  assert.equal(normalizeDisplayLanguage(p).name,name);assert.equal(normalizeDisplayLanguage(p).sourceName,p.name);
  if(brand==='Nike')assert.equal(classifyFootwear(normalizeDisplayLanguage(p)).category,'sneaker');
  assert.equal(normalizeDisplayLanguage({...p,url:'https://other.example/product/guess'}).name,p.name);
  assert.equal(normalizeDisplayLanguage({...p,officialProductEvidence:{verified:false}}).name,p.name);
 }
});
