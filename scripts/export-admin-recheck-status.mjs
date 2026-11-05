import fs from 'node:fs/promises';import{adminD1}from'./admin-d1.mjs';
const request=JSON.parse(await fs.readFile('reports/admin-bulk-recheck-request.json','utf8'));
if(request.followup)try{await fs.copyFile('reports/admin-recheck-live-status.json','reports/admin-first-status.json',fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
const rows=(await adminD1().prepare('SELECT j.brand,j.status,j.result,j.id,j.requested_at,j.started_at,j.finished_at FROM admin_batch_jobs b JOIN admin_jobs j ON j.id=b.job_id WHERE b.batch_id=?').bind(request.batchId).all()).results.map(r=>({...r,result:r.result?JSON.parse(r.result):null}));
await fs.writeFile('reports/admin-recheck-live-status.json',JSON.stringify(rows));
const counts=rows.reduce((a,r)=>{const status=r.status==='completed'?r.result?.status||'completed':r.status;a[status]=(a[status]||0)+1;return a;},{});console.log(JSON.stringify({targets:request.targets.length,counts}));
