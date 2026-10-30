import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFootwear,officialHybridReview,dedupeKey,productStyle,inPublishedScope,labelVariantColours,labelUrlVariantColours,preferLateralView,cleanProductName,colorwayFromName,inLatinOrHangul} from '../scripts/curation.mjs';
import {collectOfficialEvidence} from '../scripts/collect-evidence.mjs';
import {footwearTypes,isPublishedFootwear} from '../public/assets/footwear-policy.mjs';
import {categoryMatches} from '../public/assets/catalog-view.mjs';

const base={brand:'Nike',url:'https://www.nike.com/t/example',officialCategory:'Shoes'};
test('six requested types pass structure gates and share browser/publication filters',()=>{
  const rows=[
    {name:'Court sneaker',expected:['sneaker']},
    {name:'Ballerina sneaker',expected:['sneaker','ballet-sneaker']},
    {name:'Mary-Jane sneaker',expected:['sneaker','mary-jane-sneaker']},
    {name:'Mule sneaker',expected:['sneaker','mule-sneaker']},
    {name:'Jelly shoe',description:'Flexible TPU jelly upper with flat rubber sole',expected:['jelly']},
    {name:'Platform shoe',description:'Casual EVA flat platform construction',expected:['platform']},
    {name:'Platform sneaker',expected:['sneaker','platform']}
  ];
  for(const r of rows){const p={...base,...r,hybridReview:{approved:true,url:base.url}};const type=classifyFootwear(p);assert(type.category,r.name+': '+type.reason);Object.assign(p,type);assert(isPublishedFootwear(p));assert.deepEqual(footwearTypes(p),r.expected);for(const key of r.expected)assert(categoryMatches(p,key));}
});
test('dress exclusions win even with sneaker words, category labels and review approvals',()=>{
  // Dress and heeled shapes stay out however they are worded. Loafers came
  // off this list when they were asked for by name; a heeled one is still
  // caught by its heel.
  for(const name of ['Mary Jane dress shoes','Jelly slingback','Platform heels','Kitten heel sneaker','Wedge heel mule','Platform pump','Leather derby','Ballerina flats','메리제인 구두','슬링백 스니커즈','플랫폼 하이힐'])assert.equal(classifyFootwear({...base,name,productType:'sneaker',hybridReview:{approved:true,url:base.url,sneakerSole:true}}).reason,'excluded-footwear',name);
  for(const name of ['Leather loafer','로퍼','Penny loafer','Leather moccasin'])assert.equal(classifyFootwear({...base,name}).category,'loafer',name);
  assert.equal(classifyFootwear({...base,name:'Heeled loafer'}).reason,'excluded-footwear','a heel is a heel');
  // The source's own category counts as much as the title: filed under
  // loafers, it is a loafer, whatever its productType field claims.
  assert.equal(classifyFootwear({...base,name:'Casual shoe',category:'loafers',productType:'sneaker'}).category,'loafer');
  assert.equal(classifyFootwear({...base,name:'Mary Jane',hybridReview:{approved:true,url:base.url}}).reason,'sneaker-structure-unverified');
  assert.equal(classifyFootwear({...base,name:'Jelly shoe',description:'Jelly upper'}).reason,'flat-structure-unverified');
  assert.equal(classifyFootwear({...base,name:'Jellyfish sneaker'}).category,'sneaker');
  assert(!isPublishedFootwear({category:'sandal',name:'Flat sandal'}));
  // A platform sandal no longer has to prove its sole is flat before it can
  // be classified - the raised sole is the point of 통굽쪼리, not a doubt
  // about it - but a strappy sandal still does not reach a card.
  assert.equal(classifyFootwear({...base,name:'Platform sandal',description:'Casual rubber outsole and 60mm heel.'}).category,'platform-sandal');
  // Slides, thongs, slippers and clogs do, by name, and 통굽 counts as platform.
  assert.equal(classifyFootwear({...base,name:'Pool slide'}).category,'slipper');
  assert.equal(classifyFootwear({...base,name:'쪼리'}).category,'slipper');
  assert.equal(classifyFootwear({...base,name:'통굽 쪼리'}).category,'platform-slipper');
  assert.equal(classifyFootwear({...base,name:'Clog'}).category,'clog');
  for(const t of [{category:'slipper'},{category:'platform-slipper'},{category:'clog'}])
    assert(isPublishedFootwear({...t,name:'x'}),JSON.stringify(t)+' should reach a card');
  // ...and a dress sandal is still refused however it is worded.
  assert.equal(classifyFootwear({...base,name:'Dress sandal'}).reason,'excluded-footwear');
  for(const name of ['ジェリーパンプス','スリングバック スニーカー','皮鞋','플랫폼 힐'])assert.equal(classifyFootwear({...base,name}).reason,'excluded-footwear');
  assert.equal(classifyFootwear({...base,name:'Running sneaker',description:'A ballerina inspired color scheme.'}).category,'sneaker');
});

test('all reviewed sneaker mixtures publish without a fixed silhouette allowlist',()=>{
  for(const name of ['Sandal sneaker','Clog sneaker','Espadrille sneaker','Fisherman sneaker','Open hybrid sneaker','샌들 스니커즈','クロッグ スニーカー','凉鞋 运动鞋']){
    const raw={...base,name};
    assert.equal(classifyFootwear(raw).reason,'hybrid-review-required',name);
    const hybridReview=officialHybridReview(raw,'An open casual upper combined with a cushioned sneaker outsole.','2026-10-06T08:00:00Z');
    const p={...raw,hybridReview};
    assert.equal(classifyFootwear(p).category,'hybrid',name);
    Object.assign(p,classifyFootwear(p));
    assert(isPublishedFootwear(p),name);assert(categoryMatches(p,'sneaker'),name);
  }
  const unknown={...base,name:'Unusual construction',hybridReview:{approved:true,sneakerSole:true,url:base.url,type:'reviewed experimental form'}};
  assert.equal(classifyFootwear(unknown).category,'hybrid');
  // A review hosted anywhere but the brand's own product page proves nothing.
  // Asked of a house that also sells dress shoes, where a bare "Shoes" category
  // says nothing about the form, the record has nothing left to publish on.
  assert.equal(classifyFootwear({...unknown,brand:'Gucci',url:'https://www.gucci.com/t/example',hybridReview:{...unknown.hybridReview,url:'https://example.com/shoe'}}).reason,'footwear-type-unverified');
  assert.equal(officialHybridReview({...base,name:'Sandal sneaker',url:'https://example.com/shoe'},'A cushioned sneaker sole.'),null);
  assert.equal(officialHybridReview({...base,name:'Sandal'},'Flexible leather straps and a flat sole.'),null);
  assert.equal(officialHybridReview({...base,name:'Summer clog'},'A design inspired by the colors of running shoes and sporting heritage.'),null);
  assert(officialHybridReview({...base,name:'Summer clog'},'The lightweight upper is mounted on a sneaker outsole with cushioning.'));
  assert.equal(classifyFootwear({...base,name:'Summer clog',description:'Vented EVA upper for summer.'}).category,'clog');
  assert.equal(classifyFootwear({...base,name:'Retro running sneaker',description:'A sandal-inspired palette.'}).category,'sneaker');
});

test('regional hybrid names keep the same product filters',()=>{
  for(const [name,filter] of [['バレエ スニーカー','ballet-sneaker'],['メリージェーン スニーカー','mary-jane-sneaker'],['穆勒 运动鞋','mule-sneaker']]){
    const p={...base,name,hybridReview:{approved:true,url:base.url,sneakerSole:true}};
    Object.assign(p,classifyFootwear(p));
    assert.equal(p.category,'hybrid');assert(categoryMatches(p,filter));
  }
});

test('hybrid structure collection preserves an already verified release date',async()=>{
  const product={...base,id:'review-sandal',name:'Open sandal sneaker',style:'HYB001',releaseDate:'2026-09-03',dateEvidence:{verified:true,precision:'day',url:'https://www.nike.com/launch/HYB001',verifiedAt:'2026-09-04T00:00:00Z',excerpt:'HYB001 launched September 3, 2026.'}};
  const result=await collectOfficialEvidence({products:[product],now:'2026-10-06T08:00:00Z',log:()=>{},read:async url=>{
    if(url.includes('salomon.com'))throw Error('No fixture calendar');
    return '# Open sandal sneaker\nStyle HYB001\n![Open sandal sneaker](https://static.nike.com/HYB001.jpg)\nThe sandal upper uses a lightweight breathable construction over a cushioned sneaker sole.';
  }});
  assert.equal(result.products.length,1);
  const row=result.products[0];
  assert.deepEqual(row.dateEvidence,product.dateEvidence);assert.equal(row.releaseDate,product.releaseDate);
  assert.equal(classifyFootwear(row).category,'hybrid');assert(row.hybridReview.sneakerSole);
  assert.equal(row.officialProductEvidence,undefined);assert.equal(row.officialImageEvidence,undefined);
});

test('a platform shoe is in scope on the strength of its sole, not its marketing copy',()=>{
  // 26 records were held because their brands never wrote "casual" or
  // "street", and one of them is the shape the group was asked for.
  assert.deepEqual(classifyFootwear({...base,brand:'Melissa',name:'Sun Capri Platform',description:''}),{category:'platform-shoe'});
  assert.deepEqual(classifyFootwear({...base,brand:'Melissa',name:'통굽 플랫폼',description:''}),{category:'platform-shoe'});
  // A heel is still a heel, whatever sole it is on.
  assert.equal(classifyFootwear({...base,name:'Platform wedge heels'}).reason,'excluded-footwear');
});

test('the publishable set the validator checks is the one the classifier produces',()=>{
  // These two lists used to be written out separately. The scope gained
  // slipper and loafer, the build's validator did not, and the build - which
  // is what deploys the site - refused the catalogue it had just curated.
  for(const category of ['sneaker','hybrid','jelly','clog','loafer','slipper','platform-slipper','platform-sandal','platform-shoe'])
    assert.equal(inPublishedScope(category),true,category);
  for(const category of ['sandal','excluded-footwear',''])assert.equal(inPublishedScope(category),false,category);
});

test('one shoe listed once per size is one card, not six',()=>{
  // Melissa's Sun Capri Platform arrives as 38132-BY684-5 through -10, every
  // one of them pointing at the same product page with a ?variant= per size.
  const url='https://www.shopmelissa.com/products/sun-capri-platform-38132-by684';
  const size=(style,variant)=>({brand:'Melissa',style,colorway:'Black',url:variant?`${url}?variant=${variant}`:url});
  assert.equal(productStyle(size('38132-BY684-5')),'38132-BY684');
  assert.equal(dedupeKey(size('38132-BY684-5')),dedupeKey(size('38132-BY684-10','50543714828546')));
  // A different colour of the same model stays a different card.
  assert.notEqual(dedupeKey(size('38132-BY684-5')),dedupeKey({...size('38132-BY687-5'),colorway:'Orange'}));
  // A colour code is not a size: Nike's style survives whole, because the
  // product's own URL never names it without the last segment.
  assert.equal(productStyle({style:'CW2288-111',url:'https://www.nike.com/t/air-force-1-07-CW2288-111/CW2288-111'}),'CW2288-111');
});

test("a kids' shoe is not in the catalogue, and a colour called baby still is",()=>{
  // The retail classifier always refused them; the official one never looked,
  // so 31 reached cards - and Nike's GS models arrived as a second card beside
  // the adult shoe of the same name.
  for(const name of ["Big Kids' Jasper III Sneaker",'Air Jordan 1 High OG "Royal" (GS)',
                     "Baby Peppa Pig Flip Flop Sandals",'키즈 스니커즈','Toddler Court Sneaker'])
    assert.equal(classifyFootwear({...base,name}).reason,'kids-sizing',name);
  assert.deepEqual(classifyFootwear({...base,name:'Air Force 1 Baby Blue Sneaker'}),{category:'sneaker'});
});

test('basketball and golf shoes are sneakers; studs and spikes are not',()=>{
  for(const name of ['Kobe 10 Protro Basketball Shoes','Angel Reese 1 Basketball Shoes',
                     'Club C Revenge Golf Shoes','농구화 에어줌'])
    assert.deepEqual(classifyFootwear({...base,name}),{category:'sneaker'},name);
  for(const name of ['Mercurial Soccer Cleats','Track Spikes','야구화 스파이크'])
    assert.equal(classifyFootwear({...base,name}).reason,'excluded-footwear',name);
});

test("a colour with no name is read off the brand's own URLs, and an article number is not a colour",()=>{
  const keen=url=>({brand:'KEEN',name:"Jasper III Sneaker",url,colorway:''});
  const group=[keen('https://www.keenfootwear.com/products/jasper-iii-bungee-brindle-evening-primrose'),
               keen('https://www.keenfootwear.com/products/jasper-iii-bungee-cameo-rose-birch'),
               keen('https://www.keenfootwear.com/products/jasper-iii-bungee-birch-black')];
  labelVariantColours(group);
  assert.deepEqual(group.map(p=>p.colorway),['Brindle Evening Primrose','Cameo Rose Birch','Birch Black']);
  assert.equal(group[0].colorwaySource,'official-url-variant');
  // Axel Arigato's slugs end in an article number: it tells the shoes apart
  // and names nothing, so the cards stay unlabelled rather than lie.
  const axel=url=>({brand:'Axel Arigato',name:'Flair Runner',url,colorway:''});
  const sku=[axel('https://www.axelarigato.com/p/flair-runner-f4500001'),
             axel('https://www.axelarigato.com/p/flair-runner-f4500006')];
  labelVariantColours(sku);
  assert.deepEqual(sku.map(p=>p.colorway),['','']);
  // A colour that is already recorded is never overwritten.
  const known=[{brand:'KEEN',name:'UNEEK',url:'https://www.keenfootwear.com/products/uneek-black',colorway:'Black'}];
  labelVariantColours(known);assert.equal(known[0].colorway,'Black');
});

test('one shelf or another is the same product',()=>{
  // 23.65 reaches a product from its NEW shelf and its SNEAKERS shelf with the
  // shelf number in the query, which used to make two products of one.
  const base23='https://www.23-65.com/product/detail.html?product_no=1813';
  assert.equal(dedupeKey({brand:'23.65',style:'',colorway:'',url:`${base23}&cate_no=376&display_group=1`}),
               dedupeKey({brand:'23.65',style:'',colorway:'',url:`${base23}&cate_no=381&display_group=1`}));
});

test('one model listed once per colour is one card',()=>{
  // On writes the pair of shades into the title and leaves the colour field
  // empty, so "Women's Cloudrunner 3 Black | Ivory" and "… Ghost | Verdite"
  // were nine cards of one shoe. All nine live under the same model directory
  // and differ only in the last segment.
  const on=tail=>({brand:'On',name:"Women's Cloudrunner 3 "+tail.split('-').slice(0,2).map(w=>w[0].toUpperCase()+w.slice(1)).join(' | '),
    colorway:'',url:'https://www.on.com/en-us/products/cloudrunner-3-w-3wg1005/womens/'+tail});
  const group=[on('black-ivory-shoes-3WG10051430'),on('ghost-verdite-shoes-3WG10055248'),on('frost-glacier-shoes-3WG10051421')];
  labelUrlVariantColours(group);
  assert.deepEqual(group.map(p=>p.colorway),['Black Ivory','Ghost Verdite','Frost Glacier']);
  // The store's whole catalogue is not one model: 180 unrelated KEEN shoes
  // share /products as their directory and must not become colourways.
  const keen=slug=>({brand:'KEEN',name:slug,colorway:'',url:'https://www.keenfootwear.com/products/'+slug});
  const unrelated=[keen('uneek-black'),keen('jasper-birch')];
  labelUrlVariantColours(unrelated);
  assert.deepEqual(unrelated.map(p=>p.colorway),['','']);
});

test('a sole is not the photograph of a shoe',()=>{
  // _A is Bottega Veneta's lateral still and Balenciaga's pair of outsoles
  // seen from below, and 27 Balenciaga records went to cards showing it while
  // carrying the lateral _F from the same page all along.
  const asset=suffix=>`https://balenciaga.dam.kering.com/asset/4e0b2d73/Medium/800590WTRHK1594_${suffix}.jpg?v=4`;
  const record={brand:'Balenciaga',image:asset('A'),
    officialImageEvidence:{verified:true,url:asset('A')},
    imageCandidates:[{url:asset('G')},{url:asset('F')},{url:asset('A')}]};
  preferLateralView([record]);
  assert.equal(record.image,asset('F'));
  assert.equal(record.officialImageEvidence.url,asset('F'),'the evidence must point at the picture shown');
  // Bottega Veneta keeps its own reading of _A.
  const bottega={brand:'Bottega Veneta',image:'https://bottega-veneta.dam.kering.com/asset/x/Medium/789_A.jpg',imageCandidates:[]};
  preferLateralView([bottega]);
  assert.match(bottega.image,/_A\.jpg$/);
});

test('a product name is Latin or Hangul, never kana',()=>{
  // Louis Vuitton's Japanese store calls it LV スニーカリーナ, and the katakana
  // reached a card untouched.
  assert.equal(cleanProductName('LV スニーカリーナ'),'LV Sneakerina');
  assert.equal(cleanProductName('LV ローファー'),'LV Loafer');
  assert.equal(inLatinOrHangul('LV Sneakerina'),true);
  assert.equal(inLatinOrHangul('나이키 스니커즈'),true,'Hangul is readable here');
  assert.equal(inLatinOrHangul('LV スニーカリーナ'),false);
  // An English or Korean name is left exactly as it is.
  assert.equal(cleanProductName('Air Force 1'),'Air Force 1');
  assert.equal(cleanProductName('나이키 에어포스1'),'나이키 에어포스1');
});

test("the page's own furniture is not a colour, and the name states one",()=>{
  // Balenciaga's listing puts a "Close the dialog" control inside the card and
  // 22 records took it as their colourway, which then stopped the colour being
  // lifted out of the name.
  assert.equal(colorwayFromName("Men's Triple S.2 Denim Sneaker in Black"),'Black');
  assert.equal(colorwayFromName("Men's Hamptons Worn-out Sneaker in White/dark Blue/grey"),'White/dark Blue/grey');
  // A sentence is not a colour.
  assert.equal(colorwayFromName('Sneaker in a padded nappa leather with a rubber sole'),'');
  assert.equal(colorwayFromName('Air Force 1'),'');
});

test("a sport brand's own filing names the form, and a garment page never does",()=>{
  // Brooks sends no category, no productType and a description holding the
  // page's furniture ("Use arrow keys to pan"). Its path is the only statement
  // of form it makes, and it is a clear one.
  assert.equal(classifyFootwear({brand:'Brooks',name:'Ghost 18',url:'https://www.brooksrunning.com/en_us/womens/shoes/road-running-shoes/ghost-18/120482.html'}).category,'sneaker');
  assert.equal(classifyFootwear({brand:'Vans',name:'Old Skool Shoe',url:'https://www.vans.com/en-us/shoes-c00081/old-skool-shoe'}).category,'sneaker');
  assert.equal(classifyFootwear({brand:'Onitsuka Tiger',name:'CALIFORNIA 78 EX',officialCategory:'Shoes',url:'https://www.onitsukatiger.com/kr/ko-kr/p/california-78-ex'}).category,'sneaker');
  // FILA's shop lists its whole catalogue, and twelve garments reached cards as
  // sneakers when "shoes" anywhere on the page was enough.
  for(const name of ['에어플로우 후드 경량 다운','기모 그래픽 후드티','[차정원 착용] 1911 여성 니트트랙 집업','에센셜 롱다운'])
    assert.equal(classifyFootwear({brand:'FILA',name,url:'https://www.fila.co.kr/products/1100fs264dj01x012091'}).reason,'not-footwear',name);
  // On files its hoodies with productType "sneaker"; the path says apparel.
  assert.equal(classifyFootwear({brand:'On',name:'Climate Zip Hoodie Women',category:'sports',productType:'sneaker',url:'https://www.on.com/en-us/products/climate-zip-hoodie-w-1wg3076/womens/mallow-apparel-1WG30764978'}).reason,'not-footwear');
  // A toddler's shoe says so in its path and nowhere else.
  assert.equal(classifyFootwear({brand:'Converse',name:'Converse x Hello Kitty One Strap',url:'https://www.converse.com/shop/p/converse-x-hello-kitty-one-strap-baby-toddler-low-top-shoe/A21840F.html'}).reason,'kids-sizing');
  // A house that also sells heels states nothing with a bare "Shoes".
  assert.equal(classifyFootwear({brand:'Gucci',name:'Fashion 001',officialCategory:'Shoes',description:'Classic calf leather',url:'https://www.gucci.com/t/fashion-001'}).reason,'footwear-type-unverified');
  // Every regex in the classifier reads as written: a stray control character
  // where a word boundary should be disabled the clog and apparel rules twice.
  assert.equal(classifyFootwear({brand:'Crocs',name:'클래식 카무플라주 클로그',productType:'muleclog',category:'casual',url:'https://www.crocs.co.kr/p/classic-camo-clog'}).category,'clog');
});
