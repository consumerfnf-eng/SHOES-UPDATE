import fs from 'node:fs/promises';import{createHash}from'node:crypto';import{execFileSync,spawn}from'node:child_process';import{setTimeout as sleep}from'node:timers/promises';
import{adminD1}from'./admin-d1.mjs';
const request=JSON.parse(await fs.readFile('reports/admin-bulk-recheck-request.json')),directory=process.env.ADMIN_AUDIT_OUTPUT_DIR||'reports/admin-recheck-followup-20261105',db=adminD1(),last=new Map();
const command=(file,args=[])=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file,...args],{stdio:'inherit',env:process.env});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(file+' exited '+code)));});
for(let round=0;round<20;round++){
 let rows;
 do{rows=(await db.prepare('SELECT b.brand,j.status,j.result FROM admin_batch_jobs b JOIN admin_jobs j ON j.id=b.job_id WHERE b.batch_id=?').bind(request.batchId).all()).results;if(rows.some(r=>['queued','running'].includes(r.status)))await sleep(15000);}while(rows.some(r=>['queued','running'].includes(r.status)));
 const resume=[];
 for(const row of rows){const result=JSON.parse(row.result||'{}');if(!['partial','failed'].includes(result.status))continue;const file=directory+'/state/'+createHash('sha256').update(row.brand).digest('hex')+'.json';const s=JSON.parse(await fs.readFile(file).catch(()=>'null'));if(!s)continue;
  const c=s.checkpoint,pending=[...(s.listingPending||[]),...(s.pending||[]),...(c?.pendingIds||[]),...(c?.pendingProducts||[]),...(c?.pendingListings||[])];if(!pending.length)continue;
  const fingerprint=createHash('sha256').update(JSON.stringify({pending:pending.map(p=>typeof p==='string'?p:p.url||p.candidate?.url||p.source?.url||p.id).sort(),receipts:[...new Set((s.listingReceipts||[]).map(r=>r.url))].sort(),completed:c?.completedIds?.slice().sort(),products:[...new Set((s.products||c?.products||[]).map(p=>p.id))].sort()})).digest('hex');if(last.get(row.brand)===fingerprint)continue;last.set(row.brand,fingerprint);resume.push(row.brand);
 }
 if(!resume.length){console.log('No advancing continuation remains.');break;}
 console.log(JSON.stringify({round:round+1,resuming:resume}));
 await command('scripts/retry-admin-rechecks.mjs',resume);await command('scripts/drain-admin-queue.mjs');
}
execFileSync(process.execPath,['scripts/export-admin-recheck-status.mjs'],{stdio:'inherit'});
