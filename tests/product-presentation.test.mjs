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
