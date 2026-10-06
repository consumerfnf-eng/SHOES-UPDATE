import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_COLUMNS, productRecord, exportRows, csvBytes, xlsxBytes } from '../public/assets/export.mjs';
import { kstToday, shiftCalendarMonths, releaseState, safeUrl, filterProducts, keywordProductIds, sourceContext, trendKeywords, officialImageUrl, officialProductUrl, reviewedProductPageUrl, sourceMatches, visibleSocialMetrics, releaseDateLabel, releaseSortKey, socialComparisonGroups, groupProductVariants } from '../public/assets/catalog-view.mjs';

function official(product){return {...product,officialProductEvidence:{verified:true,url:product.url,brand:product.brand,style:product.style,verifiedAt:'2026-09-27T00:00:00Z'},officialImageEvidence:{verified:true,url:product.image,sourceUrl:product.url,brand:product.brand,style:product.style,verifiedAt:'2026-09-27T00:00:00Z'}};}
test('approved navigation links restore product buttons without loosening strict official or social gates',()=>{
 const p={id:'reviewed',brand:'Nike',style:'AA100',url:'https://www.nike.com/launch/t/runner',image:'https://static.nike.com/runner.jpg',releaseDate:'2026-09-01',socialMetrics:[{platform:'instagram',metric:'hashtag-post-count',unit:'posts',value:100,scope:'cumulative',capturedAt:'2026-10-06T05:00:00Z',sourceUrl:'https://www.instagram.com/explore/tags/runner/',query:'runner',verified:true,identity:{brand:'Nike',style:'AA100'}}]};
 const presentation={officialProductUrl:p.url,sourceUrl:p.url,image:p.image,view:'side',checkedAt:'2026-10-06T05:00:00Z'};
 assert.equal(reviewedProductPageUrl({...p,presentation},'2026-10-06'),p.url);
 assert.equal(officialProductUrl({...p,presentation},'2026-10-06'),'');assert.equal(officialImageUrl({...p,presentation},'2026-10-06'),'');assert.deepEqual(visibleSocialMetrics({...p,presentation},'2026-10-06'),[]);assert(!sourceMatches({...p,presentation},'sns','2026-10-06'));assert(!sourceMatches({...p,presentation},'brand','2026-10-06'));
 for(const patch of [{officialProductUrl:undefined},{sourceUrl:'https://www.nike.com/other'},{officialProductUrl:'http://www.nike.com/runner',sourceUrl:'http://www.nike.com/runner'},{checkedAt:'invalid'},{checkedAt:'2026-10-07T00:00:00Z'},{view:'campaign'},{image:'javascript:alert(1)'}])assert.equal(reviewedProductPageUrl({...p,presentation:{...presentation,...patch}},'2026-10-06'),'');
 assert.equal(reviewedProductPageUrl({...p,presentation:{...presentation,image:undefined,cachedPath:'/images/'+'a'.repeat(64)+'.jpg'}},'2026-10-06'),p.url);
 assert.equal(reviewedProductPageUrl({...official(p),presentation:{...presentation,officialProductUrl:'https://bad.example/',sourceUrl:'https://bad.example/'}},'2026-10-06'),p.url,'Existing strict product evidence has priority');
});
const socialMetric={platform:'instagram',metric:'hashtag-post-count',value:120,unit:'posts',scope:'cumulative',capturedAt:'2026-09-27T00:00:00Z',sourceUrl:'https://www.instagram.com/explore/tags/runner/',query:'runner',verified:true,identity:{brand:'Nike',style:'AA100'}};

test('KST calendar window clamps month ends and distinguishes upcoming, expired, unknown', () => {
  assert.equal(kstToday(new Date('2026-09-27T15:00:00Z')),'2026-09-28');
  assert.equal(shiftCalendarMonths('2026-05-31',-3),'2026-02-28');
  assert.equal(shiftCalendarMonths('2024-05-31',-3),'2024-02-29');
  for(const [date,want] of [['2026-06-28','released'],['2026-06-27',null],['2026-09-28','released'],['2026-09-29','upcoming'],['2026-12-28','upcoming'],['2026-12-29',null],['',null],['2026-02-30',null]]) assert.equal(releaseState({releaseDate:date,dateEvidence:{official:true}},'2026-09-28'),want,date);
});
test('Source filters require verified item metrics, not legacy popularity; common fit and keyword tags work', () => {
  const a=official({id:'a',name:'Runner',brand:'Nike',style:'AA100',url:'https://nike.example/runner',image:'https://nike.example/runner.jpg',releaseDate:'2026-09-01',category:'sneaker',fit:['MLB','DISCOVERY'],sourceSignals:[{type:'sns'}],popularity:{sns:true},keywordTags:['레트로']});
  const b={...a,id:'b',socialMetrics:[socialMetric]};
  const state={search:'',brands:new Set(),fit:'all',category:'all',release:'released',sort:'newest',source:'sns'};
  assert.deepEqual(filterProducts([a,b],state,'2026-09-28').map(p=>p.id),['b']);
  assert.equal(filterProducts([a,b],{...state,source:'all',fit:'common',search:'레트로'},'2026-09-28').length,2);
  assert.equal(filterProducts([a,b],{...state,brands:new Set(['On'])},'2026-09-28').length,0);
  assert.equal(filterProducts([a,b],{...state,source:'all',keywordIds:new Set(['a'])},'2026-09-28')[0].id,'a');
});
test('Verified release months retain unknown days and share conservative eligibility and sort keys',()=>{
  const month={releaseDate:'2026-08',dateEvidence:{precision:'month',verified:true}};
  assert.equal(releaseState(month,'2026-09-28'),'released');assert.equal(releaseDateLabel(month),'2026년 8월 (일자 미공개)');assert.equal(releaseSortKey(month),'2026-08-01');
  for(const value of ['2026-06','2026-05','2026-09','2026-10'])assert.equal(releaseState({...month,releaseDate:value},'2026-09-28'),null,value);
  assert.equal(releaseState({...month,dateEvidence:{precision:'month',verified:false}},'2026-09-28'),null);
});
test('Merged media uses combined independent-source qualification; brand requires exact official product and photo of released items',()=>{
  const base=official({id:'a',name:'Runner',brand:'Nike',style:'AA100',url:'https://nike.example/runner',image:'https://nike.example/runner.jpg',releaseDate:'2026-09-01'});
  assert(sourceMatches({...base,popularity:{media:true}},'media','2026-09-28'));assert(!sourceMatches({...base,popularity:{magazine:true}},'media','2026-09-28'));assert(!sourceMatches({...base,popularity:{newsletter:true}},'media','2026-09-28'));
  assert(sourceMatches(base,'brand','2026-09-28'));assert(!sourceMatches({...base,releaseDate:'2026-10-01'},'brand','2026-09-28'));
  assert.equal(officialImageUrl(base,'2026-09-28'),base.image);assert.equal(officialProductUrl(base,'2026-09-28'),base.url);
  for(const patch of [{officialImageEvidence:{...base.officialImageEvidence,verified:false}},{officialImageEvidence:{...base.officialImageEvidence,url:'https://sns.example/photo.jpg'}},{officialImageEvidence:{...base.officialImageEvidence,style:'OTHER'}},{officialImageEvidence:{...base.officialImageEvidence,sourceUrl:'https://different.example/'}},{officialProductEvidence:{...base.officialProductEvidence,brand:'adidas'}},{officialProductEvidence:{...base.officialProductEvidence,verifiedAt:'2026-10-01'}}])assert.equal(officialImageUrl({...base,...patch},'2026-09-28'),'');
  assert.equal(officialImageUrl({...base,officialImageEvidence:undefined,thumbnail:'https://sns.example/fallback.jpg'},'2026-09-28'),'','Never fall back to unverified thumbnails');
});
test('SNS measures keep null, exact units and actual periods; view counts never replace item search or post counts',()=>{
  const base=official({id:'a',name:'Runner',brand:'Nike',style:'AA100',url:'https://nike.example/runner',image:'https://nike.example/runner.jpg',releaseDate:'2026-09-01'});
  const data=[socialMetric,{...socialMetric,metric:'search-count',unit:'searches',value:null},{...socialMetric,metric:'view-count',unit:'views',value:9000,scope:'period',periodStart:'2026-09-01',periodEnd:'2026-09-27'}];
  assert.equal(visibleSocialMetrics({...base,socialMetrics:data},'2026-09-28').length,3);assert.equal(visibleSocialMetrics({...base,socialMetrics:data},'2026-09-28')[1].value,null);
  assert(sourceMatches({...base,socialMetrics:data},'sns','2026-09-28'));assert(!sourceMatches({...base,socialMetrics:[data[1],data[2]]},'sns','2026-09-28'));
  for(const patch of [{identity:{brand:'adidas',style:'AA100'}},{unit:'views'},{value:-1},{value:'120'},{capturedAt:'2026-06-27T00:00:00Z'},{capturedAt:'2026-09-29T00:00:00Z'},{scope:'period',periodStart:'2026-02-30',periodEnd:'2026-09-01'},{verified:false}])assert.equal(visibleSocialMetrics({...base,socialMetrics:[{...socialMetric,...patch}]},'2026-09-28').length,0);
  assert.equal(visibleSocialMetrics({...base,socialMetrics:[{...socialMetric,capturedAt:'2026-06-27T15:00:00Z'}]},'2026-09-28').length,1,'Inclusive KST three-calendar-month boundary');
  const period={...socialMetric,scope:'period',periodStart:'2026-06-27',periodEnd:'2026-09-27'};
  assert.equal(visibleSocialMetrics({...base,socialMetrics:[period]},'2026-09-28').length,1,'A valid measured window survives the following day');
  assert.equal(visibleSocialMetrics({...base,socialMetrics:[period]},'2026-12-28').length,0,'Stale capture and old measurement end are excluded');
  assert.equal(visibleSocialMetrics({...base,socialMetrics:[{...period,periodEnd:'2026-09-28'}]},'2026-09-28').length,0,'Measurement cannot extend past its capture day');
});
test('External links accept only ordinary http(s), reject script and credential URLs',()=>{
  assert.equal(safeUrl('javascript:alert(1)'),'');assert.equal(safeUrl('https://user:password@example.org/'),'');assert.equal(safeUrl('data:text/html,x'),'');assert.equal(safeUrl('https://example.org/shoe'),'https://example.org/shoe');
});
test('Model SNS metrics require an exact verified official model and comparisons never mix units or periods',()=>{
  const base=official({id:'a',name:'Runner',brand:'Nike',style:'AA100',url:'https://nike.example/runner',image:'https://nike.example/runner.jpg',releaseDate:'2026-09-01',fit:['MLB']});
  base.officialProductEvidence.modelIdentity={id:'runner',name:'Runner',verified:true};
  const modelMetric={...socialMetric,identity:{level:'model',brand:'Nike',modelId:'runner',modelName:'Runner'},comparison:{id:'ig-posts',verified:true,population:'items',coverage:'observed-sample',identityLevel:'model',rank:2,itemCount:2}};
  assert.equal(visibleSocialMetrics({...base,socialMetrics:[modelMetric]},'2026-09-28').length,1);
  assert.equal(visibleSocialMetrics({...base,socialMetrics:[{...modelMetric,identity:{...modelMetric.identity,modelId:'other'}}]},'2026-09-28').length,0);
  const variantMetric={...socialMetric,identity:{brand:'Nike',style:'AA100'},comparison:{id:'ig-variant',verified:true,population:'items',coverage:'observed-sample',identityLevel:'variant',rank:2,itemCount:2}};
  const a={...base,socialMetrics:[modelMetric,variantMetric]},b={...base,id:'b',style:'BB200',officialProductEvidence:{...base.officialProductEvidence,style:'BB200'},officialImageEvidence:{...base.officialImageEvidence,style:'BB200'},socialMetrics:[{...variantMetric,value:500,identity:{brand:'Nike',style:'BB200'},comparison:{...variantMetric.comparison,rank:1}}]},c={...base,id:'c',socialMetrics:[{...modelMetric,metric:'search-count',unit:'searches',value:99999,comparison:{...modelMetric.comparison,id:'ig-search'}}]};
  const groups=socialComparisonGroups([a,b,c],'2026-09-28');assert.equal(groups.length,3);assert.equal(groups[0].metric,'hashtag-post-count');
  const state={search:'',brands:new Set(),fit:'all',category:'all',release:'released',sort:'social',source:'sns',socialGroup:groups[0].key};assert.deepEqual(filterProducts([a,c,b],state,'2026-09-28').map(p=>p.id),['b','a'],'Only the same measured group is sorted by count');
});
test('Keyword matching uses every matching product, not only ranking evidence, and excludes expired or unknown dates',()=>{
  const products=[{id:'evidence',releaseDate:'2026-09-01'},{id:'attribute-only',releaseDate:'2026-08-01'},{id:'upcoming',releaseDate:'2026-10-01',dateEvidence:{official:true}},{id:'expired',releaseDate:'2026-06-27'},{id:'unknown',releaseDate:''}];
  const keyword={productIds:products.map(p=>p.id),evidenceProductIds:['evidence'],productCount:1,matchedProductCount:5};
  assert.deepEqual([...keywordProductIds(keyword,products,'2026-09-28')],['evidence','attribute-only','upcoming']);
  assert.equal(keywordProductIds({...keyword,productIds:[]},products,'2026-09-28').size,0);
});
test('Source labels distinguish observed originals from configured targets and never invent platforms',()=>{
  const directory={magazine:{configured:[{id:'actual',name:'Editorial Site',url:'https://editorial.example/'},{id:'pending',name:'Planned Magazine',url:'https://planned.example/'}],observed:[{id:'old',name:'Expired source',url:'https://expired.example/'}]}};
  const products=[{id:'a',releaseDate:'2026-09-01',sourceSignals:[{type:'magazine',url:'https://editorial.example/story',publisherName:'Editorial Site',publisherId:'actual'}]},{id:'old',releaseDate:'2020-01-01',sourceSignals:[{type:'magazine',url:'https://expired.example/story',publisherName:'Expired source'}]}];
  const context=sourceContext('magazine',products,directory,'2026-09-28');
  assert.deepEqual(context.observed.map(s=>s.name),['Editorial Site']);assert.deepEqual(context.configured.map(s=>s.name),['Planned Magazine']);
  assert.equal(context.observed[0].url,'https://editorial.example/');assert.deepEqual(sourceContext('ecommerce',products,directory,'2026-09-28'),{observed:[],configured:[]});
});
test('Archive export is the exact 17-column whitelist, with Korean groups and unknown values blank',()=>{
  const p={brand:'Nike',name:'신발',archiveGroup:'outdoor',fit:['MLB'],fitReasons:['secret'],sourceSignals:[{url:'private'}],socialMetrics:[{...socialMetric,query:'excluded-social-query'}],material:'Mesh',colors:[{name:'Black',hex:'#000000'}],image:'https://example.org/a.jpg'};
  const rows=exportRows([p]);assert.equal(rows[0].length,17);assert.deepEqual(rows[0],['season','country','brand_group','court','brand','gender','category','subcategory','fabric','fabric_group','product_name','colorway_count','variant_names','colors','hex_colors','top_hex','image_url']);
  assert.equal(productRecord(p).brand_group,'아웃도어·스포츠');assert.equal(productRecord(p).country,'');assert.equal(productRecord(p).category,'shoe');
  assert(!JSON.stringify(rows).includes('secret'));assert(!JSON.stringify(rows).includes('private'));assert(!JSON.stringify(rows).includes('excluded-social-query'));
  assert.deepEqual(exportRows([p],['product_name','brand','fit']),[['brand','product_name'],['Nike','신발']]);assert.throws(()=>exportRows([p],[]));
  assert.equal(exportRows([{...p,id:'a'},{...p,id:'b'}]).length,3,'Distinct variants cannot be merged by a similar name');
});
test('CSV preserves Unicode/quotes and neutralizes formulas; XLSX uses only inline text cells',()=>{
  const rows=exportRows([{brand:'=HYPERLINK("https://evil")',name:'한글, "신발"\n새 줄',sourceSignals:[{url:'https://private'}]}]);
  const csv=new TextDecoder().decode(csvBytes(rows));assert(csv.includes("'=HYPERLINK"));assert(csv.includes('한글, ""신발""\n새 줄'));assert(!csv.includes('private'));
  const bytes=xlsxBytes(rows), view=new DataView(bytes.buffer);assert.equal(view.getUint32(0,true),0x04034B50);
  let offset=0,sheet='';const names=[];
  while(view.getUint32(offset,true)===0x04034B50){const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),name=new TextDecoder().decode(bytes.slice(offset+30,offset+30+nameLength));names.push(name);const start=offset+30+nameLength+extra;if(name==='xl/worksheets/sheet1.xml')sheet=new TextDecoder().decode(bytes.slice(start,start+size));offset=start+size;}
  assert.equal(names.length,6);assert(sheet.includes('한글'));assert(sheet.includes('&apos;=HYPERLINK'));assert(!sheet.includes('<f>'));assert(!sheet.includes('private'));assert.equal((sheet.match(/<c /g)||[]).length,34);
});

test('Current ranks use only verified fresh source ordinals; official unranked and forecasts stay separate',()=>{
  const now=Date.parse('2026-09-28T05:00:00Z'),base={id:'term',label:'실버 스니커즈',keywordType:'style',productIds:['a'],rank:1,score:1},signal={platform:'musinsa',term:'실버 스니커즈',rank:1,kind:'search-rank',verified:true,sourceUrl:'https://example.org/search',capturedAt:'2026-09-28T04:00:00Z',validUntil:'2026-09-30',latestPeriodVerified:true,reportId:'fixture-period',periodEnd:'2026-09-27',validityBasis:'report-end-policy',publishedAt:'2026-09-27T00:00:00Z'};
  for(const kind of ['search-rank','composite-rank','hashtag-rank'])assert.equal(trendKeywords([{...base,sourceRanks:[{...signal,kind}]}],{now})[0].rank,1);
  for(const kind of ['search-popular','editorial-keyword'])assert.equal(trendKeywords([{...base,sourceRanks:[{...signal,kind,rank:null}]}],{now})[0].rank,null,'No numeric score from an official unranked mention');
  for(const patch of [{kind:'search-results-order'},{kind:'hashtag-count'},{verified:false},{rank:0},{sourceUrl:'javascript:alert(1)'},{capturedAt:'2026-09-21T04:59:59Z'},{capturedAt:'2026-09-28T05:00:01Z'},{kind:'composite-rank',validUntil:'2026-09-27'},{kind:'editorial-keyword',rank:null,publishedAt:'2026-08-01'}])assert.equal(trendKeywords([{...base,sourceRanks:[{...signal,...patch}]}],{now}).length,0);
  assert.equal(trendKeywords([{...base,sourceRanks:[{...signal,capturedAt:'2026-09-21T05:00:00Z'}]}],{now}).length,1,'Exactly 168 hours is still valid');
  assert.equal(trendKeywords([{...base,sourceRanks:[signal,{...signal,capturedAt:'2026-09-20T00:00:00Z'}]}],{now}).length,0,'Do not preserve aggregate rank after one contributor expires');
  assert.equal(trendKeywords([base],{now}).length,0,'Legacy fixed themes are not ranked search evidence');
  for(const keywordType of [undefined,'brand','model','generic'])assert.equal(trendKeywords([{...base,keywordType,sourceRanks:[signal]}],{now}).length,0,'Only server-verified styles appear in the trend list');
  const forecast={...base,sourceRanks:[{...signal,kind:'forecast-keyword',rank:null,capturedAt:'2025-07-18T00:00:00Z',validUntil:'2027-08-31',validityBasis:'season-end-policy'}]};assert.equal(trendKeywords([forecast],{now}).length,0);assert.equal(trendKeywords([forecast],{now,forecast:true})[0].rank,null);assert.equal(trendKeywords([forecast],{now:Date.parse('2027-08-31T14:59:59Z'),forecast:true}).length,1);assert.equal(trendKeywords([forecast],{now:Date.parse('2027-08-31T15:00:00Z'),forecast:true}).length,0);
  assert.equal(trendKeywords([{...base,sourceRanks:[signal]}],{now,forecast:true}).length,0);
});
test('Same-model colorways group into one card in input order; distinct models stay separate',()=>{
  const a={id:'a',modelKey:'nb|990',colorway:'Red'},b={id:'b',modelKey:'nb|990',colorway:'Blue'},c={id:'c',modelKey:'nb|991'},d={id:'d'};
  assert.deepEqual(groupProductVariants([a,b,c,d]),[[a,b],[c],[d]]);
  assert.deepEqual(groupProductVariants([b,a]),[[b,a]],'group order follows first-seen input order, not a sort inside the group');
  assert.deepEqual(groupProductVariants([]),[]);
});
