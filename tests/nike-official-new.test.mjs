import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNikeOfficialNew, createNikeProviderReader, nikeNewApiUrl, parseNikeOfficialNewPage,
  readNikeOfficialJson, NIKE_NEW_SOURCES, NIKE_ADULT_NEW_SOURCES, nikeAdultProductUrl,
  parseNikeAdultProductEvidence, hasBoundNikeApiVariant} from '../scripts/collect-nike-official-new.mjs';
import {verifiedCategoryApiProof, CATEGORY_API_FIELDS} from '../public/assets/official-category-api.mjs';
import {officialEvidenceFor, curateCatalog} from '../scripts/curation.mjs';
import {officialImageUrl, officialProductUrl} from '../public/assets/catalog-view.mjs';
import {productPresentation} from '../scripts/product-presentation.mjs';

const at = new Date('2026-11-05T06:00:00Z');
function row(n, patch = {}) {
  const sku = `AB${String(n).padStart(4, '0')}-001`;
  return {productCode: sku, productType: 'FOOTWEAR', globalProductId: `global-${n}`, merchProductId: `merch-${n}`,
    copy: {title: `Nike Runner ${n}`, subTitle: "Men's Shoes"}, displayColors: {colorDescription: `Black/Color ${n}`},
    pdpUrl: {url: `https://www.nike.com/t/runner-model/${sku}`}, colorwayImages: {squarishURL: `https://static.nike.com/a/images/own-${n}.png`},
    prices: {currency: 'USD', currentPrice: 100}, featuredAttributes: [], isNewUntil: '2030-01-01T00:00:00Z', ...patch};
}
function captured(url, groups, total = groups.length, patch = {}) {
  const u = new URL(url), anchor = Number(u.searchParams.get('anchor')), count = Number(u.searchParams.get('count'));
  const next = new URL(url); next.searchParams.set('anchor', String(anchor + groups.length));
  const payload = {canonicalUrl: anchor ? null : `https://www.nike.com${u.searchParams.get('path')}`, marketplace: 'US', language: 'en',
    productGroupings: groups.map(products => ({cardType: 'default', products})),
    pages: {next: anchor + groups.length < total ? next.pathname + next.search : '', totalResources: total, totalPages: Math.ceil(total / count)}, ...patch};
  return {url, status: 200, body: JSON.stringify(payload)};
}
function fixture({nike = [row(1)], jordan = [], adult = [...nike, ...jordan]} = {}) {
  const records = new Map([[NIKE_NEW_SOURCES.Nike, nike], [NIKE_NEW_SOURCES.Jordan, jordan],
    [NIKE_ADULT_NEW_SOURCES[0], adult], [NIKE_ADULT_NEW_SOURCES[1], []]]);
  return async (url, {sourceUrl}) => captured(url, records.get(sourceUrl).map(r => [r]));
}
const collect = options => collectNikeOfficialNew({now: at, minIntervalMs: 0, ...options});

test('live reader requests public JSON and actual web caller header without credentials', async () => {
  const url = nikeNewApiUrl(NIKE_NEW_SOURCES.Nike);
  const result = await readNikeOfficialJson(url, {fetchImpl: async (u, options) => {
    assert.equal(u, url); assert.equal(options.headers['nike-api-caller-id'], 'com.nike.commerce.nikedotcom.web');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, undefined);
    return {url, status: 200, text: async () => '{}'};
  }});
  assert.equal(result.transport, 'official-public-json-api');
  await assert.rejects(readNikeOfficialJson('https://evil.example/api'), /Unofficial/);
});

test('preserves color-level own image binding and partitions Jordan without title heuristics', async () => {
  const nike = row(1), jordan = row(2, {copy: {title: 'Luka 5', subTitle: 'Basketball Shoes'}});
  const r = await collect({read: fixture({nike: [nike, jordan], jordan: [jordan]})});
  assert.equal(r.exhausted, true); assert.equal(r.products.length, 2);
  assert.deepEqual(r.products.map(p => [p.brand, p.style]), [['Nike', nike.productCode], ['Jordan', jordan.productCode]]);
  for (const p of r.products) {
    assert.equal(p.image, (p.brand === 'Nike' ? nike : jordan).colorwayImages.squarishURL);
    assert.match(p.officialImageEvidence.sourceUrl, /^https:\/\/api.nike.com\//);
    assert.equal(p.officialProductEvidence.transport, 'official-public-json-api');
    assert.equal(p.officialProductEvidence.verificationMethod, 'official-new-category-json-variant');
    assert.ok(p.scopeEvidence.url.includes('new-mens-shoes'));
    assert.deepEqual(p.officialProductEvidence.scopeEvidence, p.scopeEvidence);
    assert.equal(p.officialImageEvidence.scopeEvidence, undefined);
    assert.equal(p.arrivalEvidence.scopeEvidence, undefined);
    assert.equal(p.releaseDate, undefined); assert.equal(p.releaseEvidence, undefined);
    assert.equal(hasBoundNikeApiVariant(p), true);
  }
});

test('enumerates all groups through explicit terminal cursor, retaining every variant', async () => {
  const rows = Array.from({length: 26}, (_, n) => row(n + 1)), calls = [];
  const reader = async (url, {sourceUrl}) => {
    calls.push(url);
    const anchor = Number(new URL(url).searchParams.get('anchor'));
    if (sourceUrl === NIKE_NEW_SOURCES.Jordan || sourceUrl === NIKE_ADULT_NEW_SOURCES[1]) return captured(url, []);
    const groups = [[rows[0], rows[1]], ...rows.slice(2).map(r => [r])];
    return captured(url, groups.slice(anchor, anchor + 24), groups.length);
  };
  const r = await collect({read: reader, count: 24});
  assert.equal(r.exhausted, true); assert.equal(r.products.length, 26);
  assert.equal(calls.length, 6); assert.equal(r.diagnostics[0].groups, 25);
  assert.equal(r.products[1].officialImageEvidence.jsonPointer, '/productGroupings/0/products/1');
});

test('missing terminal cursor metadata, scope changes and offset gaps fail closed', async () => {
  const sourceUrl = NIKE_NEW_SOURCES.Nike, url = nikeNewApiUrl(sourceUrl), good = captured(url, [[row(1)]]);
  for (const mutate of [
    j => delete j.pages.next,
    j => { j.pages.totalResources = 2; },
    j => { j.canonicalUrl = NIKE_NEW_SOURCES.Jordan; },
    j => { j.pages.next = '/discover/product_wall/v1/marketplace/US/language/en/consumerChannelId/d9a5bc42-4b9c-4976-858a-f159cf99c647?path=/w&queryType=PRODUCTS&anchor=100&count=100'; },
  ]) {
    const j = JSON.parse(good.body); mutate(j);
    assert.throws(() => parseNikeOfficialNewPage({...good, body: JSON.stringify(j)}, url, {sourceUrl}));
  }
  const r = await collect({read: async url => ({url, status: 403, body: '<html>Denied</html>'})});
  assert.equal(r.exhausted, false); assert.deepEqual(r.products, []);
});

test('page ceiling, repeated pages, count drift and fetch failure never publish partial rows', async () => {
  const rows = Array.from({length: 49}, (_, n) => [row(n + 1)]);
  for (const mode of ['cap', 'repeat', 'drift', 'failure']) {
    const r = await collect({count: 24, maxPages: mode === 'cap' ? 1 : 10, read: async url => {
      const anchor = Number(new URL(url).searchParams.get('anchor'));
      if (anchor && mode === 'failure') throw Error('Network failed');
      return captured(url, rows.slice(mode === 'repeat' ? 0 : anchor, (mode === 'repeat' ? 0 : anchor) + 24), anchor && mode === 'drift' ? 50 : 49);
    }});
    assert.equal(r.exhausted, false, mode); assert.deepEqual(r.products, [], mode); assert.ok(r.error, mode);
  }
});

test('excludes children, cleats, boots, gift cards, custom and upcoming even when adult scopes include them', async () => {
  const rows = [row(1), row(2, {copy: {title: 'Nike Junior', subTitle: "Big Kids' Shoes"}}),
    row(3, {copy: {title: 'Nike Soccer', subTitle: "Men's Soccer Cleats"}}),
    row(4, {featuredAttributes: ['COMING_SOON']}), row(5, {badgeLabel: 'Coming Soon'}),
    row(6, {productType: 'ACCESSORIES'}), row(7, {copy: {title: 'Nike By You', subTitle: "Men's Custom Shoes"}}),
    row(8, {copy: {title: 'Nike Lunar Force 1', subTitle: "Men's Winterized Duckboots"}})];
  const r = await collect({read: fixture({nike: rows})});
  assert.equal(r.exhausted, true); assert.deepEqual(r.products.map(p => p.style), [rows[0].productCode]);
  assert.equal(new Set(r.excluded.map(e => e.reason)).size, 5);
});

test('cannot borrow sibling images or colors and rejects contradictory duplicate variants', async () => {
  for (const bad of [row(1, {colorwayImages: {}}), row(1, {displayColors: {}}),
    row(1, {pdpUrl: row(2).pdpUrl}), row(1, {colorwayImages: {squarishURL: 'https://evil.example/a/images/x.png'}})]) {
    const r = await collect({read: fixture({nike: [bad, row(2)]})});
    assert.equal(r.exhausted, false); assert.deepEqual(r.products, []);
  }
  const r = await collect({read: fixture({nike: [row(1), row(1, {displayColors: {colorDescription: 'Other'}})]})});
  assert.equal(r.exhausted, false); assert.match(r.error, /Conflicting/);
});

function thread(row, patch = {}) {
  return {url: nikeAdultProductUrl(row.productCode), status: 200, body: JSON.stringify({pages: {next: '', totalResources: 1}, objects: [{
    marketplace: 'US', language: 'en', channelId: 'd9a5bc42-4b9c-4976-858a-f159cf99c647', productInfo: [{
      merchProduct: {id: row.merchProductId, styleColor: row.productCode, productType: 'FOOTWEAR', genders: ['MEN', 'WOMEN'],
        status: 'ACTIVE', preOrder: false, commerceStartDate: '2026-11-01T00:00:00Z', ...patch},
      productContent: {title: row.copy.title, colorDescription: row.displayColors.colorDescription}, availability: {available: true},
    }],
  }]})};
}

test('exact official merchandise adult genders recover SKUs omitted by adult New facets', async () => {
  const shoe = row(1, {copy: {title: 'Nike Court', subTitle: 'Indoor/Court Soccer Shoes'}});
  const r = await collect({read: fixture({nike: [shoe], adult: []}), readProduct: async url => {
    assert.equal(url, nikeAdultProductUrl(shoe.productCode)); return thread(shoe);
  }});
  assert.equal(r.exhausted, true); assert.equal(r.products.length, 1);
  assert.match(r.products[0].scopeEvidence.jsonPointer, /^\/objects\/\d+\/productInfo\/\d+$/);
  assert.deepEqual(r.products[0].officialProductEvidence.scopeEvidence, r.products[0].scopeEvidence);
  assert.equal(r.products[0].image, shoe.colorwayImages.squarishURL);
  for (const patch of [{genders: ['KIDS']}, {preOrder: true}, {commerceStartDate: '2030-01-01T00:00:00Z'}]) {
    assert.equal(parseNikeAdultProductEvidence(thread(shoe, patch), shoe, {now: at}).adult, false);
  }
  assert.throws(() => parseNikeAdultProductEvidence(thread(shoe, {id: 'other-sku'}), shoe, {now: at}), /identity mismatch/);
});

test('SNKRS available SKU URL is preserved; no manufactured HTML PDP URL', async () => {
  const shoe = row(1, {pdpUrl: {url: 'https://www.nike.com/launch/r/AB0001-001'}, badgeLabel: 'Available in SNKRS'});
  const r = await collect({read: fixture({nike: [shoe]})});
  assert.equal(r.exhausted, true); assert.equal(r.products[0].url, shoe.pdpUrl.url);
});

function providerResponse(url, groups, total) {
  const direct = JSON.parse(captured(url, groups, total).body);
  return {success: true, requestId: 'receipt-1', data: {alexandria: [{provider: 'nike-com', capability: 'products/search', providerRequestId: 'request-1',
    data: {canonical_url: direct.canonicalUrl, country: 'US', language: 'en', observed_at_ms: 1793850000000,
      total_pages: direct.pages.totalPages, total_resources: total, next_cursor: direct.pages.next,
      groups: groups.map(variants => ({card_type: 'default', variants: variants.map(r => ({style_color: r.productCode,
        product_type: r.productType, global_product_id: r.globalProductId, merch_product_id: r.merchProductId,
        title: r.copy.title, subtitle: r.copy.subTitle, color: r.displayColors.colorDescription,
        url: r.pdpUrl.url, images: {square: r.colorwayImages.squarishURL}, attributes: [],
      }))})),
    },
  }]}};
}

test('provider contract uses opaque cursor only and preserves provider receipt/time semantics', async () => {
  const sourceUrl = NIKE_NEW_SOURCES.Nike, url = nikeNewApiUrl(sourceUrl, {count: 24}), calls = [];
  const groups = Array.from({length: 25}, (_, n) => [row(n + 1)]);
  let current = url;
  const read = createNikeProviderReader(async args => {
    calls.push(args.alexandria[0].options);
    const anchor = Number(new URL(current).searchParams.get('anchor'));
    return {structuredContent: providerResponse(current, groups.slice(anchor, anchor + 24), 25)};
  });
  const first = parseNikeOfficialNewPage(await read(current, {sourceUrl}), current, {sourceUrl});
  current = first.next;
  const last = parseNikeOfficialNewPage(await read(current, {sourceUrl}), current, {sourceUrl});
  assert.deepEqual(calls[0], {path: new URL(sourceUrl).pathname, count: 24});
  assert.deepEqual(Object.keys(calls[1]), ['cursor']); assert.equal(last.next, null);
  assert.equal(first.transport, 'nike-com/products/search'); assert.equal(first.provenance.requestId, 'receipt-1');
  assert.equal(first.provenance.observedAtMs, 1793850000000); assert.equal(first.rows[0].pointer, '/groups/0/variants/0');
});

test('successful outer provider envelope cannot hide an inner provider failure', async () => {
  const read = createNikeProviderReader(async () => ({success: true, data: {alexandria: [{provider: 'nike-com',
    capability: 'products/search', error: {message: '502 upstream'}}]}}));
  const r = await collect({read});
  assert.equal(r.exhausted, false); assert.deepEqual(r.products, []); assert.match(r.error, /502 upstream/);
});

test('provider integration retains provider provenance in emitted product and image evidence', async () => {
  const read = createNikeProviderReader(async args => {
    const {path, count} = args.alexandria[0].options;
    const sourceUrl = `https://www.nike.com${path}`;
    const rows = sourceUrl === NIKE_NEW_SOURCES.Jordan || sourceUrl === NIKE_ADULT_NEW_SOURCES[1] ? [] : [[row(1)]];
    return providerResponse(nikeNewApiUrl(sourceUrl, {count}), rows, rows.length);
  });
  const r = await collect({read});
  assert.equal(r.exhausted, true); assert.equal(r.products.length, 1);
  const p = r.products[0];
  assert.equal(p.officialImageEvidence.transport, 'nike-com/products/search');
  assert.equal(p.officialProductEvidence.provenance.observedAtMs, 1793850000000);
  assert.equal(p.officialImageEvidence.payloadPointer, '/data/alexandria/0/data');
  assert.equal(p.officialImageEvidence.jsonPointer, '/groups/0/variants/0');
});

test('checkpoint errors propagate instead of becoming collection diagnostics', async () => {
  await assert.rejects(collect({read: fixture(), onCheckpoint: () => {throw Error('storage failure');}}), /storage failure/);
});

test('explicit API proof contract rejects mismatched URL, color, image, SKU, pointer and page hash', async () => {
  const r = await collect({read: fixture()});
  const original = r.products[0];
  assert.equal(hasBoundNikeApiVariant(original), true);
  for (const mutate of [
    p => {p.image = row(2).colorwayImages.squarishURL;},
    p => {p.colorway = 'Wrong color';},
    p => {p.style = 'AB9999-001';},
    p => {p.productEvidenceUrl = p.url;},
    p => {p.arrivalEvidence.url = NIKE_NEW_SOURCES.Jordan;},
    p => {p.officialImageEvidence.contentHash = 'f'.repeat(64);},
    p => {p.officialProductEvidence.apiVariant.jsonPointer = '/groups/0/variants/0';},
  ]) {
    const altered = structuredClone(original); mutate(altered);
    assert.equal(hasBoundNikeApiVariant(altered), false);
  }
});

test('shared API gate accepts Nike/Jordan fixtures and curation preserves metadata for client image URLs', async () => {
  const nike = row(1), jordan = row(2, {copy: {title: 'Luka 5', subTitle: 'Basketball Shoes'}});
  const r = await collect({read: fixture({nike: [nike, jordan], jordan: [jordan]})});
  const today = '2026-11-05';
  assert.equal(r.products.length, 2);
  for (const raw of r.products) {
    assert.equal(verifiedCategoryApiProof(raw, today), true, raw.brand);
    assert.ok(officialEvidenceFor(raw, today), raw.brand);
    const curated = curateCatalog([raw], {now: at});
    assert.deepEqual(curated.review.held, []);
    assert.equal(curated.snapshot.products.length, 1);
    const clean = curated.snapshot.products[0];
    for (const key of CATEGORY_API_FIELDS) {
      assert.deepEqual(clean.officialProductEvidence[key], raw.officialProductEvidence[key], `product ${key}`);
      assert.deepEqual(clean.officialImageEvidence[key], raw.officialImageEvidence[key], `image ${key}`);
    }
    assert.equal(clean.scopeEvidence, undefined, 'adult proof survives inside product evidence without a product whitelist extension');
    assert.equal(clean.officialProductEvidence.apiVariant, undefined, 'shared contract survives optional raw-only helper metadata removal');
    assert.equal(verifiedCategoryApiProof(clean, today), true);
    assert.ok(officialEvidenceFor(clean, today));
    assert.equal(officialProductUrl(clean, today), raw.url);
    assert.equal(officialImageUrl(clean, today), raw.image);
    assert.equal(productPresentation(clean,{}).presentation.image,raw.image,'verified category API photographs survive presentation preparation');
    assert.ok(!clean.releaseDate, 'curation does not invent a release date');
  }
});

test('shared API gate and client accept exact-SKU adult fallback through curation', async () => {
  const shoe = row(1, {copy: {title: 'Nike Court', subTitle: 'Indoor/Court Soccer Shoes'}});
  const r = await collect({read: fixture({nike: [shoe], adult: []}), readProduct: async () => thread(shoe)});
  const raw = r.products[0], today = '2026-11-05';
  assert.equal(verifiedCategoryApiProof(raw, today), true);
  const curated = curateCatalog([raw], {now: at});
  assert.deepEqual(curated.review.held, []);
  const clean = curated.snapshot.products[0];
  assert.deepEqual(clean.officialProductEvidence.scopeEvidence, raw.scopeEvidence);
  assert.equal(officialImageUrl(clean, today), raw.image);
  const bad = structuredClone(clean);
  bad.officialProductEvidence.scopeEvidence.sourceUrl = nikeAdultProductUrl(row(2).productCode);
  bad.officialProductEvidence.scopeEvidence.url = bad.officialProductEvidence.scopeEvidence.sourceUrl;
  assert.equal(verifiedCategoryApiProof(bad, today), false);
  assert.equal(officialImageUrl(bad, today), '');
});

test('shared official gates reject altered adult scope, SKU, image, source path and hash before and after curation', async t => {
  const raw = (await collect({read: fixture()})).products[0], today = '2026-11-05';
  const clean = curateCatalog([raw], {now: at}).snapshot.products[0];
  const mutations = {
    'adult scope SKU': p => {p.officialProductEvidence.scopeEvidence.style = row(2).productCode;},
    'adult scope source path': p => {p.officialProductEvidence.scopeEvidence.sourceUrl = nikeNewApiUrl(NIKE_NEW_SOURCES.Nike);},
    'adult scope hash': p => {p.officialProductEvidence.scopeEvidence.contentHash = 'invalid';},
    'SKU': p => {p.style = row(2).productCode;},
    'image': p => {p.image = row(2).colorwayImages.squarishURL;},
    'proof source path': p => {
      const source = nikeNewApiUrl(NIKE_NEW_SOURCES.Jordan);
      for (const e of [p.officialProductEvidence, p.officialImageEvidence, p.arrivalEvidence]) e.sourceUrl = source;
      p.productEvidenceUrl = source;
    },
    'mismatched page hash': p => {p.officialImageEvidence.contentHash = 'f'.repeat(64);},
    'invalid shared hash': p => {for (const e of [p.officialProductEvidence, p.officialImageEvidence, p.arrivalEvidence]) e.contentHash = 'not-a-sha256';},
    'provider transport': p => {for (const e of [p.officialProductEvidence, p.officialImageEvidence, p.arrivalEvidence]) e.transport = 'nike-com/products/search';},
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
    for (const original of [raw, clean]) {
      const bad = structuredClone(original); mutate(bad);
      assert.equal(verifiedCategoryApiProof(bad, today), false);
      assert.equal(officialEvidenceFor(bad, today), null);
      assert.equal(officialProductUrl(bad, today), '');
      assert.equal(officialImageUrl(bad, today), '');
      assert.equal(curateCatalog([bad], {now: at}).snapshot.products.length, 0);
    }
  });
});


test('Converse VX-1 Heel SKUs and own title/subtitle dress forms are excluded from the Nike wall',async()=>{
 const heels=['A19133C-100','A19134C-001'].map((sku,i)=>row(i+10,{productCode:sku,copy:{title:'Converse x Vaquera VX-1 Heel',subTitle:'Shoes'},pdpUrl:{url:`https://www.nike.com/launch/r/${sku}`}}));
 const other=[row(20,{copy:{title:'Nike Dress Heel',subTitle:'Shoes'}}),row(21,{copy:{title:'Nike Dress',subTitle:"Women's Pumps"}}),row(22,{copy:{title:'Converse Chuck 70',subTitle:'Shoes'}}),row(23,{brandName:'Converse'})];
 const r=await collect({read:fixture({nike:[...heels,...other,row(1)]})});
 assert.equal(r.exhausted,true);assert.deepEqual(r.products.map(p=>p.style),[row(1).productCode]);
 for(const p of [...heels,...other])assert.ok(r.excluded.some(e=>e.style===p.productCode),p.productCode);
});

test('shared proof guard blocks old typed heel/pump and Converse mislabel runs before and after curation',async()=>{
 const raw=(await collect({read:fixture()})).products[0],today='2026-11-05';
 const clean=curateCatalog([raw],{now:at}).snapshot.products[0];
 for(const original of [raw,clean])for(const mutate of [
  p=>{p.name='Converse x Vaquera VX-1 Heel';},
  p=>{p.name='Nike Dress Heel';},
  p=>{p.officialCategory="Women's Heels";},
  p=>{p.officialCategory="Women's Pumps";},
  p=>{p.name='Converse Chuck 70';},
  p=>{p.officialCategory='Converse Shoes';},
  p=>{p.officialBrand='Converse';},
  p=>{p.officialProductEvidence.ownBrand='Converse';},
  p=>{p.officialProductEvidence.ownBrand='Jordan';},
 ]){
  const bad=structuredClone(original);mutate(bad);
  assert.equal(verifiedCategoryApiProof(bad,today),false);
  assert.equal(officialEvidenceFor(bad,today),null);
  assert.equal(officialProductUrl(bad,today),'');assert.equal(officialImageUrl(bad,today),'');
  assert.equal(curateCatalog([bad],{now:at}).snapshot.products.length,0);
  if(original===raw)assert.equal(hasBoundNikeApiVariant(bad),false);
 }
});

test('heel counter construction remains a sneaker and Jordan names never establish brand membership',async()=>{
 for(const copy of [
  {title:'Nike Runner',subTitle:"Men's Shoes with heel counter"},
  {title:'Nike Heel Counter Runner',subTitle:"Men's Shoes"},
  {title:'Air Jordan 1 Mid SE',subTitle:"Men's Shoes"},
 ]){
  const r=await collect({read:fixture({nike:[row(1,{copy})]})});
  assert.equal(r.products.length,1);assert.equal(r.products[0].brand,'Nike');
  assert.equal(verifiedCategoryApiProof(r.products[0],'2026-11-05'),true);
 }
});

test('explicit Jordan own-brand cannot be assigned Nike without verified Jordan New membership',async()=>{
 const shoe=row(1,{brandName:'Jordan',copy:{title:'Air Jordan 1 Mid SE',subTitle:"Men's Shoes"}});
 const noMembership=await collect({read:fixture({nike:[shoe]})});
 assert.deepEqual(noMembership.products,[]);
 assert.ok(noMembership.excluded.some(e=>e.reason==='own-brand-requires-jordan-new-membership'));
 const member=await collect({read:fixture({nike:[shoe],jordan:[shoe]})});
 assert.equal(member.products.length,1);assert.equal(member.products[0].brand,'Jordan');
 assert.equal(member.products[0].officialProductEvidence.ownBrand,'Jordan');
 const curated=curateCatalog(member.products,{now:at}).snapshot.products;
 assert.equal(curated.length,1);assert.equal(curated[0].officialProductEvidence.ownBrand,'Jordan');
 assert.equal(verifiedCategoryApiProof(curated[0],'2026-11-05'),true);
});
