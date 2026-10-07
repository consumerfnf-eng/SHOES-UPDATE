import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseArrivalListing,isNewListing,listingProduct,listingFollowups} from '../scripts/new-arrivals.mjs';
import {releaseState} from '../public/assets/release-window.mjs';
import {publicationWindow} from '../public/assets/publication-window.mjs';
import {curateProduct} from '../scripts/curation.mjs';
import {publishCurated,atomicJson} from '../scripts/publish-curated.mjs';
import {eligibilityReason} from '../scripts/archive-expired.mjs';
const now=new Date('2026-10-07T01:00:00Z'),today='2026-10-07';
const url='https://www.prada.com/us/en/p/runner/ABC123';
function product(){const base={verified:true,brand:'Prada',style:'ABC123',verifiedAt:now.toISOString()};return {id:'new-prada',brand:'Prada',name:'Runner sneakers',style:'ABC123',url,image:'https://www.prada.com/ABC123_SLR.jpg',description:'Mesh sneakers with rubber soles',colorway:'Red',country:'US',productVerifiedAt:now.toISOString(),productEvidenceUrl:url,officialProductEvidence:{...base,url},officialImageEvidence:{...base,url:'https://www.prada.com/ABC123_SLR.jpg',sourceUrl:url},arrivalEvidence:{...base,productUrl:url,url:'https://www.prada.com/us/en/womens/new-in/c/10111US',kind:'new-arrivals-listing',excerpt:'Official New In listing: Runner sneakers',contentHash:'a'.repeat(64)}};}
test('official New Arrivals can publish without inventing a release day; unrelated proof fails',()=>{
 const p=product(),r=curateProduct(p,today);assert(r.product);assert.equal(r.product.releaseDate,'');assert.equal(r.product.dateEvidence,undefined);
 for(const patch of [{verified:false},{kind:'newest'},{productUrl:'https://www.prada.com/other'},{style:'OTHER'},{url:'https://retailer.example/new-arrivals'}])assert(!curateProduct({...p,arrivalEvidence:{...p.arrivalEvidence,...patch}},today).product);
 for(const name of ['Platform loafers','Mary Jane pumps','Slingback sneakers','Leather oxford shoes','Speedcat Wedge','메리제인 구두','플랫폼 힐'])assert(!curateProduct({...p,name},today).product,name);
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
