import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {SITE_BRAND_GROUPS} from '../public/assets/site-brand-policy.mjs';
import {prepareCatalog} from '../public/assets/catalog-runtime.mjs';
import {selectAdminSources} from './admin-source-selection.mjs';
const read=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
const latest=values=>values.filter(v=>Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
const sourceFiles=[['data/sports-casual-new.json',null],['data/puma-korea-new.json','PUMA'],['data/asics-complete-new.json','ASICS'],['data/adidas-complete-new.json','adidas'],['data/newbalance-complete-new.json','New Balance'],['data/converse-complete-new.json','Converse'],['data/fila-china-new.json','FILA China'],['data/official-new-feeds.json',null],['data/columbia-new.json','COLUMBIA'],['data/dkon-new.json',null]];
export async function buildAdminSnapshot({now=new Date()}={}){
 const catalog=await read('public/data/catalog.json'),raw=await read('data/catalog-source.json',{products:[]}),sources=await read('config/daily_sources.json',{});
 const today=new Date(now.getTime()+9*3600000).toISOString().slice(0,10),prepared=prepareCatalog(catalog,null,null,today),coverage=[];
 for(const row of raw.collection?.coverage||[])coverage.push({...row,checkedAt:row.checkedAt||raw.collection.checkedAt});
 for(const [file,brand] of sourceFiles){const data=await read(file,null);if(!data)continue;
  const rows=Array.isArray(data.coverage)?data.coverage:data.coverage?[data.coverage]:[];
  for(const row of rows){const name=row.brand||brand;if(!name)continue;coverage.push({...row,brand:name,checkedAt:row.checkedAt||data.checkedAt,exhaustive:row.exhaustive===true||row.exhausted===true||Number.isInteger(row.total)&&row.total>0&&row.read===row.total,verified:row.verified??data.products?.filter(p=>p.brand===name).length??0,status:row.error?'unavailable':row.status||((row.exhaustive||row.exhausted||row.total>0&&row.read===row.total)?'checked':'partial'),errors:row.errors||(row.error?[{error:row.error}]:[])});}
  if(!rows.length&&brand&&data.checkedAt)coverage.push({brand,checkedAt:data.checkedAt,verified:data.products?.length||0,listingPages:data.pages?.length||0,exhaustive:false,status:data.errors?.length?'partial':'checked',errors:data.errors||[]});
 }
 const rows=SITE_BRAND_GROUPS.flatMap(group=>group.priority.map(brand=>{
  const products=prepared.products.filter(p=>p.brand===brand&&prepared.officialMatches.get(p.id)),checks=coverage.filter(c=>c.brand===brand),lastCheckAt=latest(checks.map(c=>c.checkedAt)),recent=checks.filter(c=>c.checkedAt===lastCheckAt);
  const errors=recent.flatMap(c=>c.errors||[]).map(e=>String(e.error||e.message||e).slice(0,240)).filter(Boolean);
  const sourceList=selectAdminSources(brand,sources[brand]);
  const age=lastCheckAt?(now-Date.parse(lastCheckAt))/86400000:null;
  const blocked=recent.length&&recent.every(c=>['unavailable','failed'].includes(c.status));
  const status=blocked?'blocked':age===null?'check-needed':age>7?'stale':errors.length||recent.some(c=>c.truncated||c.exhaustive!==true)?'partial':'checked';
  return {brand,group:group.name,officialModels:prepared.officialBrandCounts.get(brand)||0,officialRecords:products.length,lastCheckAt,lastVerifiedAt:latest(products.map(p=>p.lastVerifiedAt||p.officialProductEvidence?.verifiedAt)),status,exhaustive:recent.length>0&&recent.every(c=>c.exhaustive===true),collectedRecords:recent.length?recent.reduce((sum,c)=>sum+(Number(c.verified)||0),0):null,errors:[...new Set(errors)].slice(0,8),sources:sourceList.map(s=>({name:s.name||'공식 상품 목록',url:s.url})).slice(0,6)};
 }));
 const snapshot={schemaVersion:1,generatedAt:now.toISOString(),brands:rows};
 // One observation per KST day or changed data, not a fresh baseline on every deploy.
 snapshot.id=createHash('sha256').update(JSON.stringify({day:today,brands:rows})).digest('hex');return snapshot;
}
export async function syncAdminSnapshot(){
 const snapshot=await buildAdminSnapshot();await fs.mkdir('.secrets',{recursive:true});
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const schema=await fs.readFile('server/admin-schema.sql','utf8');
 const sql=schema+'\n'+`INSERT OR IGNORE INTO admin_snapshots (id,created_at,data) VALUES (${quote(snapshot.id)},${quote(snapshot.generatedAt)},${quote(JSON.stringify(snapshot))});\n`;
 const file='.secrets/admin-snapshot.sql';await fs.writeFile(file,sql,{mode:0o600});
 let run;for(let attempt=0;attempt<3;attempt++){
  run=spawnSync('npx',['wrangler','d1','execute','shoes-admin-monitor','--remote','--file',file],{stdio:'pipe',encoding:'utf8',shell:process.platform==='win32'});
  if(run.status===0)break;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
 }
 if(run.status!==0){await fs.writeFile('.secrets/admin-sync-error.log',(run.stderr||'')+'\n'+(run.stdout||''),{mode:0o600});throw Error('Administrator snapshot synchronization failed. Diagnostics: .secrets/admin-sync-error.log');}
 console.log(`Administrator monitoring snapshot: ${snapshot.brands.length} brands`);return snapshot;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.includes('--sync'))await syncAdminSnapshot();else{await fs.mkdir('reports',{recursive:true});const s=await buildAdminSnapshot();await fs.writeFile('reports/admin-monitor-snapshot.json',JSON.stringify(s,null,2));console.log('Administrator snapshot prepared for '+s.brands.length+' brands');}}
