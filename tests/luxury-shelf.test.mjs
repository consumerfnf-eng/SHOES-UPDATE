import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {collectNewArrivals,parseArrivalListing,isKidsListing} from '../scripts/new-arrivals.mjs';
import {curateProduct,kstDay} from '../scripts/curation.mjs';
import {assertReadableOfficial} from '../scripts/official-reader.mjs';
import {brandFingerprint,collectedBrandList} from '../scripts/collection-scope.mjs';
import {classifyShelfPages} from '../scripts/classify-luxury-shelf.mjs';
import {withLuxuryShelves,luxuryShelfSources,isLuxuryMaison,latestSortUrl} from '../scripts/luxury-shelves.mjs';
import {markdownLinks} from '../scripts/new-arrivals.mjs';
import {recoveredCollection} from '../scripts/recover-collection.mjs';
import {atomicJson} from '../scripts/publish-curated.mjs';

const now=new Date('2026-10-30T03:00:00Z'),today=kstDay(now);

test('a week is only complete for the brands and shelves it covered',()=>{
  const sources={Zegna:[{url:'https://www.zegna.com/us-en/new-in/'}],Nike:[{url:'https://www.nike.com/new'}]};
  const before=brandFingerprint(['Zegna','Nike'],sources);
  // Reading order does not change what was collected.
  assert.equal(before,brandFingerprint(['Nike','Zegna'],sources));
  // A new brand does.
  assert.notEqual(before,brandFingerprint(['Zegna','Nike','Fendi'],sources));
  // So does a new shelf for a brand already on the list - the case that went
  // unnoticed on 2026-10-30.
  assert.notEqual(before,brandFingerprint(['Zegna','Nike'],
    {...sources,Zegna:[...sources.Zegna,{url:'https://www.zegna.com/us-en/shoes/sneakers/',basis:'catalogue'}]}));
  // And so does changing what an existing shelf is read as.
  assert.notEqual(before,brandFingerprint(['Zegna','Nike'],{...sources,Zegna:[{url:sources.Zegna[0].url,basis:'catalogue'}]}));
});

test('the collected brand list puts the maisons first',()=>{
  const list=collectedBrandList({brands:[
    {name:'Nike',group:'outdoor',policy:'mandatory',mandatory:true},
    {name:'Autry',group:'contemporary',policy:'core'},
    {name:'Zegna',group:'luxury',policy:'core'},
    {name:'Dior',group:'luxury',policy:'mandatory',mandatory:true},
    {name:'Chloé',group:'luxury',policy:'conditional'},
  ]});
  assert.deepEqual(list,['Zegna','Dior','Nike','Autry']);
});

test('a shop with an outlet cannot have its shelf taken whole',()=>{
  const shelf='https://www.example-maison.com/us/women/shoes/sneakers';
  const withOutlet=classifyShelfPages('Fendi',[{url:shelf,
    text:`# Sneakers\n[Sneakers](${shelf})\n[Outlet](https://www.example-maison.com/us/outlet)`}]);
  assert.equal(withOutlet.basis,'undetermined');
  const currentOnly=classifyShelfPages('Fendi',[{url:shelf,
    text:`# Sneakers\n[Sneakers](${shelf})\n[Store locator](https://www.example-maison.com/us/stores)`}]);
  assert.equal(currentOnly.basis,'current-season-only');
  assert.deepEqual(currentOnly.shelves,[shelf]);
  assert.equal(currentOnly.evidence.verified,true);
  assert.equal(currentOnly.evidence.url,shelf);
  // A shop we could not read at all makes no claim either way.
  assert.equal(classifyShelfPages('Fendi',[]),null);
});

test('the newest-first control is the same shelf reordered, not a different shelf',()=>{
  const shelf='https://www.example-maison.com/us/women/shoes/sneakers';
  const links=markdownLinks(`[Newest](${shelf}?srule=newest)\n[New In](https://www.example-maison.com/us/new-in)`);
  assert.equal(latestSortUrl(links,shelf),shelf+'?srule=newest');
  assert.equal(latestSortUrl(markdownLinks(`[Newest](https://www.example-maison.com/us/new-in)`),shelf),'');
});

test('a determined shelf becomes a catalogue source, and an undetermined one is read newest first',()=>{
  const shelf='https://www.zegna.com/us-en/shoes/sneakers/';
  const determined=luxuryShelfSources('Zegna',{basis:'current-season-only',shelves:[shelf],latest:{}});
  assert.equal(determined[0].basis,'catalogue');
  assert.equal(determined[0].url,shelf);
  const undetermined=luxuryShelfSources('Zegna',{basis:'undetermined',shelves:[shelf],latest:{[shelf]:shelf+'?sort=new'}});
  assert.equal(undetermined[0].basis,'catalogue-latest');
  assert.equal(undetermined[0].url,shelf+'?sort=new');
  // Not a maison, nothing added - this rule is about shops with no New section.
  assert.deepEqual(luxuryShelfSources('Nike',{basis:'current-season-only',shelves:[shelf]}),[]);
  assert(isLuxuryMaison('Saint Laurent')&&isLuxuryMaison('Maison Margiela')&&!isLuxuryMaison('KEEN'));
  const merged=withLuxuryShelves({Zegna:[{url:'https://www.zegna.com/us-en/new-in/'}]},
    {brands:{Zegna:{basis:'current-season-only',shelves:[shelf],latest:{}}}});
  assert.equal(merged.Zegna.length,2);
  // Folding it in twice does not add it twice.
  assert.equal(withLuxuryShelves(merged,{brands:{Zegna:{basis:'current-season-only',shelves:[shelf],latest:{}}}}).Zegna.length,2);
});

test('a maison sneaker publishes on the shelf it stands on, with no product-page proof',()=>{
  const url='https://www.ysl.com/en-us/p/court-classic-sneaker-ABC123.html';
  const shelf='https://www.ysl.com/en-jp/ca/shop-women/shoes/sneakers';
  const rows=parseArrivalListing(`# Sneakers\n[![Court Classic sneaker](https://www.ysl.com/ABC123_A.jpg) **Court Classic sneaker** $795](${url})`,
    {brand:'Saint Laurent',url:shelf,checkedAt:now.toISOString(),basis:'catalogue-latest'});
  assert.equal(rows.length,1);
  assert.equal(rows[0].arrivalEvidence.kind,'catalogue-latest-listing');
  const raw={id:'ysl-1',brand:'Saint Laurent',name:'Court Classic sneaker',style:'ABC123',url,
    image:'https://www.ysl.com/ABC123_A.jpg',description:'Leather sneakers with a rubber sole',
    arrivalEvidence:{...rows[0].arrivalEvidence,style:'ABC123'}};
  const result=curateProduct(raw,today,now);
  assert(result.product,result.reason);
  assert.equal(result.product.publicationBasis,'maison-shelf-latest');
  assert.equal(result.product.productEvidenceUrl,shelf,'the shelf is the proof, and the record says so');
  assert.equal(result.product.releaseDate,'','no release date is invented');
  // The same shoe from a brand that is not a maison still needs its proof.
  assert.equal(curateProduct({...raw,brand:'KEEN',arrivalEvidence:{...raw.arrivalEvidence,brand:'KEEN'}},today,now).reason,
    'release-day-evidence-required');
  // Listing evidence is still checked: it has to be about this shoe.
  for(const patch of [{verified:false},{style:'OTHER'},{productUrl:'https://www.ysl.com/en-us/p/other.html'},
                      {url:'https://retailer.example/sneakers'},{kind:'newest'}])
    assert(!curateProduct({...raw,arrivalEvidence:{...raw.arrivalEvidence,...patch}},today,now).product,JSON.stringify(patch));
  // A heel is not in scope whoever makes it.
  assert(!curateProduct({...raw,name:'Opyum slingback pumps'},today,now).product);
});

test('a kids shelf is a kids shelf whatever else the URL says',()=>{
  for(const url of ['https://www.fila.co.kr/collections/kids-new','https://www.amiri.com/collections/kids-new-arrivals',
                    'https://www.reebok.com/c/junior/shoes','https://example.com/ko/아동/신발'])
    assert(isKidsListing(url),url);
  for(const url of ['https://www.fila.co.kr/collections/new','https://www.nike.com/w/new-shoes',
                    'https://www.kidsuper.com/collections/sneakers'])
    assert(!isKidsListing(url),url);
});

test("Arc'teryx files a product under /shop with its style number on the slug",async()=>{
  const shelf="https://arcteryx.com/us/en/c/mens/footwear/shoes";
  const run=await collectNewArrivals({sources:{"Arc'teryx":[{url:shelf,basis:'catalogue'}]},brands:["Arc'teryx"],now,log:()=>{},
    read:async target=>target.endsWith(shelf)
      ? `# Shoes\n[![Kragg Shoe](https://arcteryx.com/kragg.jpg) **Kragg Shoe** $190](https://arcteryx.com/shop/mens/kragg-shoe-0078)\n[Shoes](${shelf})`
      : '# Kragg Shoe\nApproach shoe with a rubber outsole.'});
  const arc=run.coverage.find(c=>c.brand==="Arc'teryx");
  assert.equal(arc.candidates,1,'fifteen listing pages a week found none of these');
});

test('a blocked page is not a page that had no new shoes',()=>{
  // hoka.com, every week.
  assert.throws(()=>assertReadableOfficial('Title: hoka.com\nURL Source: https://www.hoka.com/en/us/new-arrivals/\nWarning: This page maybe requiring CAPTCHA, please make sure you are authorized to access this page.\n\nMarkdown Content:'),/OFFICIAL_ACCESS_CHALLENGE/);
  // adidas.com, redirected to a tracking pixel and returned 200.
  assert.throws(()=>assertReadableOfficial('Title: https://cm.g.doubleclick.net/pixel\nURL Source: https://www.adidas.com/us/shoes-new_arrivals\nFinal URL: https://cm.g.doubleclick.net/pixel?google_nid=x\n\nMarkdown Content:\nA 1x1 image, likely be a tacker probe'),/OFFICIAL_REDIRECTED_OFF_SITE/);
  // valentino.com, whose grid is drawn in the browser.
  assert.throws(()=>assertReadableOfficial("Title: Valentino Garavani Men's New Arrivals\nURL Source: https://www.valentino.com/en-us/men/new-arrivals\n\nMarkdown Content:\n*  \n\n- [x] *  \n\n*  \n"),/OFFICIAL_NO_LINKS_IN_PAGE/);
  // A redirect inside the brand's own site is still the brand's page.
  const regional='Title: Shoes\nURL Source: https://www.zegna.com/us-en/shoes/sneakers/\nFinal URL: https://zegna.com/us-en/shoes/sneakers/\n\nMarkdown Content:\n[Triple Stitch](https://www.zegna.com/us-en/p/triple-stitch/ABC.html)';
  assert.equal(assertReadableOfficial(regional),regional);
});

test("candidates nobody got to check are the next run's head start",async()=>{
  const shelf='https://www.prada.com/us/en/new-in';
  const pdp='https://www.prada.com/us/en/p/runner/ABC123';
  const carried=[{brand:'Prada',candidate:{brand:'Prada',name:'Runner sneakers',url:pdp,images:[],linkedImages:[],cardDescription:'Runner sneakers',
    arrivalEvidence:{verified:true,brand:'Prada',productUrl:pdp,kind:'new-arrivals-listing',url:shelf,verifiedAt:now.toISOString(),excerpt:'Official New In listing: Runner sneakers',contentHash:'a'.repeat(64)}}},
    {brand:'Gucci',candidate:{brand:'Gucci',name:'Screener',url:'https://www.gucci.com/us/en/pr/screener-p-123',images:[],linkedImages:[],cardDescription:'Screener'}}];
  const reads=[];
  const run=await collectNewArrivals({sources:{Prada:[{url:shelf}]},brands:['Prada'],now,log:()=>{},carriedPending:carried,
    read:async target=>{reads.push(target);return target.endsWith(shelf)?'# New In\n[Nothing here](https://www.prada.com/us/en/new-in)':'# Runner sneakers\nMesh sneakers with a rubber sole.\n![Runner sneakers](https://www.prada.com/ABC123.jpg)';}});
  assert(reads.some(r=>r.endsWith(pdp)),'the carried candidate was checked without re-reading the listing for it');
  // Gucci was not collected this run, so its queue is handed on rather than dropped.
  assert(run.pending.some(p=>p.brand==='Gucci'));
});

test('a recovery claims only what the collection established',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shoes-recover-'));
  try{
    const progress={checkedAt:'2026-10-30T06:01:13.794Z',coverage:[{brand:'Prada',responses:14},{brand:'Fendi',responses:0}],
      brandFingerprint:'abc123',products:[]};
    const collection=recoveredCollection(progress,{sourceRanks:[{id:'kept'}],keywordCheckedAt:'2026-10-29T00:00:00Z'});
    assert.equal(collection.checkedAt,progress.checkedAt);
    assert.deepEqual(collection.unavailableBrands,['Fendi']);
    assert.equal(collection.brandFingerprint,'abc123');
    // Keyword and rank collections have their own evidence; a recovery does
    // not claim to have re-checked them.
    assert.deepEqual(collection.sourceRanks,[{id:'kept'}]);
    assert.equal(collection.keywordCheckedAt,'2026-10-29T00:00:00Z');
    await atomicJson(path.join(dir,'x.json'),{ok:true});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
