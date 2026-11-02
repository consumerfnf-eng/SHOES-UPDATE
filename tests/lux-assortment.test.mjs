import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArrivalListing} from '../scripts/new-arrivals.mjs';
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
