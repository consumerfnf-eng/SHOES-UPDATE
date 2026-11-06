import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {adminD1} from './admin-d1.mjs';
import {validateVisualCandidate,IMAGE_HASH,VISUAL_CATEGORY_IDS} from '../server/visual-classifications.mjs';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const bytes=value=>Buffer.byteLength(value,'utf8');
export function validateQueue(input){
 if(input?.schemaVersion!==1||!Array.isArray(input.records)||input.records.length>20000||typeof input.generatedAt!=='string'||!Number.isFinite(Date.parse(input.generatedAt)))throw Error('Invalid queue envelope');
 const m=input.model;
 if(!m||typeof m.version!=='string'||!m.version.length||m.version.length>200||/[\u0000-\u001f]/.test(m.version)||typeof m.sha256!=='string'||!IMAGE_HASH.test(m.sha256)||typeof m.encoder!=='string'||!m.encoder.length||m.encoder.length>200||/[\u0000-\u001f]/.test(m.encoder)||typeof m.validated!=='boolean'||!m.thresholds||typeof m.thresholds!=='object'||Array.isArray(m.thresholds))throw Error('Invalid model metadata');
 // Release gates have distinct bounds for probabilities and sample counts.
 function thresholds(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>9)throw Error('Invalid thresholds');
  return Object.fromEntries(Object.entries(value).map(([id,gate])=>{
   if(!VISUAL_CATEGORY_IDS.includes(id)||!gate||typeof gate!=='object'||Array.isArray(gate))throw Error('Invalid threshold category');
   const fields=Object.fromEntries(Object.entries(gate).map(([key,v])=>{
    if(['minConfidence','minMargin','calibrationPrecision','testPrecision'].includes(key)){
     if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)throw Error('Invalid threshold score');
    }else if(['calibrationN','testN'].includes(key)){
     if(!Number.isInteger(v)||v<0||v>100000)throw Error('Invalid threshold sample count');
    }else throw Error('Invalid threshold field');
    return [key,v];
   }));return [id,fields];
  }));
 }
 const model={version:m.version,sha256:m.sha256,encoder:m.encoder,validated:m.validated,thresholds:thresholds(m.thresholds)};
 if(bytes(JSON.stringify(model))>32768)throw Error('Model metadata too large');
 const seen=new Set(),records=input.records.map(row=>{const safe=validateVisualCandidate(row,m.version);if(seen.has(safe.imageHash))throw Error('Duplicate photo hash');seen.add(safe.imageHash);return safe;});
 return {schemaVersion:1,model,generatedAt:new Date(input.generatedAt).toISOString(),records};
}
export async function syncQueue(file,{db=adminD1(),dryRun=false}={}){
 if((await fs.stat(file)).size>128*1024*1024)throw Error('Queue file too large');
 const queue=validateQueue(JSON.parse(await fs.readFile(file,'utf8'))),at=new Date().toISOString(),chunks=[];
 const schema=await fs.readFile(new URL('../server/admin-schema.sql',import.meta.url),'utf8');
 // Append-only migration: existing credentials, sessions and monitoring tables stay intact.
 chunks.push(schema.slice(schema.indexOf('-- Physical photo hashes')));
 let batch='';
 for(const row of queue.records){
  const sql=`INSERT INTO visual_classification_candidates (image_hash,model_version,data,updated_at) VALUES (${literal(row.imageHash)},${literal(row.modelVersion)},${literal(JSON.stringify(row))},${literal(at)}) ON CONFLICT(image_hash) DO UPDATE SET model_version=excluded.model_version,data=excluded.data,updated_at=excluded.updated_at;\n`;
  if(bytes(batch)+bytes(sql)>900000){chunks.push(batch);batch='';}batch+=sql;
 }
 if(batch)chunks.push(batch);
 // Publish metadata only after every candidate batch succeeds. Never delete owner reviews.
 chunks.push(`DELETE FROM visual_classification_candidates WHERE updated_at<>${literal(at)};\nINSERT INTO visual_classification_metadata (id,data,updated_at) VALUES (1,${literal(JSON.stringify(queue.model))},${literal(at)}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`);
 if(chunks.some(sql=>bytes(sql)>1000000))throw Error('SQL batch exceeds 1MB');
 if(!dryRun)for(const sql of chunks)await db.execute(sql);
 return {records:queue.records.length,modelVersion:queue.model.version,batches:chunks.length,maxSqlBytes:Math.max(...chunks.map(bytes)),dryRun};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),dryRun=args.includes('--dry-run'),files=args.filter(a=>a!=='--dry-run');
 if(files.length>1||files.some(a=>a.startsWith('--')))throw Error('Usage: node scripts/sync-visual-classification-queue.mjs [queue.json] [--dry-run]');
 console.log(JSON.stringify(await syncQueue(files[0]||'.secrets/clip/admin-queue.json',{dryRun})));
}
