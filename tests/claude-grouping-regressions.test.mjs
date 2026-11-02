// Grouping regressions found by auditing the strict-assortment snapshot:
// a modelName copied out of a listing's own title, Rick Owens SKUs standing in
// for names, 23.65's shop template answering alt text into the colour field,
// Gucci's hex codes reaching a chip label, Alexander McQueen's one Oversized
// Sneaker standing as a Korean card and an English card, and Golden Goose's
// "볼스타" holding nine article numbers.
//
// Every case here is a synthetic record built to the shape the real listing
// has, not a count read off public/data. The catalogue changes week to week -
// tests/ui-browser.mjs carries four scars from being bound to it - so what is
// asserted is the rule, which the record states in full.
import test from 'node:test';
import assert from 'node:assert/strict';
import {variantGroupKey,variantGroupName,variantColorLabel,uniqueColorVariants,
  unifyVariantGroups,groupProductVariants,styleFamily} from '../public/assets/catalog-view.mjs';
import {manufacturerCode,reviewedDesignName,titleColorLabel} from '../public/assets/product-identity.mjs';

const at='2026-11-01T00:00:00.000Z';
/** A released, photographed listing, with only the fields grouping reads. */
const row=fields=>({id:fields.id||fields.style||fields.name,category:'sneaker',productType:'sneaker',
  releaseDate:'2026-10-01',firstPublishedAt:at,image:'https://example.org/'+(fields.id||'x')+'.jpg',...fields});
/** The keys a set of listings falls into, after the one pass app.mjs makes. */
function keys(rows){unifyVariantGroups(rows);return rows.map(variantGroupKey);}
function cards(rows){unifyVariantGroups(rows);return groupProductVariants(rows);}
const names=rows=>{unifyVariantGroups(rows);return rows.map(variantGroupName);};

test('a modelName copied out of the listing title does not skip colour subtraction',()=>{
  // ALOHAS's feed answers modelName with the whole title, colour included, and
  // taking it as a resolved model stood four shades of one article as four
  // cards. s101316 is the article; the two digits after the dash are the shade.
  const rows=[
    row({id:'a1',brand:'ALOHAS',style:'s101316-10',manufacturerStyle:'s101316-10',colorway:'rife taupe',
      name:'Tb.00 Barefoot Rife Taupe Leather Sneakers',modelName:'Tb.00 Barefoot Rife Taupe Leather Sneakers'}),
    row({id:'a2',brand:'ALOHAS',style:'s101316-11',manufacturerStyle:'s101316-11',colorway:'rife cocoa & off white',
      name:'Tb.00 Barefoot Rife Cocoa & Off White Leather Sneakers',modelName:'Tb.00 Barefoot Rife Cocoa & Off White Leather Sneakers'}),
    row({id:'a3',brand:'ALOHAS',style:'s101316-12',manufacturerStyle:'s101316-12',colorway:'crochet cream',
      name:'Tb.00 Barefoot Crochet Cream Leather Sneakers',modelName:'Tb.00 Barefoot Crochet Cream Leather Sneakers'}),
  ];
  assert.deepEqual(names(rows),['Tb.00 Barefoot','Tb.00 Barefoot','Tb.00 Barefoot']);
  assert.equal(new Set(keys(rows)).size,1,'one article, one card');
  // Three shades of it, still three chips: the card exists to show them.
  assert.equal(uniqueColorVariants(cards(rows)[0],'a1').length,3);
  assert.equal(styleFamily(rows[0]),'S101316');
});

test('an article code groups ALOHAS shades even when the title cannot',()=>{
  const rows=[
    row({id:'b1',brand:'ALOHAS',style:'s100471-08',manufacturerStyle:'s100471-08',colorway:'',name:'Tb.490 Rife Sneakers'}),
    row({id:'b2',brand:'ALOHAS',style:'s100471-34',manufacturerStyle:'s100471-34',colorway:'',name:'Tb.490 Rife Blue Tones Sneakers'}),
  ];
  assert.equal(new Set(keys(rows)).size,1);
  // A different article is a different shoe, however close the title reads.
  const other=[...rows,row({id:'b3',brand:'ALOHAS',style:'s100709-01',manufacturerStyle:'s100709-01',colorway:'',name:'Tb.490 Rife Grain Sneakers'})];
  assert.equal(new Set(keys(other)).size,2);
});

test('a modelName that says more than the title is still used as given',()=>{
  // 23.65 resolves "Aroa 스니커즈 - BEIGE" to AROA Sneakers, and that answer
  // cannot be re-derived from the title, so it is not second-guessed.
  const rows=[
    row({id:'c1',brand:'23.65',name:'Aroa 스니커즈 - BEIGE',modelName:'AROA Sneakers',colorway:'BEIGE',
      url:'https://www.23-65.com/product/detail.html?product_no=1849'}),
    row({id:'c2',brand:'23.65',name:'Aroa 스니커즈',modelName:'AROA Sneakers',colorway:'MOCHA BROWN',
      url:'https://www.29cm.co.kr/products/4263619'}),
  ];
  assert.deepEqual(names(rows),['AROA Sneakers','AROA Sneakers']);
  assert.equal(new Set(keys(rows)).size,1);
});

test("Rick Owens' SKU title becomes the house's name for the design",()=>{
  const sneaks=row({id:'r1',brand:'Rick Owens',style:'DS02F6800_DO_911',manufacturerStyle:'DS02F6800_DO_911',
    name:'DS02F6800_DO_911 | SNEAKS',modelName:'DS02F6800_DO_911 | SNEAKS',colorway:'Black',
    url:'https://www.rickowens.eu/products/ds02f6800do911'});
  assert.equal(variantGroupName(sneaks),'Sneaks F6800');
  assert.equal(reviewedDesignName(row({...sneaks,id:'r2',style:'DS02F6803_DOLVS_8611',manufacturerStyle:'DS02F6803_DOLVS_8611',
    name:'DS02F6803_DOLVS_8611 | VINTAGE SNEAKS'})),'Vintage Sneaks F6803');
  assert.equal(reviewedDesignName(row({...sneaks,id:'r3',style:'DS02F6809_DOH1W1_11111',manufacturerStyle:'DS02F6809_DOH1W1_11111',
    name:'DS02F6809_DOH1W1_11111 | MEGALACE® SNEAKS'})),'Megalace Sneaks F6809');
  // A listing the house named itself is left alone.
  assert.equal(variantGroupName(row({id:'r4',brand:'Rick Owens',style:'ro-tower',name:'Tower Low Sneakers',colorway:'Black'})),'Tower Low Sneakers');
});

test('the Rick Owens line prefix is a size run, not another shoe',()=>{
  // DS02F6800_BMC_911 and DU02F6800_BMC_911 are the same design, material and
  // colour, and 13 of the 15 such pairs in the catalogue are the same
  // photograph and the same photoHash.
  const ds=row({id:'d1',brand:'Rick Owens',style:'DS02F6800_DO_911',manufacturerStyle:'DS02F6800_DO_911',
    name:'DS02F6800_DO_911 | SNEAKS',colorway:'Black'});
  const du=row({id:'d2',brand:'Rick Owens',style:'DU02F6800_DO_911',manufacturerStyle:'DU02F6800_DO_911',
    name:'DU02F6800_DO_911 | SNEAKS',colorway:'Black'});
  assert.equal(manufacturerCode(ds),manufacturerCode(du));
  assert.equal(new Set(keys([ds,du])).size,1);
  // A different material slot is a different variant, and a different design a
  // different card.
  const otherMaterial=row({...du,id:'d3',style:'DU02F6800_BMC_911',manufacturerStyle:'DU02F6800_BMC_911',name:'DU02F6800_BMC_911 | SNEAKS'});
  assert.notEqual(manufacturerCode(ds),manufacturerCode(otherMaterial));
  assert.equal(new Set(keys([ds,du,otherMaterial])).size,1,'one design, three listings, one card');
  assert.equal(uniqueColorVariants(cards([ds,du,otherMaterial])[0],'d1').length,2,'two materials, two chips; the line prefix folds');
  const otherDesign=row({...ds,id:'d4',style:'DS02F6802_DO_911',manufacturerStyle:'DS02F6802_DO_911',name:'DS02F6802_DO_911 | LOW SNEAKS'});
  assert.equal(new Set(keys([ds,otherDesign])).size,2);
});

test("23.65's shop template is stripped off the model, and the silhouette is not",()=>{
  const shop=(id,name,extra={})=>row({id,brand:'23.65',name,colorway:'',
    url:`https://www.23-65.com/product/detail.html?product_no=${id}&cate_no=376`,...extra});
  const read=p=>reviewedDesignName(p);
  // The alt text the template appends after a dash.
  assert.equal(read(shop('1858','스니커즈 BLACK - 블랙 컬러가 돋보이는 스니커즈 제품')),'스니커즈');
  assert.equal(read(shop('1856','스니커즈 BROWN - 블랙 컬러가 돋보이는 스니커즈 제품')),'스니커즈');
  // The category stands on either side of the model, and 29CM drops it.
  assert.equal(read(shop('1852','스니커즈 V - 블랙 컬러가 돋보이는 스니커즈 제품')),'V');
  assert.equal(read(shop('1853','V 스니커즈 BLACK - 블랙 컬러가 돋보이는 스니커즈 제품')),'V');
  assert.equal(read(shop('1831','메리노 슈즈 그레이',{colorway:'그레이'})),'메리노');
  assert.equal(read(shop('m29','메리노',{colorway:'그레이',url:'https://www.29cm.co.kr/products/4204094'})),'메리노');
  // The bundle listing is the same shoe sold twice.
  assert.equal(read(shop('1617','너티 모카신 1+1')),'너티 모카신');
  assert.equal(read(shop('1832','KIDNEY 1+1 - 일상의 가벼운 발걸음을 제안하는 편안한 라이프스타일 슈즈 제품 이미지')),'KIDNEY');
  // The colourway named after the model.
  assert.equal(read(shop('1611','23.65 너티 모카신 너티 베이지')),'너티 모카신');
  // A silhouette and a pattern are the design; only the shade comes off.
  assert.equal(read(shop('1833','FEROA 플리플랍 DOTTY BLACK - 감각적인 도트 패턴이 돋보이는 블랙 컬러 플리플랍 제품 이미지')),'FEROA 플리플랍 DOTTY');
  assert.equal(read(shop('1791','너티 모카신')),'너티 모카신');
  // A mule is not the sneaker of the same name.
  const mule=shop('m1','DONKEY MULE 스니커즈 -BEIGE',{colorway:'BEIGE',modelName:'DONKEY MULE 스니커즈 -BEIGE'});
  const sneaker=shop('m2','DONKEY 스니커즈',{colorway:'BLACK'});
  assert.equal(read(mule),'DONKEY MULE');
  assert.equal(read(sneaker),'DONKEY');
  assert.equal(new Set(keys([mule,sneaker])).size,2);
  // Three shades of the one bare-named model, one card, one chip each.
  const bare=[shop('1858','스니커즈 BLACK - 블랙 컬러가 돋보이는 스니커즈 제품',{colorway:'블랙 컬러가 돋보이는 스니커즈 제품'}),
    shop('1857','스니커즈 BLACK - 블랙 컬러가 돋보이는 스니커즈 제품',{colorway:'블랙 컬러가 돋보이는 스니커즈 제품'}),
    shop('1856','스니커즈 BROWN - 블랙 컬러가 돋보이는 스니커즈 제품',{colorway:'블랙 컬러가 돋보이는 스니커즈 제품'}),
    shop('1855','스니커즈 CHARCOAL - 블랙 컬러가 돋보이는 스니커즈 제품',{colorway:'블랙 컬러가 돋보이는 스니커즈 제품'})];
  assert.equal(new Set(keys(bare)).size,1);
  assert.deepEqual(uniqueColorVariants(cards(bare)[0],'1858').map(variantColorLabel),['BLACK','BROWN','CHARCOAL']);
});

test("a shop's alt text is not a colour, and the title says which one it is",()=>{
  // The same sentence answers the colour field for the brown listing as for
  // the black one, so it cannot be trusted even for the colour it names.
  const brown=row({id:'p1',brand:'23.65',name:'스니커즈 BROWN - 블랙 컬러가 돋보이는 스니커즈 제품',
    colorway:'블랙 컬러가 돋보이는 스니커즈 제품',url:'https://www.23-65.com/product/detail.html?product_no=1856'});
  assert.equal(variantColorLabel(brown),'BROWN');
  assert.equal(titleColorLabel(brown),'BROWN');
  // No other house's title is mined for a colour.
  assert.equal(titleColorLabel(row({id:'p2',brand:'Nike',name:'Air Force 1 Triple White'})),'');
  // A colour the shop actually stated is still the colour.
  assert.equal(variantColorLabel(row({id:'p3',brand:'23.65',name:'Aroa 스니커즈 - BEIGE',modelName:'AROA Sneakers',colorway:'BEIGE'})),'BEIGE');
});

test("a number the shop carries in its own query string is not an article number",()=>{
  const shopRow=row({id:'s1',brand:'23.65',name:'스니커즈 BLACK',style:'1854',productVariantId:'1854',
    styleType:'official-product-id',url:'https://www.23-65.com/product/detail.html?product_no=1854&cate_no=376'});
  assert.equal(manufacturerCode(shopRow),'','the shop\'s listing row is not a factory variant');
  // Ferragamo and Burberry number their articles in digits too, and their own
  // URLs do not echo them, so those codes stand.
  const ferragamo=row({id:'s2',brand:'Ferragamo',name:'Nima Sneakers',style:'784502',productVariantId:'784502',
    styleType:'official-product-id',url:'https://www.ferragamo.com/shop/kor/ko/men/nima-784502--1'});
  assert.equal(manufacturerCode(ferragamo),'official-variant|784502');
});

test("a hex code is the swatch, not the colour's name",()=>{
  const gucci=row({id:'g1',brand:'Gucci',name:"Men's Screener sneaker",style:'A000MVAAGVY9522',colorway:'White,#336633|Green'});
  assert.equal(variantColorLabel(gucci),'White, Green');
  // A stated colour with one separator is left exactly as the house wrote it.
  assert.equal(variantColorLabel(row({id:'g2',brand:'Balenciaga',name:'Triple S.2 Sneaker',colorway:'Black/dark Grey'})),'Black/dark Grey');
});

test('a listing named only for its audience is read off the product slug',()=>{
  const gucci=row({id:'g3',brand:'Gucci',name:"Men's",style:'874813AAGSG1000',colorway:'Black',
    url:'https://www.gucci.com/us/en/pr/men/shoes-for-men/sneakers-for-men/mens-sneaker-with-driver-sole-p-874813AAGSG1000'});
  assert.equal(variantGroupName(gucci),'Sneaker With Driver Sole');
});

test("one Oversized Sneaker, whichever language the listing is in",()=>{
  // The Korean listings carry the Kering code without its colour slot and the
  // US ones carry it with, so the same article reached two cards. Eleven
  // characters, the seventh of them the W of the footwear class.
  const ko=row({id:'q1',brand:'Alexander McQueen',name:'오버사이즈 스니커즈',style:'553680WIAKB',colorway:'화이트',
    url:'https://www.alexandermcqueen.com/ko-kr/pr/oversized-sneaker'});
  const us=row({id:'q2',brand:'Alexander McQueen',name:'Oversized Sneaker in Black/White',style:'oversized-sneaker-553680WIAKB1016',
    colorway:'Black/White',url:'https://www.alexandermcqueen.com/en-us/pr/oversized-sneaker-553680WIAKB1016.html'});
  assert.equal(styleFamily(ko),'553680WIAKB');
  assert.equal(styleFamily(us),'553680WIAKB');
  assert.equal(new Set(keys([ko,us])).size,1);
  // A shop's own eleven-digit sequence has no W in it and is not a design.
  assert.equal(styleFamily(row({id:'q3',brand:'PANE',name:'Pane Light Training Nogi',style:'12345678901'})),'');
  // The crystal-set edition is its own design and stays its own card.
  const crystal=row({id:'q4',brand:'Alexander McQueen',name:'크리스탈 장식 오버사이즈 스니커즈',style:'611697WHZ39',colorway:'화이트'});
  assert.equal(new Set(keys([ko,us,crystal])).size,2);
});

test("Golden Goose's article number is the card, and its size run is not",()=>{
  const gg=(id,code,material,colour,name)=>row({id,brand:'Golden Goose',name,colorway:'',
    style:`${code}.${material}.${colour}`,manufacturerStyle:`${code}.${material}.${colour}`,
    url:`https://www.goldengoose.com/kr/ko/p/ball-star-cod-${code}.${material}.${colour}.html`});
  const men=gg('h1','GMF00117','F005821','10361','남성 그린 스타 화이트 나파 볼스타');
  const women=gg('h2','GWF00117','F005821','10361','그린 레더 스타와 힐탭 화이트 나파 레더 여성 볼스타');
  // The Korean model word is translated, and the article number is kept.
  assert.equal(variantGroupName(men),'Ball Star F00117');
  assert.equal(variantGroupName(women),'Ball Star F00117');
  // Same article, same material, same colour: one chip in two fits.
  assert.equal(manufacturerCode(men),manufacturerCode(women));
  assert.equal(uniqueColorVariants(cards([men,women])[0],'h1').length,1);
  // A different material slot is a different variant of the same card.
  const otherMaterial=gg('h3','GMF00117','F008300','15919','남성 오커 스웨이드 볼스타');
  assert.equal(new Set(keys([men,otherMaterial])).size,1);
  assert.equal(uniqueColorVariants(cards([men,women,otherMaterial])[0],'h1').length,2);
  // A different article is a different shoe, however the house markets it.
  const otherArticle=gg('h4','GMF00916','F008586','50454','남성 다크 블루 퍼포레이티드 스웨이드 볼스타');
  assert.equal(new Set(keys([men,otherArticle])).size,2,'GMF00117 and GMF00916 are two Ball Stars');
  // An unnamed design still reads as its article number, as it already did.
  assert.equal(variantGroupName(gg('h5','GWF00122','F000325','10502','여성 스니커즈')),'Sneakers F00122');
});

test('sole, height and silhouette distinctions survive the merge rules',()=>{
  const rows=[
    row({id:'t1',brand:'Gucci',name:'Stretch low-top sneaker',style:'865445AAGFF1000',colorway:'Black'}),
    row({id:'t2',brand:'Gucci',name:'Stretch high-top sneaker',style:'865057AAGFF1000',colorway:'Black'}),
    row({id:'t3',brand:'Maison Mihara Yasuhiro',name:'"BLAKEY" OG Sole low-top sneakers',colorway:'Black'}),
    row({id:'t4',brand:'Maison Mihara Yasuhiro',name:'"BLAKEY" Hybrid Sole low-top sneakers',colorway:'Black'}),
  ];
  assert.equal(new Set(keys(rows)).size,4,'high and low tops, and two soles, are four designs');
});

test('the colour fold the browser test counts on is unchanged',()=>{
  // tests/ui-browser.mjs builds this card from its Nike fixture and expects
  // two chips: White folds with WHITE, Black stands apart.
  const base={brand:'Nike',name:'Retro Runner 00',category:'sneaker',productType:'sneaker',
    releaseDate:'2026-10-01',url:'https://example.org/p0',image:'https://example.org/white.svg',
    presentation:{image:'https://example.org/white.svg',scale:1}};
  const rows=[{...base,id:'p0',style:'SKU-0',colorway:'White'},
    {...base,id:'black',style:'SKU-0-B',colorway:'Black',image:'https://example.org/black.svg',presentation:{image:'https://example.org/black.svg',scale:1}},
    {...base,id:'white-women',style:'SKU-0-W',colorway:'WHITE'}];
  assert.equal(new Set(keys(rows)).size,1);
  assert.equal(uniqueColorVariants(cards(rows)[0],'p0').length,2);
});
