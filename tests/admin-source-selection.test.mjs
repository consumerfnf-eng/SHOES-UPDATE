import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {isNewListing, listingFollowups, parseArrivalListing} from '../scripts/new-arrivals.mjs';
import {auditBrand} from '../scripts/admin-monitor-runner.mjs';
import {buildAdminSnapshot} from '../scripts/build-admin-snapshot.mjs';

// Offline fixtures: New membership was checked on the official site, not
// inferred from the category number, source name, product age or sort order.
const brand = 'Rockfish Weatherwear';
const parent = 'https://en.rockfish-weatherwear.co.kr/';
const url = parent + 'NODE/product/list.html?cate_no=626';
const productUrl = parent + 'product/bryn-velcro-sneakers-v2-grey/4318/';
const sectionEvidence = {
  kind: 'new-arrivals-navigation', url: parent, targetUrl: url,
  contentHash: 'a'.repeat(64), excerpt: 'New',
};
const text = `# Shoes\n[BRYN VELCRO SNEAKERS V2 - GREY](${productUrl})`;
const parse = overrides => parseArrivalListing(text, {
  brand, url, checkedAt: '2026-11-05T00:00:00Z', ...overrides,
});

test('numeric New category requires evidence; its name alone proves nothing', () => {
  assert.equal(isNewListing(url), false);
  assert.deepEqual(parse({}), []);
});

test('parser already accepts exact-target official New navigation evidence', () => {
  const rows = parse({sectionEvidence});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].arrivalEvidence.kind, 'new-arrivals-listing');
  assert.equal(rows[0].arrivalEvidence.url, url);
});

test('mismatched target, external parent and missing hash cannot prove New', () => {
  for (const change of [
    {targetUrl: parent + 'NODE/product/list.html?cate_no=487'},
    {url: 'https://unrelated.example/new'},
    {contentHash: ''},
    {kind: 'catalogue-listing'},
  ]) assert.deepEqual(parse({sectionEvidence: {...sectionEvidence, ...change}}), []);
});

test('catalogue basis remains catalogue even with New navigation evidence', () => {
  const rows = parse({basis: 'catalogue', sectionEvidence});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].arrivalEvidence.kind, 'catalogue-listing');
});

test('newest sort on a general shoe catalogue does not establish New membership', () => {
  const sorted = 'https://www.goalstudio.com/product/list.html?cate_no=133&sort_method=5';
  assert.equal(isNewListing(sorted), false);
  assert.deepEqual(parseArrivalListing(
    `# Shoes\n[GB PACER Sneaker](https://www.goalstudio.com/product/gb-pacer/8895/)`,
    {brand: 'goalstudio', url: sorted, checkedAt: '2026-11-05T00:00:00Z'},
  ), []);
});

test('Cafe24 New navigation must survive listingFollowups', () => {
  const rows = listingFollowups(`[New](${url})`, parent, brand);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, url);
  assert.equal(rows[0].sectionEvidence.targetUrl, url);
});

const tommy = 'TOMMY HILFIGER';
const tommyUrl = 'https://www.hfashionmall.com/display/brand/getThemeBrand?brndCtgryNo=BDMA08&themeCtgryNo=THMA18A05';
const tommySource = {
  name: 'TOMMY HILFIGER official New', url: tommyUrl,
  sectionEvidence: {
    kind: 'new-arrivals-navigation',
    url: 'https://www.hfashionmall.com/display/brand?brndCtgryNo=BDMA08',
    targetUrl: tommyUrl, contentHash: 'b'.repeat(64), excerpt: '신상품',
  },
};

function mockInputs(t) {
  const original = fs.readFile.bind(fs);
  t.mock.method(fs, 'readFile', async (file, ...options) => {
    if (file === 'config/daily_sources.json') return JSON.stringify({[tommy]: [tommySource]});
    if (file === 'reports/admin-rendered-index.json') return '{}';
    if (file === 'public/data/catalog.json' || file === 'data/catalog-source.json') return '{"products":[],"keywords":[]}';
    if (typeof file === 'string' && file.startsWith('data/') && file.endsWith('.json')) {
      const error = new Error('fixture absent'); error.code = 'ENOENT'; throw error;
    }
    return original(file, ...options);
  });
  // Regressions must remain offline, including the runner's reader fallback.
  t.mock.method(globalThis, 'fetch', async () => {throw new Error('NETWORK_DISABLED_IN_TEST');});
}

test('admin runner reads an evidence-backed New URL with no New path token', async t => {
  mockInputs(t);
  const reads = [];
  await auditBrand(tommy, {
    now: new Date('2026-11-05T00:00:00Z'),
    readHtml: async target => {
      reads.push(target);
      return '<title>Official New listing fixture</title><h1>NEW IN</h1><a href="https://www.hfashionmall.com/">Official store</a>';
    },
  });
  assert.deepEqual(reads, [tommyUrl]);
});

test('admin snapshot exposes the same evidence-backed source as the runner', async t => {
  mockInputs(t);
  const snapshot = await buildAdminSnapshot({now: new Date('2026-11-05T00:00:00Z')});
  const row = snapshot.brands.find(row => row.brand === tommy);
  assert(row);
  assert.deepEqual(row.sources.map(source => source.url), [tommyUrl]);
});
