import test from 'node:test';
import assert from 'node:assert/strict';
import {collectLululemonNew, parseLululemonNewPage, readLululemonNewHtml, LULULEMON_NEW_ROOT as root,
  LULULEMON_NEW_SOURCES} from '../scripts/collect-lululemon-new.mjs';
import {officialEvidenceFor, curateCatalog} from '../scripts/curation.mjs';
import {officialImageUrl} from '../public/assets/catalog-view.mjs';
import {reviewAdminProducts} from '../scripts/admin-publication-review.mjs';

const now = new Date('2026-11-05T08:00:00Z'), observedAt = '2026-11-05T07:00:00Z';
function product({id = 'zrd76yrfgx', name = "Women's SightSeeker Sneaker", style = 'LW9GBSS', color = '075608',
  urlColor = String(Number(color)), colorway = 'Coconut Ivory/Coconut Ivory/Coconut Ivory', categoryId = 'n1colrzq0cf', title = "What's New Shoes"} = {}) {
  return {id, type: 'products', attributes: {name, parentCategory: {id: categoryId, name: title}, url: `/p/womens-sightseeker-sneaker/${id}`,
    colors: [{id: urlColor, name: colorway}],
    styles: [{id: style, colors: [{id: `${style}-${color}`, price: {listPrice: 138, currencyCode: 'USD'},
      images: [{url: `https://images.lululemon.com/is/image/lululemon/${style}_${color}_1`}], availability: {isAvailable: true}}]}],
    skus: [{id: 'us_159768961', styleId: style, url: `/p/Womens-SightSeeker-Sneaker/${id}?color=${urlColor}&size=10`,
      color: {id: urlColor, name: colorway}, availability: {isAvailable: true}}],
  }};
}
function capture(products, {url = root, total = products.length, offset = 0, limit = 40, next = null} = {}) {
  const parts = new URL(url).pathname.split('/'), slug = parts[2], categoryId = parts[3];
  const page = {data: {type: 'category-details', attributes: {title: "What's New Shoes", totalCount: total, offset, limit,
    breadcrumbs: [{label: "What's New", path: '/c/whats-new/n1q0cf'}, {label: 'Shoes', path: null}],
    appliedRefinements: [{label: 'Shoes', dimensionName: 'product.categoryFacet'}]},
    relationships: {products: {data: products.map(p => ({id: p.id, type: 'products'}))}, pageData: {data: {id: categoryId}}}},
    included: [...products, {id: categoryId, type: 'category-page-data', attributes: {canonicalUrl: '/c/whats-new/n1q0cf'}, links: {related: {next}}}]};
  const hydration = {query: {slug: [slug, categoryId]}, props: {pageProps: {locale: 'en-us', dehydratedState: {queries: [{
    queryKey: ['catalogPageData', 'cdp', {hash: categoryId, slug, offset, pageSize: limit}], state: {status: 'success', data: {pages: [page]}},
  }]}}}};
  return {url, status: 200, rawHtml: `<html><head><title>What's New Shoes | lululemon</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(hydration)}</script></body></html>`, observedAt};
}
const mutateHydration = (record, mutate) => {
  const h = JSON.parse(record.rawHtml.match(/<script[^>]*>([^]*?)<\/script>/)[1]); mutate(h);
  return {...record, rawHtml: record.rawHtml.replace(/(<script[^>]*>)[^]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(h) + b)};
};
const pageOf = h => h.props.pageProps.dehydratedState.queries[0].state.data.pages[0];
const collect = options => collectLululemonNew({now, minIntervalMs: 0, ...options});

test('original New category hydration emits typed manufacturer color records accepted by existing gates', async () => {
  const r = await collect({read: async () => capture([product()])});
  assert.equal(r.complete, true); assert.equal(r.products.length, 1);
  const p = r.products[0], today = '2026-11-05';
  assert.equal(p.style, 'LW9GBSS'); assert.equal(p.productVariantId, 'LW9GBSS-075608');
  assert.equal(p.representativeSkuId, 'us_159768961'); assert.equal(new URL(p.url).searchParams.get('size'), '10');
  assert.match(p.image, /LW9GBSS_075608_1$/);
  assert.equal(p.productEvidenceUrl, root); assert.equal(p.officialImageEvidence.sourceUrl, root);
  assert.equal(p.officialProductEvidence.verificationMethod, 'official-new-listing-sku-image');
  assert.match(p.officialProductEvidence.jsonPointer, /styles\/0\/colors\/0$/);
  assert.equal(p.officialProductEvidence.provenance.reportedCanonicalUrl, '/c/whats-new/n1q0cf');
  assert.ok(officialEvidenceFor(p, today)); assert.equal(reviewAdminProducts([p], {}).products.length, 1);
  const curated = curateCatalog([p], {now}); assert.deepEqual(curated.review.held, []);
  assert.equal(officialImageUrl(curated.snapshot.products[0], today), p.image); assert.equal(p.releaseDate, undefined);
});

test('each original color keeps its own style, SKU URL, color name and shoe photograph', async () => {
  const a = product(), b = product({color: '4310', colorway: 'Black/Black/Black'});
  a.attributes.colors.push(...b.attributes.colors); a.attributes.styles[0].colors.push(...b.attributes.styles[0].colors);
  a.attributes.skus.push(...b.attributes.skus);
  const r = await collect({read: async () => capture([a])});
  assert.equal(r.products.length, 2);
  assert.deepEqual(r.products.map(p => p.colorway), ['Coconut Ivory/Coconut Ivory/Coconut Ivory', 'Black/Black/Black']);
  assert.match(r.products[1].image, /LW9GBSS_4310_1$/);
  assert.equal(new URL(r.products[1].url).searchParams.get('color'), '4310');
});

test('cached raw captures preserve original observed timestamp rather than replay time', async () => {
  const r = capture([product()]); r.metadata = {sourceURL: root, url: root, statusCode: 200, cacheState: 'hit', cachedAt: '2026-11-03T01:00:00Z', scrapeId: 'receipt'};
  const out = await collect({read: async () => ({structuredContent: {success: true, data: r}})});
  assert.equal(out.products[0].productVerifiedAt, r.metadata.cachedAt);
  assert.equal(out.products[0].officialProductEvidence.provenance.scrapeId, 'receipt');
  delete r.metadata.cachedAt;
  assert.throws(() => parseLululemonNewPage(r, root, {now}), /timestamp/);
});

test('obsolete and general shoe paths or newest-sort URLs cannot claim New membership', async () => {
  for (const url of ['https://shop.lululemon.com/c/whats-new-sneakers/n1d852zq0cf',
    'https://shop.lululemon.com/c/shoes/n1n4fc', root + '?Ns=product.last_SKU_addition_dateTime%7C1']) {
    await assert.rejects(collect({sources: [url]}), /category|query/);
  }
});

test('HTTP 400 GE401001, CAPTCHA, processed HTML and markdown remain failed reads', async () => {
  const good = capture([product()]);
  for (const r of [
    {...good, status: 400, rawHtml: '{"errorCode":"GE401001"}'},
    {...good, rawHtml: good.rawHtml.replace("What's New Shoes | lululemon", 'Access Denied CAPTCHA')},
    {url: root, status: 200, html: good.rawHtml}, {url: root, status: 200, markdown: '# New Shoes'},
  ]) {
    const out = await collect({read: async () => r});
    assert.equal(out.complete, false); assert.deepEqual(out.products, []); assert.ok(out.coverage[0].error);
  }
});

test('New route, query identity, breadcrumb, selected Shoes and per-product membership are all required', async () => {
  const good = capture([product()]);
  for (const mutate of [
    h => {h.query.slug[0] = 'shoes';},
    h => {h.props.pageProps.locale = 'en-ca';},
    h => {h.props.pageProps.dehydratedState.queries[0].queryKey[2].hash = 'n1n4fc';},
    h => {pageOf(h).data.attributes.breadcrumbs = [];},
    h => {pageOf(h).data.attributes.appliedRefinements = [];},
    h => {pageOf(h).included[0].attributes.parentCategory.id = 'n1n4fc';},
  ]) assert.throws(() => parseLululemonNewPage(mutateHydration(good, mutate), root, {now}));
});

test('SKU, color, product URL and own photo mismatches never borrow evidence from siblings', async () => {
  const good = capture([product()]);
  for (const mutate of [
    a => {a.styles[0].id = 'LW9OTHER';},
    a => {a.styles[0].colors[0].images[0].url = 'https://images.lululemon.com/is/image/lululemon/LW9GBSS_4310_1';},
    a => {a.styles[0].colors[0].images[0].url = 'https://evil.example/is/image/lululemon/LW9GBSS_075608_1';},
    a => {a.skus[0].color.name = 'Wrong';},
    a => {a.skus[0].url = '/p/Womens-SightSeeker-Sneaker/other?color=75608&size=10';},
    a => {a.skus[0].url = '/p/Womens-SightSeeker-Sneaker/zrd76yrfgx?color=4310&size=10';},
    a => {a.colors = [];},
  ]) {
    const bad = mutateHydration(good, h => mutate(pageOf(h).included[0].attributes));
    const r = await collect({read: async () => bad}); assert.equal(r.complete, false); assert.deepEqual(r.products, []);
  }
});

test('children, boots, slides, mules, non-athletic shoes and unavailable variants stay excluded', async () => {
  const names = ["Kids' Running Shoe", "Women's Boot", "Men's Slide", "Women's Mule", "Women's Puff Puff Shoe"];
  const rows = names.map((name, i) => product({id: `id${i}`, name}));
  const unavailable = product({id: 'unavailable'}); unavailable.attributes.styles[0].colors[0].availability.isAvailable = false;
  const r = await collect({read: async () => capture([...rows, unavailable])});
  assert.equal(r.complete, true); assert.equal(r.products.length, 0); assert.equal(r.excluded.length, 6);
});

test('explicit category next link and exact model totals prove completion', async () => {
  const next = root + '?offset=1', calls = [];
  const r = await collect({read: async url => {
    calls.push(url); return url === root ? capture([product()], {total: 2, limit: 1, next}) :
      capture([product({id: 'other', style: 'LW9ABCS'})], {url, total: 2, limit: 1, offset: 1});
  }});
  assert.deepEqual(calls, [root, next]); assert.equal(r.products.length, 2); assert.equal(r.complete, true);
});

test('truncated references, missing next metadata, page ceiling and repeated models return no publishable source rows', async () => {
  const good = capture([product()]);
  for (const mutate of [
    h => {pageOf(h).data.attributes.totalCount = 2;},
    h => {delete pageOf(h).included[1].links.related.next;},
    h => {pageOf(h).included.splice(0, 1);},
    h => {pageOf(h).data.relationships.products.data.push({id: 'zrd76yrfgx', type: 'products'});},
  ]) {
    const r = await collect({read: async () => mutateHydration(good, mutate)});
    assert.equal(r.complete, false); assert.deepEqual(r.products, []);
  }
  const next = root + '?offset=1';
  for (const maxPages of [1, 2]) {
    const r = await collect({maxPages, read: async url => capture([product()], {url, total: 2, limit: 1,
      offset: url === root ? 0 : 1, next: url === root ? next : null})});
    assert.equal(r.complete, false); assert.deepEqual(r.products, []);
  }
});

test('default reader makes ordinary HTML request without credentials; checkpoint errors propagate', async () => {
  let calls = 0;
  const r = await readLululemonNewHtml(root, {fetchImpl: async (url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, undefined);
    return {url, status: 400, text: async () => '{"errorCode":"GE401001"}'};
  }});
  assert.equal(calls, 1); assert.equal(r.status, 400);
  await assert.rejects(collect({read: async () => capture([product()]), onCheckpoint: async () => {throw Error('storage failed');}}), /storage failed/);
});
