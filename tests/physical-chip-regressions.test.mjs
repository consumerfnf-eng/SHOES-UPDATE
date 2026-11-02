import test from 'node:test';
import assert from 'node:assert/strict';
import {manufacturerCode} from '../public/assets/product-identity.mjs';
import {uniqueColorVariants,variantChipLabel,colorSwatch,preferWomenVariants} from '../public/assets/catalog-view.mjs';
import {repairSourceLabels} from '../scripts/repair-source-labels.mjs';
const photo=letter=>'/images/'+letter.repeat(64)+'.webp';
const shoe=fields=>({brand:'Example',name:'Runner Sneakers',colorway:'White',...fields});

for(const [brand,style,url,param,colours] of [
 ['The North Face','NF0A8G4P','https://www.thenorthface.com/en-us/p/verto-NF0A8G4P','color',['JX4','RPI','L3I']],
 ['PUMA','398846','https://us.puma.com/us/en/pd/speedcat/398846','swatch',['31','94','93']],
 ['Crocs','212854','https://www.crocs.co.kr/p/clog/212854.html','cid',['001','2MC']],
 ['Lululemon','kjsar8czu7','https://shop.lululemon.com/p/mens-beyondfeel-waterproof-running-shoe/kjsar8czu7','color',['82580','82581']],
 ['Under Armour','3026727','https://www.underarmour.com/en-us/p/ua_charged_edge_mens_training_shoes/3026727.html','dwvar_3026727_color',['002','300']],
])test(brand+' model-level codes retain every explicitly selected PDP colour',()=>{
 const rows=colours.map((value,i)=>shoe({id:String(i),brand,style,url:url+'?'+param+'='+value,colorway:'Colour '+i,presentation:{cachedPath:photo('abcdef'[i])},gender:i?'women':'men'}));
 assert.equal(new Set(rows.map(manufacturerCode)).size,colours.length);
 assert.equal(uniqueColorVariants(rows).length,colours.length);
 assert.equal(preferWomenVariants(rows).length,colours.length);
 assert.equal(manufacturerCode({...rows[0],url:rows[0].url+'&utm_source=test&cgid=women'}),manufacturerCode(rows[0]));
});

test('a repeated factory code has the same meaning with or without a feed variant field',()=>{
 const a={brand:'Givenchy',style:'BH00B5H1XW-100'};
 assert.equal(manufacturerCode(a),manufacturerCode({...a,productVariantId:a.style}));
 assert.notEqual(manufacturerCode(a),manufacturerCode({...a,productVariantId:'physical-different-123'}));
});

test('an identical cached photo and material/colour label produces one chip without dropping raw records',()=>{
 const a=shoe({id:'a',style:'AA100',presentation:{cachedPath:photo('a')}});
 const b={...a,id:'b',style:'BB200'};
 const rows=[a,b];assert.equal(uniqueColorVariants(rows).length,1);assert.equal(rows.length,2);
 assert.equal(uniqueColorVariants(rows,'b')[0].id,'b');
 assert.equal(uniqueColorVariants([a,{...b,material:'Suede'}]).length,2,'a declared material difference is preserved');
 assert.equal(uniqueColorVariants([a,{...b,presentation:{cachedPath:photo('b')}}]).length,2,'same basic colour never proves a duplicate');
});

test('the official listing wins an identical photographed retail variant, including when retail was active',()=>{
 const a=shoe({id:'official',style:'AA100',presentation:{cachedPath:photo('a')}});
 const b={...a,id:'retail',style:'262100M237001',source:'retail-ssense',overlay:true};
 assert.deepEqual(uniqueColorVariants([b,a],'retail').map(p=>p.id),['official']);
});

test('distinct material/colour variants with coarse inferred labels stay distinguishable',()=>{
 const rows=['1AKYXE','1AKYZX'].map((style,i)=>shoe({id:String(i),brand:'Louis Vuitton',style,bodyColor:i?'#e3d8c5':'#eeeeec',colorEvidence:{method:'upper-image-analysis'},presentation:{cachedPath:photo('ab'[i])}}));
 const chips=uniqueColorVariants(rows);assert.equal(chips.length,2);
 assert.equal(variantChipLabel(chips[0],chips),'White · 1AKYXE');
 assert.equal(variantChipLabel(chips[1],chips),'White · 1AKYZX');
 assert.notEqual(colorSwatch(chips[0]),colorSwatch(chips[1]));
 assert.equal(variantChipLabel(chips[0],[chips[0]]),'White');
});

test('a source-bound official colour review supersedes a coarse photo estimate without changing its factory code',()=>{
 const p=shoe({id:'autry-w',brand:'Autry',style:'WVLW-YG02-2026.2_2026',name:'REELWIND IN LEPRECHAUN AND WHITE SUEDE AND NYLON',url:'https://www.autry-usa.com/women/reelwind-849135.html',image:'https://example.org/autry.jpg',colorway:'Grey',colorEvidence:{method:'upper-image-analysis'}});
 p.sourceLabelReview={verified:true,brand:p.brand,style:p.style,url:p.url,image:p.image,name:p.name,colorway:'Leprechaun / White'};
 const repaired=repairSourceLabels(p);
 assert.equal(repaired.colorway,'Leprechaun / White');assert.equal(repaired.style,p.style);
 assert.equal(repaired.colorEvidence.method,'official-product-attribute');
 assert.equal(repairSourceLabels({...p,image:'https://example.org/changed.jpg'}).colorway,'Grey','review is bound to the actual source image');
 const m={...repaired,id:'autry-m',style:'WVLM-YG02-2026.2_2026'};
 assert.equal(uniqueColorVariants([repaired,m]).length,1,'verified same-colour M/W size runs do not become duplicate chips');
 assert.equal(uniqueColorVariants([repaired,{...m,style:'WVLM-YG03-2026.2_2026',colorway:'Blue'}]).length,2);
});

test('official colour labels exclude availability notices and following image markdown',()=>{
 const p={brand:'Under Armour',colorway:'Colorado Sage / Black - 300 (Out of Stock)![Image 29: Colorado Sage](https://example.org/300.jpg)',url:'https://www.underarmour.com/en-us/p/shoe/3026727.html?dwvar_3026727_color=300'};
 assert.equal(repairSourceLabels(p).colorway,'Colorado Sage / Black');
 assert.equal(repairSourceLabels(p).colorEvidence.method,'official-product-attribute');
 assert.equal(repairSourceLabels({brand:'Converse',name:'Run Star Trainer%E2%84%A2'}).name,'Run Star Trainer™');
});
