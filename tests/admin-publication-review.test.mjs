import test from 'node:test';import assert from 'node:assert/strict';
import {reviewAdminProducts,retainReviewedAdminPhoto,retainExactPhotoAdminReview,preserveAdminBaselineFields} from '../scripts/admin-publication-review.mjs';
test('baseline recovery restores only missing fields within the authorized brands and keeps new verified prices',()=>{
 const prior=[{id:'a',brand:'Prada',priceLabel:'USD 990',material:'Leather',notes:{reviewed:true}},{id:'b',brand:'Nike',priceLabel:'USD 120'},{id:'c',brand:'Prada',priceLabel:'USD 800'}];
 const current=[{id:'a',brand:'Prada',priceLabel:'',material:'',lastVerifiedAt:'2026-11-05'},{id:'b',brand:'Nike',priceLabel:''},{id:'c',brand:'Prada',priceLabel:'USD 850'}];
 const result=preserveAdminBaselineFields(current,prior,['Prada']);assert.equal(result[0].priceLabel,'USD 990');assert.equal(result[0].material,'Leather');assert.deepEqual(result[0].notes,{reviewed:true});assert.equal(result[0].lastVerifiedAt,'2026-11-05');assert.equal(result[1],current[1]);assert.equal(result[2].priceLabel,'USD 850');assert.equal(current[0].priceLabel,'');
});
test('admin publication rejects inherited New membership on a general sports catalogue',()=>{
 const make=url=>({id:url,brand:'diadora',style:'201.182808_C0178',url:'https://www.diadora.com/en/us/b.elite/201.182808_C0178.html',arrivalEvidence:{kind:'new-arrivals-listing',url}});
 const rows=[make('https://www.diadora.com/en/us/shoes/'),make('https://www.diadora.com/en/us/new-arrivals/')];
 const out=reviewAdminProducts(rows,{});assert.equal(out.products.length,1);assert.equal(out.products[0].id,rows[1].id);assert.equal(out.held[0].reason,'new-membership-not-bound-to-verified-section');
});
test('identical photo bytes retain reviewed mixed colours across official locale URLs without borrowing another photo review',()=>{
 const old={id:'old',brand:'Rockfish Weatherwear',style:'4318',url:'https://shop.example/detail?product_no=4318',image:'https://cdn.example/big.jpg',presentation:{cachedPath:'/images/identical.jpg',thumbnail:{path:'/images/reviewed.webp'}},colorway:'Charcoal / Grey',colorSwatches:['#35383d','#88909a'],colourReview:{verified:true,checkedAt:'2026-11-03',style:'4318',url:'https://shop.example/detail?product_no=4318',image:'https://cdn.example/big.jpg'}};
 const incoming={...old,id:'new',url:'https://shop.example/product/grey/4318/',image:'https://cdn.example/medium.jpg',colorway:'GREY',colourReview:undefined};
 const retained=retainExactPhotoAdminReview(incoming,[old]);assert.equal(retained.colorway,old.colorway);assert.deepEqual(retained.colorSwatches,old.colorSwatches);assert.equal(retained.colourReview.url,incoming.url);assert.equal(retained.colourReview.image,incoming.image);assert.equal(retained.colourReview.checkedAt,'2026-11-03');
 const other={...incoming,presentation:{cachedPath:'/images/different.jpg'}};assert.equal(retainExactPhotoAdminReview(other,[old]),other);
});
test('locale URLs sharing an exact manufacturer variant collapse, conflicting ID cannot overwrite',()=>{
 const p={id:'same',brand:'Prada',style:'2EE400_3LKG_F0009',url:'https://www.prada.com/us/en/p/sneakers/2EE400_3LKG_F0009'};
 const q={...p,url:p.url.replace('/us/','/kr/')},bad={...p,style:'DIFFERENT',url:'https://www.prada.com/us/en/p/other/DIFFERENT'};
 const out=reviewAdminProducts([p,q,bad],{});assert.deepEqual(out.products,[p]);assert.equal(out.held.length,1);
});
test('a recheck retains an existing reviewed shoe photo instead of replacing it with a campaign image',()=>{
 const old={id:'old',brand:'Prada',style:'2EE400_3LKG_F0009',url:'https://www.prada.com/us/en/p/sneakers/2EE400_3LKG_F0009',image:'https://cdn.prada.com/shoe.jpg',presentation:{cachedPath:'/images/shoe.jpg',frame:{x:0,y:0,width:1,height:1}},officialImageEvidence:{verified:true,url:'https://cdn.prada.com/shoe.jpg'},colorway:'White'};
 const proof={verified:true,brand:old.brand,style:old.style,verifiedAt:'2026-11-05T00:00:00Z',verificationMethod:'official-new-arrivals-and-product-page',contentHash:'a'.repeat(64)};
 Object.assign(old,{productEvidenceUrl:old.url,officialProductEvidence:{...proof,url:old.url},officialImageEvidence:{...proof,url:old.image,sourceUrl:old.url}});
 const incoming={...old,id:'incoming',image:'https://cdn.prada.com/campaign.jpg',presentation:{cachedPath:'/images/campaign.jpg'},name:'Updated official name'};
 const out=retainReviewedAdminPhoto(incoming,[old]);assert.equal(out.image,old.image);assert.deepEqual(out.presentation,old.presentation);assert.equal(out.name,incoming.name);assert.notEqual(out.presentation,old.presentation);assert.equal(incoming.image,'https://cdn.prada.com/campaign.jpg');
 const legacy={...old,officialProductEvidence:undefined};assert.equal(retainReviewedAdminPhoto(incoming,[legacy]),incoming,'an unverified legacy envelope cannot replace a new proof');
});
