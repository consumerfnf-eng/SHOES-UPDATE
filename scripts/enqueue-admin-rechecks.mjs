import fs from 'node:fs/promises';
import {adminD1} from './admin-d1.mjs';
import {monitoringSnapshot,bulkRecheckPlan} from '../server/admin-monitor.mjs';
const db=adminD1();await db.execute(await fs.readFile('server/admin-schema.sql','utf8'));
const status=await monitoringSnapshot(db),scope=process.argv.includes('--all')?'all':'attention',plan=bulkRecheckPlan(status.brands,scope);
const literal=value=>typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
if(plan.targets.length){const sql=plan.statements.map(s=>{let i=0;return s.sql.replace(/^INSERT INTO /,'INSERT OR IGNORE INTO ').replace(/\?/g,()=>literal(s.params[i++]))+';';}).join('\n');await db.execute(sql);}
const counts=plan.id?(await db.prepare('SELECT j.status,COUNT(*) AS count FROM admin_batch_jobs b JOIN admin_jobs j ON j.id=b.job_id WHERE b.batch_id = ? GROUP BY j.status').bind(plan.id).all()).results:[];
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/admin-bulk-recheck-request.json',JSON.stringify({batchId:plan.id,requestedAt:plan.at,scope,targets:plan.targets,counts},null,2));
console.log(JSON.stringify({batchId:plan.id,targets:plan.targets.length,counts}));
