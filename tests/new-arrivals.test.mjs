import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseArrivalListing,isNewListing,listingProduct,listingFollowups,collectNewArrivals} from '../scripts/new-arrivals.mjs';
import {releaseState} from '../public/assets/release-window.mjs';
import {publicationWindow} from '../public/assets/publication-window.mjs';
import {curateProduct,officialHybridReview} from '../scripts/curation.mjs';
import {publishCurated,atomicJson} from '../scripts/publish-curated.mjs';
import {eligibilityReason} from '../scripts/archive-expired.mjs';
const now=new Date('2026-10-07T01:00:00Z'),today='2026-10-07';
test('an incomplete product image gallery gets a rendered detail retry without trusting a different product',async()=>{
 const source='https://www.prada.com/us/en/women/new-in.html',pdp='https://www.prada.com/us/en/p/runner-sneaker/ABC123';let retries=0;
 const run=await collectNewArrivals({sources:{Prada:[{url:source}]},brands:['Prada'],now,log:()=>{},read:async target=>target.endsWith(source)?`# New In\n[Runner sneaker](${pdp})`:'# Runner sneaker\nABC123\n![Runner sneaker](<Base64-Image-Removed>)',readDetails:async target=>{assert.equal(target,pdp);retries++;return `# Runner sneaker\nProduct code: ABC123\n![Runner sneaker side](https://www.prada.com/ABC123_SLS.jpg)\nRunner sneaker with rubber outsole.`;}});
 assert.equal(retries,1);assert.equal(run.products.length,1);assert.equal(run.products[0].officialImageEvidence.sourceUrl,pdp);assert.equal(run.products[0].style,'ABC123');
 const wrong=await collectNewArrivals({sources:{Prada:[{url:source}]},brands:['Prada'],now,log:()=>{},read:async target=>target.endsWith(source)?`# New In\n[Runner sneaker](${pdp})`:'# Runner sneaker',readDetails:async()=>'# Leather handbag\n![Handbag](https://www.prada.com/bag.jpg)'});
 assert.equal(wrong.products.length,0);
});
const url='https://www.prada.com/us/en/p/runner/ABC123';
test('linked galleries match an exact Cecilie shoe code and recover a model name from carousel-only labels',async()=>{
 const source='https://www.ceciliebahnsen.com/collections/new-in',pdp='https://ceciliebahnsen.com/products/3-26ftw30002-cbblaise-soft-sneakers-leather-nylon-silver-mint',img='https://ceciliebahnsen.com/cdn/shop/files/3.26FTW30002CBBLAISE_Side.jpg';
 const run=await collectNewArrivals({sources:{'Cecilie Bahnsen':[{url:source}]},brands:['Cecilie Bahnsen'],now,log:()=>{},read:async target=>target.endsWith(source)?`# New In\n[CBBlaise Shoes](${pdp})`:`[![CBBLAISE | SOFT SNEAKERS SILVER/MINT](${img})](${img})\n# CBBlaise Shoes\nSoft leather sneakers with rubber sole.`});
 assert.equal(run.products.length,1);assert.equal(run.products[0].image,img);assert.equal(run.products[0].colorway,'SILVER/MINT');assert.equal(run.products[0].officialCategory,'Sneakers');
 const rows=parseArrivalListing('# New In\n[![LOEWE Pogo sneaker Grey/White](https://www.loewe.com/P123.jpg) New in - Slide 0 - Slide 1](https://www.loewe.com/usa/en/women/shoes/sneakers/pogo/P123.html)',{brand:'Loewe',url:'https://www.loewe.com/usa/en/women/new-in',checkedAt:now.toISOString()});
 assert.equal(rows[0].name,'Pogo sneaker Grey/White');assert(rows[0].needsProductTitle);assert.equal(listingProduct(rows[0],now.toISOString()),null);
});
test('configured regional sources are attempted before one catalogue consumes the page limit',async()=>{
 const a='https://www.prada.com/us/en/new-in',b='https://www.prada.com/gb/en/new-in',calls=[];
 await collectNewArrivals({sources:{Prada:[{url:a},{url:b}]},brands:['Prada'],maxPagesPerBrand:2,now,log:()=>{},read:async target=>{calls.push(target);return `# New In\n[Next](${a}?page=2)`;}});
 assert.deepEqual(calls,['https://r.jina.ai/'+a,'https://r.jina.ai/'+b]);
});
function product(){const base={verified:true,brand:'Prada',style:'ABC123',verifiedAt:now.toISOString()};return {id:'new-prada',brand:'Prada',name:'Runner sneakers',style:'ABC123',url,image:'https://www.prada.com/ABC123_SLR.jpg',description:'Mesh sneakers with rubber soles',colorway:'Red',country:'US',productVerifiedAt:now.toISOString(),productEvidenceUrl:url,officialProductEvidence:{...base,url},officialImageEvidence:{...base,url:'https://www.prada.com/ABC123_SLR.jpg',sourceUrl:url},arrivalEvidence:{...base,productUrl:url,url:'https://www.prada.com/us/en/womens/new-in/c/10111US',kind:'new-arrivals-listing',excerpt:'Official New In listing: Runner sneakers',contentHash:'a'.repeat(64)}};}
test('official New Arrivals can publish without inventing a release day; unrelated proof fails',()=>{
 const p=product(),r=curateProduct(p,today);assert(r.product);assert.equal(r.product.releaseDate,'');assert.equal(r.product.dateEvidence,undefined);
 for(const patch of [{verified:false},{kind:'newest'},{productUrl:'https://www.prada.com/other'},{style:'OTHER'},{url:'https://retailer.example/new-arrivals'}])assert(!curateProduct({...p,arrivalEvidence:{...p.arrivalEvidence,...patch}},today).product);
 for(const name of ['Platform loafers','Mary Jane pumps','Slingback sneakers','Leather oxford shoes','Speedcat Wedge','메리제인 구두','플랫폼 힐'])assert(!curateProduct({...p,name},today).product,name);
});
test('a shortened ballet model title retains its verified official sneaker category',()=>{
 const p={...product(),name:'Runner Ballet Dress-Up',officialCategory:'Sneakers',description:'Runner Ballet Dress-Up Sneakers with straps and a rubber outsole'};
 p.hybridReview=officialHybridReview(p,p.description,now.toISOString());assert(p.hybridReview?.approved);assert.equal(curateProduct(p,today).product.category,'hybrid');
 assert(!curateProduct({...p,name:'Runner Ballet Slingback'},today).product);
});
test('a product-linked official listing image is evidence at the listing URL, not a claimed PDP fetch',()=>{
 const p=product(),source=p.arrivalEvidence.url;
 const rows=parseArrivalListing(`# New In\n[![Runner sneakers](https://www.prada.com/ABC123_SLS.jpg) **Runner sneakers** $900](${url})`,{brand:'Prada',url:source,checkedAt:now.toISOString()});
 const listed=listingProduct(rows[0],now.toISOString());assert(listed);assert.equal(listed.style,'ABC123');assert.equal(listed.productEvidenceUrl,source);assert.equal(listed.officialImageEvidence.sourceUrl,source);assert(curateProduct(listed,today).product);
 assert(!curateProduct({...listed,officialImageEvidence:{...listed.officialImageEvidence,contentHash:'different'}},today).product);
 const unbound=parseArrivalListing(`# New In\n![Runner sneakers](https://www.prada.com/ABC123_SLS.jpg)\n[Runner sneakers](${url})`,{brand:'Prada',url:source,checkedAt:now.toISOString()});assert.equal(listingProduct(unbound[0],now.toISOString()),null);
 const sku='1E490O_3ZM0_F0007_F_005';assert.equal(listingProduct({...rows[0],url:'https://www.prada.com/us/en/p/speedrock/'+sku},now.toISOString()).style,sku);
});
test('three calendar months run from first publication, including KST midnight and month end',()=>{
 const p={...product(),firstPublishedAt:'2026-10-06T15:00:00Z',releaseDate:'2020-01-01'};
 assert.deepEqual(publicationWindow(p),{start:'2026-10-07',end:'2027-01-07'});
 assert.equal(releaseState(p,'2027-01-06'),'released');assert.equal(releaseState(p,'2027-01-07'),'expired');
 assert.equal(publicationWindow({firstPublishedAt:'2026-11-30T01:00:00Z'}).end,'2027-02-28');
 assert.equal(publicationWindow({firstPublishedAt:'2023-11-30T01:00:00Z'}).end,'2024-02-29');
 const curated=curateProduct({...p,releaseDate:''},today).product;
 assert.equal(eligibilityReason(curated,new Date('2027-01-06T14:59:59Z')),'not-expired');
 assert.equal(eligibilityReason(curated,new Date('2027-01-06T15:00:00Z')),null);
});
test('opaque model names retain official running classification and nested image URL parameters',()=>{
 const productUrl='https://www.asics.com/us/en-us/gel-kayano/p/ANA_1012C073-400.html';
 const md=`# New Arrivals\n[![GEL-KAYANO, Lavender 1](https://images.asics.com/1012C073_400_SL_LT_GLB.jpg?im=Resize=(600,600))\nNext slide\nGEL-KAYANO\nWomen's Running Shoes\n$180](${productUrl})`;
 const [candidate]=parseArrivalListing(md,{brand:'ASICS',url:'https://www.asics.com/us/en-us/new-arrivals/',checkedAt:now.toISOString()});
 assert.match(candidate.name,/Running Shoes/);const p=listingProduct(candidate,now.toISOString());assert.equal(p.style,'1012C073-400');assert(p.image.endsWith('Resize=(600,600)'));assert(curateProduct(p,today).product);
});
test('New collection footwear filters inherit membership without treating unrelated filters as New',()=>{
 const parent='https://www.balenciaga.com/en-us/women/discover-women',target='https://www.balenciaga.com/en-us/searchajax?cgid=discover_women&prefv3=bal_sneakers';
 const nav={kind:'new-arrivals-navigation',url:'https://www.balenciaga.com/en-us/women/shoes-for-women',targetUrl:parent,contentHash:'a'.repeat(64)};
 const [next]=listingFollowups(`[Sneakers (19)](${target})`,parent,'Balenciaga',nav);assert.equal(next.url,target);
 const rows=parseArrivalListing('[Speed sneakers](https://www.balenciaga.com/en-us/speed-123456.html)',{brand:'Balenciaga',url:target,sectionEvidence:next.sectionEvidence,checkedAt:now.toISOString()});assert.equal(rows.length,1);
 assert.equal(listingFollowups(`[Sneakers (19)](${target})`,parent,'Balenciaga').length,0);
});
test('a New badge binds to its own product and newest sorting does not prove New membership',()=>{
 const context={brand:'Prada',url:'https://www.prada.com/us/en/womens/shoes',checkedAt:now.toISOString()};
 const md=`# Shoes\n\nNew\n\n[![Red sneaker](https://www.prada.com/red.jpg)\n**Red sneaker**\n$ 900](${url})\n\n[![Blue sneaker](https://www.prada.com/blue.jpg)](https://www.prada.com/us/en/p/runner/BLUE123)`;
 const rows=parseArrivalListing(md,context);assert.equal(rows.length,1);assert.equal(rows[0].url,url);assert.equal(rows[0].images[0].url,'https://www.prada.com/red.jpg');
 assert(!isNewListing('https://www.gucci.com/shoes?sort=newest'));assert.equal(parseArrivalListing(md.replace('New\n\n',''),context).length,0);
 assert(!isNewListing('https://www.miumiu.com/us/en/p/new-balance-sneakers/ABC123'));
 assert.equal(parseArrivalListing(md,{...context,url:'https://www.prada.com/us/en/womens/new-in/c/10111US'}).length,2);
});
test('navigation popups do not truncate products and category redirects are never product evidence',()=>{
 const md=`## SUBSCRIBE TO OUR NEWSLETTER\nNavigation\n## New Arrivals\n[![Runner sneakers](https://www.prada.com/ABC123_SLS.jpg) **Runner sneakers**](${url})\n[![Court](https://www.prada.com/court.jpg) Court Sneakers](https://www.prada.com/geored?urlInn=mens/shoes/court/c/11007.html)`;
 const rows=parseArrivalListing(md,{brand:'Prada',url:'https://www.prada.com/new/',checkedAt:now.toISOString()});assert.equal(rows.length,1);assert.equal(rows[0].url,url);
 const lateHeading=md+'\n# New Arrivals';assert.equal(parseArrivalListing(lateHeading,{brand:'Prada',url:'https://www.prada.com/new/',checkedAt:now.toISOString()}).length,1);
});
test('recollection never renews publication age and an undated item remains queued after removal',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-arrivals-'));
 try{
  await atomicJson(path.join(dir,'data/catalog-source.json'),{products:[product()]});
  const first=await publishCurated({directory:dir,now});assert.equal(first.snapshot.products.length,1);
  const second=await publishCurated({directory:dir,now:new Date('2026-11-01T00:00:00Z'),incoming:[{...product(),firstPublishedAt:'2026-11-01T00:00:00Z'}]});
  assert.equal(second.snapshot.products[0].firstPublishedAt,now.toISOString());
  const expired=await publishCurated({directory:dir,now:new Date('2027-01-07T00:00:00Z'),maintenance:true});
  assert.equal(expired.snapshot.products.length,0);assert.equal(expired.queue.products.length,1);assert.equal(expired.queue.products[0].releaseDate,'');
  await atomicJson(path.join(dir,'data/catalog-source.json'),{products:[]});
  const retry=await publishCurated({directory:dir,now:new Date('2027-01-08T00:00:00Z'),maintenance:true});assert.equal(retry.queue.products.length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('legacy release-based queue entries wait for their migrated publication anniversary',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-legacy-queue-'));
 try{
  const p=product();await atomicJson(path.join(dir,'data/catalog-source.json'),{products:[]});
  await atomicJson(path.join(dir,'data/archive-queue.json'),{products:[p]});
  await atomicJson(path.join(dir,'data/publication-history.json'),{entries:{[p.id]:{firstPublishedAt:now.toISOString()}}});
  const current=await publishCurated({directory:dir,now,maintenance:true});assert.equal(current.queue.products.length,0);assert.equal(current.queue.deferred.length,1);
  const due=await publishCurated({directory:dir,now:new Date('2027-01-07T00:00:00Z'),maintenance:true});assert.equal(due.queue.deferred.length,0);assert.equal(due.queue.products.length,1);assert.equal(due.queue.products[0].firstPublishedAt,now.toISOString());
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
