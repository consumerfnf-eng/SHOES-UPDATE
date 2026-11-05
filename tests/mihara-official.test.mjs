import test from 'node:test';
import assert from 'node:assert/strict';
import {MIHARA_OFFICIAL_SOURCES as sources, miharaProductIdentity, parseMiharaOfficialListing,
  parseMiharaOfficialProduct, collectMiharaOfficial} from '../scripts/collect-mihara-official.mjs';
import {officialEvidenceFor} from '../scripts/curation.mjs';
import {hasArrivalEvidence} from '../public/assets/publication-window.mjs';
import {productPresentation} from '../scripts/product-presentation.mjs';

const at='2026-11-05T05:00:00Z';
const pdp=(pid='8508',c='1')=>`https://en.miharayasuhiro.jp/products/detail.php?product_id=${pid}&c=${c}`;
const photo=(c,pid='8508')=>`https://img.miharayasuhiro.jp/v2/product/UNTRUSTED-AS-SKU/${pid}-${c}.jpg`;
function card(pid='8508',colors=['1','16']) {
  return `<li class="product_item"><ul>${colors.map(c=>`<li><a href="${pdp(pid,c).replaceAll('&','&amp;')}"><img src="/placeholder.gif" data-src="${photo(c,pid)}"></a></li>`).join('')}</ul><p class="list_name">&quot;BAKER&quot; Canvas Low-top Sneakers</p></li>`;
}
function listing(cards=[card()],total=cards.length,links=[]) {
  return `<ul class="item_list_default">${card('999')}</ul><section id="top_item_list"><header><h1>SNEAKERS</h1><p>${total} items</p></header><ul class="item_list_default">${cards.join('')}</ul>${links.map(url=>`<a href="${url.replaceAll('&','&amp;')}">next</a>`).join('')}</section>`;
}
function detail({pid='8508',colors=['1','16'],name='Canvas Low-top Sneakers',sku='A17FW709',missing=[],input=true}={}) {
  return `<div id="item_spec"><h1 id="item_spec_tit">${name}</h1><p id="item_spec_maker">Maison MIHARA YASUHIRO</p>${input?`<input name="product_id" value="${pid}">`:`<a href="${pdp(pid)}#alert">Return</a>`}<div id="color_block"><ul>${colors.map(c=>`<li id="color_${c}" data-class="${c}" data-colorname="COLOR ${c}"><img data-src="${photo(c,pid)}"></li>`).join('')}</ul></div><ul>${sku?`<li><p>Item No：</p><p>${sku}</p></li>`:''}<li><p>Material：</p><p>COTTON RUBBER</p></li></ul></div><div id="item_photo_slider"><div class="swiper-wrapper">${colors.filter(c=>!missing.includes(c)).map(c=>`<div class="swiper-slide" id="c${c}"><div><img src="/placeholder.gif" data-src="${photo(c,pid)}"></div></div>`).join('')}<div class="swiper-slide"><img src="${photo('UNASSIGNED',pid)}"></div></div></div><div id="recommendations"><img src="${photo('NEIGHBOUR')}"></div>`;
}
function reader({men=listing(),women=listing(),details=detail()}={}) {
  const calls=[];
  return Object.assign(async url=>{calls.push(url);if(url===sources[0])return men;if(url===sources[1])return women;if(url.includes('/products/detail.php?'))return details;throw Error('unexpected '+url);},{calls});
}

test('product_id plus c is the identity; detail.php is never a style code',()=>{
  assert.equal(miharaProductIdentity(pdp()).style,'8508:1');
  assert.notEqual(miharaProductIdentity(pdp()).style,miharaProductIdentity(pdp('8508','16')).style);
  assert.equal(miharaProductIdentity(pdp()+'&utm_source=test#x').url,pdp());
  for(const url of [pdp().replace('&c=1',''),pdp().replace('&c=1','&c='),pdp().replace('product_id','product_no'),pdp()+'&c=16',pdp().replace('en.miharayasuhiro.jp','evil.example')])assert.throws(()=>miharaProductIdentity(url));
});

test('bounds main listing, nested cards and each own-color linked image',()=>{
  const page=parseMiharaOfficialListing(listing(),sources[0]);
  assert.equal(page.cards,1);assert.deepEqual(page.cardIds,['8508']);
  assert.deepEqual(page.products.map(p=>[p.style,p.image]),[['8508:1',photo('1')],['8508:16',photo('16')]]);
  assert.equal(page.products[0].gender,'Men');assert.match(page.contentHash,/^[a-f0-9]{64}$/);
});

test('follows only same-gender sneaker pagination and preserves all current source URLs',()=>{
  const next=sources[0]+'&disp_number=40&pageno=2';
  const p=parseMiharaOfficialListing(listing([card()],2,[next,sources[1]+'&pageno=2',sources[0].replace('27','28')+'&pageno=2','https://evil.example/products/list.php?category_id=27&sex_id=1&pageno=2']),sources[0]);
  assert.deepEqual(p.pages,[next]);
  assert.throws(()=>parseMiharaOfficialListing(listing(),sources[1].replace('27','28')),/SNEAKER_LIST/);
});

test('selects requested c slide even when another color comes first; no adjacent/unassigned photos',()=>{
  const p=parseMiharaOfficialProduct(detail(),pdp('8508','16'),{at,sourceUrl:pdp()});
  assert.equal(p.product.style,'8508:16');assert.deepEqual(p.product.gallery,[photo('16')]);
  assert.equal(p.product.colorway,'COLOR 16');assert.equal(p.product.manufacturerStyle,'A17FW709');
  assert.equal(p.product.officialImageEvidence.sourceUrl,pdp());assert.equal(p.product.officialProductEvidence.url,pdp('8508','16'));
  assert.equal(p.product.styleType,'official-product-id');
});

test('manufacturer code requires official Item No; image path is never inferred as SKU',()=>{
  const p=parseMiharaOfficialProduct(detail({sku:''}),pdp()).product;
  assert.equal(p.manufacturerStyle,undefined);assert.equal(p.style,'8508:1');
});

test('rejects wrong PDP, missing selected gallery, challenge and shells',()=>{
  assert.throws(()=>parseMiharaOfficialProduct(detail({pid:'9'}),pdp()),/IDENTITY_MISMATCH/);
  assert.throws(()=>parseMiharaOfficialProduct(detail({missing:['16']}),pdp('8508','16')),/GALLERY_ABSENT/);
  assert.throws(()=>parseMiharaOfficialProduct(detail(),pdp('8508','29')),/GALLERY_ABSENT/);
  assert.throws(()=>parseMiharaOfficialListing('<title>Just a moment</title>',sources[0]),/UNREADABLE/);
  assert.throws(()=>parseMiharaOfficialListing('<html></html>',sources[0]),/LIST_ABSENT/);
  assert.equal(parseMiharaOfficialProduct(detail({input:false}),pdp()).product.productId,'8508');
});

test('deduplicates men/women membership and fetches each color URL, including PDP-only colors',async()=>{
  const readHtml=reader({details:detail({colors:['1','16','29']})});
  const r=await collectMiharaOfficial({readHtml,now:at});
  assert.equal(r.exhausted,true);assert.equal(r.products.length,3);assert.equal(readHtml.calls.length,5);
  assert.deepEqual(r.products.map(p=>p.style),['8508:1','8508:16','8508:29']);
  assert.equal(r.products[0].gender,'Unisex');assert.deepEqual(r.products[0].genders,['Men','Women']);
  assert.equal(r.products[0].arrivalEvidence.kind,'official-assortment-listing');assert.equal(r.products[0].releaseDate,undefined);
  for(const p of r.products){assert.ok(officialEvidenceFor(p,'2026-11-05'));assert.equal(hasArrivalEvidence(p,'2026-11-05'),true);assert.equal(p.officialImageEvidence.sourceUrl,p.url);assert.ok(readHtml.calls.includes(p.url));assert.equal(productPresentation(p,{}).presentation.image,p.image);}
});

test('bounded listing and PDP collection resumes without rereading completed work',async()=>{
  const readHtml=reader();let callback;
  const first=await collectMiharaOfficial({readHtml,now:at,maxListingPages:1,onProgress:p=>{callback=p;}});
  assert.equal(first.exhausted,false);assert.equal(first.pending.productIds,null);assert.equal(first.coverage[1].exhausted,false);
  const second=await collectMiharaOfficial({readHtml,resume:JSON.parse(JSON.stringify(callback.checkpoint)),maxProductPages:0});
  assert.equal(second.exhausted,false);assert.deepEqual(second.pending.productIds,['8508']);
  const last=await collectMiharaOfficial({readHtml,resume:second.checkpoint});
  assert.equal(last.exhausted,true);assert.equal(last.checkedAt,new Date(at).toISOString());assert.equal(readHtml.calls.length,4);
  const again=await collectMiharaOfficial({readHtml,resume:last.checkpoint});assert.equal(again.products.length,2);assert.equal(readHtml.calls.length,4);
});

test('count mismatch, repeated pages and premature empty pages never establish exhaustion',async()=>{
  const next=sources[0]+'&disp_number=40&pageno=2';
  for(const second of [listing([card() ],2),listing([],2)]){
    const readHtml=async url=>url===sources[0]?listing([card()],2,[next]):url===sources[1]?listing([],0):second;
    const r=await collectMiharaOfficial({readHtml,now:at});assert.equal(r.exhausted,false);assert.equal(r.errors.length,1);assert.equal(r.products.length,0);assert.ok(r.pending.listings.includes(next));
  }
  const r=await collectMiharaOfficial({readHtml:reader({men:listing([card()],2)}),now:at});
  assert.match(r.errors[0].error,/TOTAL_MISMATCH/);assert.equal(r.exhausted,false);
});

test('successful multi-page total reconciliation counts cards rather than color variants',async()=>{
  const next=sources[0]+'&disp_number=40&pageno=2';
  const readHtml=async url=>url===sources[0]?listing([card()],2,[next]):url===sources[1]?listing([],0):url===next?listing([card('77')],2,[sources[0]]):detail({pid:new URL(url).searchParams.get('product_id')});
  const r=await collectMiharaOfficial({readHtml,now:at});assert.equal(r.exhausted,true);assert.equal(r.products.length,4);assert.equal(r.coverage[0].cards,2);assert.equal(r.coverage[0].pages,2);
});

test('one broken variant retains its URL while previously verified colors survive resume',async()=>{
  const r=await collectMiharaOfficial({readHtml:reader({details:detail({missing:['16']})}),now:at});
  assert.equal(r.exhausted,false);assert.equal(r.products.length,1);assert.deepEqual(r.pending.productIds,['8508']);assert.deepEqual(r.pending.productUrls,[pdp('8508','16')]);
  const readHtml=reader();const resumed=await collectMiharaOfficial({readHtml,resume:r.checkpoint});
  assert.equal(resumed.exhausted,true);assert.equal(resumed.products.length,2);assert.deepEqual(readHtml.calls,[pdp('8508','16')]);
});

test('does not count boots or ambiguous footwear as Sneakers; retains explicit exclusions',async()=>{
  for(const name of ['Canvas Boots','Sneaker Sole Loafers','Leather Shoes']){
    const r=await collectMiharaOfficial({readHtml:reader({details:detail({name})}),now:at});
    assert.equal(r.exhausted,true);assert.equal(r.products.length,0);assert.equal(r.excluded.length,2);assert.match(r.excluded[0].reason,/non-sneaker/);
  }
});

test('missing listed color and transport failure remain retryable, zero budget proves nothing',async()=>{
  const r=await collectMiharaOfficial({readHtml:reader({details:detail({colors:['1']})}),now:at});
  assert.equal(r.exhausted,false);assert.match(r.errors[0].error,/COLOR_MISMATCH/);
  const failed=await collectMiharaOfficial({readHtml:async()=>{throw Error('503');},now:at});assert.equal(failed.exhausted,false);assert.deepEqual(failed.pending.listings,sources);
  const zero=await collectMiharaOfficial({readHtml:async()=>{throw Error('must not read');},now:at,maxDurationMs:0});assert.equal(zero.exhausted,false);assert.equal(zero.pages.length,0);
});

test('other official store brands are exclusions with their published maker intact',async()=>{
  const readHtml=reader({details:detail().replace('Maison MIHARA YASUHIRO','SOUND OF SUNRISE')});
  const r=await collectMiharaOfficial({readHtml,now:at});
  assert.equal(r.exhausted,true);assert.equal(r.products.length,0);assert.equal(r.excluded.length,2);
  assert.equal(r.excluded[0].reason,'other-official-brand');assert.equal(r.excluded[0].brand,'SOUND OF SUNRISE');
});

test('listing evidence hashes the actual listing; product and photo evidence hash each PDP',async()=>{
  const r=await collectMiharaOfficial({readHtml:reader(),now:at});
  for(const p of r.products){
    assert.equal(p.arrivalEvidence.contentHash,r.pages[0].contentHash);
    assert.notEqual(p.arrivalEvidence.contentHash,p.officialProductEvidence.contentHash);
    assert.equal(p.officialProductEvidence.contentHash,p.officialImageEvidence.contentHash);
    assert.ok(officialEvidenceFor(p,'2026-11-05'));assert.equal(hasArrivalEvidence(p,'2026-11-05'),true);
  }
});

test('PDP budget counts actual color reads and resumes without repeating completed color URLs',async()=>{
  const readHtml=reader();
  const first=await collectMiharaOfficial({readHtml,now:at,maxProductPages:1});
  assert.equal(first.exhausted,false);assert.equal(first.products.length,1);
  assert.deepEqual(first.pending.productUrls,[pdp('8508','16')]);
  const last=await collectMiharaOfficial({readHtml,resume:JSON.parse(JSON.stringify(first.checkpoint)),maxProductPages:1});
  assert.equal(last.exhausted,true);assert.equal(last.products.length,2);
  assert.deepEqual(readHtml.calls,[...sources,pdp(),pdp('8508','16')]);
});

test('totals changing between pages cannot establish completeness',async()=>{
  const next=sources[0]+'&disp_number=40&pageno=2';
  const readHtml=async url=>url===sources[0]?listing([card()],2,[next]):url===sources[1]?listing([],0):listing([card('77')],3);
  const r=await collectMiharaOfficial({readHtml,now:at});
  assert.equal(r.exhausted,false);assert.match(r.errors[0].error,/TOTAL_CHANGED/);
  assert.deepEqual(r.pending.listings,[next]);
});
