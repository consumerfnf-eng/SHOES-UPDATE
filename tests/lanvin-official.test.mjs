import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LANVIN_MEN_SNEAKERS_URL as men, parseLanvinOfficialPage, lanvinOfficialProduct, collectLanvinOfficial} from '../scripts/collect-lanvin-official.mjs';
import {officialEvidenceFor, curateProduct, curateCatalog, kstDay} from '../scripts/curation.mjs';
import {productPresentation} from '../scripts/product-presentation.mjs';
import {officialImageUrl, officialProductUrl, sourceMatches} from '../public/assets/catalog-view.mjs';
import {adminCoverageExhaustive} from '../scripts/admin-monitor-runner.mjs';

const women = 'https://www.lanvin.com/en-us/woman/shoes/sneakers/';
const now = new Date('2026-11-05T08:00:00Z');
function row(base = 'FMSKABC12LEAA26', color = '10', gender = 'man', extra = {}) {
  const productId = base + color, productName = 'CURB SNEAKERS IN LEATHER';
  const category = `${gender === 'man' ? 'men' : 'women'}-shoes-sneakers`;
  return {productId, productName, currency: 'USD', hitType: 'variation_group', c_brand: 'LANVIN', c_primaryCategory: category, orderable: true, price: 990,
    c_url: `https://www.lanvin.com/en/${gender}/shoes/sneakers/curb-sneakers-in-leather-${productId}.html`,
    representedProduct: {c_categoryId: category, c_colorDescription: 'Black', c_materialDescription: '<ul><li>Calf leather</li></ul>'},
    imageGroups: [{viewType: 'zoom', variationAttributes: [{id: 'color', values: [{value: color}]}], images: [{title: productName, alt: `Lanvin ${productName} Black ${base}`, disBaseLink: `https://www.lanvin.com/dw/image/v2/BGDG_PRD/on/demandware.static/-/Sites-57/default/dw123/images/zoom/${base}_${color}_1.jpg`}]}], ...extra};
}
function document(url, rows, {total = rows.length, offset = 0, limit = 24, next, nav = false, defaults = {}} = {}) {
  const u = new URL(url), page = u.searchParams.get('page') ?? '1';
  const cgid = u.pathname.includes('/woman/') ? 'women-shoes-sneakers' : 'men-shoes-sneakers';
  const state = {query: '', selectedRefinements: {cgid, htype: 'variation_group'}, total, offset, limit, pages: {[page]: {__packed: 1, defaults, rows}}};
  const data = {__PRELOADED_STATE__: {__STATE_MANAGEMENT_LIBRARY: {reduxStoreState: {productSearchResult: {'search-page_lanvin_us_sfcc': state}}}}};
  const links = rows.map(r => `<a href="${r.c_url.replace('/en/', '/en-us/')}">${r.productName}</a>`).join('');
  const rawHtml = `<link rel="canonical" href="${u.origin}${u.pathname}">${next ? `<link rel="next" href="${next}">` : ''}${nav ? `<nav><a href="${women}">Women's Sneakers</a></nav>` : ''}${links}<script id="mobify-data" type="application/json">${JSON.stringify(data)}</script>`;
  return {rawHtml, metadata: {sourceURL: url, url, statusCode: 200}};
}
const one = () => row();
const two = () => row('FUSKABC12LEAA26', '00', 'woman');
const three = () => row('FUSKABC13LEAA26', '10', 'woman');
function fixtures() {
  return new Map([
    [men, document(men, [one()], {total: 2, limit: 1, next: men + '?page=2', nav: true})],
    [men + '?page=2', document(men + '?page=2', [two()], {total: 2, offset: 1, limit: 1})],
    [women, document(women, [two(), three()])],
  ]);
}
const reader = (records, reads = []) => async (url, options) => {
  reads.push({url, options});
  if (!records.has(url)) throw Error('Uncaptured URL: ' + url);
  return structuredClone(records.get(url));
};
async function collect(records = fixtures(), options = {}) {
  return collectLanvinOfficial({read: reader(records), now, minIntervalMs: 0, ...options});
}
function rewrite(record, change) {
  const copy = structuredClone(record), match = copy.rawHtml.match(/(<script[^>]*>)([\s\S]*?)(<\/script>)/);
  const value = JSON.parse(match[2]), state = value.__PRELOADED_STATE__.__STATE_MANAGEMENT_LIBRARY.reduxStoreState.productSearchResult['search-page_lanvin_us_sfcc'];
  change(state);
  copy.rawHtml = copy.rawHtml.replace(match[0], match[1] + JSON.stringify(value) + match[3]);
  return copy;
}

test('actual women navigation, all pages and own product gender produce normalized unique products', async () => {
  const reads = [], result = await collect(fixtures(), {read: reader(fixtures(), reads)});
  assert.equal(result.products.length, 3);
  assert.equal(result.held.length, 0);
  assert.equal(result.reads, 3);
  assert.equal(result.coverage.exhaustive, true);
  assert.equal(result.coverage.womenDiscovery.targetUrl, women);
  assert.deepEqual(result.diagnostics.map(d => [d.total, d.read, d.pages]), [[2, 2, 2], [2, 2, 1]]);
  assert.ok(reads.every(r => r.options.formats[0] === 'rawHtml' && r.options.maxAge === 0));
  const ownWoman = result.products.find(p => p.style === two().productId);
  assert.equal(ownWoman.gender, 'Women');
  assert.equal(ownWoman.arrivalEvidence.url, men + '?page=2', 'a men shelf does not overwrite the product gender');
  assert.ok(result.products.every(p => p.brand === 'Lanvin'));
});

test('published packed defaults apply per row without borrowing another tile', () => {
  const candidate = one(), {c_brand, currency, hitType, ...packedRow} = candidate;
  const page = parseLanvinOfficialPage(document(men, [packedRow], {defaults: {c_brand, currency, hitType}}), men);
  const product = lanvinOfficialProduct(page.rows[0], page, {now});
  assert.equal(product.brand, 'Lanvin'); assert.equal(product.priceLabel, 'USD 990');
});

test('exact SKU/color images pass existing proof and curation gates without fictional New dates', async () => {
  const result = await collect();
  for (const p of result.products) {
    assert.ok(officialEvidenceFor(p, kstDay(now)));
    assert.ok(curateProduct(p, kstDay(now), now).product);
    assert.equal(p.arrivalEvidence.kind, 'official-assortment-listing');
    assert.equal(p.officialImageEvidence.sourceUrl, p.arrivalEvidence.url);
    assert.equal(p.sourceTileBinding.style, p.style);
    assert.equal(p.officialCategory, 'Sneakers');
    assert.equal(p.audience, 'adult');
    assert.equal(p.styleType, 'official-product-id');
    assert.match(p.image, /images\/zoom\//);
    for (const key of ['releaseDate', 'launchDate', 'isNew']) assert.equal(Object.hasOwn(p, key), false);
  }
  assert.equal(result.pages[0].contentHash, createHash('sha256').update(fixtures().get(men).rawHtml).digest('hex'));
});

test('raw source URL/status/schema cannot be replaced by old domains, JSON guesses or challenge HTML', () => {
  const record = fixtures().get(men);
  for (const bad of [record.rawHtml, {html: record.rawHtml, metadata: record.metadata}, {...record, metadata: {}},
    {...record, metadata: {...record.metadata, statusCode: 403}}, {...record, requestedUrl: women},
    {...record, metadata: {...record.metadata, url: 'https://us.lanvin.com/collections/men-sneakers'}},
    {...record, rawHtml: '<html>Checking your browser</html>'}, {...record, success: false}]) {
    assert.throws(() => parseLanvinOfficialPage(bad, men));
  }
  assert.throws(() => parseLanvinOfficialPage(record, 'https://us.lanvin.com/collections/men-sneakers'), /category/);
});

test('an incorrect category, page number, count, packed row or canonical fails closed', () => {
  const record = fixtures().get(men);
  for (const change of [
    s => {s.selectedRefinements.cgid = 'women-shoes-sneakers';}, s => {s.total = -1;}, s => {s.offset = 1;},
    s => {s.pages = {'2': s.pages['1']};}, s => {s.pages['1'].__packed = 0;}, s => {s.pages['1'].rows.push(s.pages['1'].rows[0]);},
  ]) assert.throws(() => parseLanvinOfficialPage(rewrite(record, change), men));
  assert.throws(() => parseLanvinOfficialPage({...record, rawHtml: record.rawHtml.replace(`rel="canonical" href="${men}"`, `rel="canonical" href="${women}"`)}, men), /canonical/);
});

test('missing, repeated and off-category continuation never establish exhaustive coverage', async () => {
  for (const mode of ['missing-next', 'repeated', 'off-category', 'changed-total']) {
    const records = fixtures();
    if (mode === 'missing-next') records.set(men, {...records.get(men), rawHtml: records.get(men).rawHtml.replace(/<link rel="next"[^>]*>/, '')});
    if (mode === 'off-category') records.set(men, {...records.get(men), rawHtml: records.get(men).rawHtml.replace(`href="${men}?page=2"`, `href="${women}?page=2"`)});
    if (mode === 'repeated') records.set(men + '?page=2', document(men + '?page=2', [one()], {total: 2, offset: 1, limit: 1}));
    if (mode === 'changed-total') records.set(men + '?page=2', document(men + '?page=2', [two()], {total: 1, offset: 0, limit: 1}));
    const result = await collect(records);
    assert.equal(result.coverage.exhaustive, false, mode);
    assert.equal(result.diagnostics[0].status, 'incomplete', mode);
    assert.ok(!result.products.some(p => p.style === one().productId), mode);
  }
});

test('blocked continuation discards only that incomplete shelf and retains other complete shelf proofs', async () => {
  const records = fixtures(); records.set(men + '?page=2', {rawHtml: 'Access denied', metadata: {sourceURL: men + '?page=2', statusCode: 403}});
  const result = await collect(records);
  assert.equal(result.diagnostics[0].status, 'incomplete');
  assert.match(result.diagnostics[0].error, /403/);
  assert.equal(result.diagnostics[1].status, 'complete');
  assert.equal(result.coverage.exhaustive, false);
  assert.deepEqual(result.products.map(p => p.style), [two().productId, three().productId]);
  assert.ok(result.products.every(p => p.arrivalEvidence.url === women));
});

test('own image, color, title, actual anchor, manufacturer URL and category must agree', () => {
  const parsed = parseLanvinOfficialPage(document(men, [one()]), men);
  const failures = [
    r => {r.imageGroups[0].images[0].disBaseLink = three().imageGroups[0].images[0].disBaseLink;},
    r => {r.imageGroups[0].variationAttributes[0].values[0].value = '99';},
    r => {r.imageGroups[0].images[0].title = 'Other shoe';},
    r => {r.imageGroups[0].images[0].disBaseLink = 'https://evil.test/' + one().productId + '.jpg';},
    r => {r.c_brand = 'adidas';}, r => {r.c_url = two().c_url;},
    r => {r.c_primaryCategory = 'women-shoes-sneakers';}, r => {r.representedProduct.c_categoryId = 'children-shoes-sneakers';},
  ];
  for (const change of failures) {const bad = structuredClone(parsed.rows[0]); change(bad); assert.throws(() => lanvinOfficialProduct(bad, parsed, {now}));}
  assert.throws(() => lanvinOfficialProduct(parsed.rows[0], {...parsed, anchors: []}, {now}), /anchor/);
});

test('wrong images are held per product and do not turn into another SKU image', async () => {
  const bad = one(); bad.imageGroups[0].images[0].disBaseLink = three().imageGroups[0].images[0].disBaseLink;
  const records = fixtures(); records.set(men, document(men, [bad], {total: 2, limit: 1, next: men + '?page=2', nav: true}));
  const result = await collect(records);
  assert.ok(!result.products.some(p => p.style === bad.productId));
  assert.equal(result.held[0].style, bad.productId);
  assert.match(result.held[0].reason, /SKU\/color/);
});

test('a final page may shrink its limit without inventing offsets from page numbers', async () => {
  const records = fixtures();
  records.set(men, document(men, [one(), two()], {total: 3, limit: 2, next: men + '?page=2', nav: true}));
  records.set(men + '?page=2', document(men + '?page=2', [three()], {total: 3, offset: 2, limit: 1}));
  const result = await collect(records);
  assert.equal(result.diagnostics[0].exhaustive, true);
  assert.equal(result.diagnostics[0].read, 3);
});

test('women source must come from actual official navigation, never a guessed path', async () => {
  const records = fixtures(); records.set(men, document(men, [one()]));
  const reads = [], result = await collect(records, {read: reader(records, reads)});
  assert.equal(reads.length, 1);
  assert.equal(result.coverage.womenDiscovery, null);
  assert.equal(result.coverage.exhaustive, false);
  assert.match(result.diagnostics.at(-1).error, /navigation not verified/);
});

test('read and page budgets stop without extra requests and progress failures propagate', async () => {
  const reads = [];
  const limited = await collect(fixtures(), {read: reader(fixtures(), reads), maxReads: 1});
  assert.equal(reads.length, 1); assert.equal(limited.coverage.exhaustive, false);
  assert.equal(limited.products.length, 0);
  const capped = await collect(fixtures(), {maxPages: 1});
  assert.equal(capped.diagnostics[0].status, 'incomplete');
  assert.ok(!capped.products.some(p => p.style === one().productId));
  await assert.rejects(collect(fixtures(), {onProgress: async () => {throw Error('progress persistence failed');}}), /progress persistence failed/);
});

test('sneaker-ballerina hybrids remain held by the existing review gate', () => {
  const bad = one(); bad.productName = 'LNV1 BALLERINA SNEAKERS IN SCUBA';
  bad.imageGroups[0].images[0].title = bad.productName;
  const parsed = parseLanvinOfficialPage(document(men, [bad]), men);
  assert.throws(() => lanvinOfficialProduct(parsed.rows[0], parsed, {now}), /hybrid-review-required/);
});

test('source errors expose their exact failed URL and incomplete takes precedence over exhausted', async () => {
  const records = fixtures(), failedUrl = men + '?page=2';
  records.set(failedUrl, {rawHtml: 'Access denied', metadata: {sourceURL: failedUrl, url: failedUrl, statusCode: 403}});
  const result = await collect(records);
  assert.deepEqual(result.errors, [{brand: 'Lanvin', sourceUrl: men, url: failedUrl, status: 'incomplete', error: 'HTTP 403: Lanvin source not successful'}]);
  assert.equal(result.diagnostics[1].exhausted, true, 'the other shelf completed');
  for (const key of ['exhaustive', 'exhausted', 'complete']) assert.equal(result[key], false);
  assert.equal(result.coverage.exhaustive, false);
  assert.equal(result.coverage.exhausted, false);
  assert.equal(adminCoverageExhaustive(result), false);
  assert.equal(adminCoverageExhaustive({...result, exhausted: true, coverage: {...result.coverage, exhausted: true}}), false,
    'an explicit top-level false must defeat legacy exhausted-only completion');
});

test('every source failure, including missing navigation and read budgets, is normalized for the runner', async () => {
  for (const options of [{read: async () => {throw Error('HTTP 429');}}, {maxReads: 1}, {maxPages: 1}]) {
    const result = await collect(fixtures(), options);
    const failed = result.diagnostics.filter(d => !d.exhaustive);
    assert.equal(result.errors.length, failed.length);
    assert.ok(result.errors.every(e => e.brand === 'Lanvin' && e.status === 'incomplete' && e.url && e.error));
    assert.ok(result.errors.some(e => /429|budget|limit/.test(e.error)));
    assert.equal(adminCoverageExhaustive(result), false);
  }
  const records = fixtures(); records.set(men, document(men, [one()]));
  const result = await collect(records);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /navigation not verified/);
  assert.equal(result.errors[0].url, men);
});

test('full original source receipts preserve all capture metadata, including denied responses', async () => {
  const records = fixtures(), failedUrl = men + '?page=2';
  records.set(failedUrl, {rawHtml: 'Denied', metadata: {sourceURL: failedUrl, url: failedUrl, statusCode: 403, retryAfter: '30'}});
  for (const [url, record] of records) Object.assign(record, {
    requestedUrl: url, checkedAt: '2026-11-05T07:00:00Z', conversationId: 'capture-session',
    metadata: {...record.metadata, scrapeId: 'original-scrape', nested: {capture: 'unchanged'}, contentType: 'text/html'},
  });
  const result = await collect(records);
  assert.equal(result.sourceRecords.length, 3);
  for (const source of result.sourceRecords) assert.deepEqual(source.record, records.get(source.url));
  const denied = result.sourceRecords.find(source => source.url === failedUrl);
  assert.equal(denied.record.metadata.statusCode, 403);
  assert.equal(denied.record.metadata.retryAfter, '30');
  records.get(men).metadata.nested.capture = 'changed by caller';
  assert.equal(result.sourceRecords[0].record.metadata.nested.capture, 'unchanged');
});

test('complete Lanvin products survive curation, productPresentation and public official gates', async () => {
  const result = await collect();
  assert.deepEqual(result.errors, []);
  assert.equal(adminCoverageExhaustive(result), true);
  const curated = curateCatalog(result.products, {now});
  assert.equal(curated.snapshot.products.length, 3);
  const presented = curated.snapshot.products.map(p => productPresentation(p, {products: []}));
  assert.equal(presented.filter(Boolean).length, 3);
  for (const p of presented) {
    assert.equal(p.presentation.image, p.image);
    assert.equal(p.presentation.view, 'product-photo');
    assert.equal(p.presentation.sourceUrl, p.arrivalEvidence.url);
    assert.equal(p.presentation.checkedAt, p.officialImageEvidence.verifiedAt);
    assert.equal(officialProductUrl(p, kstDay(now)), p.url);
    assert.equal(officialImageUrl(p, kstDay(now)), p.image);
    assert.equal(sourceMatches(p, 'brand', kstDay(now)), true);
    assert.equal(p.releaseDate || '', '');
  }
  const p = curated.snapshot.products[0];
  assert.equal(productPresentation(p, {products: [{id: p.id, brand: p.brand, style: p.style, originalImage: p.image, approved: false}]}), null);
  const mismatched = structuredClone(p); mismatched.officialImageEvidence.style = 'OTHER-SKU';
  assert.equal(productPresentation(mismatched, {products: []}), null);
});
