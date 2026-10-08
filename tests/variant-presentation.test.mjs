import test from 'node:test';
import assert from 'node:assert/strict';
import {variantGroupName,variantGroupKey,groupProductVariants,preferWomenVariants,productAudience,uniqueColorVariants,variantColorLabel} from '../public/assets/catalog-view.mjs';
import {officialVariantLabels,parseArrivalListing,listingProduct,adidasProductColor,collectNewArrivals} from '../scripts/new-arrivals.mjs';
import fs from 'node:fs';
import {applyReviewedEvidence} from '../scripts/publish-curated.mjs';

test('the card title stays at model level while declared color names consolidate variants',()=>{
 const rows=[{id:'cream',brand:'ALOHAS',name:'Tb.61 Aera Cream Sneakers',colorway:'Cream'},{id:'brown',brand:'ALOHAS',name:'Tb.61 Aera Dark Brown Sneakers',colorway:'Dark Brown'}];
 assert.equal(groupProductVariants(rows).length,1);assert.equal(variantGroupName(rows[0]),'Tb.61 Aera Sneakers');assert.equal(variantGroupName(rows[1]),'Tb.61 Aera Sneakers');
 assert.equal(groupProductVariants([...rows,{...rows[0],id:'different',name:'Tb.490 Club Nylon Cream Sneakers'}]).length,2);
 assert.equal(variantGroupName({name:'ASICS GEL-KINETIC FR | BLACK COFFEE',colorway:'Black Coffee'}),'ASICS GEL-KINETIC FR');
});
test('one chip represents one declared color while all source variants remain available',()=>{
 const rows=[{id:'m',colorway:'White / Grey'},{id:'w',colorway:'WHITE / GREY'},{id:'black',colorway:'Black'},{id:'unknown1'},{id:'unknown2'}];
 assert.deepEqual(uniqueColorVariants(rows,'w').map(p=>p.id),['w','black','unknown1','unknown2']);assert.equal(rows.length,5);
 for(const colorway of ['Image 1','Women | Balenciaga United States EN','Sneakers · Unisex','BEIGE![shoe](https://example.org/a.jpg)'])assert.equal(variantColorLabel({colorway}),'');
});
test('gender labels and terminal footwear wording group the same model without changing source records',()=>{
 const names=["GEL-KAYANO 33 LITE-SHOW Men's Running Shoes","GEL-KAYANO 33 LITE-SHOW Women’s Running Shoes","Men's GEL-KAYANO 33 LITE-SHOW Sneaker",'GEL-KAYANO 33 LITE-SHOW Sneakers · Unisex','GEL-KAYANO 33 LITE-SHOW'];
 const rows=names.map((name,i)=>({id:String(i),modelKey:`different-feed-key-${i}`,brand:'ASICS',name,colorway:i?'Lite Show/Lavender Glow':'Lite Show/Orange Glow'}));
 const before=structuredClone(rows),groups=groupProductVariants(rows);
 assert.equal(groups.length,1);assert.deepEqual(groups[0],rows);assert.deepEqual(rows,before);
 assert.equal(variantGroupName(rows[0]),'GEL-KAYANO 33 LITE-SHOW Running Shoes');
 assert.equal(uniqueColorVariants(groups[0]).length,2);
 for(const [men,women] of [["Men's Mizuno Sky Prime Running Shoe","Women's Mizuno Sky Prime Running Shoes"],['Pane Zephyr Training Men’s Shoes','Pane Zephyr Training Women’s Shoes']]){
  assert.equal(variantGroupKey({brand:'same',name:men}),variantGroupKey({brand:'same',name:women}));
 }
});
test('editions, generations, materials, widths, collaborations and brands keep separate cards',()=>{
 const asics=['GEL-KAYANO 33','GEL-KAYANO 33 LITE-SHOW','GEL-KAYANO 33 GTX','GEL-KAYANO 33 GORE-TEX','GEL-KAYANO 32 LITE-SHOW','GEL-KAYANO 33 WIDE','GEL-KAYANO 33 Trail','GEL-KAYANO 33 x Designer'];
 const rows=asics.flatMap((name,i)=>["Men's",'Women’s'].map((gender,j)=>({brand:'ASICS',id:`${i}-${j}`,name:`${name} ${gender} Running Shoes`})));
 assert.equal(groupProductVariants(rows).length,asics.length);
 assert.equal(groupProductVariants([...rows,{...rows[0],brand:'Other brand'}]).length,asics.length+1);
 const names=['Cloudvista 3','Cloudvista 3 Waterproof','Cloudvista 2','Radar leather sneaker','Radar velvety sneaker','Pane Zephyr Training Shoes','Pane Zephyr Training Pouching Shoes','Wave Rider 30 Running Shoe','Wave Rider 30 Running Shoe, Tsukiakari Pack'];
 assert.equal(groupProductVariants(names.map(name=>({brand:'same',name}))).length,names.length);
 assert.equal(variantGroupName({name:'Superwomen Running Shoes'}),'Superwomen Running Shoes','Do not remove an embedded gender substring');
});

test('women counterparts exclusively supply colors while male-only editions and original records remain',()=>{
 const make=(id,name,colorway,gender='')=>({id,name,colorway,gender,brand:'ASICS'});
 const rows=[make('m',"Runner 33 Men's Running Shoes",'Orange'),make('w1',"Runner 33 Women's Running Shoes",'Lavender'),make('w2',"Runner 33 Women's Running Shoes",'White'),make('unknown','Runner 33','Black'),make('unisex','Runner 33','Grey','unisex'),make('edition',"Runner 33 GTX Men's Running Shoes",'Orange'),make('only',"Runner 14 Men's Running Shoes",'White')];
 const before=structuredClone(rows),selected=preferWomenVariants(rows);
 assert.deepEqual(selected.map(p=>p.id),['w1','w2','edition','only']);
 assert.deepEqual(rows,before);
 assert.deepEqual(preferWomenVariants(selected),selected,'Selection is idempotent');
 assert.deepEqual(preferWomenVariants(rows.filter(p=>!p.id.startsWith('w'))).map(p=>p.id),['m','unknown','unisex','edition','only']);
 assert.equal(uniqueColorVariants(selected.slice(0,2)).length,2,'Keep every distinct female color');
});

test('audience uses explicit product metadata and URL path without guessing from a SKU or query',()=>{
 for(const product of [{gender:'Female'},{name:'Runner Women’s Shoes'},{url:'https://www.on.com/en-us/products/runner/womens/cream-shoes'},{url:'https://paneshoes.com/products/runner-women-s-shoes-cream'},{officialCategory:'여성용 러닝화'}])assert.equal(productAudience(product),'women');
 for(const product of [{gender:'Male'},{name:"Runner Men's Shoes"},{url:'https://www.nike.com/t/runner-mens-running-shoes/ABC'}])assert.equal(productAudience(product),'men');
 assert.equal(productAudience({gender:'MEN/WOMEN',name:'Runner'}),'unisex');
 assert.equal(productAudience({gender:'Unisex',name:"Women's Runner"}),'women');
 assert.equal(productAudience({name:'Superwomen Runner',style:'W123',url:'https://example.com/runner?ref=womens'}),'');
 assert.equal(productAudience({gender:'Women',url:'https://example.com/men/runner'}),'women');
 assert.equal(variantGroupKey({brand:'A',name:'여성용 Runner Shoes'}),variantGroupKey({brand:'A',name:'남성용 Runner Shoes'}));
});

test('reported live duplicates use female products only, including the reviewed adidas SKU',()=>{
 const rows=JSON.parse(fs.readFileSync(new URL('../public/data/catalog.json',import.meta.url))).products;
 const selected=preferWomenVariants(rows);
 for(const group of groupProductVariants(rows).filter(g=>g.some(p=>productAudience(p)==='women'))){
  const shown=selected.filter(p=>variantGroupKey(p)===variantGroupKey(group[0]));
  assert(shown.length>0);assert(shown.every(p=>productAudience(p)==='women'),group[0].name);
 }
 assert.deepEqual(selected.filter(p=>p.brand==='adidas'&&['KI8294','KI8293'].includes(p.style)).map(p=>p.style),['KI8293']);
});

test('reviewed gender survives a later blank listing without refreshing product verification',()=>{
 const url='https://www.adidas.com/us/test/KI8293.html',verifiedAt='2026-10-08T00:00:00Z';
 const original={id:'adidas-w',brand:'adidas',style:'KI8293',url,gender:'',productVerifiedAt:verifiedAt};
 const review={id:original.id,brand:original.brand,style:original.style,url,gender:'Women',genderEvidence:{verified:true,url,checkedAt:'2026-10-07T12:00:00Z',excerpt:"Women's • Running"}};
 const [result]=applyReviewedEvidence([original],[review]);
 assert.equal(result.gender,'Women');assert.equal(result.productVerifiedAt,verifiedAt);assert.deepEqual(result.genderEvidence,review.genderEvidence);
});
test('the current catalog consolidates the reported ASICS, PANE and Mizuno gender pairs',()=>{
 const rows=JSON.parse(fs.readFileSync(new URL('../public/data/catalog.json',import.meta.url))).products;
 for(const [brand,prefix,count,chips] of [['ASICS','GEL-KAYANO 33 LITE-SHOW',2,2],['ASICS','GT-2000 15 LITE-SHOW',2,2],['PANE','Pane Light Training Nogi',44,22],['PANE','Pane Zephyr Training Pouching',10,5]]){
  const variants=rows.filter(p=>p.brand===brand&&p.name.startsWith(prefix));
  assert.equal(variants.length,count);assert.equal(groupProductVariants(variants).length,1,prefix);assert.equal(uniqueColorVariants(variants).length,chips,prefix);
 }
 const zephyr=rows.filter(p=>p.brand==='PANE'&&p.name.startsWith('Pane Zephyr Training'));
 assert.equal(groupProductVariants(zephyr).length,2,'Pouching stays separate from standard Zephyr');
 const sky=rows.filter(p=>p.brand==='Mizuno'&&p.name.includes('Sky Prime'));
 assert.equal(sky.length,2);assert.equal(groupProductVariants(sky).length,1);
 const kayano=rows.filter(p=>p.brand==='ASICS'&&p.name.startsWith('GEL-KAYANO'));
 assert.equal(groupProductVariants(kayano).length,3,'14, 33 and 33 LITE-SHOW stay separate');
});
test('category delimiters and dangling color prepositions do not split otherwise identical models',()=>{
 const salomon=[{brand:'Salomon',name:'XT-6 - Sneakers · Unisex',colorway:'Sneakers · Unisex'},{brand:'Salomon',name:'XT-6'}];
 assert.equal(groupProductVariants(salomon).length,1);assert.equal(variantGroupName(salomon[0]),'XT-6');
 const gucci=[{brand:'Gucci',name:"Women's Drip sneaker",colorway:'White Suede'},{brand:'Gucci',name:"Men's Drip sneaker in sand and brown GG canvas",colorway:'Sand and Brown GG Canvas'}];
 assert.equal(groupProductVariants(gucci).length,1);assert.equal(variantGroupName(gucci[1]),'Drip sneaker');
 assert.equal(variantGroupName({name:'Runner in Suede',colorway:'White'}),'Runner in Suede','Unmatched material descriptions stay intact');
});
test('duplicate color labels normalize separators without merging different colors with the same chip fill',()=>{
 const rows=[{id:'m',colorway:'Solar Turbo / Core Black / Lucid Red'},{id:'w',colorway:'SOLAR TURBO/Core Black/Lucid Red'},{id:'other',colorway:'Lucid Red / Core Black / Solar Turbo'}];
 assert.deepEqual(uniqueColorVariants(rows,'w').map(p=>p.id),['w','other']);
 const shared={colorSwatches:['#eeeeee']},photo='/images/'+'a'.repeat(64)+'.jpg';
 assert.equal(uniqueColorVariants([{...shared,id:'a',colorway:'Hop Point'},{...shared,id:'b',colorway:'Tyrian'}]).length,2);
 assert.equal(uniqueColorVariants([{...shared,id:'a'},{...shared,id:'b'}]).length,2);
 assert.deepEqual(uniqueColorVariants([{id:'a',presentation:{cachedPath:photo}},{id:'b',presentation:{cachedPath:photo}}],'b').map(p=>p.id),['b']);
});
test('adidas colors come from the current variant link, never another swatch or a review',()=>{
 const url='https://www.adidas.com/us/adizero-adios-pro-5-running-shoes/KI8293.html';
 const text=`Color: White / Blue\n[![Product color: White / Green](https://assets.adidas.com/other.jpg)](https://www.adidas.com/us/shoes/OTHER.html)\n[![Product color: Solar Turbo / Core Black / Lucid Red](https://assets.adidas.com/pink.jpg)](${url})`;
 assert.equal(adidasProductColor(text,url),'Solar Turbo / Core Black / Lucid Red');
 assert.equal(adidasProductColor(text,'https://www.adidas.com/us/shoes/MISSING.html'),'');
});
test('the reported ADIOS PRO 5 variants retain their official color evidence and one chip',()=>{
 const catalog=JSON.parse(fs.readFileSync(new URL('../data/catalog-source.json',import.meta.url)));
 const evidence=JSON.parse(fs.readFileSync(new URL('../data/release-evidence.json',import.meta.url)));
 const rows=applyReviewedEvidence(catalog.products.filter(p=>p.brand==='adidas'&&['KI8294','KI8293'].includes(p.style)),evidence.products.filter(e=>e.brand==='adidas'&&['KI8294','KI8293'].includes(e.style)));
 assert.equal(rows.length,2);assert.equal(uniqueColorVariants(rows).length,1);
 for(const p of rows){const e=evidence.products.find(e=>e.id===p.id);assert.equal(e.colorway,p.colorway);assert.equal(e.colorwayEvidence.url,p.url);assert(e.colorwayEvidence.verified);}
});
test('a current-product color picker below recommendations is still bound to the exact PDP',async()=>{
 const url='https://www.adidas.com/us/adizero-adios-pro-5-running-shoes/KI8293.html',source='https://www.adidas.com/us/shoes-new_arrivals';
 const pdp=`# ADIZERO ADIOS PRO 5 Running Shoes\nProduct code: KI8293\n![ADIZERO ADIOS PRO 5 Running Shoes](https://assets.adidas.com/KI8293.jpg)\n## You may also like\n[![Product color: White](https://assets.adidas.com/OTHER.jpg)](https://www.adidas.com/us/shoes/OTHER.html)\n[![Product color: Solar Turbo / Core Black / Lucid Red](https://assets.adidas.com/KI8293.jpg)](${url})`;
 const result=await collectNewArrivals({sources:{adidas:[{url:source}]},brands:['adidas'],now:new Date('2026-10-08T00:00:00Z'),log:()=>{},read:async target=>target.endsWith(source)?`# New Arrivals\n[ADIZERO ADIOS PRO 5 Running Shoes](${url})`:pdp});
 assert.equal(result.products.length,1);assert.equal(result.products[0].colorway,'Solar Turbo / Core Black / Lucid Red');
});
test('official variant labels do not take colors from navigation or adjacent products',()=>{
 const kering=officialVariantLabels({brand:'Bottega Veneta',name:'Orbit Sneaker',url:'https://www.bottegaveneta.com/en-us/orbit-sneaker-bark-green-shamrock-741357V2X403801.html',colorway:'Image 1'});assert.equal(kering.colorway,'bark green shamrock');
 const alohas=officialVariantLabels({brand:'ALOHAS',name:'Tb.61 Aera Cream Sneakers',url:'https://alohas.com/en-us/products/tb-61-aera-cream-sneakers',colorway:'Off White'});assert.equal(alohas.colorway,'Cream');
 const fila=officialVariantLabels({brand:'FILA',url:'https://www.fila.co.kr/products/1100fs263ru02x098260',colorway:'BEIGE,GRAY,BEIGE![shoe](https://www.fila.co.kr/photo.jpg)'});assert.equal(fila.colorway,'BEIGE,GRAY,BEIGE');
});
test('a listing gallery made of bullet separators retains the On model and its own color',()=>{
 const url='https://www.on.com/en-us/products/cloudvista-3-m-3mg3004/mens/grain-saffron-shoes-3MG30045160',source='https://www.on.com/en-us/shop/new-arrivals/shoes';
 const text=`# New Arrivals\n[- ![On Cloudvista 3 Grain & Saffron Men Shoes](https://images.ctfassets.net/shoe.png)](${url})\n[![Grain | Saffron](https://images.ctfassets.net/shoe.png)](${url})\n[New color Cloudvista 3 Men – Trail Running $160.00](${url})`;
 const [candidate]=parseArrivalListing(text,{brand:'On',url:source,checkedAt:'2026-10-07T01:00:00Z'}),p=listingProduct(candidate,'2026-10-07T01:00:00Z');assert.equal(p.name,'Cloudvista 3');assert.equal(p.colorway,'Grain | Saffron');
});
