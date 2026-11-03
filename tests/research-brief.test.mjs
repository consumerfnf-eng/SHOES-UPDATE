import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedFeedLook,runwayFirst} from '../public/assets/research-policy.mjs';
import {composeSnapshot} from '../scripts/build-catwalk-snapshot.mjs';
import {validateProposalConfig} from '../scripts/build-season-proposals.mjs';
import {proposalAsset,proposalsForSeason} from '../public/assets/research-brief.mjs';
import {proposalSheet,BOARD_SIZE} from '../public/assets/proposal-template.mjs';
import {brandPriceRows,comparisonBrand,mlbBenchmark,PRICE_BRANDS,priceComparisonMarkup} from '../public/assets/brand-prices.mjs';
import {priceKrw} from '../public/assets/analysis.mjs';
test('CATWALK exclusions persist across collections and runway precedes feed stably',()=>{
 assert.equal(isAllowedFeedLook({collection:'fashion-feed',hashtags:['#HeeledPump']}),false);
 assert.equal(isAllowedFeedLook({collection:'runway',hashtags:['#HeeledPump']}),true);
 for(const collection of ['runway','fashion-feed'])for(const tag of ['#slingback','#WedgeHeels','#WEDGEHEELS'])assert.equal(isAllowedFeedLook({collection,hashtags:[tag]}),false);
 const refs=[{id:'f1',collection:'fashion-feed'},{id:'r1'},{id:'r2'},{id:'f2',collection:'fashion-feed'}];assert.deepEqual(runwayFirst(refs).map(r=>r.id),['r1','r2','f1','f2']);assert.equal(refs[0].id,'f1');
 const snapshot=composeSnapshot([{season:'Spring/Summer 2027',collection:'fashion-feed',looks:[{id:'f'},{id:'bad',hashtags:['#slingback']}]},{season:'Spring/Summer 2027',looks:[{id:'r'},{id:'bad-r',hashtags:['#WedgeHeels']}]}]).snapshot;assert.deepEqual(snapshot.looks.map(l=>l.id),['r','f']);
});
const report=(id,title)=>({id,title,pages:Array(20).fill('/page.jpg')});
const reports=[report('ss','Sneakers S/S 27'),report('fw','Sneakers A/W 27/28'),report('next','Sneakers S/S 28')];
const config=()=>({schemaVersion:2,ideas:['27SS','27FW','28SS'].flatMap((season,n)=>Array.from({length:5},(_,i)=>({id:'idea-'+n+'-'+i,season,pattern:'mesh',insight:'Independent design interpretation',tags:['Mesh','Club','Team'],strategies:Array(4).fill('Design hypothesis'),references:Array.from({length:6},(_,j)=>({id:'ref-'+j,kind:'product'})),forecast:[{id:reports[n].id,page:4}]})))});
test('proposal publication requires five unique designs per season and season-correct source pages',()=>{
 validateProposalConfig(config(),reports);const short=config();short.ideas.pop();assert.throws(()=>validateProposalConfig(short,reports));const wrong=config();wrong.ideas[0].forecast[0].id='fw';assert.throws(()=>validateProposalConfig(wrong,reports));const repeat=config();repeat.ideas[1].id=repeat.ideas[0].id;assert.throws(()=>validateProposalConfig(repeat,reports));const language=config();language.ideas[0].strategies[0]='リップ';assert.throws(()=>validateProposalConfig(language,reports));
 assert.equal(proposalsForSeason(config(),'27SS').length,5);assert.deepEqual(BOARD_SIZE,{width:4800,height:2700});assert.equal(proposalAsset('/proposals/retro/board.png'),'/proposals/retro/board.png');assert.equal(proposalAsset('/proposals/../secret'), '');
 const idea={...config().ideas[0],title:'<script>bad</script>',subtitle:'Retro',references:Array.from({length:6},()=>({image:'/safe.jpg',brand:'Prada',name:'Sneaker',kind:'product'})),evidence:{officialModels:2,retailModels:3,articles:1,ranking:[],social:[]},targetPrice:149000,forecast:[{shortTitle:'Sneakers',page:4}]};assert(!proposalSheet(idea).includes('<script>'));assert(proposalSheet(idea).includes('&lt;script&gt;'));
});
test('price comparison includes only nine requested brands, omits unpriced rows and counts each model once',()=>{
 const base={brand:'Nike',name:'Test Runner',style:'MODEL-1',colorway:'White',priceLabel:'100,000원'};
 const benchmark=mlbBenchmark({products:[{style:'a',listPrice:99000},{style:'b',listPrice:149000},{style:'c',listPrice:199000},{style:'b',listPrice:149000}]});assert.equal(benchmark.count,3);assert.equal(benchmark.median,149000);
 const rows=brandPriceRows([base,{...base,id:'black',colorway:'Black',priceLabel:'200,000원'},{brand:'FILA',name:'No price'},{brand:'Prada',name:'Luxury',priceLabel:'USD 950'},{brand:'National Geographic',name:'Excluded',priceLabel:'159,000원'},{brand:'AKIII CLASSIC',name:'Excluded',priceLabel:'99,000원'}],benchmark);
 assert.equal(rows.length,1);assert.equal(rows[0].name,'Nike');assert.equal(rows[0].models,1);assert.equal(rows[0].median,150000);assert.equal(PRICE_BRANDS.length,9);
 const scoped=brandPriceRows([base,{...base,style:'OTHER',name:'Distinct Runner',priceLabel:'USD 900'}, {...base,style:'NEWS',name:'News Reference',priceLabel:'USD 1200',source:'newsletter-sneaker-news'}],benchmark);assert.equal(scoped[0].median,100000);assert.equal(scoped[0].models,2);assert.equal(scoped[0].basis,'한국 원화 표시가');
 assert.equal(comparisonBrand({brand:'adidas',name:'Performance Runner'}),'');assert.equal(comparisonBrand({brand:'adidas',url:'https://www.ssense.com/en-us/men/product/adidas-originals/shoe/123'}),'Adidas Originals');
 assert.equal(priceKrw({priceLabel:'SEK 4,070'}),null);assert.equal(priceKrw({priceLabel:'14\nEUR'}),null);assert.equal(priceKrw({priceLabel:'USD 1200',source:'newsletter-footwear-news'}),null);assert.equal(priceKrw({priceLabel:'CNY ¥1000'}),193000);
 assert.equal(priceKrw({priceLabel:'USD 90'}),124200);assert.equal(priceKrw({priceLabel:'30% OFF USD 140'}),193200);
});

test('median bars sort from cheapest to highest with the MLB baseline and no count table',()=>{
 const benchmark=mlbBenchmark({products:[{style:'a',listPrice:99000},{style:'b',listPrice:149000},{style:'c',listPrice:199000}]});
 const rows=brandPriceRows([{brand:'Nike',name:'High',priceLabel:'199,000원'},{brand:'FILA',name:'Low',priceLabel:'99,000원'}],benchmark);
 assert.deepEqual(rows.map(r=>r.name),['FILA','Nike']);
 const html=priceComparisonMarkup(rows,benchmark);
 assert(html.includes('MLB보다 50,000원 저렴'));assert(html.includes('MLB보다 50,000원 높음'));assert(html.includes('MLB 중앙값 149,000원'));
 assert.equal([...html.matchAll(/class="price-mlb-line" style="left:74.500%"/g)].length,3);
 assert(html.includes('width:49.500%'));assert(html.includes('width:99.500%'));assert(!html.includes('가격대별 상품 개수'));assert(!html.includes('<table'));
 assert(!/가격 확인 모델|전체 모델|가격대 내 모델|지수 100|\d+\s*\/\s*\d+개 모델/.test(html));
 assert(html.indexOf('data-price-brand="FILA"')<html.indexOf('data-price-reference="MLB"'));assert(html.indexOf('data-price-reference="MLB"')<html.indexOf('data-price-brand="Nike"'));
 assert(!priceComparisonMarkup(rows,null).includes('price-mlb-line'));
});
