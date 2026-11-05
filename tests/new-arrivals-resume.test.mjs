import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectNewArrivals,proveListingCompletion,parseArrivalListing,listingProduct,strictLuxuryTileProduct,pageProduct,isNewListing} from '../scripts/new-arrivals.mjs';
import {canonicalUrl,officialEvidenceFor,curateProduct} from '../scripts/curation.mjs';

const brand='Prada',root='https://www.prada.com/us/en/new-in';
const now=new Date('2026-11-05T00:00:00Z');
const product=i=>`https://www.prada.com/us/en/p/runner/ABC00${i}`;
const page=i=>i===1?root:`${root}?page=${i}`;
const detail=i=>`# Runner sneaker ${i}\nProduct code: ABC00${i}\n![Runner sneaker side](https://www.prada.com/ABC00${i}_SLS.jpg)\nMesh runner sneakers with a rubber outsole.`;
const listing=(i,total=4,images=false)=>`# New In\n${total} products\nPage ${i} of ${total}\n[${images?`![Runner sneaker ${i}](https://www.prada.com/ABC00${i}_SLS.jpg) `:''}Runner sneaker ${i}](${product(i)})\n${i<total?`[Next](${page(i+1)})`:''}\n${i>1?`[1](${root})`:''}`;
const options={brands:[brand],sources:{[brand]:[{url:root}]},now,log:()=>{}};
const resume=run=>({listingSeeds:run.listingPending,resumeReceipts:run.listingReceipts,carriedPending:run.pending,candidateOutcomes:run.candidateOutcomes});

test('a two-page discovery budget resumes unread pages, carries products and skips backwards links',async()=>{
  const calls=[],snapshots=[];
  const read=async target=>{const url=target.replace('https://r.jina.ai/','');calls.push(url);return listing(Number(new URL(url).searchParams.get('page')||1));};
  const first=await collectNewArrivals({...options,maxPagesPerBrand:2,listingSeeds:[{brand,source:{url:root}}],canReadDetails:()=>false,read,onProgress:s=>snapshots.push(s)});
  assert.deepEqual(calls,[page(1),page(2)]);
  assert.deepEqual(first.listingPending.map(e=>e.source.url),[page(3)]);
  assert.equal(first.pending.length,2);
  const checkpoints=snapshots.filter(s=>s.phase==='listing-page');
  assert.equal(checkpoints.length,2);
  assert.deepEqual(checkpoints[0].listingPending.map(e=>e.source.url),[page(2)]);
  assert.equal(checkpoints[0].pending.length,1);
  assert.equal(checkpoints[0].listingReceipts[0].contentHash,createHash('sha256').update(listing(1)).digest('hex'));
  assert.equal(checkpoints[0].listingReceipts[0].extractedCandidateUrlCount,1);
  assert.deepEqual(checkpoints[0].listingReceipts[0].declaredTotalCounts,[4]);
  assert.equal(checkpoints[0].candidateOutcomes[0].outcome,'unverified');
  const second=await collectNewArrivals({...options,...resume(first),maxPagesPerBrand:2,canReadDetails:()=>false,read});
  assert.deepEqual(calls,[page(1),page(2),page(3),page(4)]);
  assert.equal(second.listingPending.length,0);
  assert.equal(second.listingReceipts.length,4);
  assert.equal(second.pending.length,4);
  assert.equal(second.coverage[0].exhaustive,false);
});

test('a persisted per-page checkpoint can resume after interruption without losing carried candidates',async()=>{
  let saved;
  const carried={brand,candidate:{brand,url:product(9),name:'Runner sneaker 9',linkedImages:[],arrivalEvidence:{}}};
  await assert.rejects(collectNewArrivals({...options,carriedPending:[carried],read:async()=>listing(1),onProgress:s=>{saved=s;throw Error('interrupted');}}),/interrupted/);
  assert.equal(saved.phase,'listing-page');
  assert.equal(saved.pending.length,2);
  assert.equal(saved.listingReceipts.length,1);
  const calls=[];
  const result=await collectNewArrivals({...options,...resume(saved),maxPagesPerBrand:1,canReadDetails:()=>false,read:async target=>{calls.push(target);return listing(2);}});
  assert.deepEqual(calls,['https://r.jina.ai/'+page(2)]);
  assert.equal(result.pending.length,3);
  assert.deepEqual(result.listingPending.map(e=>e.source.url),[page(3)]);
});

test('listing checkpoints include configured shelves not yet visited',async()=>{
  const other='https://www.prada.com/gb/en/new-in',snapshots=[];
  const result=await collectNewArrivals({...options,sources:{[brand]:[{url:root},{url:other}]},maxPagesPerBrand:1,canReadDetails:()=>false,read:async()=>listing(1),onProgress:s=>snapshots.push(s)});
  assert.deepEqual(result.listingPending.map(e=>e.source.url),[other,page(2)]);
  assert.deepEqual(snapshots.find(s=>s.phase==='listing-page').listingPending,result.listingPending);
});

test('failed listing reads remain seeded for a later attempt, with their errors intact',async()=>{
  const first=await collectNewArrivals({...options,read:async()=>{throw Error('listing timeout');}});
  assert.equal(first.listingPending[0].source.url,root);
  assert.equal(first.listingReceipts.length,0);
  assert.equal(first.coverage[0].errors[0].error,'listing timeout');
  const next=await collectNewArrivals({...options,...resume(first),canReadDetails:()=>false,read:async()=>listing(1,1)});
  assert.equal(next.listingPending.length,0);
  assert.equal(next.listingReceipts.length,1);
});

test('failed and identity-unverified PDPs remain pending once, then succeed in verification-only mode',async()=>{
  for(const failure of ['throw','identity']){
    const calls=[];
    const first=await collectNewArrivals({...options,read:async target=>{
      calls.push(target);
      if(target.endsWith(root))return listing(1,1);
      if(failure==='throw')throw Error('PDP timeout');
      return '# Different handbag';
    }});
    assert.equal(calls.length,2,'a failed candidate is attempted only once per run');
    assert.deepEqual(first.pending.map(e=>e.candidate.url),[product(1)]);
    assert.equal(first.candidateOutcomes[0].outcome,'unverified');
    assert(first.coverage[0].errors.some(e=>e.error===(failure==='throw'?'PDP timeout':'product-identity-image-unverified')));
    const snapshots=[];
    const next=await collectNewArrivals({...options,...resume(first),skipDiscovery:true,read:async target=>{assert.equal(target,'https://r.jina.ai/'+product(1));return detail(1);},onProgress:s=>snapshots.push(s)});
    assert.equal(next.pending.length,0);
    assert.equal(next.candidateOutcomes[0].outcome,'complete');
    assert.equal(next.products.length,1);
    assert.equal(snapshots.at(-1).pending.length,0);
  }
});

test('strict completion is opt-in and can combine receipts and outcomes across listing passes',async()=>{
  const read=async target=>listing(Number(new URL(target.replace('https://r.jina.ai/','')).searchParams.get('page')||1),4,true);
  const first=await collectNewArrivals({...options,completionProof:true,maxPagesPerBrand:2,read});
  assert.equal(first.coverage[0].exhaustive,false);
  assert(first.coverage[0].completionProof.reasons.includes('listing-pending'));
  const next=await collectNewArrivals({...options,...resume(first),completionProof:true,maxPagesPerBrand:2,read});
  assert.equal(next.coverage[0].exhaustive,true);
  assert.equal(next.coverage[0].completionProof.scope,'configured-shelves');
  assert.equal(next.coverage[0].completionProof.shelves[0].uniqueObserved,4);
  assert.equal(next.candidateOutcomes.length,4);
  assert(next.candidateOutcomes.every(o=>o.outcome==='complete'));
  const normal=await collectNewArrivals({...options,read:async()=>listing(1,1,true)});
  assert.equal(normal.coverage[0].exhaustive,false);
});

test('unknown or mismatching totals, unresolved candidates and unread configured shelves cannot prove completion',async()=>{
  const cases=[
    {body:listing(1,1,true).replace('Page 1 of 1','').replace('1 products',''),reason:'terminal-paging-unproven:'},
    {body:listing(1,1,true).replace('1 products','2 products'),reason:'declared-total-mismatch-or-missing:'},
    {body:listing(1,1,true).replace('1 products',''),reason:'declared-total-mismatch-or-missing:'},
    {body:listing(1,1),reason:'candidate-pending'},
  ];
  for(const {body,reason} of cases){
    const run=await collectNewArrivals({...options,completionProof:true,canReadDetails:()=>false,read:async()=>body});
    assert.equal(run.coverage[0].exhaustive,false);
    assert(run.coverage[0].completionProof.reasons.some(r=>r.startsWith(reason)),JSON.stringify(run.coverage[0].completionProof));
  }
  const unread=await collectNewArrivals({...options,sources:{[brand]:[{url:root},{url:root+'/men'}]},completionProof:true,maxPagesPerBrand:1,read:async()=>listing(1,1,true)});
  assert.equal(unread.coverage[0].exhaustive,false);
});

test('an explicitly excluded candidate is distinguishable from an unverified card omitted by parsing',async()=>{
  const excluded=await collectNewArrivals({...options,completionProof:true,filterCandidate:()=>false,read:async()=>listing(1,1,true)});
  assert.equal(excluded.pending.length,0);
  assert.equal(excluded.candidateOutcomes[0].outcome,'explicitlyexcluded');
  assert.equal(excluded.coverage[0].exhaustive,true);
  const omitted=await collectNewArrivals({...options,completionProof:true,read:async()=>listing(1,1,true)+`\n[Unlabelled](${product(2)})`});
  assert.equal(omitted.coverage[0].exhaustive,false);
});

test('filtered pagination remains a missing receipt rather than implied completion',async()=>{
  const run=await collectNewArrivals({...options,completionProof:true,allowListingFollowup:()=>false,read:async()=>listing(1,1,true)+`\n[Next](${page(2)})`});
  assert.equal(run.coverage[0].exhaustive,false);
  assert(run.coverage[0].completionProof.reasons.includes('missing-page-receipt:'+canonicalUrl(page(2))));
});

test('a claimed complete outcome without valid product evidence cannot satisfy the proof',async()=>{
  const run=await collectNewArrivals({...options,read:async()=>listing(1,1,true)});
  const outcome={...run.candidateOutcomes[0],product:{...run.products[0],officialImageEvidence:{verified:false}}};
  const proof=proveListingCompletion({brand,configured:options.sources[brand],receipts:run.listingReceipts,outcomes:[outcome],today:'2026-11-05'});
  assert.equal(proof.complete,false);
  assert(proof.reasons.some(r=>r.startsWith('candidate-unverified:')));
});

test('an empty continuation seed list performs no listing reads',async()=>{
  const run=await collectNewArrivals({...options,listingSeeds:[],read:async()=>{throw Error('unexpected listing read');}});
  assert.equal(run.coverage[0].attempts,0);
  assert.deepEqual(run.listingPending,[]);
});

test('a grid item omitted by eligibility parsing remains unverified even when the total matches',async()=>{
  const body=listing(1,1,true).replace('1 products','2 products')+`\n[Leather pumps](${product(2)})`;
  const run=await collectNewArrivals({...options,completionProof:true,read:async()=>body});
  assert.equal(run.listingReceipts[0].sourceGridItemUrls.length,2);
  assert.equal(run.listingReceipts[0].extractedCandidateUrlCount,1);
  assert.equal(run.candidateOutcomes.find(o=>canonicalUrl(o.url)===canonicalUrl(product(2))).outcome,'unverified');
  assert(run.coverage[0].completionProof.reasons.includes('candidate-unverified:'+canonicalUrl(product(2))));
});

test('exclusion proof must bind the candidate to an actual listing receipt',async()=>{
  const run=await collectNewArrivals({...options,read:async()=>listing(1,1,true)});
  const outcome={brand,url:product(1),outcome:'explicitlyexcluded',reason:'reviewed-outside-scope',evidence:{url:root,contentHash:'invented'}};
  const proof=proveListingCompletion({brand,configured:options.sources[brand],receipts:run.listingReceipts,outcomes:[outcome],today:'2026-11-05'});
  assert.equal(proof.complete,false);
});

test('the default empty-page guard preserves a visible unread continuation for an admin resume',async()=>{
  const run=await collectNewArrivals({...options,read:async()=>`# New In\n[Next](${page(2)})`});
  assert.equal(run.coverage[0].attempts,1,'default traversal guard is preserved');
  assert.deepEqual(run.listingPending.map(e=>e.source.url),[page(2)]);
});

const staticShelf=(count=12)=>'# New In\n12 products\n'+Array.from({length:count},(_,i)=>`[![Runner sneaker ${i+1}](https://www.prada.com/ABC00${i+1}_SLS.jpg) Runner sneaker ${i+1}](${product(i+1)})`).join('\n');
const proofFor=(run,extra={})=>proveListingCompletion({brand,configured:options.sources[brand],receipts:run.listingReceipts,outcomes:run.candidateOutcomes,pending:run.pending,listingPending:run.listingPending,today:'2026-11-05',...extra});

test('a static shelf enumerates all 12 own bound proofs using its source-declared positive total',async()=>{
  const run=await collectNewArrivals({...options,completionProof:true,read:async()=>staticShelf()});
  assert.equal(run.products.length,12);
  assert(run.candidateOutcomes.every(o=>o.outcome==='complete'));
  assert.equal(run.coverage[0].exhaustive,true);
  assert.equal(run.coverage[0].completionProof.method,'source-declared-enumeration');
  assert.equal(run.coverage[0].completionProof.shelves[0].method,'source-declared-enumeration');
  assert.equal(run.listingReceipts[0].terminalPaging,null);
  assert.deepEqual(run.listingReceipts[0].declaredTotalEvidence,[{count:12,text:'12 products',kind:'listing-counter'}]);
  const normal=await collectNewArrivals({...options,read:async()=>staticShelf()});
  assert.equal(normal.coverage[0].exhaustive,false,'enumeration remains opt-in');
});

test('static enumeration fails for a missing item, an extra item, or an unverified own proof',async()=>{
  for(const count of [11,13]){
    const run=await collectNewArrivals({...options,completionProof:true,read:async()=>staticShelf(count)});
    assert.equal(run.coverage[0].exhaustive,false);
    assert(run.coverage[0].completionProof.reasons.some(r=>r.startsWith('declared-total-mismatch-or-missing:')));
  }
  const run=await collectNewArrivals({...options,read:async()=>staticShelf()});
  const unverified=run.candidateOutcomes.map((o,i)=>i?o:{...o,outcome:'unverified'});
  assert.equal(proofFor(run,{outcomes:unverified}).complete,false);
  const missing=run.candidateOutcomes.slice(1);
  assert.equal(proofFor(run,{outcomes:missing}).complete,false);
  const unbound=run.candidateOutcomes.map((o,i)=>i?o:{...o,evidence:{...o.evidence,contentHash:'other-page'}});
  assert.equal(proofFor(run,{outcomes:unbound}).complete,false);
});

test('a static enumeration accepts an explicit exclusion bound to the observed item and receipt',async()=>{
  const run=await collectNewArrivals({...options,completionProof:true,filterCandidate:c=>c.url!==product(12),read:async()=>staticShelf()});
  assert.equal(run.products.length,11);
  assert.equal(run.candidateOutcomes.find(o=>o.url===product(12)).outcome,'explicitlyexcluded');
  assert.equal(run.coverage[0].exhaustive,true);
});

test('static enumeration rejects pending work, errors and missing continuation receipts',async()=>{
  const run=await collectNewArrivals({...options,read:async()=>staticShelf()});
  for(const extra of [
    {pending:[{brand,candidate:{url:product(1)}}]},
    {listingPending:[{brand,source:{url:page(2)}}]},
    {errors:[{url:product(1),error:'PDP timeout'}]},
    {receipts:[]},
    {receipts:run.listingReceipts.map(r=>({...r,followupUrls:[page(2)]}))},
  ])assert.equal(proofFor(run,extra).complete,false);
  const errored=await collectNewArrivals({...options,sources:{[brand]:[{url:root},{url:root+'/men'}]},completionProof:true,read:async target=>{if(!target.endsWith(root))throw Error('listing timeout');return staticShelf();}});
  assert(errored.coverage[0].completionProof.reasons.includes('listing-or-product-errors'));
  assert.equal(errored.coverage[0].exhaustive,false);
});

test('only anchored listing counters qualify; description phrases, mixed, unknown and zero totals stay partial',async()=>{
  const cases=[
    staticShelf().replace('12 products','Our collection includes 12 products for runners.'),
    staticShelf().replace('12 products','')+'\n12 products',
    staticShelf().replace('12 products','12 products\n13 items'),
    staticShelf().replace('12 products',''),
    '# New In\n0 products',
    staticShelf()+'\nPage 1 of 2',
  ];
  for(const body of cases){
    const run=await collectNewArrivals({...options,completionProof:true,read:async()=>body});
    assert.equal(run.coverage[0].exhaustive,false,body.slice(0,100));
  }
  const descriptions=await collectNewArrivals({...options,completionProof:true,read:async()=>staticShelf()+'\nThis shoe pairs well with 99 products.'});
  assert.equal(descriptions.coverage[0].exhaustive,true);
  assert.deepEqual(descriptions.listingReceipts[0].declaredTotalCounts,[12]);
});

const opaqueImage='https://images.example-cdn.com/72b847ae9d654961ae6bb9d77424b872.webp';
const ownTile=`# New In\n1 products\n[![Runner sneaker](${opaqueImage}) New](${product(1)})`;
const tileCandidate=body=>parseArrivalListing(body,{brand,url:root,checkedAt:now.toISOString()})[0];


test('opt-in strict luxury proof accepts an opaque CDN image nested in its own explicit sneaker tile without a PDP',async()=>{
  const candidate=tileCandidate(ownTile);
  assert(candidate.needsProductTitle);
  assert.equal(listingProduct(candidate,now.toISOString()),null,'the existing gate leaves this tile for PDP verification');
  const calls=[];
  const run=await collectNewArrivals({...options,strictLuxuryTileProofs:true,completionProof:true,read:async target=>{calls.push(target);assert.equal(target,'https://r.jina.ai/'+root,'no PDP should be read');return ownTile;}});
  assert.equal(calls.length,1);
  assert.equal(run.pending.length,0);
  assert.equal(run.coverage[0].sourceTileProofs,1);
  assert.equal(run.coverage[0].exhaustive,true);
  assert.equal(run.candidateOutcomes[0].outcome,'complete');
  const p=run.products[0],hash=createHash('sha256').update(ownTile).digest('hex');
  assert.equal(p.styleType,'official-product-id');
  assert.equal(p.style,'ABC001');
  assert.equal(p.productEvidenceUrl,root);
  assert.equal(p.officialProductEvidence.verificationMethod,'official-new-listing-sku-image');
  assert.equal(p.officialImageEvidence.sourceUrl,root);
  for(const evidence of [p.arrivalEvidence,p.officialProductEvidence,p.officialImageEvidence])assert.equal(evidence.contentHash,hash);
  assert.deepEqual(p.sourceTileBinding,{verified:true,brand,url:product(1),image:opaqueImage,style:'ABC001',sourceUrl:root,contentHash:hash});
  assert(officialEvidenceFor(p,'2026-11-05'));
  const curated=curateProduct(p,'2026-11-05');
  assert(curated.product,curated.reason);
  assert.equal(curated.product.officialProductEvidence.verificationMethod,'official-new-listing-sku-image');
});

test('strict luxury tile proof rejects adjacent images, contradictory titles, furniture and ordinary shoes',async()=>{
  const own=tileCandidate(ownTile),at=now.toISOString();
  const unbound=tileCandidate(`# New In\n1 products\n![Runner sneaker](${opaqueImage})\n[Runner sneaker](${product(1)})`);
  for(const candidate of [
    unbound,
    {...own,linkedImages:[],images:own.linkedImages},
    {...own,name:'Leather shoe'},
    {...own,name:'Image 23: Runner sneaker'},
    {...own,name:'New'},
    {...own,linkedImages:[{url:opaqueImage,alt:'Leather dress shoe'}]},
    {...own,url:'https://retailer.example/p/runner/ABC001'},
    {...own,arrivalEvidence:{...own.arrivalEvidence,productUrl:product(2)}},
    {...own,arrivalEvidence:{...own.arrivalEvidence,contentHash:''}},
  ])assert.equal(strictLuxuryTileProduct(candidate,at),null,JSON.stringify(candidate));
  const run=await collectNewArrivals({...options,strictLuxuryTileProofs:true,canReadDetails:()=>false,read:async()=>`# New In\n1 products\n![Runner sneaker](${opaqueImage})\n[Runner sneaker](${product(1)})`});
  assert.equal(run.coverage[0].sourceTileProofs||0,0);
  assert.equal(run.products.filter(p=>officialEvidenceFor(p,'2026-11-05')).length,0);
  assert.equal(run.pending.length,1);
});

test('strict luxury tile recovery handles carried failed candidates without PDP reads or retained mixed hashes',async()=>{
  const candidate=tileCandidate(ownTile),at=now.toISOString();
  const old=strictLuxuryTileProduct(candidate,at);
  old.id='keep-existing-id';
  for(const e of [old.arrivalEvidence,old.officialProductEvidence,old.officialImageEvidence])e.contentHash='b'.repeat(64);
  const fresh=await collectNewArrivals({...options,existing:[old],strictLuxuryTileProofs:true,read:async target=>{assert.equal(target,'https://r.jina.ai/'+root);return ownTile;}});
  const p=fresh.products[0];
  assert.equal(p.id,old.id);
  for(const e of [p.arrivalEvidence,p.officialProductEvidence,p.officialImageEvidence,p.sourceTileBinding])assert.equal(e.contentHash,candidate.arrivalEvidence.contentHash);
  const recovered=await collectNewArrivals({...options,skipDiscovery:true,listingSeeds:[],strictLuxuryTileProofs:true,carriedPending:[{brand,candidate}],read:async()=>{throw Error('PDP must not be read');}});
  assert.equal(recovered.pending.length,0);
  assert.equal(recovered.products.length,1);
  assert.equal(recovered.candidateOutcomes[0].outcome,'complete');
  assert(officialEvidenceFor(recovered.products[0],'2026-11-05'));
});

test('strict luxury tile recovery remains opt-in',async()=>{
  const run=await collectNewArrivals({...options,canReadDetails:()=>false,read:async()=>ownTile});
  assert.equal(run.coverage[0].sourceTileProofs||0,0);
  assert.equal(run.products.filter(p=>officialEvidenceFor(p,'2026-11-05')).length,0);
  assert.equal(run.pending.length,1);
});

test('strict Korean sneaker tile titles recover blocked Dior PDP candidates without any PDP read',async()=>{
  const source='https://www.dior.com/ko_kr/fashion/mens-fashion/shoes/sneakers';
  const pdp='https://www.dior.com/ko_kr/fashion/products/3SN318ZRF_H960-b57';
  for(const name of ['B57 로우탑 스니커즈','B57 로우탑 스니커']){
    const body=`# Sneakers\n[![${name}](${opaqueImage}) New](${pdp})`;
    const candidate=parseArrivalListing(body,{brand:'Dior',url:source,checkedAt:now.toISOString(),basis:'assortment'})[0];
    assert(candidate.needsProductTitle);assert.equal(listingProduct(candidate,now.toISOString()),null);
    const product=strictLuxuryTileProduct(candidate,now.toISOString());
    assert(product,name);assert.equal(product.name,name);assert.equal(product.sourceTileBinding.url,pdp);
    const hash=createHash('sha256').update(body).digest('hex');
    for(const evidence of [product.arrivalEvidence,product.officialProductEvidence,product.officialImageEvidence,product.sourceTileBinding])assert.equal(evidence.contentHash,hash);
    assert(officialEvidenceFor(product,'2026-11-05'));
    const curated=curateProduct(product,'2026-11-05');assert(curated.product,curated.reason);
    const run=await collectNewArrivals({brands:[],sources:{},now,log:()=>{},skipDiscovery:true,strictLuxuryTileProofs:true,
      carriedPending:[{brand:'Dior',candidate}],read:async()=>{throw Error('blocked PDP must not be read');}});
    assert.equal(run.pending.length,0);assert.equal(run.products.length,1);assert.equal(run.candidateOutcomes[0].outcome,'complete');
  }
});

test('Korean title support rejects socks, heels, broad shoe names, unbound images and mismatching own alt/hash',()=>{
  const own=tileCandidate(ownTile.replaceAll('Runner sneaker','B57 스니커즈')),at=now.toISOString();
  for(const name of ['양말','가죽 슈즈','스니커즈 heels','스니커즈 하이힐','スニーカー']){
    assert.equal(strictLuxuryTileProduct({...own,name,linkedImages:[{url:opaqueImage,alt:name}]},at),null,name);
  }
  assert.equal(strictLuxuryTileProduct({...own,linkedImages:[],images:own.linkedImages},at),null);
  assert.equal(strictLuxuryTileProduct({...own,linkedImages:[{url:opaqueImage,alt:'다른 스니커즈'}]},at),null);
  assert.equal(strictLuxuryTileProduct({...own,arrivalEvidence:{...own.arrivalEvidence,contentHash:''}},at),null);
  assert.equal(strictLuxuryTileProduct({...own,arrivalEvidence:{...own.arrivalEvidence,productUrl:product(2)}},at),null);
});

test('the strict nested tile proof also validates a luxury assortment source without claiming a PDP read',async()=>{
  const run=await collectNewArrivals({...options,catalogueBrands:[brand],strictLuxuryTileProofs:true,read:async target=>{assert.equal(target,'https://r.jina.ai/'+root);return ownTile;}});
  assert.equal(run.pending.length,0);
  const p=run.products[0];
  assert.equal(p.arrivalEvidence.kind,'official-assortment-listing');
  assert.equal(p.productEvidenceUrl,root);
  assert(officialEvidenceFor(p,'2026-11-05'));
  const curated=curateProduct(p,'2026-11-05');
  assert(curated.product,curated.reason);
});

const fendiShelf='https://www.fendi.com/us-en/man/shoes/sneakers-white';
const fendiProducts=[
  {url:'https://www.fendi.com/us-en/man/shoes/fendi-fender-sneakers-brown-and-black-cavallino-low-top-sneaker-7e1958b187f1xix',sku:'7e1958b187f1xix',name:'Fendi Fender sneakers'},
  {url:'https://www.fendi.com/us-en/man/shoes/fendi-wrap-sneakers-black-suede-and-fabric-low-top-7e1968ay0tf08m4',sku:'7e1968ay0tf08m4',name:'Fendi Wrap sneakers'},
];
const fendiImage=(sku,slot='01')=>`https://static.fendi.com/dam/is/image/fendi/${sku.toUpperCase()}_${slot}?wid=1200`;
const fendiListing='# Sneakers\n2 products\n'+fendiProducts.map(({url,sku,name})=>`![${name}](${fendiImage(sku,'02')})\n[](${url})\n![${name}](${fendiImage(sku)})\n[${name}](${url})`).join('\n')+
  `\n![Neighbour other colour](${fendiImage('7e1958b187f1xxx')})\n![Wrong CDN](https://other.example/dam/is/image/fendi/7E1958B187F1XIX_01)\n[Sneakers white](${fendiShelf})`;

test('Fendi full-code product paths are discovered while sneakers-white navigation and other hosts stay nonproducts',()=>{
  const rows=parseArrivalListing(fendiListing,{brand:'Fendi',url:fendiShelf,basis:'assortment',checkedAt:now.toISOString()});
  assert.deepEqual(rows.map(c=>c.url),fendiProducts.map(p=>p.url));
  for(const {url} of fendiProducts){
    assert.equal(isNewListing(url,'# New In'),false,'a known Fendi PDP cannot become a listing');
    assert.equal(isNewListing(url.replace('www.fendi.com','example.com'),'# New In'),true,'the trailing-code rule is Fendi-host-specific');
  }
  assert.equal(isNewListing(fendiShelf,'# New In'),true);
});

test('Fendi sibling-anchor images bind only their exact full SKU plus colour, prefer 01 and publish without PDPs',async()=>{
  const calls=[];
  const run=await collectNewArrivals({brands:['Fendi'],sources:{Fendi:[{url:fendiShelf,basis:'assortment'}]},catalogueBrands:['Fendi'],now,log:()=>{},completionProof:true,read:async target=>{calls.push(target);assert.equal(target,'https://r.jina.ai/'+fendiShelf);return fendiListing;}});
  assert.equal(calls.length,1);
  assert.equal(run.products.length,2);
  assert.equal(run.pending.length,0);
  assert.equal(run.coverage[0].exhaustive,true);
  const hash=createHash('sha256').update(fendiListing).digest('hex');
  const candidates=parseArrivalListing(fendiListing,{brand:'Fendi',url:fendiShelf,basis:'assortment',checkedAt:now.toISOString()});
  for(let i=0;i<fendiProducts.length;i++){
    const {sku,url}=fendiProducts[i],c=candidates[i],p=run.products[i];
    assert.deepEqual(c.linkedImages,[],'sibling images are never relabelled as nested images');
    assert.deepEqual(c.skuBoundImages.map(image=>image.url),[fendiImage(sku),fendiImage(sku,'02')]);
    assert.equal(p.style,sku,'the full code including colour is preserved and casefolded');
    assert.equal(p.url,url);
    assert.equal(p.image,fendiImage(sku));
    assert.equal(p.productEvidenceUrl,fendiShelf);
    assert.deepEqual(p.sourceSkuBinding,{verified:true,brand:'Fendi',url,image:p.image,style:sku,sourceUrl:fendiShelf,contentHash:hash,method:'official-full-sku-image'});
    for(const e of [p.arrivalEvidence,p.officialProductEvidence,p.officialImageEvidence])assert.equal(e.contentHash,hash);
    assert(officialEvidenceFor(p,'2026-11-05'));
    const curated=curateProduct(p,'2026-11-05');assert(curated.product,curated.reason);
    assert.equal(listingProduct({...c,skuBoundImages:c.skuBoundImages.map(image=>({...image,contentHash:'other-page'}))},now.toISOString()),null);
    assert.equal(listingProduct({...c,skuBoundImages:candidates[1-i].skuBoundImages},now.toISOString()),null);
  }
});

test('Fendi PDP image matching uses the entire URL SKU case-insensitively and rejects another colour',()=>{
  const {sku,url,name}=fendiProducts[0],candidate={brand:'Fendi',name,url,linkedImages:[],arrivalEvidence:{verified:true,brand:'Fendi',productUrl:url,url:fendiShelf,kind:'official-assortment-listing',excerpt:'Official sneaker shelf',contentHash:'a'.repeat(64),verifiedAt:now.toISOString()}};
  const p=pageProduct(candidate,`# ${name}\n![Side](${fendiImage(sku)})`,now.toISOString());
  assert(p);
  assert.equal(p.style,sku);
  assert.equal(p.image,fendiImage(sku));
  assert(officialEvidenceFor(p,'2026-11-05'));
  assert.equal(pageProduct(candidate,`# ${name}\n![Side](${fendiImage('7e1958b187f1xxx')})`,now.toISOString()),null);
  const upper=pageProduct({...candidate,url:url.replace(sku,sku.toUpperCase())},`# ${name}\n![Side](${fendiImage(sku)})`,now.toISOString());
  assert.equal(upper.style,sku);
});
