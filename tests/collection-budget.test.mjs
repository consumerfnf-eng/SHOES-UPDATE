import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionBudget} from '../scripts/collection-budget.mjs';
import {collectNewArrivals} from '../scripts/new-arrivals.mjs';
import {collectSignals} from '../scripts/collect-signals.mjs';

test('phase deadline prevents new requests without abandoning the current request',async()=>{
 let time=0,calls=0,finish;
 const budget=createCollectionBudget({durationMs:10,now:()=>time,label:'TEST'});
 const read=budget.wrap(async()=>{calls++;await new Promise(r=>finish=r);return 'verified response';});
 const pending=read();time=10;assert(budget.exhausted());finish();
 assert.equal(await pending,'verified response');
 await assert.rejects(read(),/TEST_TIME_BUDGET/);assert.equal(calls,1);
});

const brands=['Prada','Nike'],origins={Prada:'https://www.prada.com',Nike:'https://www.nike.com'};
const sources=Object.fromEntries(brands.map(brand=>[brand,[{url:origins[brand]+'/new-arrivals'}]]));
const now=new Date('2026-10-18T00:00:00Z');
function listing(brand){const root=origins[brand];return `# New Arrivals\n[![Ready sneakers](${root}/READY001.jpg) Ready sneakers](${root}/p/READY001)\n[Pending sneakers](${root}/p/PENDING001)\n[Another sneakers](${root}/p/PENDING002)`;}

test('all brands retain listing proofs before bounded details; pending candidates and checkpoints survive',async()=>{
 let time=0,writing=0,detailCalls=0;
 const snapshots=[];
 const run=await collectNewArrivals({brands,sources,now,log:()=>{},clock:()=>time,maxDetailMsPerBrand:5,
  onProgress:async snapshot=>{assert.equal(writing++,0,'Only one checkpoint writer at a time');await new Promise(r=>setImmediate(r));snapshots.push(snapshot);writing--;},
  read:async target=>{
   const url=target.slice('https://r.jina.ai/'.length),brand=brands.find(b=>url.startsWith(origins[b]));
   if(url.endsWith('/new-arrivals'))return listing(brand);
   assert(snapshots.some(s=>s.phase==='listing-proofs'&&s.products.length===2),'Every brand has its ready proofs first');
   detailCalls++;time+=6;
   return `# Pending sneakers\nProduct code: PENDING001\n![Pending sneakers side](${origins[brand]}/PENDING001.jpg)\nMesh sneakers with a rubber outsole.`;
  }});
 assert.equal(detailCalls,2);assert.equal(run.products.length,4);
 for(const status of run.coverage){assert.equal(status.verified,2);assert.equal(status.detailPending,1);assert.equal(status.status,'partial');}
 const last=snapshots.at(-1);assert.equal(last.phase,'complete');assert.equal(last.pending.length,2);
 assert(last.pending.every(p=>p.candidate.url.endsWith('/PENDING002')));
 assert.equal(snapshots.find(s=>s.phase==='listing-proofs').products.length,2,'Earlier snapshots are immutable');
 assert(snapshots.find(s=>s.phase==='listing-discovery').pending.length>0);
});

test('expired detail budget never drops immediately verifiable products from later brands',async()=>{
 let requests=0;
 const run=await collectNewArrivals({brands,sources,now,log:()=>{},canReadDetails:()=>false,read:async target=>{
  requests++;assert(target.endsWith('/new-arrivals'));return listing(brands.find(b=>target.includes(origins[b])));
 }});
 assert.equal(requests,2);assert.equal(run.products.length,2);assert.equal(run.coverage.length,2);
 assert(run.coverage.every(s=>s.detailPending===2&&s.status==='partial'));
});

test('a deferred signal search does not refresh the last search date or repeat for every item',async()=>{
 let calls=0;
 const result=await collectSignals({products:[{id:'one',brand:'Nike',style:'ONE001',lastSignalSearchCheckedAt:'2026-10-01T00:00:00Z'},{id:'two',brand:'Nike',style:'TWO002'}],now,
  config:{editorialSources:[],rankingPages:[],magazineDomains:[],newsletterDomains:[],snsAccounts:[]},read:async()=>{calls++;throw Error('SIGNAL_TIME_BUDGET');}});
 assert.equal(calls,1);
 assert.equal(result.products.find(p=>p.id==='one').lastSignalSearchCheckedAt,'2026-10-01T00:00:00Z');
 assert.equal(result.products.find(p=>p.id==='two').lastSignalSearchCheckedAt,undefined);
});
