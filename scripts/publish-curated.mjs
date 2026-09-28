import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {curateCatalog,canonicalBrand} from './curation.mjs';
import {mergePreserving} from './collect-evidence.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function readJson(file,fallback) {try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}}
export async function atomicJson(file,value) {file=file instanceof URL?fileURLToPath(file):file;await fs.mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;await fs.writeFile(tmp,JSON.stringify(value,null,2));await fs.rename(tmp,file);}
function compatibleEvidenceIdentity(product,evidence) {
  if(!evidence.brand||canonicalBrand(product.brand)!==canonicalBrand(evidence.brand))return false;
  if(product.style&&evidence.style&&product.style.toUpperCase()!==evidence.style.toUpperCase())return false;
  // A shared base SKU must not collapse explicitly selected color/variant URLs.
  try {
    const a=new URL(product.url),b=new URL(evidence.url);
    for(const field of ['swatch','color','colour','colorway','variant'])if(a.searchParams.has(field)&&b.searchParams.has(field)&&a.searchParams.get(field)!==b.searchParams.get(field))return false;
  }catch{}
  return true;
}
export function applyReviewedEvidence(input,evidence) {
  // Both stable-ID and exact-SKU joins require the same declared brand and compatible variant.
  let products=[...input];
  for(const e of evidence||[]) {
    const sameId=e.id&&products.find(p=>p.id===e.id);
    if(sameId&&!compatibleEvidenceIdentity(sameId,e))throw Error(`Conflicting reviewed product identity: ${e.id}`);
    const found=sameId||products.find(p=>e.style&&p.style?.toUpperCase()===e.style.toUpperCase()&&compatibleEvidenceIdentity(p,e));
    if(found) {
      const next={...e,id:found.id};
      // Reviewed bootstrap facts must never reset newer weekly verification or discard newly found signals.
      if((found.lastSignalCheckedAt||'')>(e.checkedAt||e.dateEvidence?.verifiedAt||''))delete next.sourceSignals;
      products=mergePreserving(products,[next]);
    }
    else if(!sameId&&e.id&&e.name&&e.brand) products=mergePreserving(products,[e]);
  }
  return products;
}
export async function publishCurated({directory=root,now=new Date(),incoming=[],collection,maintenance=false}={}) {
  const sourceFile=path.join(directory,'data/catalog-source.json'), prior=await readJson(path.join(directory,'public/data/catalog.json'),{});
  const source=await readJson(sourceFile), evidence=await readJson(path.join(directory,'data/release-evidence.json'),{products:[]});
  const products=applyReviewedEvidence(mergePreserving(source.products,incoming),evidence.products);
  const result=curateCatalog(products,{now,previous:prior,collection:collection||source.collection||{}});
  // Maintenance only removes expired entries / updates upcoming state and ages signals; it does not claim a new collection.
  if(maintenance&&prior.publishedAt) result.snapshot.publishedAt=prior.publishedAt;
  if(!Array.isArray(result.snapshot.products)||new Set(result.snapshot.products.map(p=>p.id)).size!==result.snapshot.products.length)throw Error('Invalid curated snapshot');
  if(!maintenance) {
    await fs.mkdir(path.join(directory,'logs/backups'),{recursive:true});
    await fs.copyFile(sourceFile,path.join(directory,'logs/backups/catalog-source-before.json'));
    await atomicJson(sourceFile,{...source,products,collection:collection||source.collection||{},lastCuratedAt:new Date(now).toISOString()});
  }
  await atomicJson(path.join(directory,'data/archive-queue.json'),result.queue);
  await atomicJson(path.join(directory,'data/curation-review.json'),result.review);
  // Public catalog is the last write: observers can only see a fully serialized snapshot.
  await atomicJson(path.join(directory,'public/data/catalog.json'),result.snapshot);
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)publishCurated({maintenance:process.argv.includes('--maintenance')}).then(r=>console.log(`Published ${r.snapshot.products.length}; held ${r.review.held.length}; archive queue ${r.queue.products.length}.`)).catch(e=>{console.error(e.message);process.exitCode=1;});
