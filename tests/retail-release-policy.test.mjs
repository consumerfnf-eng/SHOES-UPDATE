// Synthetic fixtures only; never used as published evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {retailReleaseEligibility} from '../public/assets/retail-release-policy.mjs';

const TODAY='2026-11-03';           // cutoff is 2026-08-03 (three calendar months)
const URL='https://brand.example.com/sneaker/fa-123-white';

function proof(over={}){
  return {verified:true,kind:'first-release',firstRelease:true,date:'2026-10-20',
    authority:'brand-official',url:'https://brand.example.com/news/fa-123-launch',
    productUrl:URL,brand:'Common Projects',style:'FA-123',...over};
}
function product(over={},evidenceOver){
  return {brand:'Common Projects',url:URL,manufacturerStyle:'FA-123',
    releaseEvidence:evidenceOver===null?undefined:proof(evidenceOver),...over};
}
const listingNoise={listedAt:'2026-10-30',publishedAt:'2026-10-30T00:00:00Z',
  firstDetected:'2026-10-30',published_at:'2026-10-30T00:00:00Z',
  collections:['new-arrivals','current-assortment'],imagePath:'/img/2026/10/fa-123.jpg',
  seasonCode:'262MZSFG2110',inCurrentAssortment:true,regions:['KR','UAE']};

test('verified brand-official first release inside three calendar months qualifies',()=>{
  const out=retailReleaseEligibility(product(),TODAY);
  assert.deepEqual(out,{eligible:true,reason:'release-verified-within-three-calendar-months',
    releaseDate:'2026-10-20',cutoff:'2026-08-03'});
});

test('retailer-explicit-first-release is an accepted authority',()=>{
  assert.equal(retailReleaseEligibility(product({},{authority:'retailer-explicit-first-release'}),TODAY).eligible,true);
});

test('reissue and restock markers reject despite a recent listing',()=>{
  for(const [p,e] of [[{...listingNoise},{title:'Re-issue of the 2019 runway pair'}],
                      [{...listingNoise,isRestock:true},{}],
                      [{...listingNoise,releaseType:'restock'},{}],
                      [{},{basis:'back in stock at retailer'}],
                      [{},{release_type:'rerelease'}]]){
    const out=retailReleaseEligibility(product(p,e),TODAY);
    assert.equal(out.eligible,false);
    assert.equal(out.reason,'release-restock-or-reissue');
  }
});

test('old original release with a new listing is rejected by its original date',()=>{
  const out=retailReleaseEligibility(product({...listingNoise,originalReleaseDate:'2024-03-01'}),TODAY);
  assert.deepEqual(out,{eligible:false,reason:'release-outside-three-calendar-months',
    releaseDate:'2024-03-01',cutoff:'2026-08-03'});
});

test('missing proof is release-date-unverified even with every listing signal',()=>{
  const out=retailReleaseEligibility(product(listingNoise,null),TODAY);
  assert.deepEqual(out,{eligible:false,reason:'release-date-unverified',releaseDate:null,cutoff:'2026-08-03'});
  assert.equal(retailReleaseEligibility({brand:'Bally',url:URL,manufacturerStyle:'FA-123',
    releaseDate:'2026-10-20',...listingNoise},TODAY).reason,'release-date-unverified');
});

test('incomplete or unverified proof shapes stay unverified',()=>{
  for(const over of [{verified:false},{kind:'listing'},{firstRelease:false},
                     {date:'2026-10-32'},{date:'2026-10'},{date:null}])
    assert.equal(retailReleaseEligibility(product({},over),TODAY).reason,'release-date-unverified');
});

test('listing-grade authorities are rejected as unauthoritative',()=>{
  for(const authority of ['retailer-registration','retailer-upload','shopify-published-at','new-arrivals',undefined])
    assert.equal(retailReleaseEligibility(product({},{authority}),TODAY).reason,'release-evidence-unauthoritative');
});

test('mismatched url, brand, style or insecure url rejects',()=>{
  for(const over of [{productUrl:'https://brand.example.com/sneaker/other'},
                     {url:'http://brand.example.com/news/fa-123-launch'},
                     {productUrl:'http://brand.example.com/sneaker/fa-123-white'},
                     {brand:'Bally'},{style:'FA-124'},{style:''}]){
    const out=retailReleaseEligibility(product({},over),TODAY);
    assert.equal(out.eligible,false);
    assert.equal(out.reason,'release-evidence-mismatch');
  }
  assert.equal(retailReleaseEligibility(product({manufacturerStyle:undefined,style:undefined}),TODAY).reason,
    'release-evidence-mismatch');
});

test('a distinct colourway needs its own style-bound proof',()=>{
  const black={...product(),url:'https://brand.example.com/sneaker/fa-456-black',manufacturerStyle:'FA-456'};
  assert.equal(retailReleaseEligibility(black,TODAY).reason,'release-evidence-mismatch');
  const owned=retailReleaseEligibility({...black,releaseEvidence:proof({productUrl:black.url,style:'FA-456'})},TODAY);
  assert.equal(owned.eligible,true);
});

test('future release dates never qualify',()=>{
  const out=retailReleaseEligibility(product({},{date:'2026-11-04'}),TODAY);
  assert.deepEqual(out,{eligible:false,reason:'release-date-in-future',releaseDate:'2026-11-04',cutoff:'2026-08-03'});
});

test('the window is three calendar months, inclusive, not a fixed 90 days',()=>{
  assert.equal(retailReleaseEligibility(product({},{date:'2026-08-03'}),TODAY).eligible,true);
  assert.equal(retailReleaseEligibility(product({},{date:'2026-08-02'}),TODAY).reason,
    'release-outside-three-calendar-months');
  // 2026-08-04 is 91 days before today: a 90-day cutoff would wrongly drop it.
  assert.equal(retailReleaseEligibility(product({},{date:'2026-08-04'}),TODAY).eligible,true);
  // Month-end anchors clamp: 2026-05-31 minus three months is 2026-02-28.
  assert.equal(retailReleaseEligibility(product({},{date:'2026-02-28'}),'2026-05-31').cutoff,'2026-02-28');
  assert.equal(retailReleaseEligibility(product({},{date:'2026-02-28'}),'2026-05-31').eligible,true);
  assert.equal(retailReleaseEligibility(product({},{date:'2026-02-27'}),'2026-05-31').eligible,false);
});

test('invalid today and non-objects are handled',()=>{
  assert.throws(()=>retailReleaseEligibility(product(),'2026-13-01'));
  assert.equal(retailReleaseEligibility(null,TODAY).reason,'release-date-unverified');
});
