import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {decodeCatalog} from '../public/assets/catalog-wire.mjs';
const hashedPhoto=/^images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/;
const operatorReport=/^data\/lux-[^/]*(?:report|summary|reconciliation)\.json$/;
async function files(directory,prefix=''){
 const out=[];for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  if(entry.isSymbolicLink())throw Error('Deployment assets must be regular files: '+entry.name);
  const relative=prefix+entry.name;
  if(entry.isDirectory())out.push(...await files(path.join(directory,entry.name),relative+'/'));
  else out.push(relative);
 }return out;
}
export async function prepareDeploymentAssets(publicDirectory){
 const source=path.resolve(publicDirectory),all=await files(source),available=new Set(all),referenced=new Set();
 for(const relative of all){
  if(/(?:catalog-source|curation-review|curation-summary|archive-queue)\.json$/.test(relative))throw Error('Private collection data in deployment: '+relative);
  if(operatorReport.test(relative))continue;
  if(!/\.(?:json|html|css|m?js|svg)$/.test(relative))continue;
  const text=await fs.readFile(path.join(source,relative),'utf8');
  for(const match of text.matchAll(/\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)/g))referenced.add(match[0].slice(1));
 }
 const selected=all.filter(relative=>!operatorReport.test(relative)&&(!hashedPhoto.test(relative)||referenced.has(relative)));
 for(const relative of referenced)if(!available.has(relative))throw Error('Referenced deployment photo missing: '+relative);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-internal-assets-'));
 const hasWire=available.has('data/catalog-ui.json');
 if(hasWire)assert.deepEqual(decodeCatalog(JSON.parse(await fs.readFile(path.join(source,'data/catalog-ui.json'),'utf8'))),JSON.parse(await fs.readFile(path.join(source,'data/catalog.json'),'utf8')),'Wire deployment must retain the full local catalogue');
 // Assets are immutable during an upload. Same-volume hard links avoid copying
 // the full photo library into temporary staging on a nearly-full collector PC.
 let next=0;await Promise.all(Array.from({length:8},async()=>{while(next<selected.length){const relative=selected[next++];const destination=path.join(directory,relative),input=path.join(source,hasWire&&relative==='data/catalog.json'?'data/catalog-ui.json':relative);await fs.mkdir(path.dirname(destination),{recursive:true});if((await fs.stat(input)).size>25*1024*1024)throw Error('Deployment asset exceeds 25 MiB: '+relative);try{await fs.link(input,destination);}catch(error){if(!['EXDEV','EPERM','ENOTSUP'].includes(error.code))throw error;await fs.copyFile(input,destination);}}}));
 const hashes={};for(const relative of selected.filter(r=>/^(?:data\/.*\.json|deployment\.json)$/.test(r)))hashes[relative]=createHash('sha256').update(await fs.readFile(path.join(directory,relative))).digest('hex');
 return {directory,manifest:{files:selected.length,wireCatalog:hasWire,referencedPhotos:referenced.size,unusedPhotosOmitted:all.filter(p=>hashedPhoto.test(p)&&!referenced.has(p)).length,operatorReportsOmitted:all.filter(p=>operatorReport.test(p)).length,catwalkFiles:selected.filter(p=>p.startsWith('catwalk/')).length,hashes}};
}
export async function removeDeploymentAssets(directory){
 const absolute=path.resolve(directory),parent=path.resolve(os.tmpdir());
 if(path.dirname(absolute)!==parent||!path.basename(absolute).startsWith('shoes-internal-assets-'))throw Error('Unexpected temporary deployment directory');
 await fs.rm(absolute,{recursive:true,force:true});
}
