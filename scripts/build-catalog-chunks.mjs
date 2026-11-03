import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {encodeCatalog,decodeCatalog} from '../public/assets/catalog-wire.mjs';
export async function buildCatalogChunks(snapshot,directory){
 const folder=path.join(directory,'catalog-brands');await fs.mkdir(folder,{recursive:true});
 const groups=new Map();for(const p of snapshot.products){if(!groups.has(p.brand))groups.set(p.brand,[]);groups.get(p.brand).push(p);}
 const chunks=[];const recovered=[];
 const brandOrder=new Map((snapshot.brands||[]).map((b,i)=>[b.name,i]));
 for(const [brand,products] of [...groups].sort((a,b)=>(brandOrder.get(a[0])??999)-(brandOrder.get(b[0])??999))){const wire=encodeCatalog({schemaVersion:1,products});const bytes=JSON.stringify(wire)+'\n';const id=createHash('sha256').update(bytes).digest('hex').slice(0,24);const name=`catalog-brands/${id}.json`;await fs.writeFile(path.join(directory,name),bytes);chunks.push({brand,url:'./data/'+name,count:products.length,bytes:Buffer.byteLength(bytes)});recovered.push(...decodeCatalog(JSON.parse(bytes)).products);}
 assert.deepEqual([...recovered].sort((a,b)=>a.id.localeCompare(b.id)),[...snapshot.products].sort((a,b)=>a.id.localeCompare(b.id)),'Brand chunks preserve all products and fields');
 const manifest={schemaVersion:1,total:snapshot.products.length,base:encodeCatalog({...snapshot,products:[]}),chunks};
 await fs.writeFile(path.join(directory,'catalog-index.json'),JSON.stringify(manifest)+'\n');
 const retained=new Set(chunks.map(c=>path.basename(c.url)));
 for(const name of await fs.readdir(folder))if(/^[a-f0-9]{24}\.json$/.test(name)&&!retained.has(name))await fs.unlink(path.join(folder,name));
 return manifest;
}
