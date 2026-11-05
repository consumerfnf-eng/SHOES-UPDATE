import test from'node:test';import assert from'node:assert/strict';import{bindAdminRawProof}from'../scripts/admin-publication-review.mjs';
test('whole replacement proof removes an obsolete official-product-id type instead of inheriting it',()=>{
 const raw={id:'one',brand:'MCM',style:'old-handle',styleType:'official-product-id',manufacturerStyle:'KNOWN-SKU',officialProductEvidence:{style:'old-handle'},recheckEvidence:{stale:true}};
 const prepared={style:'KNOWN-SKU',url:'https://www.mcmworldwide.com/new',image:'https://assets.example/new.jpg',officialProductEvidence:{style:'KNOWN-SKU',contentHash:'new'},officialImageEvidence:{style:'KNOWN-SKU',contentHash:'new'}};
 const result=bindAdminRawProof(raw,prepared);assert.equal(result.styleType,undefined);assert.equal(result.recheckEvidence,undefined);assert.equal(result.manufacturerStyle,'KNOWN-SKU');assert.deepEqual(result.officialProductEvidence,prepared.officialProductEvidence);assert.equal(raw.styleType,'official-product-id');
});
