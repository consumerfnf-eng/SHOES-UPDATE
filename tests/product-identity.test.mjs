import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalUrl,dedupeKey,classifyFootwear} from '../scripts/curation.mjs';
import {parseArrivalListing} from '../scripts/new-arrivals.mjs';

test('Mihara colour IDs are product identity, while campaign parameters are discarded',()=>{
 const base='https://en.miharayasuhiro.jp/products/detail.php?product_id=8508';
 assert.notEqual(canonicalUrl(base+'&c=1'),canonicalUrl(base+'&c=16'));
 assert.equal(canonicalUrl(base+'&c=1&utm_source=test'),canonicalUrl(base+'&c=1'));
 assert.equal(canonicalUrl('https://example.com/product?c=campaign'),'https://example.com/product');
  assert.notEqual(dedupeKey({brand:'Maison Mihara Yasuhiro',productVariantId:'7498:1'}),dedupeKey({brand:'Maison Mihara Yasuhiro',productVariantId:'749:81'}));
});

test('Golden Goose Slide is a closed high-top model and its laces are accessories',()=>{
 assert.equal(classifyFootwear({brand:'Golden Goose',name:'슬라이드',officialCategory:'Sneakers Slide',url:'https://www.goldengoose.com/kr/ko/slide-cod-GWF00115.F006619.60565.html'}).category,'sneaker');
 assert.equal(classifyFootwear({brand:'Golden Goose',name:'슬라이드',officialCategory:'스니커즈',url:'https://www.goldengoose.com/kr/ko/slide-cod-GWF00115.F006619.60565.html'}).category,'sneaker');
 assert.equal(classifyFootwear({brand:'Golden Goose',name:'Sneaker laces',officialCategory:'Sneakers',url:'https://www.goldengoose.com/kr/ko/laces-cod-GUZ00437.Z000436.10418.html'}).reason,'not-footwear');
});

test('category and editorial links cannot become Mihara or Golden Goose product cards',()=>{
 for(const [brand,url] of [['Maison Mihara Yasuhiro','https://en.miharayasuhiro.jp/products/list.php?category_id=27&sex_id=1'],['Golden Goose','https://www.goldengoose.com/kr/ko/stories/marathon-speed.html']]){
  const text=`# Sneakers\n[![Sneaker](https://example.com/shoe.jpg) Sneaker](${url})`;
  assert.equal(parseArrivalListing(text,{brand,url,checkedAt:'2026-11-02T06:00:00Z',basis:'assortment'}).length,0);
 }
});
import fs from 'node:fs';
import {unifyVariantGroups,groupProductVariants,uniqueColorVariants,variantGroupName,overlayReleaseState} from '../public/assets/catalog-view.mjs';
import {preferOfficialVariants,manufacturerCode} from '../public/assets/product-identity.mjs';

test('the exact reported Lanvin listings share Curb while high top and Glen remain separate',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../public/data/monthly-catalog.json',import.meta.url)));
 m.retail.push(...JSON.parse(fs.readFileSync(new URL('./fixtures/lanvin-curb-variants.json',import.meta.url))));
 const codes=['262254M237004','262254M237013','262254M236000','262254M237002'];
 const rows=codes.map(code=>({...m.retail.find(p=>p.style===code),overlay:true}));
 assert(rows.every(p=>p.id),'regression source products must exist');
 unifyVariantGroups(rows);const groups=groupProductVariants(rows);
 assert.equal(groups.length,3);assert.equal(groups.find(g=>g.length===2).length,2);
 assert.equal(uniqueColorVariants(groups.find(g=>g.length===2)).length,2);
});
test('retail-only colour/material survives; only exact brand-scoped physical variant is retired',()=>{
 const official={id:'o',brand:'Dior',name:'B27 Sneaker',style:'3SN272AFD_H710'};
 const exact={...official,id:'r',overlay:true,source:'retail-x'};
 const other={...exact,id:'other',style:'3SN272AFD_H900',colorway:'Black'};
 const anotherBrand={...exact,id:'brand',brand:'Lanvin'};
 const audit=[];assert.deepEqual(preferOfficialVariants([official,exact,other,anotherBrand],audit).map(p=>p.id),['o','other','brand']);
 assert.equal(audit[0].reason,'exact-manufacturer-code');
 assert.equal(manufacturerCode({style:'262254M237004'}),'');
});
test('model grain preserves Chanel designs, Mihara generations/heights and inferred same-colour variants',()=>{
 const chanel=['G47649B26511UE608','G47649B26510UE606','G47651B26512UE622'].map((code,i)=>({id:'c'+i,brand:'Chanel',name:'Sneakers',url:'https://www.chanel.com/us/fashion/p/'+code+'/sneakers/'}));
 const mihara=['"BAKER" OG Sole Canvas Low-top Sneakers','"BAKER" OG Sole Leather Low-top Sneakers','"BAKER 26" OG Sole Canvas Low-top Sneakers','"BAKER" OG Sole Canvas High-top Sneakers'].map((name,i)=>({id:'m'+i,brand:'Maison Mihara Yasuhiro',name}));
 unifyVariantGroups([...chanel,...mihara]);assert.equal(groupProductVariants(chanel).length,2);assert.equal(groupProductVariants(mihara).length,3);
 const variants=['8508:1','8508:16'].map((productVariantId,i)=>({id:String(i),brand:'Maison Mihara Yasuhiro',colorway:'Black',manufacturerStyle:'A17FW709',productVariantId,colorEvidence:{method:'upper-image-analysis'}}));
 assert.equal(uniqueColorVariants(variants).length,2);
});
test('Common Projects availability is shown without fabricating a recent release',()=>{
 const url='https://kith.com/products/cp1528-0506',p={brand:'Common Projects',url,listedAt:'2019-01-01',availabilityEvidence:{verified:true,kind:'retail-current-assortment',productUrl:url,verifiedAt:'2026-11-02T00:00:00Z'}};
 assert.equal(overlayReleaseState(p,'2026-11-02'),'released');
 assert.equal(overlayReleaseState({...p,brand:'Nike'},'2026-11-02'),null);
 assert.equal(overlayReleaseState(p,'2027-01-02'),null);
});

test('Balenciaga full SKU survives legacy slug formatting without collapsing another colour',()=>{
 const first={brand:'Balenciaga',style:'865849WTSDN4000'};
 assert.equal(manufacturerCode(first),manufacturerCode({...first,style:'triple-s.2-denim-sneaker-blue-865849WTSDN4000'}));
 assert.notEqual(manufacturerCode(first),manufacturerCode({...first,style:'865849WTSDN1000'}));
});
