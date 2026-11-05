import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareDeploymentAssets,removeDeploymentAssets} from '../scripts/deployment-assets.mjs';
import {encodeCatalog,decodeCatalog} from '../public/assets/catalog-wire.mjs';
import {buildCatalogChunks} from '../scripts/build-catalog-chunks.mjs';

async function fixture(run){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-staging-test-'));
 try{await run(directory);}finally{
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
  assert(path.basename(directory).startsWith('shoes-staging-test-'));
  await fs.rm(directory,{recursive:true,force:true});
 }
}
test('deployment keeps referenced originals, card renditions and all premium files, with lossless catalogue aliases',()=>fixture(async directory=>{
 const original='a'.repeat(64)+'.jpg',thumb='b'.repeat(64)+'.webp',unused='c'.repeat(64)+'.jpg';
 for(const folder of ['data','images','catwalk'])await fs.mkdir(path.join(directory,folder));
 const catalog={products:[{id:'shoe',brand:'A',image:'https://example.org/shoe.jpg',presentation:{cachedPath:'/images/'+original,thumbnail:{path:'/images/'+thumb,width:800,height:400}}}],sourceStatus:{counts:{published:1}}};
 await fs.writeFile(path.join(directory,'data/catalog.json'),JSON.stringify(catalog));
 await fs.writeFile(path.join(directory,'data/catalog-ui.json'),JSON.stringify(encodeCatalog(catalog)));
 await fs.writeFile(path.join(directory,'data/catwalk.json'),JSON.stringify({looks:[{image:'/catwalk/look.webp'}]}));
 await fs.writeFile(path.join(directory,'data/lux-verification-summary.json'),JSON.stringify({held:3044,zeroBrands:['Zero']}));
 for(const file of [original,thumb,unused])await fs.writeFile(path.join(directory,'images',file),'test-image');
 await fs.writeFile(path.join(directory,'catwalk/look.webp'),'premium');
 const staged=await prepareDeploymentAssets(directory);
 try{
  assert.equal(staged.manifest.unusedPhotosOmitted,1);assert.equal(staged.manifest.catwalkFiles,1);assert.equal(staged.manifest.wireCatalog,true);
  assert.equal(staged.manifest.operatorReportsOmitted,1);
  await assert.rejects(fs.access(path.join(staged.directory,'data/lux-verification-summary.json')),{code:'ENOENT'});
  assert.deepEqual(decodeCatalog(JSON.parse(await fs.readFile(path.join(staged.directory,'data/catalog.json'),'utf8'))),catalog);
  assert.equal(await fs.readFile(path.join(staged.directory,'catwalk/look.webp'),'utf8'),'premium');
  await assert.rejects(fs.access(path.join(staged.directory,'images',unused)),{code:'ENOENT'});
 }finally{await removeDeploymentAssets(staged.directory);}
}));
test('deployment refuses private queues and missing referenced images',()=>fixture(async directory=>{
 await fs.writeFile(path.join(directory,'curation-summary.json'),'{}');
 await assert.rejects(prepareDeploymentAssets(directory),/Private collection data/);
 await fs.unlink(path.join(directory,'curation-summary.json'));
 await fs.writeFile(path.join(directory,'index.html'),'<img src="/images/'+ 'a'.repeat(64)+'.webp">');
 await assert.rejects(prepareDeploymentAssets(directory),/Referenced deployment photo missing/);
}));
test('temporary deployment cleanup cannot target a workspace',async()=>{
 await assert.rejects(removeDeploymentAssets(process.cwd()),/Unexpected temporary deployment directory/);
});

test('staging opt-in retains nonproduct references and still enforces committed immutable originals',t=>fixture(async directory=>{
 const image=n=>'/images/'+String(n).repeat(64)+'.webp';
 const catalog={products:[1,2].map(n=>({id:'shoe-'+n,brand:'Prada',presentation:{cachedPath:image(n),thumbnail:{path:image(n+2)}}}))};
 for(const folder of ['data','images'])await fs.mkdir(path.join(directory,folder));
 await fs.writeFile(path.join(directory,'data/catalog.json'),JSON.stringify(catalog));
 await fs.writeFile(path.join(directory,'data/catalog-ui.json'),JSON.stringify(encodeCatalog(catalog)));
 for(const n of [1,2,3,4])await fs.writeFile(path.join(directory,image(n).slice(1)),'uncommitted fixture');
 // Inflate only the file inventory: budget failures occur before files are linked.
 const readdir=fs.readdir.bind(fs);let inventoryPadding=19895;
 t.mock.method(fs,'readdir',async(target,options)=>{
  const entries=await readdir(target,options);
  if(path.resolve(target)===directory)entries.push(...Array.from({length:inventoryPadding},(_,n)=>({name:`retained-${n}.bin`,isSymbolicLink:()=>false,isDirectory:()=>false})));
  return entries;
 });
 await assert.rejects(prepareDeploymentAssets(directory),/no data or research files/);
 await assert.rejects(prepareDeploymentAssets(directory,{allowLuxOriginals:true}),/Only committed immutable public product originals/);
 // Use the real builder: v3 brand shards must not protect all originals.
 const index=await buildCatalogChunks(catalog,path.join(directory,'data'));inventoryPadding-=2;
 const shardFile=path.join(directory,index.chunks[0].url.slice(2)),indexFile=path.join(directory,'data/catalog-index.json');
 const shardBytes=await fs.readFile(shardFile,'utf8'),indexBytes=await fs.readFile(indexFile,'utf8');
 await assert.rejects(prepareDeploymentAssets(directory),/no data or research files/);
 await assert.rejects(prepareDeploymentAssets(directory,{allowLuxOriginals:true}),/Only committed immutable public product originals/);
 for(const location of ['shard metadata','shard wrapper','index base','index metadata','index chunk','stale product','shard thumbnail']){
  const shard=decodeCatalog(JSON.parse(shardBytes)),manifest=JSON.parse(indexBytes);
  const refs={references:[image(1),image(2)]};
  if(location==='shard metadata')shard.research=refs;
  if(location==='index base')manifest.base=encodeCatalog({...decodeCatalog(manifest.base),research:refs});
  if(location==='index metadata')manifest.research=refs;
  if(location==='index chunk')manifest.chunks[0].research=refs;
  if(location==='stale product')shard.products[0].research=refs;
  if(location==='shard thumbnail')shard.products[0].presentation.thumbnail.path=image(2);
  const wire=encodeCatalog(shard);if(location==='shard wrapper')wire.research=refs;
  await fs.writeFile(shardFile,JSON.stringify(wire));await fs.writeFile(indexFile,JSON.stringify(manifest));
  await assert.rejects(prepareDeploymentAssets(directory,{allowLuxOriginals:true}),/no data or research files/,location);
 }
 await fs.writeFile(shardFile,shardBytes);await fs.writeFile(indexFile,indexBytes);
 await fs.writeFile(path.join(directory,'data/catalog-brands/research.json'),JSON.stringify({products:catalog.products}));
 await assert.rejects(prepareDeploymentAssets(directory,{allowLuxOriginals:true}),/no data or research files/);
 await fs.unlink(path.join(directory,'data/catalog-brands/research.json'));
 for(const referenceFile of ['research.json','catwalk.json','forecast.json','boards.json']){
  await fs.writeFile(path.join(directory,'data',referenceFile),JSON.stringify({references:[image(1),image(2)]}));
  await assert.rejects(prepareDeploymentAssets(directory,{allowLuxOriginals:true}),/no data or research files/);
  await fs.unlink(path.join(directory,'data',referenceFile));
 }
 // References in canonical metadata and its encoded alias must also stay local.
 catalog.boards=[{image:image(1)}];
 await fs.writeFile(path.join(directory,'data/catalog.json'),JSON.stringify(catalog));
 await fs.writeFile(path.join(directory,'data/catalog-ui.json'),JSON.stringify(encodeCatalog(catalog)));
 await assert.rejects(prepareDeploymentAssets(directory,{allowLuxOriginals:true}),/no data or research files/);
}));
