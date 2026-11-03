import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildCatalogChunks} from '../scripts/build-catalog-chunks.mjs';
import {decodeCatalog} from '../public/assets/catalog-wire.mjs';
test('brand partitioning retains metadata, variants, evidence and interleaved brands without a partial catalogue overwrite',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-chunks-'));
 try{
  const snapshot={schemaVersion:1,brands:[{name:'Dior'},{name:'Prada'}],keywords:[{label:'White',productIds:['a','c']}],products:[{id:'a',brand:'Dior',style:'1',proof:{source:'official',verified:true}},{id:'b',brand:'Prada',style:'2'},{id:'c',brand:'Dior',style:'3',colorway:'White'}],sourceStatus:{checkedAt:'2026-11-03'}};
  const m=await buildCatalogChunks(snapshot,dir),base=decodeCatalog(m.base);
  assert.deepEqual({...base,products:snapshot.products},snapshot);assert.equal(m.total,3);
  const recovered=(await Promise.all(m.chunks.map(async c=>decodeCatalog(JSON.parse(await fs.readFile(path.join(dir,c.url.replace('./data/','')),'utf8'))).products))).flat().sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(recovered,snapshot.products);assert.equal(m.chunks[0].count,2);
  const old=m.chunks[0].url.replace('./data/','');await buildCatalogChunks({...snapshot,products:snapshot.products.filter(p=>p.id!=='a')},dir);
  await assert.rejects(fs.access(path.join(dir,old)));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
