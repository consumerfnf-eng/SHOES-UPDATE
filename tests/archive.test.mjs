import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeArchive,prepareRows,planArchive,resolveDestination,cutoffDate,eligibilityReason,parseCsv,createGoogleAdapter,fingerprintRows,verifyArchiveConnection,writeRunSummary } from '../scripts/archive-expired.mjs';

const productionConfig=JSON.parse(await fs.readFile(new URL('../config/archive-sheets.json',import.meta.url),'utf8'));
const cfg={key:'domestic',id:'test-only',sheetId:0,title:'시트1',defaultCountry:'KR'};
const config={...productionConfig,sheets:[cfg],newBrandGroups:{domestic:['PANE']}};
const cell=value=>({userEnteredValue:{stringValue:value},userEnteredFormat:{textFormat:{fontFamily:'Arial',fontSize:11},wrapStrategy:'WRAP'}});
const headers=['season','brand','gender','category','picture','product_name','material','color','image_hex_color','image_url','debug','','','','country'];
function snapshot() {
  const row=name=>['2025-09','PANE','Unisex','shoe','',''+name,'Mesh','White','#FFFFFF','https://example.com/'+name+'.jpg','','','','','GL'].map(cell);
  const first=row('Original One'),second=row('Original Two');
  first[4].userEnteredValue={formulaValue:'=IMAGE(J2)'};
  first[3].dataValidation={condition:{type:'ONE_OF_LIST',values:[{userEnteredValue:'shoe'},{userEnteredValue:'top'}]},strict:true,showCustomUi:true};
  second[3].dataValidation=structuredClone(first[3].dataValidation);
  first[9].userEnteredFormat.textFormat.link={uri:'https://example.com/old-link'};
  first.push({userEnteredValue:{formulaValue:'=COUNTIF(B:B,"PANE")'},note:'Human calculation',chipRuns:[{startIndex:0,chip:{richLinkProperties:{uri:'https://example.com/owned'}}}]});
  return {native:true,metadata:{properties:{sheetId:0,title:'시트1',gridProperties:{rowCount:3,columnCount:16}}},rows:[headers.map(cell),first,second]};
}
function product(overrides={}) {
  return {id:'new-1',brand:'PANE',name:'New Shoe',category:'sneaker',fit:['MLB'],fitReasons:['Court design'],releaseDate:'2026-03-17',releaseStatus:'released',dateEvidence:{verified:true,url:'https://example.com/release',precision:'day',verifiedAt:'2026-09-28T00:00:00Z',official:true,excerpt:'Released 17 March 2026'},eligibility:{passed:true},productEvidenceUrl:'https://example.com/product',lastVerifiedAt:'2026-09-28T00:00:00Z',url:'https://example.com/product',image:'https://example.com/new.jpg',style:'SKU1',colorway:'Blue',colors:[{name:'Blue',hex:'#0000FF'}],gender:'Unisex',material:'Mesh',country:'GL',archiveGroup:'contemporary',...overrides};
}
function memoryAdapter(source=snapshot(),mode='ok') {
  let data=structuredClone(source),writes=0;
  return {get writes(){return writes;},get snapshot(){return data;},async read(){return structuredClone(data);},async append(_cfg,rows){writes++;if(mode!=='timeout-before-write')data.rows.push(...structuredClone(rows).map(r=>r.values));if(mode==='timeout-after-write'||mode==='timeout-before-write')throw new Error('request timed out');if(mode==='damage-existing')data.rows[1][5].userEnteredValue.stringValue='Accidental change';}};
}
const now=new Date('2026-09-28T00:00:00Z');
test('dry-run is strictly zero writes, leaves ledger and all existing cells unchanged',async()=>{
  const adapter=memoryAdapter(),initial=fingerprintRows(adapter.snapshot.rows),ledger={entries:{}};
  const result=await executeArchive({products:[product()],config,adapter,ledger,now});
  assert.equal(result.ready.length,1);assert.equal(adapter.writes,0);assert.deepEqual(ledger,{entries:{}});assert.equal(fingerprintRows(adapter.snapshot.rows),initial);
});
test('native append preserves old formulas, formats, chips and validation; second run is idempotent',async()=>{
  const source=snapshot(),adapter=memoryAdapter(source),ledger={entries:{}},audits=[];
  const options={products:[product()],config,adapter,ledger,now,apply:true,saveLedger:async()=>{},audit:async(id,body)=>audits.push({id,body})};
  const first=await executeArchive(options);assert.equal(first.appended.length,1);assert.equal(adapter.writes,1);assert.equal(audits.length,1);
  assert.deepEqual(adapter.snapshot.rows.slice(0,source.rows.length),source.rows);
  const newRow=adapter.snapshot.rows[3];assert.equal(newRow[3].userEnteredValue.stringValue,'shoe');assert.deepEqual(newRow[3].dataValidation,source.rows[1][3].dataValidation);
  assert.equal(newRow[14].userEnteredValue.stringValue,'GL');assert.equal(newRow[9].userEnteredFormat.textFormat.link,undefined);assert.equal(newRow[15],undefined);
  assert.match(newRow[4].userEnteredValue.formulaValue,/INDEX\(J:J,ROW\(\)\)/);
  const again=await executeArchive(options);assert.equal(adapter.writes,1);assert.equal(again.skipped[0].status,'already-archived');
});
test('network timeout after server commit reconciles read-back without replay',async()=>{
  const adapter=memoryAdapter(snapshot(),'timeout-after-write'),ledger={entries:{}};
  const r=await executeArchive({products:[product()],config,adapter,ledger,now,apply:true,saveLedger:async()=>{},audit:async()=>{}});
  assert.equal(r.appended.length,1);assert.equal(adapter.writes,1);assert.equal(Object.values(ledger.entries)[0].reconciledAfterError,true);
});
test('uncertain write without observed marker is never replayed on next run',async()=>{
  const adapter=memoryAdapter(snapshot(),'timeout-before-write'),ledger={entries:{}},options={products:[product()],config,adapter,ledger,now,apply:true,saveLedger:async()=>{},audit:async()=>{}};
  await assert.rejects(executeArchive(options),/stopped without replay/);assert.equal(adapter.writes,1);assert.equal(Object.values(ledger.entries)[0].state,'uncertain');
  const r=await executeArchive(options);assert.equal(adapter.writes,1);assert.equal(r.pending[0].reason,'ledger-requires-reconciliation');
});
test('wrong country, unknown brand and ambiguous existing destinations fail closed',()=>{
  assert.equal(resolveDestination(product({country:null}),productionConfig,new Map()).reason,'country-needs-review');
  assert.equal(resolveDestination(product({brand:'PANE (CN)',country:'GL'}),productionConfig,new Map()).reason,'brand-country-conflict');
  assert.equal(resolveDestination(product({brand:'Unreviewed Brand'}),productionConfig,new Map()).reason,'unknown-brand-needs-review');
  assert.equal(resolveDestination(product({brand:'On',archiveGroup:'',country:'GL'}),productionConfig,new Map([['on',new Set(['athleisure','outdoor_global','luxury'])]])).reason,'multiple-existing-files-needs-review');
  assert.equal(resolveDestination(product({brand:'FILA',country:'GL'}),productionConfig,new Map([['fila',new Set(['outdoor_china'])]])).reason,'existing-country-mismatch-needs-review');
});
test('user overrides preserve actual market, Ralph Lauren athleisure, contemporary domestic',()=>{
  assert.deepEqual(resolveDestination(product({brand:'Urban Revivo',country:'CN'}),productionConfig,new Map([['urbanrevivo',new Set(['outdoor_china'])]])),{key:'domestic',country:'CN',reason:'user-contemporary-override'});
  assert.equal(resolveDestination(product({brand:'Ralph Lauren'}),productionConfig,new Map()).key,'athleisure');
});
test('approved European/global PUMA routes to outdoor sports while preserving actual market',()=>{
  const existing=new Map([['puma',new Set(['outdoor_china'])]]);
  for(const country of ['EU','GL','US']) {
    assert.deepEqual(resolveDestination(product({brand:'PUMA',country}),productionConfig,existing),{key:'outdoor_global',country,reason:'user-puma-regional-override'});
  }
  assert.equal(resolveDestination(product({brand:'PUMA',country:null}),productionConfig,existing).reason,'country-needs-review');
});
test('Chinese PUMA retains read-only Chinese destination and never enters append plan',()=>{
  const p=product({brand:'PUMA',country:'CN'}),existing=new Map([['puma',new Set(['outdoor_china'])]]);
  assert.deepEqual(resolveDestination(p,productionConfig,existing),{key:'outdoor_china',country:'CN',reason:'existing-china-brand'});
  const snapshots=Object.fromEntries(productionConfig.sheets.map(s=>[s.key,snapshot()]));
  snapshots.outdoor_china.rows[1][1]=cell('PUMA');snapshots.outdoor_china.rows[1][14]=cell('CN');
  const plan=planArchive([p],snapshots,productionConfig,now);
  assert.equal(plan.ready.length,0);assert.equal(plan.pending[0].reason,'destination-read-only-needs-user-review');assert.equal(plan.pending[0].destination,'outdoor_china');
});
test('invalid/date unknown/young products never enter archive; KST calendar-month boundary clamps',()=>{
  assert.equal(cutoffDate(new Date('2026-05-30T16:00:00Z')),'2026-02-28');
  assert.equal(eligibilityReason(product({releaseDate:'2026-06-28'}),now),'not-expired');
  assert.equal(eligibilityReason(product({releaseDate:null}),now),'unknown-release-date');
  assert.equal(eligibilityReason(product({category:'loafer'}),now),'excluded-category');
  assert.equal(eligibilityReason(product({eligibility:{passed:false}}),now),'eligibility-not-verified');
  assert.equal(eligibilityReason(product({dateEvidence:{url:'https://example.com'}}),now),'missing-release-evidence');
});
test('verified release months archive only after the entire month expires, without fabricating a day',()=>{
  const monthly=product({releaseDate:'2026-06',dateEvidence:{...product().dateEvidence,precision:'month',excerpt:'First released in June 2026'}});
  assert.equal(eligibilityReason(monthly,now),'not-expired');
  assert.equal(eligibilityReason(monthly,new Date('2026-09-30T14:59:00Z')),'not-expired');
  assert.equal(eligibilityReason(monthly,new Date('2026-09-30T15:00:00Z')),null);
  assert.equal(monthly.releaseDate,'2026-06');
  assert.equal(eligibilityReason({...monthly,releaseDate:'2026-13'},now),'unknown-release-date');
  assert.equal(eligibilityReason({...monthly,dateEvidence:{...monthly.dateEvidence,verified:false}},now),'unknown-release-date');
  assert.equal(eligibilityReason({...monthly,verifiedReleaseWindow:{start:'2026-06-01',end:'2026-06-29'}},now),'unknown-release-date');
});
test('audit is mandatory before any write; schema drift and unsupported validations block writes',async()=>{
  const adapter=memoryAdapter();await assert.rejects(executeArchive({products:[product()],config,adapter,now,apply:true}),/Immutable audit/);assert.equal(adapter.writes,0);
  const changed=snapshot();changed.rows[0][1]=cell('renamed');assert.throws(()=>planArchive([product()],{domestic:changed},config,now),/Header changed/);
  const validated=snapshot();for(const r of validated.rows.slice(1))r[3].dataValidation={condition:{type:'CUSTOM_FORMULA',values:[{userEnteredValue:'=TRUE'}]}};
  const entry=planArchive([product()],{domestic:validated},config,now).ready;
  assert.throws(()=>prepareRows(entry,validated,cfg),/Validation requires review/);
});
test('post-write existing cell mismatch halts without trying to restore or resend',async()=>{
  const adapter=memoryAdapter(snapshot(),'damage-existing');await assert.rejects(executeArchive({products:[product()],config,adapter,now,apply:true,saveLedger:async()=>{},audit:async()=>{}}),/Existing cell changed/);assert.equal(adapter.writes,1);
});
test('duplicate queue and pre-existing product are not appended',()=>{
  const p=product({name:'Original One',colorway:'White',image:'https://example.com/Original One.jpg'});
  const r=planArchive([p,product(),product()],{domestic:snapshot()},config,now);assert.equal(r.ready.length,1);assert.deepEqual(r.skipped.map(x=>x.status),['existing-product','queue-duplicate']);
});
test('official product IDs never masquerade as manufacturer codes in archive rows or duplicate matching',()=>{
  const source=snapshot();source.rows[0][11]=cell('상품코드');
  for(const row of source.rows.slice(1))row[11]=cell('9876543210123');
  const before=structuredClone(source),p=product({style:'9876543210123',styleType:'official-product-id',colorway:'White'});
  const plan=planArchive([p],{domestic:source},config,now);
  assert.equal(plan.ready.length,1,'An unrelated existing manufacturer code must not match a platform product ID');
  const rows=prepareRows(plan.ready,source,cfg);
  assert.equal(rows[0].values[11].userEnteredValue?.stringValue||'','');
  assert.deepEqual(source,before,'The original Sheet snapshot remains unchanged');
  const manufacturer=planArchive([{...p,styleType:undefined}],{domestic:source},config,now);
  assert.equal(manufacturer.skipped[0].status,'existing-product','Existing manufacturer-code matching is preserved');
  const differentCode=planArchive([{...p,style:'MANUFACTURER-CODE',styleType:undefined}],{domestic:source},config,now);
  assert.equal(prepareRows(differentCode.ready,source,cfg)[0].values[11].userEnteredValue.stringValue,'MANUFACTURER-CODE');
});
test('CSV handles commas, quoted newlines and quotes without changing strings',()=>{
  assert.deepEqual(parseCsv('brand,name\r\n"PANE","A, B"\r\n"X","A\n""B"""'),[['brand','name'],['PANE','A, B'],['X','A\n"B"']]);
});
test('read-only China file cannot be written even if adapter is called directly',async()=>{
  const china=productionConfig.sheets.find(s=>s.key==='outdoor_china');await assert.rejects(createGoogleAdapter('test').append(china,[]),/read-only/);
});
test('actual US/CA/TW market is preserved, unknown gender is left blank',()=>{
  for(const country of ['US','CA','TW']) {
    const p=product({country,gender:''}),entries=planArchive([p],{domestic:snapshot()},config,now).ready,rows=prepareRows(entries,snapshot(),cfg);
    assert.equal(entries[0].route.country,country);assert.equal(rows[0].values[14].userEnteredValue.stringValue,country);assert.equal(rows[0].values[2].userEnteredValue,undefined);
  }
});
test('remote backup or pending ledger persistence failure prevents every Sheet write',async()=>{
  for(const phase of ['audit','ledger']) {
    const adapter=memoryAdapter();
    await assert.rejects(executeArchive({products:[product()],config,adapter,now,apply:true,audit:async()=>{if(phase==='audit')throw new Error('remote backup failed');},saveLedger:async()=>{if(phase==='ledger')throw new Error('remote ledger failed');}}),/remote/);
    assert.equal(adapter.writes,0);
  }
});
test('crash after append but before receipt save does not duplicate after ledger reload',async()=>{
  const adapter=memoryAdapter(),ledger={entries:{}},durable={};let saves=0;
  await assert.rejects(executeArchive({products:[product()],config,adapter,ledger,now,apply:true,audit:async()=>{},saveLedger:async l=>{if(++saves>1)throw new Error('simulated runner failure');Object.assign(durable,structuredClone(l));}}),/simulated runner failure/);
  assert.equal(adapter.writes,1);assert.equal(Object.values(durable.entries)[0].state,'pending');
  const again=await executeArchive({products:[product()],config,adapter,ledger:durable,now,apply:true,audit:async()=>{},saveLedger:async()=>{}});
  assert.equal(adapter.writes,1);assert.equal(again.skipped[0].status,'already-archived');
});
test('formula-derived existing brand/product/country participates in routing and duplicate checks',()=>{
  const data=snapshot();for(const index of [1,5,14]){const value=data.rows[1][index].userEnteredValue.stringValue;data.rows[1][index].userEnteredValue={formulaValue:'=OTHER_CELL'};data.rows[1][index].effectiveValue={stringValue:value};}
  const p=product({name:'Original One',colorway:'White',image:'https://example.com/Original One.jpg'}),plan=planArchive([p],{domestic:data},config,now);
  assert.equal(plan.ready.length,0);assert.equal(plan.skipped[0].status,'existing-product');
});
test('read-only connection probe verifies file editor capability + exact tab and bounded native schema',async()=>{
  const calls=[],probeConfig={...config,sheets:[cfg,{...cfg,key:'china',id:'read-only',readOnly:true}]};
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method});assert.equal(options.method,'GET');assert.ok(!url.includes('read-only'));
    if(url.includes('/drive/v3/files/'))return new Response(JSON.stringify({id:cfg.id,mimeType:'application/vnd.google-apps.spreadsheet',capabilities:{canEdit:true}}));
    if(!url.includes('ranges='))return new Response(JSON.stringify({sheets:[snapshot().metadata]}));
    return new Response(JSON.stringify({sheets:[{data:[{rowData:snapshot().rows.map(values=>({values}))}]}]}));
  };
  const report=await verifyArchiveConnection(probeConfig,'dummy',{fetchImpl});assert.equal(report.status,'connection-verified');assert.equal(report.writes,0);assert.equal(calls.length,3);assert.equal(report.results[0].readRange,"'시트1'!A1:P3");
});
test('read-only connection probe rejects missing editor permission without mutation',async()=>{
  let calls=0;const report=await verifyArchiveConnection(config,'dummy',{fetchImpl:async()=>{calls++;return new Response(JSON.stringify({id:cfg.id,mimeType:'application/vnd.google-apps.spreadsheet',capabilities:{canEdit:false}}));}});
  assert.equal(report.status,'blocked-config');assert.equal(report.writes,0);assert.equal(calls,1);assert.match(report.results[0].reason,/editor capability/);
});
test('pending routing becomes action-required and CI summary contains safe reasons/IDs only',async()=>{
  const adapter=memoryAdapter(),report=await executeArchive({products:[product({country:''})],config,adapter,now,apply:true});
  assert.equal(report.status,'action-required');assert.equal(report.needsReview,true);assert.equal(adapter.writes,0);
  report.pending[0].privateSheetCell='DO_NOT_EXPOSE';
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'archive-summary-')),summary=path.join(directory,'summary.md'),output=path.join(directory,'output.txt');
  try {
    await writeRunSummary(report,{GITHUB_STEP_SUMMARY:summary,GITHUB_OUTPUT:output});
    const text=await fs.readFile(summary,'utf8'),values=await fs.readFile(output,'utf8');assert.match(text,/country-needs-review/);assert.match(text,/new-1/);assert.ok(!text.includes('DO_NOT_EXPOSE'));assert.match(values,/archive_attention=true/);assert.match(values,/archive_pending=1/);
  } finally {assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'archive-summary-'));await fs.rm(directory,{recursive:true});}
});
