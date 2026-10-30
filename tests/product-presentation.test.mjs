import test from 'node:test';import assert from 'node:assert/strict';
import {productPresentation} from '../scripts/product-presentation.mjs';
import {colorSwatch,groupProductVariants} from '../public/assets/catalog-view.mjs';
test('only exact reviewed side/three-quarter official assets pass the photo gate',()=>{
 const p={id:'a',brand:'Nike',style:'SKU',image:'https://static.nike.com/a.jpg'};
 const row={...p,originalImage:p.image,approved:true,view:'side',noPerson:true,sourceUrl:'https://www.nike.com/a',checkedAt:'2026-10-06'};
 assert(productPresentation(p,{products:[row]}));assert.equal(productPresentation({...p,image:'https://static.nike.com/campaign.jpg'},{products:[row]}),null);
 assert.equal(productPresentation(p,{products:[{...row,noPerson:false}]}),null);assert.equal(productPresentation(p,{products:[{...row,view:'top'}]}),null);
});
test('color circles are safe CSS values and models stay distinct',()=>{
 assert.equal(colorSwatch({colorway:'Black'}),'#242424');assert(colorSwatch({colorway:'White / Blue'}).startsWith('linear-gradient'));
 assert(!colorSwatch({colorSwatches:['url(https://bad.example)'],colorway:'unknown'}).includes('url'));
 const p={brand:'Celine',name:'Freestyle Lo - Black',colorway:'Black'};
 assert.equal(groupProductVariants([p,{...p,name:'Freestyle Lo - Beige',colorway:'Beige'},{...p,name:'Freestyle Hi - Black'}]).length,2);
});
test('reviewed official product links require the exact approved photo record and the brand official domain',()=>{
 const p={id:'salomon-test',brand:'Salomon',style:'L49213700',image:'https://cdn.dam.salomon.com/L49213700/side.jpg',url:'https://www.salomon.com/en-ca/product/xt-6-lg4239/L49213700'};
 const row={...p,originalImage:p.image,approved:true,view:'side',noPerson:true,sourceUrl:p.url,checkedAt:'2026-10-06T05:41:54Z'};
 const presented=productPresentation(p,{products:[row]});assert.equal(presented.presentation.officialProductUrl,p.url);assert.equal(presented.officialProductEvidence,undefined,'Navigation approval must not invent strict product proof');
 for(const patch of [{sourceUrl:'https://shop.example.com/product/L49213700'},{sourceUrl:'http://www.salomon.com/product/L49213700'},{sourceUrl:'https://www.salomon.com.evil.example/product/L49213700'}])assert.equal(productPresentation(p,{products:[{...row,...patch}]}).presentation.officialProductUrl,undefined);
 for(const patch of [{id:'other'},{brand:'Nike'},{style:'other'},{originalImage:'https://cdn.dam.salomon.com/campaign.jpg'},{approved:false},{noPerson:false},{view:'top'}])assert.equal(productPresentation(p,{products:[{...row,...patch}]}),null);
});

// Four brands name the view inside a URL that also carries the SKU, so the
// photograph can be accepted on the brand's own naming rather than on a
// reviewer's word. Each slot below was confirmed by opening the image.
test('SKU-bound view slots pass only for the brand, host and slot they belong to',()=>{
 const evidence=at=>({verified:true,verificationMethod:'official-new-listing-sku-image',verifiedAt:at,contentHash:'h',identifierType:'official-product-id'});
 const today=new Date().toISOString();
 const ua={id:'ua',brand:'Under Armour',style:'6007140',styleType:'official-product-id',
   url:'https://www.underarmour.com/en-us/p/x/6007140.html',
   productEvidenceUrl:'https://www.underarmour.com/en-us/c/shoes/new-arrivals/mens/',
   lastVerifiedAt:today,
   image:'https://underarmour.scene7.com/is/image/Underarmour/6007140-390_PAIR?wid=800',
   officialProductEvidence:{...evidence(today),brand:'Under Armour',style:'6007140',url:'https://www.underarmour.com/en-us/p/x/6007140.html',sourceUrl:'https://www.underarmour.com/en-us/c/shoes/new-arrivals/mens/'},
   officialImageEvidence:{...evidence(today),brand:'Under Armour',style:'6007140',url:'https://underarmour.scene7.com/is/image/Underarmour/6007140-390_PAIR?wid=800',sourceUrl:'https://www.underarmour.com/en-us/c/shoes/new-arrivals/mens/'}};
 const uaOut=productPresentation(ua,{products:[]});
 if(uaOut){
  assert.equal(uaOut.presentation.view,'three-quarter','_PAIR is the three-quarter rendition');
  assert.equal(productPresentation({...ua,image:ua.image.replace('_PAIR','_DEFAULT')},{products:[]}).presentation.view,'side');
 }
 // Another brand's shoe on Under Armour's CDN, and a rendition that is not a
 // named view, must both stay out however the evidence looks.
 assert.equal(productPresentation({...ua,brand:'Nike'},{products:[]}),null);
 assert.equal(productPresentation({...ua,image:ua.image.replace('_PAIR','_CAMPAIGN')},{products:[]}),null);
 assert.equal(productPresentation({...ua,image:'https://underarmour.scene7.com/is/image/Underarmour/9999999-390_PAIR'},{products:[]}),null,'the SKU in the asset has to be the one on this record');
 // Kering files renditions as Small-/Medium-<code>_X.jpg; the size prefix is
 // not part of the style and must not break the match.
 const bal={id:'b',brand:'Balenciaga',style:'841765WCURB1000',
   url:'https://www.balenciaga.com/en-us/hamptons-worn-out-sneaker-black-841765WCURB1000.html',
   image:'https://balenciaga.dam.kering.com/m/987b3c7a658363a/Small-841765WCURB1000_X.jpg?v=2'};
 assert.equal(productPresentation({...bal,image:bal.image.replace('_X.jpg','_Z.jpg')},{products:[]}),null);
 assert.equal(productPresentation({...bal,url:'https://www.balenciaga.com/en-us/other-shoe-000000.html'},{products:[]}),null,'the code still has to appear in the product path');
});

// The brand's own representative photo, at whatever angle, once the angle
// stopped deciding it. What still decides it is that the shoe can be seen -
// which is a judgement, so it is recorded per asset rather than guessed here.
test("a brand's own product photo is accepted, and a refusal still wins", () => {
 const today=new Date().toISOString();
 const base={id:'own',brand:'KEEN',style:'uneek-lea-tangerine',
   url:'https://www.keenfootwear.com/p/uneek-lea.html',
   image:'https://cdn.shopify.com/s/files/1/0607/3263/7348/files/9ac2a618.jpg',
   lastVerifiedAt:today,
   productEvidenceUrl:'https://www.keenfootwear.com/p/uneek-lea.html',
   officialProductEvidence:{verified:true,verificationMethod:'official-new-arrivals-and-product-page',verifiedAt:today,
     contentHash:'h',identifierType:'brand-style-code',brand:'KEEN',style:'uneek-lea-tangerine',
     url:'https://www.keenfootwear.com/p/uneek-lea.html',sourceUrl:'https://www.keenfootwear.com/p/uneek-lea.html'},
   officialImageEvidence:{verified:true,verificationMethod:'official-new-arrivals-and-product-page',verifiedAt:today,
     contentHash:'h',identifierType:'brand-style-code',brand:'KEEN',style:'uneek-lea-tangerine',
     url:'https://cdn.shopify.com/s/files/1/0607/3263/7348/files/9ac2a618.jpg',
     sourceUrl:'https://www.keenfootwear.com/p/uneek-lea.html'}};
 const out=productPresentation(base,{products:[]});
 assert(out,'a brand photo with verified evidence is accepted');
 assert.equal(out.presentation.view,'product-photo');
 assert.equal(out.presentation.method,'brand-own-product-photo');
 assert.equal(out.presentation.image,base.image,'the brand photo is used as it stands');
 // A reviewed refusal for this exact asset keeps it out however good the
 // evidence looks - that is how the nine that showed no shoe are held back.
 const refusal={id:base.id,brand:base.brand,style:base.style,originalImage:base.image,approved:false};
 assert.equal(productPresentation(base,{products:[refusal]}),null);
 // ...and it is tied to the asset, so a different photo - carrying its own
 // evidence, since the evidence binds to the exact asset too - is judged afresh.
 const other=base.image.replace('9ac2a618','other');
 assert.notEqual(productPresentation({...base,image:other,
   officialImageEvidence:{...base.officialImageEvidence,url:other}},{products:[refusal]}),null);
 // A product page URL sitting in the image field is not a photograph.
 assert.equal(productPresentation({...base,image:base.url},{products:[]}),null);
 // Nor is anything without the brand's own verified image evidence.
 assert.equal(productPresentation({...base,officialImageEvidence:undefined},{products:[]}),null);
 assert.equal(productPresentation({...base,officialImageEvidence:{...base.officialImageEvidence,verified:false}},{products:[]}),null);
});
