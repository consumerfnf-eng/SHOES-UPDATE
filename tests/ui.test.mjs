import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_COLUMNS, productRecord, exportRows, csvBytes, xlsxBytes } from '../public/assets/export.mjs';
import { kstToday, shiftCalendarMonths, releaseState, safeUrl, filterProducts, keywordProductIds, sourceContext, trendKeywords } from '../public/assets/catalog-view.mjs';

test('KST calendar window clamps month ends and distinguishes upcoming, expired, unknown', () => {
  assert.equal(kstToday(new Date('2026-09-27T15:00:00Z')),'2026-09-28');
  assert.equal(shiftCalendarMonths('2026-05-31',-3),'2026-02-28');
  assert.equal(shiftCalendarMonths('2024-05-31',-3),'2024-02-29');
  for(const [date,want] of [['2026-06-28','released'],['2026-06-27',null],['2026-09-28','released'],['2026-09-29','upcoming'],['2026-12-28','upcoming'],['2026-12-29',null],['',null],['2026-02-30',null]]) assert.equal(releaseState({releaseDate:date},'2026-09-28'),want,date);
});
test('Source filters require qualified popularity, not a mere mention; common fit and keyword tags work', () => {
  const a={id:'a',name:'Runner',brand:'Nike',releaseDate:'2026-09-01',category:'sneaker',fit:['MLB','DISCOVERY'],sourceSignals:[{type:'sns'}],popularity:{sns:false},keywordTags:['레트로']};
  const b={...a,id:'b',popularity:{sns:true}};
  const state={search:'',brands:new Set(),fit:'all',category:'all',release:'released',sort:'newest',source:'sns'};
  assert.deepEqual(filterProducts([a,b],state,'2026-09-28').map(p=>p.id),['b']);
  assert.equal(filterProducts([a,b],{...state,source:'all',fit:'common',search:'레트로'},'2026-09-28').length,2);
  assert.equal(filterProducts([a,b],{...state,brands:new Set(['On'])},'2026-09-28').length,0);
  assert.equal(filterProducts([a,b],{...state,source:'all',keywordIds:new Set(['a'])},'2026-09-28')[0].id,'a');
});
test('External links accept only ordinary http(s), reject script and credential URLs',()=>{
  assert.equal(safeUrl('javascript:alert(1)'),'');assert.equal(safeUrl('https://user:password@example.org/'),'');assert.equal(safeUrl('data:text/html,x'),'');assert.equal(safeUrl('https://example.org/shoe'),'https://example.org/shoe');
});
test('Keyword matching uses every matching product, not only ranking evidence, and excludes expired or unknown dates',()=>{
  const products=[{id:'evidence',releaseDate:'2026-09-01'},{id:'attribute-only',releaseDate:'2026-08-01'},{id:'upcoming',releaseDate:'2026-10-01'},{id:'expired',releaseDate:'2026-06-27'},{id:'unknown',releaseDate:''}];
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
  const p={brand:'Nike',name:'신발',archiveGroup:'outdoor',fit:['MLB'],fitReasons:['secret'],sourceSignals:[{url:'private'}],material:'Mesh',colors:[{name:'Black',hex:'#000000'}],image:'https://example.org/a.jpg'};
  const rows=exportRows([p]);assert.equal(rows[0].length,17);assert.deepEqual(rows[0],['season','country','brand_group','court','brand','gender','category','subcategory','fabric','fabric_group','product_name','colorway_count','variant_names','colors','hex_colors','top_hex','image_url']);
  assert.equal(productRecord(p).brand_group,'아웃도어·스포츠');assert.equal(productRecord(p).country,'');assert.equal(productRecord(p).category,'shoe');
  assert(!JSON.stringify(rows).includes('secret'));assert(!JSON.stringify(rows).includes('private'));
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
  const now=Date.parse('2026-09-28T05:00:00Z'),base={id:'term',label:'스니커즈',productIds:['a'],rank:1,score:1},signal={platform:'musinsa',term:'스니커즈',rank:1,kind:'search-rank',verified:true,sourceUrl:'https://example.org/search',capturedAt:'2026-09-28T04:00:00Z',validUntil:'2026-09-30',latestPeriodVerified:true,reportId:'fixture-period',periodEnd:'2026-09-27',validityBasis:'report-end-policy',publishedAt:'2026-09-27T00:00:00Z'};
  for(const kind of ['search-rank','composite-rank','hashtag-rank'])assert.equal(trendKeywords([{...base,sourceRanks:[{...signal,kind}]}],{now})[0].rank,1);
  for(const kind of ['search-popular','editorial-keyword'])assert.equal(trendKeywords([{...base,sourceRanks:[{...signal,kind,rank:null}]}],{now})[0].rank,null,'No numeric score from an official unranked mention');
  for(const patch of [{kind:'search-results-order'},{kind:'hashtag-count'},{verified:false},{rank:0},{sourceUrl:'javascript:alert(1)'},{capturedAt:'2026-09-21T04:59:59Z'},{capturedAt:'2026-09-28T05:00:01Z'},{kind:'composite-rank',validUntil:'2026-09-27'},{kind:'editorial-keyword',rank:null,publishedAt:'2026-08-01'}])assert.equal(trendKeywords([{...base,sourceRanks:[{...signal,...patch}]}],{now}).length,0);
  assert.equal(trendKeywords([{...base,sourceRanks:[{...signal,capturedAt:'2026-09-21T05:00:00Z'}]}],{now}).length,1,'Exactly 168 hours is still valid');
  assert.equal(trendKeywords([{...base,sourceRanks:[signal,{...signal,capturedAt:'2026-09-20T00:00:00Z'}]}],{now}).length,0,'Do not preserve aggregate rank after one contributor expires');
  assert.equal(trendKeywords([base],{now}).length,0,'Legacy fixed themes are not ranked search evidence');
  const forecast={...base,sourceRanks:[{...signal,kind:'forecast-keyword',rank:null,capturedAt:'2025-07-18T00:00:00Z',validUntil:'2027-08-31',validityBasis:'season-end-policy'}]};assert.equal(trendKeywords([forecast],{now}).length,0);assert.equal(trendKeywords([forecast],{now,forecast:true})[0].rank,null);assert.equal(trendKeywords([forecast],{now:Date.parse('2027-08-31T14:59:59Z'),forecast:true}).length,1);assert.equal(trendKeywords([forecast],{now:Date.parse('2027-08-31T15:00:00Z'),forecast:true}).length,0);
  assert.equal(trendKeywords([{...base,sourceRanks:[signal]}],{now,forecast:true}).length,0);
});
