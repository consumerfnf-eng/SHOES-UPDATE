import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFilaChina} from '../scripts/collect-fila-china.mjs';

const now=new Date('2026-11-05T01:00:00Z');
const women='https://www.fila.com.cn/list/j2_4_22-e1';
const men='https://www.fila.com.cn/list/j1_4_22-e1';
// Real goods IDs from the existing offline FILA capture; deliberately non-sequential.
const ids=['910098','907568','907569','911647'];
const html=(name,value)=>`var ${name} = ${JSON.stringify(value)};`;
const product=(id,overrides={})=>({id_goods:id,id_alias:`T12W${id}A`,pro_title:'女士硬糖老爹鞋',onsell:1,
 market_time:Date.parse('2026-10-22T00:00:00+08:00')/1000,price:'890.00',
 color:{a:{id_pa:'6870811',attr_alias:`T12W${id}ABG`,attr_name:'黑/灰',image_url:'https://img.fishfay.com/a.jpg'}},...overrides});
function fixture({failProduct,failListing,mutateProduct,listingData}={}){
 const reads=[];
 const read=async url=>{
  reads.push(url);
  if(url.includes('/goods-')){
   const id=url.match(/goods-(\d+)\.html/)[1];
   if(failProduct?.(id))throw Error('Offline PDP failure');
   return html('proData',mutateProduct?mutateProduct(product(id)):product(id));
  }
  if(failListing?.(url))throw Error('Offline listing failure');
  const page=Number(new URL(url).searchParams.get('p')||1);
  const data={info:{_p:String(page),_page:'2',_total:'2'},id_goods:{1:ids[(url.startsWith(women)?0:2)+page-1]}};
  return html('listData',listingData?listingData(data,url):data);
 };
 return {read,reads};
}
const serial=value=>JSON.parse(JSON.stringify(value));

test('bounded checkpoint resumes exact actual goods IDs, preserving rows and skipping completed pages',async()=>{
 const first=fixture(),events=[],saved=[];
 const partial=await collectFilaChina({now,read:first.read,maxProductPages:1,onProgress:p=>events.push(serial(p)),onCheckpoint:c=>saved.push(serial(c))});
 assert.equal(partial.exhaustive,false);
 assert.equal(partial.products.length,1);
 assert.deepEqual(partial.pendingIds,ids.slice(1));
 const event=events.find(p=>p.phase==='products');
 assert.deepEqual(event.products,partial.products);
 assert.deepEqual(event.pendingIds,ids.slice(1));
 assert.deepEqual(saved.at(-1),partial.checkpoint);
 const second=fixture();
 const full=await collectFilaChina({now,read:second.read,resume:serial(partial.checkpoint)});
 assert.deepEqual(second.reads,ids.slice(1).map(id=>`https://www.fila.com.cn/goods-${id}.html`));
 assert.equal(full.exhaustive,true);
 assert.equal(full.coverage.every(c=>c.exhaustive),true);
 assert.equal(full.checkedProducts,4);
 assert.equal(full.products.length,4);
 assert.deepEqual(full.products.find(p=>p.productVariantId.startsWith(ids[0]+':')),partial.products[0]);
 assert.equal(new Set(full.products.map(p=>p.id)).size,4);
 const noReads=fixture();
 assert.deepEqual((await collectFilaChina({now,read:noReads.read,resume:full.checkpoint})).products,full.products);
 assert.deepEqual(noReads.reads,[]);
});

test('listing page cursor and numbered-object IDs survive a mid-listing checkpoint',async()=>{
 const first=await collectFilaChina({now,read:fixture().read,maxListingPages:1,maxProductPages:1});
 assert.equal(first.pages.length,1);
 assert.equal(first.products.length,1);
 assert.equal(first.checkpoint.listings[0].nextPage,2);
 assert.equal(first.exhaustive,false); // no pending PDPs is insufficient
 const next=fixture();
 const full=await collectFilaChina({now,read:next.read,resume:serial(first.checkpoint)});
 assert.ok(next.reads.includes(women+'?p=2'));
 assert.ok(!next.reads.includes(women));
 assert.ok(!next.reads.includes(`https://www.fila.com.cn/goods-${ids[0]}.html`));
 assert.equal(full.pages.length,4);
 assert.equal(full.products.length,4);
 assert.equal(full.exhaustive,true);
});

test('failed and mismatched PDPs stay pending; retry never loses successful rows',async()=>{
 const broken=fixture({failProduct:id=>id===ids[1],mutateProduct:p=>p.id_goods===ids[2]?{...p,id_goods:'999'}:p});
 const first=await collectFilaChina({now,read:broken.read});
 assert.equal(first.checkedProducts,4);
 assert.equal(first.completedProducts,2);
 assert.equal(first.errors.length,2);
 assert.equal(first.products.length,2);
 assert.deepEqual(first.pendingIds,[ids[1],ids[2]]);
 assert.equal(first.exhaustive,false);
 const recovered=fixture();
 const full=await collectFilaChina({now,read:recovered.read,resume:serial(first.checkpoint)});
 assert.deepEqual(recovered.reads.sort(),[ids[1],ids[2]].map(id=>`https://www.fila.com.cn/goods-${id}.html`).sort());
 assert.equal(full.errors.length,0);
 assert.equal(full.products.length,4);
 for(const row of first.products)assert.deepEqual(full.products.find(p=>p.id===row.id),row);
 assert.equal(full.exhaustive,true);
});

test('listing read failures retain earlier products and retry the actual failed page',async()=>{
 const first=await collectFilaChina({now,read:fixture({failListing:url=>url===women+'?p=2'}).read});
 assert.equal(first.products.length,3);
 assert.equal(first.exhaustive,false);
 const second=fixture();
 const full=await collectFilaChina({now,read:second.read,resume:serial(first.checkpoint)});
 assert.deepEqual(second.reads,[women+'?p=2',`https://www.fila.com.cn/goods-${ids[1]}.html`]);
 assert.equal(full.products.length,4);
 assert.equal(full.errors.length,0);
 assert.equal(full.exhaustive,true);
});

for(const [name,change] of [
 ['repeated IDs',(d,url)=>url.endsWith('?p=2')?{...d,id_goods:{1:ids[url.startsWith(women)?0:2]}}:d],
 ['truncated final page',(d,url)=>url.endsWith('?p=2')?{...d,id_goods:{}}:d],
 ['stuck pagination',(d,url)=>url.endsWith('?p=2')?{...d,info:{...d.info,_p:1}}:d],
 ['changing total',(d,url)=>url.endsWith('?p=2')?{...d,info:{...d.info,_total:3}}:d]
])test(`completeness failure (${name}) retains earlier rows and a retryable listing cursor`,async()=>{
 const partial=await collectFilaChina({now,read:fixture({listingData:change}).read});
 assert.equal(partial.exhaustive,false);
 assert.equal(partial.products.length,2);
 assert.equal(partial.checkpoint.listings[0].nextPage,2);
 assert.equal(partial.errors.length,2);
 const full=await collectFilaChina({now,read:fixture().read,resume:serial(partial.checkpoint)});
 assert.equal(full.products.length,4);
 assert.equal(full.exhaustive,true);
});

test('resumed evidence still admits only adult sneakers with exact market_time inside three calendar months',async()=>{
 const variants=[
  {market_time:Date.parse('2026-08-05T00:00:00+08:00')/1000}, // inclusive cutoff
  {market_time:Date.parse('2026-08-04T23:59:59+08:00')/1000,add_time:Date.parse('2026-11-01')/1000,up_time:Date.parse('2026-11-01')/1000},
  {pro_title:'儿童硬糖运动鞋'},
  {market_time:0,updated_at:'2026-11-04'}
 ];
 const offline=fixture({mutateProduct:p=>({...p,...variants[ids.indexOf(p.id_goods)]})});
 const first=await collectFilaChina({now,read:offline.read,maxProductPages:1});
 const full=await collectFilaChina({now,read:offline.read,resume:serial(first.checkpoint)});
 assert.equal(full.exhaustive,true);
 assert.equal(full.products.length,1);
 assert.equal(full.products[0].releaseDate,'2026-08-05');
 assert.equal(full.products[0].dateEvidence.field,'market_time');
 assert.equal(full.products[0].dateEvidence.kind,'official-sale-start');
 assert.match(full.products[0].dateEvidence.excerpt,/Not add_time, up_time or updated_at/);
 assert.equal(full.checkpoint.validatedProducts.length,1);
});

test('wall time limit bounds a hung reader and preserves prior rows with the hung ID pending',async()=>{
 const first=await collectFilaChina({now,read:fixture().read,maxProductPages:1});
 const events=[];
 const partial=await collectFilaChina({now,resume:first.checkpoint,maxDurationMs:500,
  read:()=>new Promise(()=>{}),onProgress:p=>events.push(serial(p))});
 assert.deepEqual(partial.products,first.products);
 assert.deepEqual(partial.pendingIds,ids.slice(1));
 assert.equal(partial.exhaustive,false);
 assert.ok(partial.errors.length>0);
 assert.deepEqual(events.at(-1).products,first.products);
 assert.deepEqual(events.at(-1).checkpoint,partial.checkpoint);
});

test('progress snapshots are isolated, ordered, and callback persistence failures reject',async()=>{
 let durable;
 const first=await collectFilaChina({now,read:fixture().read,maxProductPages:1,onProgress:p=>{
  durable=serial(p.checkpoint);p.products.length=0;p.checkpoint.ids.length=0;
 }});
 assert.equal(first.products.length,1);
 assert.equal(first.checkpoint.ids.length,4);
 assert.equal(durable.validatedProducts.length,1);
 const reads=fixture();
 await assert.rejects(collectFilaChina({now,read:reads.read,resume:durable,onCheckpoint:()=>{throw Error('Disk unavailable');}}),/Disk unavailable/);
 assert.deepEqual(reads.reads,[]);
 const checkpoints=[];
 await assert.rejects(collectFilaChina({now,read:fixture().read,onCheckpoint:c=>{checkpoints.push(serial(c));},onProgress:p=>{
  if(p.products.length)throw Error('Admin persistence failed');
 }}),/Admin persistence failed/);
 const recovered=await collectFilaChina({now,read:fixture().read,resume:checkpoints.at(-1)});
 assert.equal(recovered.products.length,4);
 assert.equal(recovered.exhaustive,true);
});

test('zero bounds do no reads; stale or malformed checkpoints and invalid bounds reject',async()=>{
 const offline=fixture();
 const empty=await collectFilaChina({now,read:offline.read,maxListingPages:0,maxProductPages:0});
 assert.deepEqual(offline.reads,[]);
 assert.equal(empty.exhaustive,false);
 await assert.rejects(collectFilaChina({now:new Date('2026-11-06T01:00:00Z'),resume:empty.checkpoint}),/stale/);
 await assert.rejects(collectFilaChina({now,resume:{...empty.checkpoint,pendingIds:['123']}}),/checkpoint/);
 await assert.rejects(collectFilaChina({now,maxProductPages:-1}),/maxProductPages/);
 await assert.rejects(collectFilaChina({now,maxDurationMs:NaN}),/maxDurationMs/);
});
