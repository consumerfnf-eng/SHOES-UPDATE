import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectCucinelliOfficial,parseCucinelliListing,CUCINELLI_BRAND,CUCINELLI_SOURCES} from '../scripts/collect-cucinelli-official.mjs';
import {officialEvidenceFor,curateProduct} from '../scripts/curation.mjs';
import {mergeCollectedRuns} from '../scripts/admin-collected-union.mjs';

const at='2026-11-05T09:00:00.000Z',now=new Date(at);
const [men,women]=CUCINELLI_SOURCES;
const first='262MZUSNEO355CGC76',second='262MZUSNEO355CW751',woman='262MZKTSG365CHY56';
const image=(sku,slot='F',host='media.brunellocucinelli.com')=>`https://${host}/brunellocucinelli-dynamic/image/upload/f_auto,q_auto,w_900/v1787552293/${sku}_${slot}.jpg?_i=AG`;
const url=(sku,source=men)=>`${source}nubuck-and-suede-runners-${sku}.html`;
function tile(sku,{source=men,color='Sand',src=image(sku),outside=false,testId=sku}={}){
  const gender=source===women?'Woman':'Man',img=`<img alt="Nubuck and suede runners ${color} ${gender} - Brunello Cucinelli" src="${src}">`;
  return (outside?img:'')+`<a aria-label="Nubuck and suede runners - ${color} - ${gender} - Brunello Cucinelli" data-testid="product-tile-${testId}-link" href="${url(sku,source)}">${outside?'':img}</a>`+
    `<a href="${url(sku,source)}"><p>Nubuck and suede runners</p><p>AED 4.850,00</p></a>`;
}
function document(tiles,{source=men,last=1,total=1,next='',counter=true,category='Sneakers',id,extra=''}={}){
  const pathname=new URL(source).pathname,categoryId=id||(source===women?'woman-shoes-sneakers':'man-shoes-sneakers');
  const state={__PRELOADED_STATE__:{__reactQuery:{queries:[{queryKey:['urlMapping',pathname,'category-only'],state:{data:{pageIdData:{resourceId:categoryId,resourceType:'category',urlSegment:pathname},categoryData:{id:categoryId,name:category}}}}]}}};
  return `<html><head><script id="mobify-data" type="application/json">${JSON.stringify(state)}</script></head><body><h1>Sneakers</h1>${tiles}<div id="pagination">${counter?`<p>1-${last} of ${total} products</p>`:''}${next?`<a href="${next.replaceAll('&','&amp;')}">VIEW 1 MORE</a>`:''}</div>${extra}</body></html>`;
}
const options={now};

test('exact official colour SKU tile proofs validate and survive the admin union gate',async()=>{
  const menHtml=document(tile(first)),womenHtml=document(tile(woman,{source:women}),{source:women});
  const checkpoints=[];
  const run=await collectCucinelliOfficial({...options,read:async source=>source===men?menHtml:womenHtml,onProgress:s=>checkpoints.push(s)});
  assert.equal(run.brand,CUCINELLI_BRAND);
  assert.equal(run.products.length,2);
  assert.equal(run.pending.length,0);
  assert.equal(run.listingPending.length,0);
  assert.equal(run.coverage[0].exhaustive,true);
  assert.equal(run.coverage[0].completionProof.method,'source-declared-colour-sku-enumeration');
  assert.equal(checkpoints[0].listingPending[0].source.url,women,'unread configured shelves are checkpointed');
  for(const p of run.products){
    assert.equal(p.styleType,'official-product-id');
    assert.equal(p.officialProductEvidence.verificationMethod,'official-new-listing-sku-image');
    assert.equal(p.officialImageEvidence.sourceUrl,p.productEvidenceUrl);
    const hash=createHash('sha256').update(p.gender==='Men'?menHtml:womenHtml).digest('hex');
    for(const e of [p.arrivalEvidence,p.officialProductEvidence,p.officialImageEvidence,p.sourceSkuBinding])assert.equal(e.contentHash,hash);
    assert(officialEvidenceFor(p,'2026-11-05'));
    const curated=curateProduct(p,'2026-11-05');assert(curated.product,curated.reason);
  }
  assert.equal(mergeCollectedRuns([run],[CUCINELLI_BRAND]).length,2);
});

test('cumulative source-declared pagination exhausts exact unique colours without double-counting previous pages',async()=>{
  const next=men+'?start=1&sz=2',calls=[],checkpoints=[];
  const pages=new Map([[men,document(tile(first),{total:2,next})],[next,document(tile(first)+tile(second,{color:'White'}),{last:2,total:2})]]);
  const run=await collectCucinelliOfficial({...options,sources:[men],read:async source=>{calls.push(source);return pages.get(source);},onProgress:s=>checkpoints.push(s)});
  assert.deepEqual(calls,[men,next]);
  assert.equal(run.products.length,2);
  assert.deepEqual(run.products.map(p=>p.style).sort(),[first,second].sort());
  assert.equal(run.coverage[0].sources[0].uniqueObserved,2);
  assert.equal(run.coverage[0].exhaustive,true);
  assert.equal(checkpoints[0].listingReceipts.length,1);
  assert.equal(checkpoints[0].listingPending[0].source.url,next);
  assert.equal(checkpoints[0].coverage[0].exhaustive,false);
});

test('another colour, partial model code, foreign host or adjacent image cannot satisfy a tile',()=>{
  for(const config of [
    {src:image(second)},
    {src:image('262MZUSNEO355')},
    {src:image(first,'F','images.example.com')},
    {outside:true},
  ]){
    const run=parseCucinelliListing(document(tile(first,config)),{url:men,checkedAt:at});
    assert.equal(run.products.length,0,JSON.stringify(config));
    assert.equal(run.pending.length,1);
    assert.equal(run.outcomes[0].outcome,'unverified');
  }
});

test('two colours bind only their own SKU and prefer an observed F image over D',()=>{
  const tiles=tile(first,{src:image(first,'D')}).replace('</a>',`<img src="${image(first)}" alt="Own F"></a>`)+tile(second,{color:'White'});
  const run=parseCucinelliListing(document(tiles,{last:2,total:2}),{url:men,checkedAt:at});
  assert.equal(run.products.length,2);
  assert.equal(run.products[0].image,image(first));
  assert.equal(run.products[1].image,image(second));
  assert.equal(run.products[0].colorway,'Sand');
  assert.equal(run.products[1].colorway,'White');
  assert(run.products[0].imageCandidates.every(i=>i.url.includes(first)));
});

test('missing Next never proves exhaustion when counter or items are missing, mixed or zero',async()=>{
  const cases=[
    document(tile(first),{counter:false}),
    document(tile(first),{last:1,total:2}),
    document(tile(first)+tile(second),{last:1,total:1}),
    document('',{last:0,total:0}),
    document(tile(first),{counter:false,extra:'<p>This shoe pairs with 1 products.</p>'}),
    document(tile(first),{extra:'<script>window.counter="1-1 of 1 products";</script>'}).replace('1-1 of 1 products','1-1 of 2 products'),
    document(tile(first)).replace('</p></div>','</p><p>1-1 of 2 products</p></div>'),
  ];
  for(const html of cases){
    const run=await collectCucinelliOfficial({...options,sources:[men],read:async()=>html});
    assert.equal(run.coverage[0].exhaustive,false,html);
  }
});

test('an unverified item blocks completion even when the terminal source counter matches all grid SKUs',async()=>{
  const html=document(tile(first)+tile(second,{src:image(first)}),{last:2,total:2});
  const run=await collectCucinelliOfficial({...options,sources:[men],read:async()=>html});
  assert.equal(run.products.length,1);
  assert.equal(run.pending.length,1);
  assert.equal(run.coverage[0].sources[0].uniqueObserved,2);
  assert.equal(run.coverage[0].exhaustive,false);
  assert(run.coverage[0].sources[0].reasons.includes('candidate-proof-pending'));
});

test('page budget and source failures retain unread listing work and block exhaustion',async()=>{
  const next=men+'?start=1&sz=2';
  const firstPage=document(tile(first),{total:2,next});
  const limited=await collectCucinelliOfficial({...options,sources:[men],maxPagesPerSource:1,read:async()=>firstPage});
  assert.equal(limited.listingPending[0].source.url,next);
  assert.equal(limited.coverage[0].exhaustive,false);
  const failed=await collectCucinelliOfficial({...options,sources:[men],read:async source=>{if(source===next)throw Error('timeout');return firstPage;}});
  assert.equal(failed.products.length,1);
  assert.equal(failed.listingPending[0].source.url,next);
  assert.equal(failed.coverage[0].errors[0].error,'timeout');
  assert.equal(failed.coverage[0].exhaustive,false);
});

test('source-declared followups cannot escape the configured sneaker category',async()=>{
  const run=await collectCucinelliOfficial({...options,sources:[men],read:async()=>document(tile(first),{next:women+'?start=1&sz=2'})});
  assert.equal(run.coverage[0].exhaustive,false);
  assert.equal(run.listingPending[0].source.url,men);
  assert(run.coverage[0].errors.some(e=>e.error==='CUCINELLI_PAGINATION_SCOPE_MISMATCH'));
});

test('the official category mapping and full SKU grid identity are mandatory',()=>{
  assert.throws(()=>parseCucinelliListing(document(tile(first),{category:'Loafers'}),{url:men,checkedAt:at}),/CATEGORY_MAPPING_MISMATCH/);
  assert.throws(()=>parseCucinelliListing(document(tile(first),{id:'man-shoes'}),{url:men,checkedAt:at}),/CATEGORY_MAPPING_MISMATCH/);
  assert.throws(()=>parseCucinelliListing(document(tile(first)).replace('id="mobify-data"','id="other"'),{url:men,checkedAt:at}),/CATEGORY_MAPPING_MISSING/);
  assert.throws(()=>parseCucinelliListing(document(tile(first)),{url:men.replace('/sneakers/','/'),checkedAt:at}),/OUTSIDE_SNEAKER_SCOPE/);
  const mismatch=parseCucinelliListing(document(tile(first,{testId:second})),{url:men,checkedAt:at});
  assert.equal(mismatch.products.length,0);
  assert.equal(mismatch.errors[0].error,'CUCINELLI_TILE_SKU_URL_MISMATCH');
});

test('capture redirects, HTTP errors and repeated nonterminal grids cannot prove completion',async()=>{
  const html=document(tile(first));
  for(const value of [
    {url:men,rawHtml:html,metadata:{statusCode:403}},
    {url:women,rawHtml:html,metadata:{statusCode:200}},
    {url:men,metadata:{statusCode:200}},
  ]){
    const run=await collectCucinelliOfficial({...options,sources:[men],read:async()=>value});
    assert.equal(run.coverage[0].exhaustive,false);
    assert.equal(run.listingPending.length,1);
  }
  const next=men+'?start=1&sz=2';
  const repeated=await collectCucinelliOfficial({...options,sources:[men],read:async source=>document(tile(first),{total:2,next:source===men?next:men+'?start=2&sz=3'})});
  assert.equal(repeated.coverage[0].exhaustive,false);
  assert(repeated.coverage[0].errors.some(e=>e.error==='CUCINELLI_REPEATED_GRID_EXHAUSTION_UNPROVEN'));
});
