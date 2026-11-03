import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedFeedLook,runwayFirst} from '../public/assets/research-policy.mjs';
import {composeSnapshot} from '../scripts/build-catwalk-snapshot.mjs';
import {validateProposalConfig} from '../scripts/build-season-proposals.mjs';
import {proposalAsset,proposalsForSeason} from '../public/assets/research-brief.mjs';
import {proposalSheet,BOARD_SIZE} from '../public/assets/proposal-template.mjs';
import {brandPriceRows,comparisonBrand,mlbBenchmark,PRICE_BRANDS} from '../public/assets/brand-prices.mjs';
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
 validateProposalConfig(config(),reports);const short=config();short.ideas.pop();assert.throws(()=>validateProposalConfig(short,reports));const wrong=config();wrong.ideas[0].forecast[0].id='fw';assert.throws(()=>validateProposalConfig(wrong,reports));const repeat=config();repeat.ideas[1].id=repeat.ideas[0].id;assert.throws(()=>validateProposalConfig(repeat,reports));
 assert.equal(proposalsForSeason(config(),'27SS').length,5);assert.deepEqual(BOARD_SIZE,{width:4800,height:2700});assert.equal(proposalAsset('/proposals/retro/board.png'),'/proposals/retro/board.png');assert.equal(proposalAsset('/proposals/../secret'), '');
 const idea={...config().ideas[0],title:'<script>bad</script>',subtitle:'Retro',references:Array.from({length:6},()=>({image:'/safe.jpg',brand:'Prada',name:'Sneaker',kind:'product'})),evidence:{officialModels:2,retailModels:3,articles:1,ranking:[],social:[]},targetPrice:149000,forecast:[{shortTitle:'Sneakers',page:4}]};assert(!proposalSheet(idea).includes('<script>'));assert(proposalSheet(idea).includes('&lt;script&gt;'));
});
test('price comparison includes only nine requested brands, omits unpriced rows and counts each model once',()=>{
 const base={brand:'Nike',name:'Test Runner',style:'MODEL-1',colorway:'White',priceLabel:'100,000원'};
 const benchmark=mlbBenchmark({products:[{style:'a',listPrice:99000},{style:'b',listPrice:149000},{style:'c',listPrice:199000},{style:'b',listPrice:149000}]});assert.equal(benchmark.count,3);assert.equal(benchmark.median,149000);
 const rows=brandPriceRows([base,{...base,id:'black',colorway:'Black',priceLabel:'200,000원'},{brand:'FILA',name:'No price'},{brand:'Prada',name:'Luxury',priceLabel:'USD 950'},{brand:'National Geographic',name:'Excluded',priceLabel:'159,000원'},{brand:'AKIII CLASSIC',name:'Excluded',priceLabel:'99,000원'}],benchmark);
 assert.equal(rows.length,1);assert.equal(rows[0].name,'Nike');assert.equal(rows[0].models,1);assert.equal(rows[0].median,150000);assert.equal(PRICE_BRANDS.length,9);
 assert.equal(comparisonBrand({brand:'adidas',name:'Performance Runner'}),'');assert.equal(comparisonBrand({brand:'adidas',url:'https://www.ssense.com/en-us/men/product/adidas-originals/shoe/123'}),'Adidas Originals');
 assert.equal(priceKrw({priceLabel:'USD 90'}),124200);assert.equal(priceKrw({priceLabel:'30% OFF USD 140'}),193200);
});
