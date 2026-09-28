import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_COLUMNS, productRecord, exportRows, csvBytes, xlsxBytes } from '../public/assets/export.mjs';
import { kstToday, shiftCalendarMonths, releaseState, safeUrl, filterProducts } from '../public/assets/catalog-view.mjs';

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
