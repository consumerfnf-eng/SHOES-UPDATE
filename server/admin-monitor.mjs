import {isSiteBrandAllowed} from '../public/assets/site-brand-policy.mjs';
export const needsRecheck=row=>row.status!=='checked'||row.officialModels===0||row.modelDelta<0;
export async function monitoringSnapshot(db,{now=Date.now()}={}){
 const snapshots=(await db.prepare('SELECT data, created_at FROM admin_snapshots ORDER BY created_at DESC LIMIT 2').all()).results;
 const current=snapshots[0]?JSON.parse(snapshots[0].data):{brands:[]},previous=snapshots[1]?JSON.parse(snapshots[1].data):null,old=new Map((previous?.brands||[]).map(row=>[row.brand,row]));
 const checks=new Map((await db.prepare('SELECT brand, checked_at, data FROM admin_checks').all()).results.map(c=>[c.brand,c]));
 const rows=current.brands.filter(row=>isSiteBrandAllowed(row.brand)).map(row=>{
  const check=checks.get(row.brand),report=check&&Date.parse(check.checked_at)>Date.parse(row.lastCheckAt||'1970-01-01')?JSON.parse(check.data):null;
  const failedStatus=report?.errors?.some(e=>/HTTP (?:401|403)|CAPTCHA|forbidden|access.denied/i.test(e))?'blocked':'check-needed';
  const latest=report?{...row,lastCheckAt:check.checked_at,exhaustive:report.exhaustive,errors:report.errors,status:report.status==='failed'?failedStatus:report.exhaustive&&!report.errors?.length?'checked':'partial'}:{...row};
  if(latest.lastCheckAt&&now-Date.parse(latest.lastCheckAt)>7*86400000&&latest.status!=='blocked')latest.status='stale';
  return {...latest,modelDelta:old.has(row.brand)?row.officialModels-old.get(row.brand).officialModels:null,recordDelta:old.has(row.brand)?row.officialRecords-old.get(row.brand).officialRecords:null};
 });
 return {...current,brands:rows,comparedAt:snapshots[1]?.created_at||null};
}
export function bulkRecheckPlan(rows,scope,{id=crypto.randomUUID(),at=new Date().toISOString()}={}){
 if(!['attention','all'].includes(scope))throw Error('Invalid recollection scope');
 const targets=[...new Set(rows.filter(row=>isSiteBrandAllowed(row.brand)&&(scope==='all'||needsRecheck(row))).map(row=>row.brand))];
 const encoded=JSON.stringify(targets);
 const statements=targets.length?[
  {sql:'INSERT INTO admin_batches (id, scope, created_at, target_count) VALUES (?, ?, ?, ?)',params:[id,scope,at,targets.length]},
  {sql:"INSERT OR IGNORE INTO admin_jobs (id, brand, status, requested_at) SELECT lower(hex(randomblob(16))), value, 'queued', ? FROM json_each(?)",params:[at,encoded]},
  {sql:"INSERT INTO admin_batch_jobs (batch_id, job_id, brand) SELECT ?, j.id, j.brand FROM admin_jobs j JOIN json_each(?) t ON t.value = j.brand WHERE j.status IN ('queued','running')",params:[id,encoded]}
 ]:[];
 return {id:targets.length?id:null,scope,at,targets,statements};
}
export async function enqueueBulkRecheck(db,rows,scope){
 const plan=bulkRecheckPlan(rows,scope);if(!plan.targets.length)return {ok:true,selected:0,queued:0,alreadyActive:0,batch:null};
 const results=await db.batch(plan.statements.map(s=>db.prepare(s.sql).bind(...s.params))),queued=results[1].meta.changes;
 return {ok:true,selected:plan.targets.length,queued,alreadyActive:plan.targets.length-queued,batch:{id:plan.id,scope,createdAt:plan.at}};
}
export async function recentBatch(db){
 const batch=await db.prepare('SELECT id, scope, created_at, target_count FROM admin_batches ORDER BY created_at DESC LIMIT 1').first();if(!batch)return null;
 const counts=(await db.prepare("SELECT CASE WHEN j.status = 'completed' THEN CASE WHEN json_extract(j.result,'$.status') = 'partial' THEN 'partial' ELSE 'completed' END ELSE j.status END AS status, COUNT(*) AS count FROM admin_batch_jobs b JOIN admin_jobs j ON j.id = b.job_id WHERE b.batch_id = ? GROUP BY 1").bind(batch.id).all()).results;
 return {...batch,counts:Object.fromEntries(counts.map(c=>[c.status,c.count]))};
}
