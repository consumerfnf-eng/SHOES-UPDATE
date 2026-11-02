import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArrivalListing,listingFollowups,maisonShelfProduct,listingProduct,collectNewArrivals} from '../scripts/new-arrivals.mjs';
import {curateProduct} from '../scripts/curation.mjs';
import {releaseState} from '../public/assets/release-window.mjs';
const today='2026-11-02',url='https://www.ysl.com/en-us/p/court-classic-sneaker-ABC123.html',shelf='https://www.ysl.com/en-us/ca/shop-women/shoes/sneakers';
const raw={id:'lux-all',brand:'Saint Laurent',name:'Court Classic sneaker',style:'ABC123',url,image:'https://www.ysl.com/ABC123_A.jpg',description:'Leather sneakers with a rubber sole',releaseDate:'2020-01-01',firstPublishedAt:'2020-01-02T00:00:00Z',arrivalEvidence:{verified:true,brand:'Saint Laurent',style:'ABC123',productUrl:url,kind:'official-assortment-listing',url:shelf,verifiedAt:'2026-11-02T00:00:00Z',excerpt:'Official current sneaker card',contentHash:'a'.repeat(64)}};
test('official LUX assortment includes older sneakers past the publication window',()=>{
 const result=curateProduct(raw,today);assert(result.product,result.reason);assert.equal(result.expired,false);assert.equal(releaseState(result.product,today),'released');assert.equal(result.product.releaseDate,'2020-01-01');
 assert(!curateProduct({...raw,name:'Opyum high heel pumps'},today).product);
 assert(!curateProduct({...raw,arrivalEvidence:{...raw.arrivalEvidence,verified:false}},today).product);
});
test('assortment pages collect unbadged cards while normal collection still requires NEW',()=>{
 const text=`# Sneakers\n[![Court Classic sneaker](https://www.ysl.com/ABC123_A.jpg) Court Classic sneaker](${url})`;
 assert.equal(parseArrivalListing(text,{brand:'Saint Laurent',url:shelf,checkedAt:'2026-11-02T00:00:00Z'}).length,0);
 assert.equal(parseArrivalListing(text,{brand:'Saint Laurent',url:shelf,checkedAt:'2026-11-02T00:00:00Z',basis:'assortment'})[0].arrivalEvidence.kind,'official-assortment-listing');
});

test('Zegna dotted product URLs are products rather than lost category links',()=>{
 const product='https://www.zegna.com/us-en/shoes/sneakers/product.white-suede-232-sneakers.37109540/';
 const text=`# Sneakers\n[![White Suede 232 Sneakers](https://productimage.zegna.com/is/image/zegna/232-F) White Suede 232 Sneakers](${product})`;
 const rows=parseArrivalListing(text,{brand:'Zegna',url:'https://www.zegna.com/us-en/shoes/sneakers/',checkedAt:'2026-11-02T00:00:00Z',basis:'assortment'});
 assert.equal(rows.length,1);
 assert.equal(rows[0].url,product);
 assert.equal(rows[0].linkedImages.length,1);
});

test('bare numbered pagination follows the same official shelf only',()=>{
 const shelf='https://us.loropiana.com/en/c/shoes/man/sneakers';
 const rows=listingFollowups(`${shelf}?page=2\nhttps://evil.test/?page=2\nhttps://us.loropiana.com/en/c/man?page=2\n${shelf}?page=1`,shelf,'Loro Piana');
 assert.deepEqual(rows.map(r=>r.url),[shelf+'?page=2']);
});

test('Jil Sander shoe names inherit sneaker type only from the exact official sneaker shelf',()=>{
 const p='https://www.jilsander.com/en-us/elbe-lace-up-shoe/J32WS0073P7892001.html';
 const text=`# Sneakers\n[![Elbe Lace-Up Shoe](https://www.jilsander.com/images/ELBE.jpg) Elbe Lace-Up Shoe](${p})`;
 const rows=parseArrivalListing(text,{brand:'Jil Sander',url:'https://www.jilsander.com/en-us/men/shoes/sneakers',checkedAt:'2026-11-02T00:00:00Z',basis:'assortment'});
 assert.equal(maisonShelfProduct(rows[0],'2026-11-02T00:00:00Z').officialCategory,'Sneakers');
 assert.equal(maisonShelfProduct({...rows[0],arrivalEvidence:{...rows[0].arrivalEvidence,url:'https://www.jilsander.com/en-us/men/shoes'}},'2026-11-02T00:00:00Z'),null);
});

test('Valentino extensionless product cards bind the actual title and colour',()=>{
 const url='https://www.valentino.com/en-us/product-upvillage-crosta-sneaker-WS0IL9MBM_BQG';
 const text=`# Sneakers\n[![Image 1: Valentino Garavani - Upvillage Crosta Sneaker - Green/ivory - Woman - Sneakers](https://valentino-cdn.thron.com/own.jpg)](${url})`;
 const rows=parseArrivalListing(text,{brand:'Valentino Garavani',url:'https://www.valentino.com/en-us/women/shoes/sneakers',checkedAt:'2026-11-02T00:00:00Z',basis:'assortment'});
 assert.equal(rows.length,1);
 assert.equal(listingProduct(rows[0],'2026-11-02T00:00:00Z').name,'Upvillage Crosta Sneaker');
 assert.equal(listingProduct(rows[0],'2026-11-02T00:00:00Z').colorway,'Green/ivory');
});

test('a store that repeats the same products on the next page does not spend the entire page budget',async()=>{
 const shelf='https://www.valentino.com/en-us/women/shoes/sneakers';
 let reads=0;
 const run=await collectNewArrivals({brands:['Valentino Garavani'],sources:{'Valentino Garavani':[{url:shelf,basis:'assortment'}]},catalogueBrands:['Valentino Garavani'],log:()=>{},read:async()=>{
  reads++;
  return `# Sneakers\n[![Upvillage Sneaker](https://valentino-cdn.thron.com/own.jpg) Upvillage Sneaker](https://www.valentino.com/en-us/product-upvillage-sneaker-WS0IL9MBM_BQG)\n${shelf}?pagination=${reads+1}`;
 }});
 assert.equal(reads,2);
 assert.equal(run.coverage[0].repeatedListingPages,1);
});
