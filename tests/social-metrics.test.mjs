import test from 'node:test';
import assert from 'node:assert/strict';
import {curateProduct,curateCatalog,officialEvidenceFor} from '../scripts/curation.mjs';
import {validateSocialMetrics,withSocialComparisons} from '../scripts/social-metrics.mjs';
import {validateSnapshot} from '../scripts/validate_catalog.mjs';
import {applyReviewedEvidence} from '../scripts/publish-curated.mjs';
const today='2026-09-28',now=new Date('2026-09-28T06:00:00Z');
function shoe(patch={}){
 const p={id:'a',brand:'Nike',name:'Retro sneaker',officialCategory:'Lifestyle sneakers',description:'Retro court design.',style:'AA001-100',url:'https://www.nike.com/t/retro/AA001-100',image:'https://static.nike.com/AA001-100.jpg',releaseDate:'2026-09-01',dateEvidence:{verified:true,precision:'day',official:true,url:'https://www.nike.com/launch/t/retro',verifiedAt:now.toISOString(),excerpt:'AA001-100 releases September 1, 2026.'},productVerifiedAt:now.toISOString(),productEvidenceUrl:'https://www.nike.com/t/retro/AA001-100',...patch};
 p.officialProductEvidence={verified:true,url:p.url,brand:p.brand,style:p.style,verifiedAt:now.toISOString()};
 p.officialImageEvidence={verified:true,url:p.image,sourceUrl:p.url,brand:p.brand,style:p.style,verifiedAt:now.toISOString()};
 return p;
}
const metric=(patch={})=>({platform:'instagram',metric:'hashtag-post-count',value:170,unit:'posts',scope:'cumulative',periodStart:null,periodEnd:null,capturedAt:now.toISOString(),sourceUrl:'https://www.instagram.com/explore/tags/aa001100/',query:'#AA001100',country:'',verified:true,identity:{brand:'Nike',style:'AA001-100'},...patch});
test('official brand tab requires exact official PDP and image proof and released status',()=>{
 const p=shoe();assert(officialEvidenceFor(p,today));assert(curateProduct(p,today).product.popularity.brand);
 assert(!curateProduct({...p,releaseDate:'2026-10-01'},today).product.popularity.brand);
 for(const changed of [{officialImageEvidence:null},{officialImageEvidence:{...p.officialImageEvidence,url:'https://other.test/image.jpg'}},{officialProductEvidence:{...p.officialProductEvidence,style:'WRONG'}},{url:'https://fake-nike.example/product'}])assert(!curateProduct({...p,...changed},today).product.popularity.brand);
});
test('verified mandatory luxury sneakers pass design reference fit without invented performance claims',()=>{
 const p=shoe({brand:'Gucci',url:'https://www.gucci.com/us/en/pr/sneaker-123',productEvidenceUrl:'https://www.gucci.com/us/en/pr/sneaker-123',name:'Leather sneaker',officialCategory:'Sneakers',description:'Leather upper and logo.'});
 const result=curateProduct(p,today);assert(result.product);assert.deepEqual(result.product.fit,['MLB']);assert(result.product.fitReasons.includes('럭셔리 스니커즈 디자인 참고'));
 assert.equal(curateProduct({...p,officialImageEvidence:null},today).reason,'brand-fit-unverified');
 assert.equal(curateProduct({...p,name:'Leather loafer'},today).reason,'excluded-footwear');
});
test('SNS accepts observed positive item search/posts, distinguishes null and views, and does not require many accounts',()=>{
 const p=shoe({socialMetrics:[metric(),metric({metric:'search-count',unit:'searches',value:null})]});
 const c=curateProduct(p,today).product;assert(c.popularity.sns);assert.equal(c.socialMetrics[1].value,null);assert.equal(c.socialMetrics[0].comparison,undefined);
 assert(!curateProduct(shoe({socialMetrics:[metric({metric:'view-count',unit:'views',value:900000})]}),today).product.popularity.sns);
 assert(!curateProduct(shoe({socialMetrics:[metric({value:0})]}),today).product.popularity.sns);
 assert(!curateProduct({...p,officialImageEvidence:null},today).product.popularity.sns);
});
test('SNS metric identity, exact units, calendar window and period/cumulative distinctions fail closed',()=>{
 const p=shoe(),valid=patch=>validateSocialMetrics({...p,socialMetrics:[metric(patch)]},today,{officialEligible:true});
 assert.equal(valid({capturedAt:'2026-06-27T15:00:00Z'}).length,1);
 for(const patch of [{capturedAt:'2026-06-27T14:59:59Z'},{capturedAt:'2026-09-29T00:00:00Z'},{identity:{brand:'Nike',style:'WRONG'}},{unit:'searches'},{value:undefined},{value:-1},{value:NaN},{scope:'period',periodStart:'2026-09-01',periodEnd:'2026-09-31'},{scope:'period',periodStart:'2026-06-01',periodEnd:'2026-09-28'},{periodStart:'2026-07-01'}])assert.equal(valid(patch).length,0,JSON.stringify(patch));
  assert.equal(valid({scope:'period',periodStart:'2026-06-28',periodEnd:'2026-09-28'}).length,1);
  const measured={...p,socialMetrics:[metric({scope:'period',periodStart:'2026-06-28',periodEnd:'2026-09-28'})]};
  assert.equal(validateSocialMetrics(measured,'2026-09-29',{officialEligible:true}).length,1);
  assert.equal(validateSocialMetrics(measured,'2026-12-29',{officialEligible:true}).length,0);
});
test('observed comparisons rank only same platform/metric/unit/scope/country/period and cannot inflate sample counts',()=>{
 const a=curateProduct(shoe({socialMetrics:[metric()]}),today).product;
 const b=curateProduct(shoe({id:'b',style:'BB002-200',socialMetrics:[metric({value:400,identity:{brand:'Nike',style:'BB002-200'}})]}),today).product;
 const c=curateProduct(shoe({id:'c',style:'CC003-300',socialMetrics:[metric({platform:'tiktok',value:999,identity:{brand:'Nike',style:'CC003-300'}})]}),today).product;
 const rows=withSocialComparisons([a,b,c,{...a,id:'duplicate'}]);assert.equal(rows[0].socialMetrics[0].comparison.rank,2);assert.equal(rows[1].socialMetrics[0].comparison.rank,1);assert.equal(rows[1].socialMetrics[0].comparison.itemCount,2);assert.equal(rows[2].socialMetrics[0].comparison,undefined);assert.equal(rows[0].socialMetrics[0].comparison.coverage,'observed-sample');
});
test('catalog validates social comparisons and combined media uses either qualified channel',()=>{
 const signals=['magazine','newsletter'].flatMap(type=>[1,2].map(i=>({type,url:`https://publisher${i}.test/${type}`,title:'Retro sneaker',publishedAt:'2026-09-22',checkedAt:now.toISOString(),modelMatched:true,independent:true,publisherId:'publisher'+i,sponsored:false})));
 const a=shoe({sourceSignals:signals,socialMetrics:[metric()]}),b=shoe({id:'b',style:'BB002-200',socialMetrics:[metric({value:400,identity:{brand:'Nike',style:'BB002-200'}})]});
 const snapshot=curateCatalog([a,b],{now}).snapshot;assert(snapshot.products[0].popularity.media);assert(validateSnapshot(snapshot));
 const changed=structuredClone(snapshot);changed.products[0].socialMetrics[0].comparison.rank=50;assert.throws(()=>validateSnapshot(changed),/social metrics/);
});
test('merged media counts independent publishers across magazine/newsletter without double counting',()=>{
 const signal=(type,publisherId)=>({type,publisherId,url:`https://${publisherId}.test/article`,title:'Shoe',publishedAt:'2026-09-22',checkedAt:now.toISOString(),modelMatched:true,independent:true,sponsored:false});
 const p=curateProduct(shoe({sourceSignals:[signal('magazine','one'),signal('newsletter','two')]}),today).product;
 assert(p.popularity.media);assert(!p.popularity.magazine);assert(!p.popularity.newsletter);
 assert(!curateProduct(shoe({sourceSignals:[signal('magazine','same'),{...signal('newsletter','same'),url:'https://same.test/newsletter'}]}),today).product.popularity.media);
});
test('model-level social identity requires exact official model proof and cannot multiply colorway sample counts',()=>{
 const make=(style,model,value)=>{const p=shoe({style});p.officialProductEvidence.modelIdentity={id:model,name:p.name,verified:true};p.socialMetrics=[metric({value,identity:{level:'model',brand:'Nike',modelId:model,modelName:p.name}})];return p;};
 const a=make('AA001-100','retro-exact',170),b=make('AA001-200','retro-exact',170),c=make('CC001-100','other-exact',400);b.id='b';c.id='c';
 const rows=curateCatalog([a,b,c],{now}).snapshot.products;assert.equal(rows.length,3);assert(rows.every(p=>p.socialMetrics[0].comparison.itemCount===2));
 const wrong=make('AA001-100','retro-exact',170);wrong.socialMetrics[0].identity.modelId='generic-nike';assert(!curateProduct(wrong,today).product.popularity.sns);
 const vague=make('AA001-100','retro-exact',170);vague.officialProductEvidence.modelIdentity.name='Nike shoes';assert(!curateProduct(vague,today).product.popularity.sns);
 const mixed=make('AA001-100','retro-exact',170);mixed.socialMetrics.push(metric({value:40}));
 assert(curateCatalog([mixed],{now}).snapshot.products[0].socialMetrics.every(m=>!m.comparison));
});
test('same-day future observations cannot enter a catalog checked earlier',()=>{
 const p=shoe({socialMetrics:[metric({capturedAt:new Date(now.getTime()+1000).toISOString()})]});
 assert.equal(curateCatalog([p],{now}).snapshot.products[0].socialMetrics.length,0);
});
test('older reviewed metadata cannot disconnect a newly verified official URL/image pair',()=>{
 const original=shoe(),old={...original,officialProductEvidence:undefined,officialImageEvidence:undefined,image:'https://static.nike.com/old.jpg',productVerifiedAt:'2026-09-01T00:00:00Z'};
 const merged=applyReviewedEvidence([original],[old])[0];assert.equal(merged.image,original.image);assert.deepEqual(merged.officialImageEvidence,original.officialImageEvidence);assert(officialEvidenceFor(merged,today));
});
test('verified month product keeps original month in public data and archives only after the whole interval expires',()=>{
 const p=shoe({releaseDate:'2026-07'});p.dateEvidence={...p.dateEvidence,precision:'month',excerpt:'Released July 2026.'};
 const c=curateCatalog([p],{now}).snapshot;assert.equal(c.products[0].releaseDate,'2026-07');assert.deepEqual(c.products[0].verifiedReleaseWindow,{start:'2026-07-01',end:'2026-07-31'});assert(validateSnapshot(c));
 assert.equal(curateCatalog([p],{now:new Date('2026-10-15T00:00:00Z')}).queue.products.length,0);
 assert.equal(curateCatalog([p],{now:new Date('2026-11-01T00:00:00Z')}).queue.products.length,1);
});
