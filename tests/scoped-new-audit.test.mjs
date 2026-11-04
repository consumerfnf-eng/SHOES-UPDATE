import test from 'node:test';import assert from 'node:assert/strict';
import {isNewListing,collectNewArrivals} from '../scripts/new-arrivals.mjs';
import {isScopedSneakerCandidate} from '../scripts/scoped-new-candidates.mjs';
import {asicsNewPage,asicsNewDetail} from '../scripts/asics-new-page.mjs';
import {reviewScopedNew} from '../scripts/review-scoped-new.mjs';
import {converseNewPage} from '../scripts/converse-new-page.mjs';
import {dedupeScopedPrepared,bindPreparedRaw} from '../scripts/scoped-prepared.mjs';
test('structured variant colours and source binding survive a repeated scrape with the same adopted ID',()=>{
 const url='https://www.reebok.com/products/classic',inferred={id:'adopted',brand:'Reebok',url,style:'classic',colorway:'Brown'},official={...inferred,url:url+'?variant=123',style:'123:black',colorway:'Black',productVariantId:'123:black'};
 assert.deepEqual(dedupeScopedPrepared([inferred,official]),[official]);
 const rows=bindPreparedRaw([official],[{...inferred},{...official,id:'raw-id'}]);assert.equal(rows[0].id,'adopted');assert.equal(rows[0].style,'123:black');assert.equal(rows[0].colorway,'Black');
 assert.throws(()=>dedupeScopedPrepared([inferred,{...inferred,url:'https://www.reebok.com/products/other'}]),/different products/);
});
test('shoe descriptions about insoles, laces and slide controls do not exclude the shoe',()=>{
 for(const row of [{name:'Wow Sneaker',description:'Daily sneaker with an EVA insole.'},{name:'Harepin',description:'여분의 신발끈과 슈레이스 제공',sourceProductType:'Sneakers'},{name:'GEL-1130',description:'Next slide Previous slide GEL-1130 Sportstyle Shoes'}])assert(isScopedSneakerCandidate({...row,url:'https://example.com/shoe'}));
 assert(!isScopedSneakerCandidate({name:'New Style',description:"Men’s Waterproof Work Boot",url:'https://example.com/evanston'}));
 assert(!isScopedSneakerCandidate({name:'ColdGear',url:'https://example.com/coldgear_womens_1-2_zip'}));
});
test('raw primary fields exclude apparel and slides before curated sneaker labels exist',()=>{
 for(const name of ['Training short sleeve','T-shirt','Track jacket','Sneaker socks','Recovery Slide','Dress'])assert(!isScopedSneakerCandidate({brand:'Under Armour',name,url:'https://example.com/product'}),name);
 assert(isScopedSneakerCandidate({brand:'Converse',name:'High Top Shoes',url:'https://example.com/product'}));
});
test('review replaces a bound outsole with the owned side photo and holds navigation images',()=>{
 const row={id:'shoe',brand:'Merrell',style:'J123456',name:'Trail Shoes',url:'https://example.com/p/J123456',image:'https://images.example/J123456_OUT.jpg',imageCandidates:['https://images.example/J123456_000.jpg']};
 const reviewed=reviewScopedNew([row]);assert.equal(reviewed.repaired.length,1);assert(reviewed.products[0].image.endsWith('_000.jpg'));
 assert.equal(reviewScopedNew([{...row,brand:'Converse',image:'https://images.example/Nav_shoe.jpg',imageCandidates:[]}]).held.length,1);
});
test('Converse empty tile SKU resolves from its official product link and keeps its owned main image',()=>{
 const url='https://www.converse.com/shop/new-arrivals/shoes',html='<div class="product-tile tile" data-testid="product-tile-" data-item-id="master-high"><div class="product-tile__name"><a>Chuck High Top</a></div><a class="product-tile__img-url" href="https://www.converse.com/shop/p/chuck.html?styleNo=A09801C"></a><picture class="product-tile__img--main--picture-element"><img alt="Chuck High Top Black" data-srcset="https://www.converse.com/images/a_08/other_A_08.jpg"></picture></div>';
 const page=converseNewPage(html,url);assert.equal(page.products.length,1);assert.equal(page.products[0].style,'A09801C');assert.equal(page.products[0].modelGroupId,'converse|master-high');assert.equal(reviewScopedNew(page.products).held.length,0);
});
test('numeric category IDs do not hide an official New category',()=>{assert(isNewListing('https://www.drmartens.com/us/en/unisex/new-arrivals/c/04150000'));assert(!isNewListing('https://www.drmartens.com/us/en/new-shoe/p/12345678'));});
test('scoped exclusions inspect Korean decoded paths rather than a size selector label',()=>{assert(!isScopedSneakerCandidate({name:'New 사이즈 선택 S M L',cardDescription:'남성 마이크로파이버 트렁크',url:'https://www.calvinklein.co.kr/ko/SEA-NB4713.html'}));assert(!isScopedSneakerCandidate({name:'사이즈 선택',url:'https://www.calvinklein.co.kr/ko/'+encodeURIComponent('남성-스트레이트-데님')+'/SEA-4RH701.html'}));assert(isScopedSneakerCandidate({name:'Denim sneaker',url:'https://example.com/p/shoe'}));assert(!isScopedSneakerCandidate({name:'Sneaker socks',url:'https://example.com/p/socks'}));});
test('resuming discovery retains already verified records without reading completed work again',async()=>{const product={id:'already-verified',brand:'Nike'},r=await collectNewArrivals({brands:[],sources:{},initialDiscovery:{products:[product],coverage:[{brand:'Nike',attempts:1,responses:1,listingPages:1,candidates:1,verified:1,errors:[]}],pending:[]},read:async()=>{throw Error('unexpected request');},log:()=>{}});assert.deepEqual(r.products,[product]);assert.equal(r.coverage[0].verified,1);});
test('ASICS lazy swatches remain bound to selected SKU and use its side view',()=>{const url='https://www.asics.com/us/en-us/sportstyle-new-arrivals/c/aa90000023/',html='<a data-unit-price="165.00" data-product-type="Shoes" data-test="product-tile-link-ANA_1203A537-301" href="https://www.asics.com/us/en-us/gel-kayano-14/p/ANA_1203A537-301.html"><button data-test="swatch" title="GEL-KAYANO 14, Lime Zest/Pure Silver" data-selected="true"><img src="https://images.asics.com/is/image/asics/1203A537_301_SL_LT_GLB?$variantthumbnail$" alt="Lime Zest/Pure Silver"></button></a>';const d=asicsNewPage(html,url);assert.equal(d.products.length,1);assert.equal(d.products[0].name,'GEL-KAYANO 14');assert.equal(d.products[0].colorway,'Lime Zest/Pure Silver');assert(d.products[0].image.includes('1203A537_301_SL_LT_GLB'));assert.equal(asicsNewPage(html.replace('_301_SL_','_999_SL_'),url).products.length,0);assert.equal(asicsNewDetail({style:'1203A537-301',url:d.products[0].url},{html,metadata:{sourceURL:url}},{markdown:'# Leather Bag',html:'',metadata:{statusCode:200}}),null);});
