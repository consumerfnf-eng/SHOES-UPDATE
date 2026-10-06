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
