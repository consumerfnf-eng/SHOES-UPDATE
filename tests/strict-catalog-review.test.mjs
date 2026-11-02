import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isExcludedBrand} from '../public/assets/brand-exclusions.mjs';
import {withLuxuryShelves} from '../scripts/luxury-shelves.mjs';
import {reviewedDesignName,manufacturerCode,preferOfficialVariants} from '../public/assets/product-identity.mjs';
import {unifyVariantGroups,groupProductVariants,uniqueColorVariants,canonicalColorKey} from '../public/assets/catalog-view.mjs';
import {listingFollowups,listingProduct} from '../scripts/new-arrivals.mjs';
import {encodeCatalog,decodeCatalog} from '../public/assets/catalog-wire.mjs';
import {reconcileOfficialAssortment} from '../scripts/reconcile-official-assortment.mjs';
import {classifyFootwear} from '../scripts/curation.mjs';
import {publicPublicationStatus} from '../scripts/publication-status.mjs';
test('all configured exclusion aliases are blocked even in stale shelf determinations',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../config/excluded-brands.json',import.meta.url)));
 for(const b of config.brands)for(const name of [b.name,...b.spellings])assert(isExcludedBrand(name),name);
 const source={Zegna:[{url:'https://www.zegna.com/us-en/shoes/sneakers/'}],Prada:[{url:'https://www.prada.com/us/en/'}]};
 const out=withLuxuryShelves(source,{brands:{Zegna:{basis:'current-season-only',shelves:[source.Zegna[0].url]},Goyard:{basis:'current-season-only',shelves:['https://www.goyard.com/']}}});
 assert.deepEqual(Object.keys(out),['Prada']);
});
test('On official model directories repair colour-only names without merging structural models',()=>{
 const make=slug=>({brand:'On',name:'| Black',url:`https://www.on.com/en-us/products/${slug}/womens/black-shoes-3WG30191985`});
 assert.equal(reviewedDesignName(make('cloudvista-3-w-3wg3019')),'Cloudvista 3');
 const rows=['cloudvista-3-w-3wg3019','cloudvista-3-wp-w-3wg3019','cloudvista-3-wide-w-3wg3019','cloudrunner-3-w-3wg3019'].map(make);
 unifyVariantGroups(rows);assert.equal(groupProductVariants(rows).length,4);
});
test('AROA marketing colour suffixes group; AMIRI gender navigation does not become a model',()=>{
 const rows=['BEIGE - 베이지 컬러가 돋보이는 스니커즈 제품','MOCHA BROWN - 모카 브라운 컬러가 돋보이는 스니커즈 제품','BLACK - 블랙 컬러가 돋보이는 스니커즈 제품'].map((suffix,i)=>({id:String(i),brand:'23.65',name:'AROA 스니커즈 '+suffix,styleType:'official-product-id',productVariantId:String(1848+i),colorway:suffix.split(' - ')[0]}));
 unifyVariantGroups(rows);assert.equal(groupProductVariants(rows).length,1);assert.equal(uniqueColorVariants(rows).length,3);
 assert.equal(reviewedDesignName({brand:'AMIRI',name:'WOMEN - MA-1 - Black'}),'MA-1');
 assert.notEqual(reviewedDesignName({brand:'AMIRI',name:'WOMEN - MA-1 - Black'}),reviewedDesignName({brand:'AMIRI',name:'WOMEN - SKEL TOP LOW - Black'}));
});
test('chip dedupe resolves exact gender copies while keeping distinct materials and factory codes',()=>{
 const white={id:'w',brand:'Test',name:'Runner',style:'SKU-0',url:'https://example.org/p',image:'https://example.org/white.jpg',colorway:'White'};
 const female={...white,id:'wf',style:'SKU-0-W'};
 const black={...white,id:'b',style:'SKU-1',image:'https://example.org/black.jpg',colorway:'Black'};
 assert.equal(uniqueColorVariants([white,black,female]).length,2);
 assert.equal(uniqueColorVariants([white,{...female,material:'Suede'}]).length,2);
 assert.equal(uniqueColorVariants([white,{...white,id:'different',style:'SKU-2'}]).length,2);
 assert.equal(manufacturerCode({brand:'Rockfish Weatherwear',style:'1'}),'');
 assert.equal(uniqueColorVariants([{...white,style:'1'},{...black,style:'1'}]).length,2);
 assert.equal(canonicalColorKey('Gray'),canonicalColorKey('Grey'));
});
test('retail precedence is brand scoped and preserves first official match',()=>{
 const a={id:'a',brand:'A',style:'SKU-1',image:'https://example.org/a.jpg'},b={...a,id:'b',image:'https://example.org/b.jpg'};
 const retail={...b,id:'r',overlay:true,source:'retail-test'},other={...retail,id:'other',brand:'B'};const audit=[];
 assert.deepEqual(preferOfficialVariants([a,b,retail,other],audit).map(p=>p.id),['a','b','other']);assert.equal(audit[0].officialId,'a');
});
test('pagination follows more products without branching into size facet combinations',()=>{
 const url='https://www.jilsander.com/en-us/women/shoes/sneakers/';
 const md='[Next](https://www.jilsander.com/en-us/women/shoes/sneakers/?start=24&sz=24)\n[Size](https://www.jilsander.com/en-us/women/shoes/sneakers/?prefn1=size&prefv1=42&start=24&sz=24)';
 const out=listingFollowups(md,url,'Jil Sander');assert(out.some(p=>p.url.includes('start=24')));assert(out.every(p=>!p.url.includes('prefn1=size')));
});
test('a shelf refresh preserves checked factory codes and side photos; structured facts can correct colours',()=>{
 const old={id:'old',brand:'Autry',name:'MEDALIST LOW SNEAKERS',style:'AULW-BQ02-2026.2_2026',url:'https://www.autry-usa.com/ko/product-851090.html',image:'https://example.org/side.jpg',colorway:'White',firstSeen:'2026-10-30'};
 const fresh={...old,id:'new',name:'메달리스트 화이트',style:'851090',styleType:'official-product-id',image:'https://example.org/thumb.jpg',arrivalEvidence:{url:'https://www.autry-usa.com/ko/sneakers/',contentHash:'clp'},officialProductEvidence:{verificationMethod:'official-new-listing-sku-image'}};
 const result=reconcileOfficialAssortment([old],[fresh],{publishedIds:new Set(['old'])});
 assert.equal(result.added.length,0);assert.equal(result.products[0].style,old.style);assert.equal(result.products[0].image,old.image);assert.equal(result.products[0].name,old.name);
 const api={...fresh,brand:'ALOHAS',name:'Tb.490 Forest Green',colorway:'Forest Green',arrivalEvidence:{url:'https://alohas.com/collections/sneakers/products.json?page=1',contentHash:'api'}};
 const corrected=reconcileOfficialAssortment([{...old,brand:'ALOHAS'}],[api],{publishedIds:new Set(['old'])});assert.equal(corrected.products[0].colorway,'Forest Green');
});
test('wire delivery preserves full facts and false evidence values, including old snapshots',()=>{
 const url='https://example.org/products/a-long-exact-product-reference',image='https://example.org/media/a-long-exact-product-photograph.jpg',at='2026-11-02T10:00:00Z';
 const proof={verified:true,brand:'A',style:'ABC123',url,verifiedAt:at,contentHash:'a'.repeat(64),verificationMethod:'official-new-listing-sku-image'};
 const p={id:'a',brand:'A',name:'Runner',style:'ABC123',url,image,lastVerifiedAt:at,officialProductEvidence:proof,arrivalEvidence:{verified:true,brand:'A',style:'ABC123',productUrl:url,url:'https://example.org/sneakers',verifiedAt:at,contentHash:'a'.repeat(64),excerpt:'Original source excerpt'},officialImageEvidence:{...proof,url:image,sourceUrl:'https://example.org/sneakers'},presentation:{image,sourceUrl:url,checkedAt:at},material:'Suede',colorway:'White'};
 const value={schemaVersion:1,products:[p,{...p,id:'false',officialProductEvidence:{...proof,verified:false}}],brands:[],keywords:[]};
 const wire=encodeCatalog(value);assert.deepEqual(decodeCatalog(JSON.parse(JSON.stringify(wire))),value);assert(JSON.stringify(wire).length<JSON.stringify(value).length*.8);assert.equal(decodeCatalog(value),value);
});
test('public publication metadata contains no held or zero-brand diagnostics',()=>{
 const value=publicPublicationStatus({products:[{brand:'A'}],brands:[{name:'A'},{name:'Zero'}],sourceStatus:{checkedAt:'now',counts:{published:1,held:3044},unavailableBrands:['Zero'],coverage:[{brand:'Zero',held:5}],notes:['review queue']}});
 assert.deepEqual(value.brands,[{name:'A'}]);assert.deepEqual(value.sourceStatus.counts,{published:1});assert(!JSON.stringify(value).includes('3044'));assert(!JSON.stringify(value).includes('Zero'));
 assert.equal(classifyFootwear({name:'AROA 스니커즈 1+1 프로모션',styleType:'official-product-id'}).reason,'promotional-bundle-not-physical-variant');
});

test('shoe charms and category pages cannot masquerade as sneakers',()=>{
 for(const name of ['Blooming Pearl Sneaker Chain','Floragram Mix Sneaker Charms','Vivienne Sneaker Charms Set'])assert.equal(classifyFootwear({name}).reason,'not-footwear');
 assert.equal(classifyFootwear({brand:'Maison Margiela',name:'Replica sneakers',url:'https://www.maisonmargiela.com/ko-kr/maison-margiela/여성복/슈즈/'}).reason,'not-product-page');
 assert.equal(classifyFootwear({name:'Chain Reaction Sneakers',description:'Rubber outsole'}).category,'sneaker');
});
