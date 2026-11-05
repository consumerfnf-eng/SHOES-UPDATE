import test from 'node:test';
import assert from 'node:assert/strict';
import {collectUnderArmourNew, parseUnderArmourNewPage, readUnderArmourNewHtml,
  UNDERARMOUR_NEW_ROOT as root, UNDERARMOUR_NEW_SOURCES} from '../scripts/collect-underarmour-new.mjs';
import {officialEvidenceFor, curateCatalog} from '../scripts/curation.mjs';
import {officialImageUrl} from '../public/assets/catalog-view.mjs';
import {reviewAdminProducts} from '../scripts/admin-publication-review.mjs';
import {reviewScopedNew} from '../scripts/review-scoped-new.mjs';

const now = new Date('2026-11-05T08:00:00Z'), observedAt = '2026-11-03T07:53:12.029Z';
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
function tile({model = '6010459', color = '449', subtitle = "Men's Running Shoes", name = 'UA Surge 5',
  image = `https://underarmour.scene7.com/is/image/Underarmour/${model}-${color}_DEFAULT?wid=400&hei=500`,
  swatches = [[color, 'Blue']], extra = '', id} = {}) {
  const url = code => `https://www.underarmour.com/en-us/p/ua_surge_5_mens_running_shoes/${model}.html?dwvar_${model}_color=${code}`;
  return `<div id="${id ?? `product-${model}-${color}-8.5-FPP`}" data-testid="product-tile-container"><a class="x-product-image-link" href="${esc(url(color))}"><img data-testid="tile-image" alt="${name}" src="${esc(image)}"></a><div><input><br><span>Save</span></div>${swatches.map(([code, label]) => `<a title="View Color ${label}-${code}" href="${esc(url(code))}">${label}</a>`).join('')}<section><h3><a href="${esc(url(color))}">${name}</a><br><span class="x-product-sub-header">${subtitle}</span></h3><span data-testid="price-display-list-price">$65</span>${extra}</section></div>`;
}
function page(tiles, {url = root, total = tiles.length, next = '', metadata = {}, raw = true} = {}) {
  const html = `<html><head><title>New Releases - Shoes | Under Armour</title></head><body><h1>New Releases - Shoes</h1><p>${total} Items</p><section><div class="products_list product-listing">${tiles.join('')}</div></section>${next ? `<a rel="next" href="${esc(next)}">Next</a>` : ''}</body></html>`;
  return {url, status: 200, [raw ? 'rawHtml' : 'html']: html, observedAt,
    metadata: {sourceURL: url, url, statusCode: 200, ...metadata}};
}
const collect = options => collectUnderArmourNew({sources: [root], now, minIntervalMs: 0, ...options});

test('ordinary reader requests HTML once; denials are not retried or bypassed', async () => {
  let calls = 0;
  const r = await readUnderArmourNewHtml(root, {fetchImpl: async (url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, undefined);
    return {url, status: 418, text: async () => ''};
  }});
  assert.equal(calls, 1); assert.equal(r.status, 418);
  await assert.rejects(readUnderArmourNewHtml('https://evil.example/en-us/c/shoes/new-arrivals/'), /Unofficial/);
});

test('actual tile tuples satisfy existing official, admin, scoped-photo, curation and client gates', async () => {
  const r = await collect({read: async () => page([tile()])});
  assert.equal(r.exhausted, true); assert.equal(r.complete, true); assert.equal(r.products.length, 1);
  const p = r.products[0], today = '2026-11-05';
  assert.equal(p.style, '6010459'); assert.equal(p.productVariantId, '6010459-449'); assert.equal(p.colorway, 'Blue');
  assert.equal(p.image, 'https://underarmour.scene7.com/is/image/Underarmour/6010459-449_DEFAULT?wid=400&hei=500');
  assert.equal(p.productEvidenceUrl, root); assert.equal(p.officialImageEvidence.sourceUrl, root);
  assert.equal(p.officialProductEvidence.verificationMethod, 'official-new-listing-sku-image');
  assert.equal(p.officialProductEvidence.contentHash, p.arrivalEvidence.contentHash);
  assert.ok(officialEvidenceFor(p, today)); assert.equal(reviewAdminProducts([p], {}).products.length, 1);
  assert.equal(reviewScopedNew([p]).products.length, 1);
  const curated = curateCatalog([p], {now}); assert.deepEqual(curated.review.held, []);
  assert.equal(officialImageUrl(curated.snapshot.products[0], today), p.image);
  assert.equal(p.releaseDate, undefined);
});

test('Firecrawl cached rendered HTML preserves actual timestamp, format and upstream provenance', async () => {
  const capture = page([tile()], {raw: false, metadata: {cacheState: 'hit', cachedAt: observedAt, scrapeId: 'source-receipt'}});
  delete capture.observedAt;
  const r = await collect({read: async () => ({structuredContent: {success: true, data: capture}})});
  assert.equal(r.products[0].productVerifiedAt, observedAt);
  assert.equal(r.products[0].firstSeen, observedAt);
  assert.equal(r.products[0].officialProductEvidence.provenance.format, 'firecrawl-rendered-html');
  assert.equal(r.products[0].officialProductEvidence.provenance.scrapeId, 'source-receipt');
  delete capture.metadata.cachedAt;
  assert.throws(() => parseUnderArmourNewPage(capture, root, {now}), /timestamp/);
});

test('all root and adult source paths remain strict official New categories', async () => {
  const seen = [];
  const r = await collect({sources: UNDERARMOUR_NEW_SOURCES, read: async url => {seen.push(url); return page([tile()], {url});}});
  assert.deepEqual(seen, UNDERARMOUR_NEW_SOURCES); assert.equal(r.products.length, 1);
  assert.equal(r.coverage.length, 3); assert.equal(r.complete, true);
  await assert.rejects(collect({sources: ['https://www.underarmour.com/en-us/c/shoes/']}), /wrong New/);
});

test('swatches alone never manufacture extra colors or image URLs', async () => {
  const r = await collect({read: async () => page([tile({swatches: [['449', 'Blue'], ['001', 'Black']]})])});
  assert.equal(r.products.length, 1); assert.equal(r.products[0].productVariantId, '6010459-449');
  assert.equal(r.exhausted, true); assert.equal(r.complete, false);
  assert.equal(r.unresolved[0].variant, '6010459-001'); assert.equal(r.unresolved[0].reason, 'swatch-only-no-own-photo');
});

test('children, cleats, boots, slides and upcoming are excluded despite New membership', async () => {
  const definitions = [
    {subtitle: 'Grade School Basketball Shoes'}, {subtitle: "Girls' Pre-School Running Shoes"},
    {subtitle: "Men's Soccer Cleats"}, {subtitle: "Men's Boots"}, {subtitle: "Women's Slides"}, {extra: '<p>Coming Soon</p>'},
  ];
  const r = await collect({read: async () => page(definitions.map((d, i) => tile({model: String(6010400 + i), ...d})))});
  assert.equal(r.products.length, 0); assert.equal(r.excluded.length, definitions.length);
  assert.equal(r.complete, true);
});

test('hero, sibling-color, non-shoe slot and foreign images stay unresolved without photo guessing', async () => {
  for (const image of [
    'https://underarmour.scene7.com/is/image/Underarmour/FW26_Q3_6010459-449_Campaign',
    'https://underarmour.scene7.com/is/image/Underarmour/6010459-001_DEFAULT',
    'https://underarmour.scene7.com/is/image/Underarmour/6010459-449_OUTSOLE',
    'https://evil.example/is/image/Underarmour/6010459-449_DEFAULT',
  ]) {
    const r = await collect({read: async () => page([tile({image})])});
    assert.equal(r.products.length, 0); assert.equal(r.complete, false);
    assert.equal(r.unresolved[0].reason, 'own-sku-color-shoe-photo-unproven');
  }
});

test('photo from a sibling tile cannot rescue an unproved primary tile', async () => {
  const first = tile({image: 'https://underarmour.scene7.com/is/image/Underarmour/FW26_6010459-449_Hero'});
  const second = tile({model: '6010400'});
  const r = await collect({read: async () => page([first, second])});
  assert.deepEqual(r.products.map(p => p.style), ['6010400']); assert.equal(r.unresolved.length, 1);
});

test('changed selected SKU, image link, swatch label and response source reject the page', async () => {
  const valid = page([tile()]);
  const bad = [
    {...valid, rawHtml: valid.rawHtml.replace('product-6010459-449-', 'product-6010459-001-')},
    {...valid, rawHtml: valid.rawHtml.replace('title="View Color Blue-449"', 'title="View Color Blue-001"')},
    {...valid, rawHtml: valid.rawHtml.replace('dwvar_6010459_color=449', 'dwvar_6010459_color=001')},
    {...valid, url: 'https://www.underarmour.com/en-us/c/shoes/'},
  ];
  for (const record of bad) assert.throws(() => parseUnderArmourNewPage(record, root, {now}));
});

test('CAPTCHA, HTTP failure, markdown-only and missing listing totals fail closed', async () => {
  const valid = page([tile()]);
  const bad = [
    {...valid, rawHtml: valid.rawHtml.replace('<title>New Releases - Shoes | Under Armour</title>', '<title>Verify you are human CAPTCHA</title>')},
    {...valid, status: 418}, {url: root, status: 200, markdown: '# New Releases - Shoes'},
    {...valid, rawHtml: valid.rawHtml.replace('1 Items', 'Items')},
  ];
  for (const record of bad) {
    const r = await collect({read: async () => record});
    assert.deepEqual(r.products, []); assert.equal(r.exhausted, false); assert.ok(r.coverage[0].error);
  }
});

test('HTTP 200 Client Challenge is an access failure, never an empty successful New listing', async () => {
  const challenge = {url: root, status: 200, rawHtml: '<html><head><title>Client Challenge</title></head><body><script src="/_fs-ch-example/script.js"></script></body></html>'};
  const r = await collect({read: async () => challenge});
  assert.deepEqual(r.products, []); assert.equal(r.exhausted, false);
  assert.equal(r.coverage[0].error, 'OFFICIAL_ACCESS_CHALLENGE');
});

test('follows explicit next links and confirms the exact listing total', async () => {
  const next = root + '?start=1&sz=1', calls = [];
  const r = await collect({read: async url => {
    calls.push(url); return url === root ? page([tile()], {total: 2, next}) : page([tile({model: '6010400'})], {url, total: 2});
  }});
  assert.deepEqual(calls, [root, next]); assert.equal(r.products.length, 2); assert.equal(r.complete, true);
});

test('repeated pages, total drift, missing continuation, wrong scope and page limits discard source products', async () => {
  for (const mode of ['repeat', 'drift', 'missing', 'scope', 'cap']) {
    const next = mode === 'scope' ? UNDERARMOUR_NEW_SOURCES[1] + '?start=1' : root + '?start=1';
    const r = await collect({maxPages: mode === 'cap' ? 1 : 5, read: async url => {
      if (url === root) return page([tile()], {total: 2, next: mode === 'missing' ? '' : next});
      return page([tile({model: mode === 'repeat' ? '6010459' : '6010400'})], {url, total: mode === 'drift' ? 3 : 2});
    }});
    assert.deepEqual(r.products, [], mode); assert.equal(r.exhausted, false, mode);
  }
});

test('checkpoint persistence errors propagate without silently counting a source complete', async () => {
  await assert.rejects(collect({read: async () => page([tile()]), onCheckpoint: async () => {throw Error('storage failed');}}), /storage failed/);
});

function browserReceipt(tiles = [tile()], options = {}) {
  const original = page(tiles, options);
  const body = original.rawHtml.match(/<body>([^]*?)<\/body>/)[1];
  const html = '<main id="main">' + body
    .replaceAll('data-testid="product-tile-container"', 'class="ProductTile__product-tile-container"')
    .replaceAll('data-testid="tile-image"', '')
    .replace(/<a title="View Color (.+?)-(\d{3})" href=/g, '<a class="ColorCarousel__product-color-swatch" aria-label="$1" href=')
    .replaceAll('href="https://www.underarmour.com/', 'href="/') + '</main>';
  return {brand: 'Under Armour', url: options.url ?? root, checkedAt: '2026-11-05T07:55:00Z',
    transport: 'chrome-rendered-main-dom', extraction: 'DOM markup; scripts and nonessential attributes omitted', html};
}

test('explicit Chrome main-DOM receipt binds relative card links and own photos without an HTTP 200 claim', async () => {
  const receipt = browserReceipt(), r = await collect({read: async () => receipt});
  assert.equal(r.exhausted, true); assert.equal(r.products.length, 1);
  const p = r.products[0], provenance = p.officialProductEvidence.provenance;
  assert.equal(p.productVerifiedAt, receipt.checkedAt); assert.equal(p.arrivalEvidence.verifiedAt, receipt.checkedAt);
  assert.equal(p.officialImageEvidence.verifiedAt, receipt.checkedAt);
  assert.equal(provenance.transport, 'chrome-rendered-main-dom');
  assert.equal(provenance.format, 'chrome-rendered-main-dom');
  assert.equal(provenance.extraction, receipt.extraction);
  assert.equal(Object.hasOwn(provenance, 'upstreamStatus'), false);
  assert.equal(Object.hasOwn(provenance, 'status'), false);
  assert.ok(officialEvidenceFor(p, '2026-11-05'));
  assert.equal(reviewAdminProducts([p], {}).products.length, 1);
  assert.equal(reviewScopedNew([p]).products.length, 1);
  const curated = curateCatalog([p], {now}); assert.deepEqual(curated.review.held, []);
  assert.equal(officialImageUrl(curated.snapshot.products[0], '2026-11-05'), p.image);
});

test('Chrome receipt cannot promote sibling swatches or a campaign photograph as an own-photo New colorway', async () => {
  const receipt = browserReceipt([
    tile({swatches: [['449', 'Blue'], ['001', 'Black']]}),
    tile({model: '6010400', image: 'https://underarmour.scene7.com/is/image/Underarmour/FW26_Q3_6010400-449_Campaign'}),
  ]);
  const r = await collect({read: async () => receipt});
  assert.equal(r.exhausted, true); assert.equal(r.complete, false);
  assert.deepEqual(r.products.map(p => p.productVariantId), ['6010459-449']);
  assert.deepEqual(new Set(r.unresolved.map(p => p.reason)), new Set(['swatch-only-no-own-photo', 'own-sku-color-shoe-photo-unproven']));
});

test('strict Chrome receipt rejects missing metadata, HTTP claims, wrong brand/source, future dates and incomplete main', async () => {
  const valid = browserReceipt();
  for (const mutate of [
    r => {delete r.checkedAt;}, r => {delete r.extraction;}, r => {r.checkedAt = '2030-01-01T00:00:00Z';},
    r => {r.status = 200;}, r => {r.status = 418;}, r => {r.brand = 'Other';},
    r => {r.url = 'https://www.underarmour.com/en-us/c/shoes/';},
    r => {r.html = r.html.replace('</main>', '');}, r => {r.html += '<footer>outside receipt</footer>';},
    r => {r.transport = 'unverified-dom';}, r => {r.rawHtml = r.html;},
  ]) {
    const bad = structuredClone(valid); mutate(bad);
    const r = await collect({read: async () => bad});
    assert.deepEqual(r.products, []); assert.equal(r.exhausted, false);
  }
  // checkedAt/DOM HTML alone cannot bypass the ordinary HTTP reader contract.
  const unlabeled = structuredClone(valid); delete unlabeled.transport;
  assert.throws(() => parseUnderArmourNewPage(unlabeled, root, {now}), /HTTP unknown/);
});

test('Chrome declared total and selected SKU/photo binding still fail closed when DOM cards are incomplete or altered', async () => {
  const short = browserReceipt([tile()], {total: 2});
  const r = await collect({read: async () => short});
  assert.equal(r.exhausted, false); assert.deepEqual(r.products, []);
  const altered = browserReceipt(); altered.html = altered.html.replace('product-6010459-449-', 'product-6010459-001-');
  assert.throws(() => parseUnderArmourNewPage(altered, root, {now}), /identity mismatch/);
  const missingSelected = browserReceipt([tile({swatches: [['001', 'Black']]})]);
  assert.throws(() => parseUnderArmourNewPage(missingSelected, root, {now}), /selected color label/);
});
