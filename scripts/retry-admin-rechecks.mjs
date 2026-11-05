import fs from 'node:fs/promises';
import {adminD1} from './admin-d1.mjs';
const request=JSON.parse(await fs.readFile('reports/admin-bulk-recheck-request.json','utf8'));
const requested=process.argv.slice(2);if(!requested.length)throw Error('Pass exact brands whose source fix has been verified');
if(requested.some(b=>!request.targets.includes(b)))throw Error('Retry must remain within the original batch');
const db=adminD1(),rows=(await db.prepare('SELECT b.brand, j.id, j.status FROM admin_batch_jobs b JOIN admin_jobs j ON j.id=b.job_id WHERE b.batch_id=?').bind(request.batchId).all()).results;
const targets=rows.filter(r=>requested.includes(r.brand)&&!['queued','running'].includes(r.status));
const quote=v=>"'"+String(v).replaceAll("'","''")+"'",at=new Date().toISOString();
if(targets.length){const encoded=quote(JSON.stringify(targets.map(r=>r.brand)));await db.execute(`INSERT OR IGNORE INTO admin_jobs (id,brand,status,requested_at) SELECT lower(hex(randomblob(16))),value,'queued',${quote(at)} FROM json_each(${encoded});
UPDATE admin_batch_jobs SET job_id=(SELECT id FROM admin_jobs j WHERE j.brand=admin_batch_jobs.brand AND j.status IN ('queued','running')) WHERE batch_id=${quote(request.batchId)} AND brand IN (SELECT value FROM json_each(${encoded}));`);}
const file='reports/admin-recheck-retries.json',prior=JSON.parse(await fs.readFile(file,'utf8').catch(()=>'[]'));prior.push({at,brands:targets.map(r=>r.brand),previousJobs:targets});await fs.writeFile(file,JSON.stringify(prior,null,2));console.log(JSON.stringify({retried:targets.length,brands:targets.map(r=>r.brand)}));
