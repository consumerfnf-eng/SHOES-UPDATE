import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareDeploymentAssets,removeDeploymentAssets} from '../scripts/deployment-assets.mjs';
import {encodeCatalog,decodeCatalog} from '../public/assets/catalog-wire.mjs';

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
