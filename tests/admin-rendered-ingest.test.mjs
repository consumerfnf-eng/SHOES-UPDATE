import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ingestRenderedSources,normalizeRenderedCapture,normalizeRenderedUrl,isOfficialRenderedTarget} from '../scripts/ingest-admin-rendered.mjs';

const exec=promisify(execFile),script=fileURLToPath(new URL('../scripts/ingest-admin-rendered.mjs',import.meta.url));
const fixedNow=new Date('2026-11-05T12:00:00.000Z'),at='2026-11-05T11:00:00.000Z';
const source='https://www.prada.com/us/en/new-in';
const hash=s=>createHash('sha256').update(s).digest('hex');
const receiptPath=url=>'logs/admin-rendered/'+hash(url)+'.json.gz';
function capture(url=source,overrides={}){
  return {brand:'Prada',requestedUrl:url,checkedAt:at,rawHtml:'<!doctype html><html><script type="application/json">{"products":[1]}</script><h1>New In</h1></html>',
    metadata:{sourceURL:url,url,statusCode:200},...overrides};
}
async function temporary(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-ingest-'));
  await fs.mkdir(path.join(root,'logs'),{recursive:true});
  t.after(async()=>{
    const relative=path.relative(os.tmpdir(),root);
    assert(!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(root).startsWith('shoes-ingest-'),'cleanup stays within the explicitly created temporary directory');
    await fs.rm(root,{recursive:true,force:true});
  });
  return root;
}
async function input(root,name,row){await fs.writeFile(path.join(root,'logs',name),JSON.stringify(row));return name;}
async function stored(root,url){return JSON.parse(gunzipSync(await fs.readFile(path.join(root,receiptPath(url)))).toString('utf8'));}
const cli=(root,names)=>exec(process.execPath,[script,...names],{cwd:root,windowsHide:true,timeout:30000,maxBuffer:300000});

test('rawHtml-only captures normalize html without losing any raw bytes or changing observed provenance',()=>{
  const row=capture(),metadata=structuredClone(row.metadata),result=normalizeRenderedCapture(row,{now:fixedNow});
  assert.equal(result.url,source);assert.equal(result.row.html,row.rawHtml);assert.equal(result.row.rawHtml,row.rawHtml);
  assert.deepEqual(result.row.metadata,metadata);assert.equal(result.row.checkedAt,at);assert.equal(row.html,undefined);
  const both=capture(source,{html:'<main>Processed content omitted scripts</main>'});
  const normalized=normalizeRenderedCapture(both,{now:fixedNow}).row;
  assert.equal(normalized.html,both.rawHtml);assert.equal(normalized.rawHtml,both.rawHtml);
  const old=capture(source,{rawHtml:undefined,html:'<h1>Old html-only capture</h1>'});
  assert.equal(normalizeRenderedCapture(old,{now:fixedNow}).row.html,old.html);
});

test('literal adidas pipes and percent-encoded equivalents validate without rewriting metadata',()=>{
  const target='https://www.adidas.com/us/men|women-new_arrivals?audience=men|women&filter=size%3A10';
  const observed=target.replaceAll('|','%7C'),row=capture(target,{brand:'adidas',url:observed,metadata:{sourceURL:observed,url:observed.replaceAll('%7C','%7c'),statusCode:200}});
  assert.equal(normalizeRenderedUrl(target),normalizeRenderedUrl(observed));
  const result=normalizeRenderedCapture(row,{now:fixedNow});
  assert.equal(result.url,target);assert.equal(result.row.requestedUrl,target);assert.deepEqual(result.row.metadata,row.metadata);
  for(const wrong of [observed.replace('women-new_arrivals','women-shoes'),observed.replace('size%3A10','size%3A11'),observed.replace('&filter=size%3A10','')]){
    assert.throws(()=>normalizeRenderedCapture({...row,metadata:{...row.metadata,url:wrong}},{now:fixedNow}),/PROVENANCE_URL_MISMATCH/);
  }
});

test('bare/www aliases and encoded pipes can coexist without relaxing category or subdomain scope',()=>{
  const target='https://www.adidas.com/us/men|women-new_arrivals?filter=color%3Ared';
  const observed='https://adidas.com/us/men%7Cwomen-new_arrivals?filter=color%3Ared';
  const row=capture(target,{brand:'adidas',metadata:{sourceURL:observed,url:observed,statusCode:200}});
  assert.equal(normalizeRenderedUrl(target),normalizeRenderedUrl(observed));
  assert.deepEqual(normalizeRenderedCapture(row,{now:fixedNow}).row.metadata,row.metadata);
  for(const wrong of [observed.replace('adidas.com','shop.adidas.com'),observed.replace('new_arrivals','shoes'),observed.replace('red','blue')]){
    assert.throws(()=>normalizeRenderedCapture({...row,metadata:{...row.metadata,url:wrong}},{now:fixedNow}),/PROVENANCE_URL_MISMATCH/);
  }
});

test('brandless Cucinelli and Lanvin captures use the configured site-brand allowlist, not the older curation policy',()=>{
  for(const target of [
    'https://shop.brunellocucinelli.com/en-ae/men/shoes/sneakers/?start=21&sz=42',
    'https://www.lanvin.com/en-us/woman/shoes/sneakers/?page=2',
  ]){
    const row=capture(target);delete row.brand;
    const normalized=normalizeRenderedCapture(row,{now:fixedNow});
    assert.equal(normalized.url,target);assert.equal(normalized.row.brand,undefined);
    assert.deepEqual(normalized.row.metadata,row.metadata);
    assert.equal(normalized.row.rawHtml,row.rawHtml);
    const wrong={...row,metadata:{...row.metadata,url:target.replace('/shoes/','/bags/')}};
    assert.throws(()=>normalizeRenderedCapture(wrong,{now:fixedNow}),/PROVENANCE_URL_MISMATCH/);
  }
  const unknown=capture('https://unconfigured.example/sneakers');delete unknown.brand;
  assert.throws(()=>normalizeRenderedCapture(unknown,{now:fixedNow}),/TARGET_NOT_OFFICIAL/);
});

test('URL normalization preserves scope and encoded separators while equating harmless representations',()=>{
  assert.equal(normalizeRenderedUrl(source+'/?utm_source=x&ref=y#grid'),normalizeRenderedUrl(source));
  assert.equal(normalizeRenderedUrl(source+'?term=men%20women'),normalizeRenderedUrl(source+'?term=men+women'));
  assert.notEqual(normalizeRenderedUrl(source+'?cgid=men'),normalizeRenderedUrl(source+'?cgid=women'));
  assert.notEqual(normalizeRenderedUrl(source+'?filter.color=red'),normalizeRenderedUrl(source));
  assert.notEqual(normalizeRenderedUrl(source+'?variant=red'),normalizeRenderedUrl(source+'?variant=blue'));
  assert.notEqual(normalizeRenderedUrl(source+'/men%2Fwomen'),normalizeRenderedUrl(source+'/men/women'));
  assert.notEqual(normalizeRenderedUrl(source+'?x=a%26b'),normalizeRenderedUrl(source+'?x=a&b='));
});

test('all supplied source, requested and final URL observations must match the official target',()=>{
  const wrong=source+'?page=2';
  const cases=[
    {...capture(),url:wrong},
    {...capture(),sourceURL:wrong},
    {...capture(),finalURL:wrong},
    capture(source,{metadata:{sourceURL:wrong,url:source,statusCode:200}}),
    capture(source,{metadata:{sourceURL:source,url:wrong,statusCode:200}}),
    capture(source,{metadata:{sourceURL:source,url:source,requestedUrl:wrong,statusCode:200}}),
    capture(source,{metadata:{sourceURL:source,url:source,finalURL:wrong,statusCode:200}}),
    capture(source,{metadata:{sourceURL:source,statusCode:200}}),
    capture(source,{metadata:{url:source,statusCode:200}}),
    capture('https://www.prada.com.evil.example/us/en/new-in'),
    capture('https://www.adidas.com/us/new',{brand:'Prada'}),
    capture('https://account:secret@www.prada.com/us/en/new-in'),
  ];
  for(const row of cases)assert.throws(()=>normalizeRenderedCapture(row,{now:fixedNow}),/PROVENANCE|NOT_OFFICIAL/);
  const legacy=capture();delete legacy.requestedUrl;delete legacy.brand;
  assert.equal(normalizeRenderedCapture(legacy,{now:fixedNow}).url,source,'official host inference supports legacy captures without a brand label');
});

test('403, render errors, missing bodies, invalid times, stale times and future times are rejected',()=>{
  for(const statusCode of [403,404,429,500,'200'])assert.throws(()=>normalizeRenderedCapture(capture(source,{metadata:{sourceURL:source,url:source,statusCode}}),{now:fixedNow}),/NOT_SUCCESSFUL/);
  assert.throws(()=>normalizeRenderedCapture(capture(source,{metadata:{sourceURL:source,url:source,statusCode:200,error:'render failed'}}),{now:fixedNow}),/NOT_SUCCESSFUL/);
  for(const checkedAt of ['',undefined,'nonsense','2026-11-05','2026-02-30T11:00:00Z','2026-11-04T24:00:00Z','2026-11-03T11:00:00Z','2026-11-05T12:00:00.001Z']){
    assert.throws(()=>normalizeRenderedCapture(capture(source,{checkedAt}),{now:fixedNow}),/CHECKED_AT_INVALID_OLD_OR_FUTURE/);
  }
  for(const rawHtml of ['',null,17,'   '])assert.throws(()=>normalizeRenderedCapture(capture(source,{rawHtml}),{now:fixedNow}),/HTML_MISSING/);
});

test('temporary-directory ingestion saves full raw HTML, rebuilds the index and retains rejected files',async t=>{
  const root=await temporary(t),good=capture(),name=await input(root,'admin-rendered-raw-only.json',good);
  const bad=capture(source+'?bad=1',{metadata:{sourceURL:source+'?bad=1',url:'https://example.com/forged',statusCode:200}});
  const invalid=await input(root,'admin-rendered-wrong-url.json',bad);
  const denied=await input(root,'admin-rendered-forbidden.json',capture(source+'?bad=2',{metadata:{sourceURL:source+'?bad=2',url:source+'?bad=2',statusCode:403}}));
  const result=await ingestRenderedSources({root,inputs:[name,invalid,denied],now:fixedNow});
  assert.equal(result.ingested,1);assert.equal(result.rejected.length,2);assert.deepEqual(Object.keys(result.index),[source]);
  const saved=await stored(root,source);assert.equal(saved.rawHtml,good.rawHtml);assert.equal(saved.html,good.rawHtml);assert.deepEqual(saved.metadata,good.metadata);
  await assert.rejects(fs.access(path.join(root,'logs',name)),/ENOENT/);
  await fs.access(path.join(root,'logs',invalid));await fs.access(path.join(root,'logs',denied));
  await assert.rejects(fs.access(path.join(root,'reports/admin-rendered-index.lock')),/ENOENT/);
});

test('parallel CLI ingests recover lost entries from receipts and never lose another worker’s index updates',async t=>{
  const root=await temporary(t),stamp=new Date(Date.now()-60000).toISOString(),directory=path.join(root,'logs/admin-rendered');
  await fs.mkdir(directory,{recursive:true});await fs.mkdir(path.join(root,'reports'),{recursive:true});
  const recovered=source+'?recovered=1',old=capture(recovered,{checkedAt:stamp});
  await fs.writeFile(path.join(root,receiptPath(recovered)),gzipSync(JSON.stringify(old)));
  await fs.writeFile(path.join(root,'reports/admin-rendered-index.json'),'broken old index');
  await fs.writeFile(path.join(directory,'f'.repeat(64)+'.json.gz'),'broken gzip');
  const rejected=source+'?receipt403=1',bad=capture(rejected,{checkedAt:stamp,metadata:{sourceURL:rejected,url:rejected,statusCode:403}});
  await fs.writeFile(path.join(root,receiptPath(rejected)),gzipSync(JSON.stringify(bad)));
  const urls=Array.from({length:4},(_,i)=>source+'?worker='+i),names=[];
  for(let i=0;i<urls.length;i++)names.push(await input(root,`admin-rendered-worker-${i}.json`,capture(urls[i],{checkedAt:stamp})));
  const workers=await Promise.all(names.map(name=>cli(root,[name])));
  assert(workers.every(r=>r.stdout.includes('Live rendered sources cached:')));
  const index=JSON.parse(await fs.readFile(path.join(root,'reports/admin-rendered-index.json'),'utf8'));
  assert.deepEqual(Object.keys(index).sort(),[recovered,...urls].sort());
  for(const url of [recovered,...urls]){
    const row=await stored(root,url);assert.equal(row.rawHtml,old.rawHtml);assert.equal(row.requestedUrl,url);
    assert.equal(index[url].path,receiptPath(url));
  }
  const files=await fs.readdir(directory);assert(!files.some(file=>file.endsWith('.part')));
  await assert.rejects(fs.access(path.join(root,'reports/admin-rendered-index.json.part')),/ENOENT/);
  await assert.rejects(fs.access(path.join(root,'reports/admin-rendered-index.lock')),/ENOENT/);
});

test('concurrent captures of one URL retain the newest complete envelope regardless of arrival order',async t=>{
  const root=await temporary(t),older=capture(source,{checkedAt:new Date(Date.now()-120000).toISOString(),rawHtml:'<html>Older whole capture</html>'});
  const newer=capture(source,{checkedAt:new Date(Date.now()-60000).toISOString(),rawHtml:'<html>Newer whole capture</html>'});
  const names=[await input(root,'admin-rendered-newer.json',newer),await input(root,'admin-rendered-older.json',older)];
  await Promise.all(names.map(name=>cli(root,[name])));
  const saved=await stored(root,source);assert.equal(saved.checkedAt,newer.checkedAt);assert.equal(saved.html,newer.rawHtml);assert.equal(saved.rawHtml,newer.rawHtml);
  const final=await input(root,'admin-rendered-older-again.json',older);
  const result=await ingestRenderedSources({root,inputs:[final]});assert.equal(result.retainedNewer.length,1);assert.equal((await stored(root,source)).checkedAt,newer.checkedAt);
});

test('lock is released on unexpected input failure, and a busy lock leaves receipts and index untouched',async t=>{
  const root=await temporary(t);
  await assert.rejects(ingestRenderedSources({root,inputs:['bad-name.json'],now:fixedNow}),/Unexpected rendered source file/);
  await assert.rejects(fs.access(path.join(root,'reports/admin-rendered-index.lock')),/ENOENT/);
  const lock=path.join(root,'reports/admin-rendered-index.lock');await fs.mkdir(lock);
  await assert.rejects(ingestRenderedSources({root,inputs:[],lockAttempts:1,lockDelayMs:1}),/index is busy/);
  await fs.access(lock);assert.deepEqual(await fs.readdir(path.join(root,'logs/admin-rendered')),[]);
});

test('recovery skips forged provenance and mismatched receipt filenames while recovering valid receipts',async t=>{
  const root=await temporary(t),directory=path.join(root,'logs/admin-rendered');await fs.mkdir(directory,{recursive:true});
  const wrong=capture(source,{metadata:{sourceURL:source,url:source+'?wrong=1',statusCode:200}});
  await fs.writeFile(path.join(root,receiptPath(source)),gzipSync(JSON.stringify(wrong)));
  const goodUrl=source+'?valid=1',good=capture(goodUrl);await fs.writeFile(path.join(root,receiptPath(goodUrl)),gzipSync(JSON.stringify(good)));
  await fs.writeFile(path.join(directory,'a'.repeat(64)+'.json.gz'),gzipSync(JSON.stringify(good)));
  const result=await ingestRenderedSources({root,now:fixedNow});assert.deepEqual(Object.keys(result.index),[goodUrl]);assert.equal(result.recoverySkipped.length,2);
});

test('reconstruction restores brandless official Cucinelli and Lanvin receipts missing from a stale index',async t=>{
  const root=await temporary(t);await fs.mkdir(path.join(root,'logs/admin-rendered'),{recursive:true});await fs.mkdir(path.join(root,'reports'),{recursive:true});
  const targets=['https://shop.brunellocucinelli.com/en-ae/men/shoes/sneakers/','https://www.lanvin.com/en-us/man/shoes/sneakers/'];
  for(const target of targets){
    const row=capture(target);delete row.brand;
    await fs.writeFile(path.join(root,receiptPath(target)),gzipSync(JSON.stringify(row)));
  }
  await fs.writeFile(path.join(root,'reports/admin-rendered-index.json'),'{}');
  const result=await ingestRenderedSources({root,now:fixedNow});
  assert.deepEqual(Object.keys(result.index).sort(),targets.sort());assert.deepEqual(result.recoverySkipped,[]);
  for(const target of targets){const row=await stored(root,target);assert.equal(row.brand,undefined);assert.equal(row.rawHtml,capture(target).rawHtml);}
});

test('Toga shared merchant requires both permitted sub-brands and their exact official target ownership',()=>{
  const target='https://int.toga.jp/products.json?limit=250&page=1',allowed=['Toga Pulla','Toga Virilis'];
  assert.equal(isOfficialRenderedTarget('Toga',target,allowed),true);
  assert.equal(isOfficialRenderedTarget('Toga',target,['Toga Pulla']),false);
  assert.equal(isOfficialRenderedTarget('Toga',target,['Toga Virilis']),false);
  assert.equal(isOfficialRenderedTarget('Toga','https://int.toga.jp.evil.example/products.json',allowed),false);
  assert.equal(isOfficialRenderedTarget('Toga',source,allowed),false,'the source-owner alias does not grant access to other official brands');
  const row=capture(target,{brand:'Toga',rawHtml:'{"products":[{"id":123}]}'}),result=normalizeRenderedCapture(row,{now:fixedNow});
  assert.equal(result.url,target);assert.equal(result.row.brand,'Toga');assert.equal(result.row.requestedUrl,target);
  assert.equal(result.row.rawHtml,row.rawHtml);assert.equal(result.row.html,row.rawHtml);assert.deepEqual(result.row.metadata,row.metadata);
  assert.throws(()=>normalizeRenderedCapture({...row,metadata:{...row.metadata,url:target.replace('page=1','page=2')}},{now:fixedNow}),/PROVENANCE_URL_MISMATCH/);
  assert.throws(()=>normalizeRenderedCapture({...row,metadata:{...row.metadata,url:'https://veritas-hub.cafe24.com/challenge'}},{now:fixedNow}),/PROVENANCE_URL_MISMATCH/);
});

test('index recovery restores all six Toga merchant receipts and continues rejecting challenge redirects',async t=>{
  const root=await temporary(t);await fs.mkdir(path.join(root,'logs/admin-rendered'),{recursive:true});
  const targets=Array.from({length:6},(_,i)=>`https://int.toga.jp/products.json?limit=250&page=${i+1}`);
  const originals=new Map();
  for(const target of targets){
    const row=capture(target,{brand:'Toga',rawHtml:'{"products":[{"source":"'+target+'"}]}'}),raw=gzipSync(JSON.stringify(row));
    originals.set(target,raw);await fs.writeFile(path.join(root,receiptPath(target)),raw);
  }
  const redirects=[
    ['Rockfish Weatherwear','https://en.rockfish-weatherwear.co.kr/category/new/230/'],
    ['spyder','https://www.spyder.co.kr/'],
  ];
  for(const [brand,target] of redirects){
    const row=capture(target,{brand,metadata:{sourceURL:target,url:'https://veritas-hub.cafe24.com/challenge',statusCode:200}});
    await fs.writeFile(path.join(root,receiptPath(target)),gzipSync(JSON.stringify(row)));
  }
  const result=await ingestRenderedSources({root,now:fixedNow});
  assert.deepEqual(Object.keys(result.index).sort(),targets.sort());assert.equal(result.recoverySkipped.length,2);
  assert(result.recoverySkipped.every(r=>r.error==='RENDERED_PROVENANCE_URL_MISMATCH'));
  for(const target of targets){
    assert.deepEqual(await fs.readFile(path.join(root,receiptPath(target))),originals.get(target),'reconstruction preserves each complete original receipt byte-for-byte');
    assert.equal((await stored(root,target)).brand,'Toga');
  }
});
