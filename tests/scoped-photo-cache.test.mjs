import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const script=path.resolve('scripts/cache-sports-casual-photos.py');
test('transparent originals render on white, retain original bytes and reject LUX cache mutations',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-scoped-photo-'));
 try{
  await fs.mkdir(path.join(dir,'data'));await fs.mkdir(path.join(dir,'config'));await fs.mkdir(path.join(dir,'public/images'),{recursive:true});
  const made=spawnSync('python',['-c','from PIL import Image,ImageDraw;im=Image.new("RGBA",(300,240),(0,120,0,0));ImageDraw.Draw(im).rectangle((50,80,250,170),fill=(180,40,40,255));im.save("original.png")'],{cwd:dir,encoding:'utf8'});assert.equal(made.status,0,made.stderr);
  const original=await fs.readFile(path.join(dir,'original.png')),asset='/images/'+createHash('sha256').update(original).digest('hex')+'.png',url='https://official.example/shoe.png';await fs.writeFile(path.join(dir,'public'+asset),original);
  await fs.writeFile(path.join(dir,'config/site-brand-groups.json'),JSON.stringify({groups:[{name:'SPORTS',priority:['Alo']}]}));
  await fs.writeFile(path.join(dir,'data/photo-cache.json'),JSON.stringify({images:{[url]:{path:asset}}}));
  const input={products:[{id:'test',brand:'Alo',name:'Sneaker',style:'TEST',presentation:{image:url}}]};await fs.writeFile(path.join(dir,'input.json'),JSON.stringify(input));
  const run=spawnSync('python',['-X','utf8',script,'input.json','output.json'],{cwd:dir,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const output=JSON.parse(await fs.readFile(path.join(dir,'output.json'),'utf8')),thumbnail=output.products[0].presentation.thumbnail.path;
  const pixel=spawnSync('python',['-c','from PIL import Image;import sys;print(Image.open(sys.argv[1]).convert("RGB").getpixel((0,0)))',path.join(dir,'public'+thumbnail)],{cwd:dir,encoding:'utf8'});assert.match(pixel.stdout,/\(255, 255, 255\)/);assert.deepEqual(await fs.readFile(path.join(dir,'public'+asset)),original);
  const cache=await fs.readFile(path.join(dir,'data/photo-cache.json'));input.products[0].brand='Prada';await fs.writeFile(path.join(dir,'input.json'),JSON.stringify(input));const reject=spawnSync('python',['-X','utf8',script,'input.json','rejected.json'],{cwd:dir,encoding:'utf8'});assert.notEqual(reject.status,0);assert.deepEqual(await fs.readFile(path.join(dir,'data/photo-cache.json')),cache);
 }finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('shoes-scoped-photo-'));await fs.rm(dir,{recursive:true,force:true});}
});
