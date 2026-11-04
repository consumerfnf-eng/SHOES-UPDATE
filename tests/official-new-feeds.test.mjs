import test from 'node:test';import assert from 'node:assert/strict';
import {aloNewRows,satisfyNewRows} from '../scripts/collect-official-new-feeds.mjs';import {classifyFootwear,curateCatalog} from '../scripts/curation.mjs';import {officialTabScope} from '../public/assets/official-tab-scope.mjs';
import {repairSourceLabels} from '../scripts/repair-source-labels.mjs';import {unifyVariantGroups,groupProductVariants} from '../public/assets/catalog-view.mjs';
const at='2026-11-03T01:00:00Z',today='2026-11-03';
const product={id:12,title:'ALO Malibu Low Boot - Black',handle:'a1229u-malibu-low-boot-black',product_type:'Accessories:Shoes:Boots',body_html:'<p>Suede boot with a 2.5 inch platform wedge.</p>',created_at:'2020-01-01',updated_at:at,images:[{src:'https://cdn.shopify.com/s/files/1/2185/2813/files/A1229U_01_b1_s1_a1.jpg'}],variants:[{sku:'A1229U010305',option1:'Black',option2:'5W',available:true,price:'388000'},{sku:'A1229U010406',option1:'Black',option2:'6W',available:true,price:'388000'}]};
const feed=p=>({root:'https://www.aloyoga.com/ko-kr',products:p,pages:[{url:'https://www.aloyoga.com/ko-kr/collections/new-arrivals/products.json?limit=250&page=1',hash:'hash',products:p.length}]});
test('Aspen material-only update retains the reviewed design family with its own SKU and image',()=>{
 const p={...product,title:'ALO Aspen Lace-Up Boot - Winter Ivory',body_html:'Soft wool-blend faux fur exterior. Set on a 2.5" platform wedge, finished with an adjustable metal toggle.',images:[{src:'https://cdn.shopify.com/s/files/1/2185/2813/files/A1172U_07345_b1_s1_a1.jpg'}],variants:[{sku:'A1172U073450305',option1:'Winter Ivory',available:true,price:'388000'}]};const [row]=aloNewRows(feed([p]),{at,today});assert.equal(row.style,'A1172U07345');assert.equal(row.modelGroupId,'alo|A1128U');assert(row.image.includes('A1172U_07345'));
});
test('Alo New feed collapses sizes, preserves variable-length factory color code and uses New provenance without an invented date',()=>{
 const rows=aloNewRows(feed([product]),{at,today});assert.equal(rows.length,1);assert.equal(rows[0].style,'A1229U01');assert.equal(rows[0].sizesCollapsed,2);assert.equal(rows[0].releaseDate,undefined);assert.equal(rows[0].priceLabel,'KRW 388000');assert.equal(classifyFootwear(rows[0]).category,'platform-shoe');
 const published=curateCatalog(rows,{now:new Date(at)}).snapshot.products;assert.equal(published.length,1);assert(officialTabScope(published[0],today));
 assert.equal(classifyFootwear(published[0]).category,'platform-shoe','Original platform construction survives re-curation of the display description');
 assert.notEqual(classifyFootwear({...rows[0],footwearReview:{...rows[0].footwearReview,style:'wrong'}}).category,'platform-shoe');
});
test('Alo ordinary boots and non-shoe New products remain excluded',()=>{
 assert.equal(aloNewRows(feed([{...product,body_html:'Regular boot'}]),{at,today}).length,0);
 assert.equal(aloNewRows(feed([{...product,product_type:'Women:Bottoms:Leggings'}]),{at,today}).length,0);
});
test('Alo Slippers and official Slides include the linked loafer form; other brands do not gain this exception',()=>{
 const rows=aloNewRows(feed([{...product,title:'Recovery Slipper - Black',product_type:'Accessories:Shoes:Slippers'},{...product,id:13,title:'ALO Malibu Loafer - Black',product_type:'Accessories:Shoes:Slides'}]),{at,today});assert.equal(rows.length,2);
 const published=curateCatalog(rows,{now:new Date(at)}).snapshot.products;assert.equal(published.length,2);assert(published.every(p=>officialTabScope(p,today)));assert(!officialTabScope({...published[0],brand:'Nike'},today));
});
test('K-SWISS factory code prefixes do not split one design into a card per colour',()=>{
 const rows=[['03629-016-M','Black'],['03629-106-M','White']].map(([code,colorway])=>repairSourceLabels({id:code,brand:'K-SWISS',name:code+' | COURT PRO II | '+colorway,colorway:'Blue'}));
 assert.equal(rows[0].name,'COURT PRO II');assert.equal(rows[0].manufacturerStyle,'03629-016-M');unifyVariantGroups(rows);assert.equal(groupProductVariants(rows).length,1);
 assert.equal(rows[0].colorway,'Black','Exact colour in the official title outranks a mismatched generic option');
});
test('reviewed SATISFY athletic shoes do not depend on a literal sneaker marketing word',()=>{
 const p={...product,title:'TheROCKER',handle:'therocker-shadow',product_type:'Shoes',variants:product.variants.map(v=>({...v,option1:'Shadow'})),body_html:'Monomesh upper, foam midsole and Vibram outsole.'};
 const rows=satisfyNewRows({...feed([p]),root:'https://satisfyrunning.com',pages:[{url:'https://satisfyrunning.com/collections/shop-new-arrivals/products.json',hash:'hash',products:1}]},{at});assert.equal(rows.length,1);assert.equal(rows[0].officialCategory,'Shoes');assert.equal(rows[0].sizesCollapsed,2);assert.equal(curateCatalog(rows,{now:new Date(at)}).snapshot.products.length,1);
 assert.equal(satisfyNewRows({...feed([{...p,title:'Unknown new form'}]),root:'https://satisfyrunning.com'},{at}).length,0);
});
