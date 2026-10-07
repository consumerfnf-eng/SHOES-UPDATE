import test from 'node:test';
import assert from 'node:assert/strict';
import {variantGroupName,groupProductVariants,uniqueColorVariants,variantColorLabel} from '../public/assets/catalog-view.mjs';
import {officialVariantLabels,parseArrivalListing,listingProduct,adidasProductColor} from '../scripts/new-arrivals.mjs';
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
