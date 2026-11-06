import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {adminD1} from './admin-d1.mjs';
import {syncQueue,validateQueue} from './sync-visual-classification-queue.mjs';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export function validatePriority(batch){
 if(batch?.schemaVersion!==1||batch.id!=='priority-20261106-v1'||batch.targetCount!==96||batch.images?.length!==96)throw Error('Invalid priority batch');
 const hashes=new Set(),models=new Set();
 for(const r of batch.images){if(!/^[a-f0-9]{64}$/.test(r.imageHash)||hashes.has(r.imageHash)||!r.modelKey||models.has(r.modelKey)||!['train','calibration','test'].includes(r.role)||typeof r.reason!=='string'||r.reason.length>500)throw Error('Priority batch must contain unique photos and designs');hashes.add(r.imageHash);models.add(r.modelKey);}
 if(['train','calibration','test'].some(role=>batch.images.filter(r=>r.role===role).length!==32))throw Error('Expected frozen 32/32/32 roles');
 return batch;
}
export async function seedPriority({db=adminD1()}={}){
 const batch=validatePriority(JSON.parse(await fs.readFile('.secrets/clip/priority-review.json','utf8')));
 const original=validateQueue(JSON.parse(await fs.readFile('.secrets/clip/admin-queue.json','utf8'))),priority=validateQueue(JSON.parse(await fs.readFile('.secrets/clip/priority-queue.json','utf8')));
 if(original.model.version!==priority.model.version||batch.modelVersion!==priority.model.version)throw Error('Priority model version mismatch');
 const records=new Map(original.records.map(r=>[r.imageHash,r]));for(const r of priority.records)records.set(r.imageHash,r);
 if(batch.images.some(r=>!records.has(r.imageHash)))throw Error('Priority photos unresolved');
 const merged={...original,generatedAt:new Date().toISOString(),records:[...records.values()]};
 await fs.writeFile('.secrets/clip/priority-merged-queue.json',JSON.stringify(merged));
 const result=await syncQueue('.secrets/clip/priority-merged-queue.json',{db});
 const data={id:batch.id,title:batch.title,targetCount:96,selectionVersion:batch.selectionVersion,modelVersion:batch.modelVersion,reasons:Object.fromEntries(batch.images.map(r=>[r.imageHash,r.reason]))};
 const existing=await db.prepare('SELECT data FROM visual_review_batches WHERE id=?').bind(batch.id).first();
 if(existing&&JSON.stringify(JSON.parse(existing.data))!==JSON.stringify(data))throw Error('Existing batch is immutable; use a new version for a new selection');
 let sql=`INSERT OR IGNORE INTO visual_review_batches(id,data,created_at) VALUES(${literal(batch.id)},${literal(JSON.stringify(data))},${literal(new Date().toISOString())});\n`;
 for(const [position,row] of batch.images.entries())sql+=`INSERT OR IGNORE INTO visual_review_batch_members(batch_id,image_hash,role,position) VALUES(${literal(batch.id)},${literal(row.imageHash)},${literal(row.role)},${position});\n`;
 await db.execute(sql);
 // Keep the canonical operational queue inclusive of the priority photos.
 await fs.writeFile('.secrets/clip/admin-queue.json',JSON.stringify(merged));
 return {...result,batchId:batch.id,priorityPhotos:96};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await seedPriority()));
