import test from 'node:test';
import assert from 'node:assert/strict';
import {deferredProductOriginals} from '../scripts/deployment-photo-budget.mjs';

const image=n=>'/images/'+n.toString(16).padStart(64,'0')+'.webp';
const product=(brand,n,thumbnail=image(n+100))=>({brand,presentation:{cachedPath:image(n),thumbnail:{path:thumbnail}}});
const selectedFor=catalog=>['data/catalog.json',...new Set(catalog.products.flatMap(p=>[p.presentation.cachedPath,p.presentation.thumbnail.path]).map(p=>p.slice(1)))];

test('LUX stays protected by default and requires an explicit boolean opt-in',()=>{
 const catalog={products:[product('Prada',1),product('PUMA',2),product('Converse',3)]},selected=selectedFor(catalog);
 for(const options of [undefined,{allowLuxOriginals:false},{allowLuxOriginals:'true'}]){
  assert.deepEqual([...deferredProductOriginals(catalog,selected,6,options)],[image(2).slice(1),image(3).slice(1)]);
  assert.throws(()=>deferredProductOriginals(catalog,selected,5,options),/no data or research files/);
 }
});

test('opt-in fills the budget with LUX only after SPORTS/CASUAL originals are exhausted',()=>{
 const catalog={products:[product('Prada',1),product('PUMA',2),product('Converse',3)]},before=structuredClone(catalog),selected=selectedFor(catalog),originalSelected=[...selected];
 assert.deepEqual([...deferredProductOriginals(catalog,selected,6,{allowLuxOriginals:true})],[image(2).slice(1),image(3).slice(1)]);
 const deferred=deferredProductOriginals(catalog,selected,5,{allowLuxOriginals:true});
 assert.deepEqual([...deferred],[image(2).slice(1),image(3).slice(1),image(1).slice(1)]);
 assert.equal(selected.length-deferred.size+1,5); // Reserve the origin manifest.
 assert.deepEqual(catalog,before);assert.deepEqual(selected,originalSelected);
 assert.equal(deferredProductOriginals(catalog,selected,selected.length,{allowLuxOriginals:true}).size,0);
});

test('every product thumbnail stays protected, including paths shared with other originals',()=>{
 const catalog={products:[product('Prada',1,image(2)),product('PUMA',2,image(3)),product('Converse',3,image(1)),product('Prada',4),product('PUMA',5)]},selected=selectedFor(catalog);
 const deferred=deferredProductOriginals(catalog,selected,selected.length-1,{allowLuxOriginals:true});
 assert.deepEqual([...deferred],[image(5).slice(1),image(4).slice(1)]);
 for(const p of catalog.products)assert(!deferred.has(p.presentation.thumbnail.path.slice(1)));
 assert.throws(()=>deferredProductOriginals(catalog,selected,selected.length-2,{allowLuxOriginals:true}),/no data or research files/);
});

test('research, catwalk, forecast, board and other LUX references cannot become origin candidates',()=>{
 const catalog={products:Array.from({length:9},(_,i)=>product(i%2?'PUMA':'Prada',i+1)),research:{image:image(1)},catwalk:{looks:[{image:image(2)}]},forecast:{pages:[image(3)]},boards:[{original:image(4)}]};
 catalog.products[0].alternate=image(5);
 const selected=[...selectedFor(catalog),'catwalk/private.webp','forecast/private.webp','data/research.json'];
 const options={allowLuxOriginals:true,protectedPaths:[image(6),image(7).slice(1)]};
 assert.deepEqual([...deferredProductOriginals(catalog,selected,selected.length,options)],[]);
 assert.deepEqual([...deferredProductOriginals(catalog,selected,selected.length-1,options)],[image(8).slice(1),image(9).slice(1)]);
 assert.throws(()=>deferredProductOriginals(catalog,selected,selected.length-2,options),/no data or research files/);
});

test('only selected hashed public cachedPath originals are eligible',()=>{
 const catalog={products:[product('Prada',1),product('Prada',2),product('Prada',3),product('Prada',4)]};
 catalog.products[0].presentation.cachedPath='/forecast/private.webp';
 catalog.products[1].presentation.cachedPath='/images/unhashed.webp';
 catalog.products[2].presentation.cachedPath='/private/images/'+ 'a'.repeat(64)+'.jpg';
 catalog.products[3].image=image(5);
 assert.throws(()=>deferredProductOriginals(catalog,['data/catalog.json',image(5).slice(1)],1,{allowLuxOriginals:true}),/no data or research files/);
});
