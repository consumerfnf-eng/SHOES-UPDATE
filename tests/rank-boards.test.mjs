import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {musinsaBoard, ssenseBoard, withMovement, departures, collectRankBoards, BOARD_SIZE} from '../scripts/collect-rank-boards.mjs';

const musinsaPayload = {data: {modules: [
  {type: 'TAB_OUTLINED', tabs: []},
  {type: 'THREECOLUMN', items: [
    {type: 'PRODUCT_COLUMN', id: '7460361', info: {brandName: '온루', productName: 'DUAL/WKRS - 808', finalPrice: 146300, discountRatio: 30, isSoldOut: false},
     image: {rank: 1, url: 'https://image.msscdn.net/images/goods_img/a.jpg'}, onClick: {url: 'https://www.musinsa.com/products/7460361'}},
    {type: 'PRODUCT_COLUMN', id: '7516828', info: {brandName: 'Nike', productName: '마인드 002 W', finalPrice: 179000},
     image: {rank: 2, url: 'https://image.msscdn.net/images/goods_img/b.jpg'}},
    {type: 'BANNER', id: 'ad'},
  ]},
]}};

test('a store ranking is read with its own rank, price and photograph', () => {
  const rows = musinsaBoard(musinsaPayload);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.rank), [1, 2]);
  assert.equal(rows[0].priceLabel, '146,300원');
  assert.equal(rows[0].discountRatio, 30);
  assert.match(rows[0].image, /^https:\/\/image\.msscdn\.net\//);
  // A product with no click target still links to its own page.
  assert.equal(rows[1].url, 'https://www.musinsa.com/products/7516828');
  // Anything that is not a product column is not a rank.
  assert(!rows.some(r => r.key === 'ad'));
});

test('a trending page has no rank field, so the order of the page is the rank', () => {
  const block = (sku, name, price) => `<script type="application/ld+json">${JSON.stringify(
    {'@context': 'https://schema.org', '@type': 'Product', productID: sku, sku, name,
     brand: {name: 'Nike'}, offers: [{price, priceCurrency: 'USD'}], url: `https://www.ssense.com/p/${sku}`})}</script>`;
  const rows = ssenseBoard(`<html>${block('262254M237004', 'Purple Curb Sneakers', 1490)}
    <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
    ${block('262254M237013', 'Gray Curb Snake Sneakers', 990)}</html>`);
  assert.deepEqual(rows.map(r => [r.rank, r.key]), [[1, '262254M237004'], [2, '262254M237013']]);
  assert.equal(rows[0].priceLabel, 'USD 1,490');
  // The photograph is not in the block; the sku names it on their CDN.
  assert.match(rows[0].image, /262254M237004_1\.jpg$/);
  // A breadcrumb is not a product.
  assert.equal(rows.length, 2);
});

test('what moved is the point: climbed, slipped, arrived, or left the board', () => {
  const now = [{key: 'a', rank: 1}, {key: 'b', rank: 2}, {key: 'd', rank: 3}];
  const before = {ranks: {a: 5, b: 2, c: 3}, names: {c: 'Nike Air Max 95'}};
  const moved = withMovement(now, before);
  assert.deepEqual(moved.map(i => [i.key, i.movement, i.change ?? null, i.previousRank ?? null]), [
    ['a', 'up', 4, 5],
    ['b', 'same', null, 2],
    ['d', 'new', null, null],
  ]);
  // c was third and is not on the board at all.
  assert.deepEqual(departures(now, before), [{key: 'c', rank: 3, name: 'Nike Air Max 95'}]);
  // With nothing to compare against, nothing is claimed to have moved.
  assert(withMovement(now, null).every(i => i.movement === 'first'));
});

test('a board that cannot be read keeps the last one that could, and says so', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ranks-'));
  await fs.mkdir(path.join(directory, 'data'), {recursive: true});
  const boards = [{id: 'musinsa-test', label: '테스트', retailer: 'Musinsa', basis: '판매 순위',
    pageUrl: 'https://www.musinsa.com/x', apiUrl: 'https://api.musinsa.com/x', read: musinsaBoard}];

  const first = await collectRankBoards({directory, boards, now: new Date('2026-10-23T00:00:00Z'),
    fetchText: async () => JSON.stringify(musinsaPayload)});
  assert.equal(first.boards[0].items.length, 2);
  assert(first.boards[0].items.every(i => i.movement === 'first'));

  // A week later the first product has slipped and a new one has arrived.
  const later = structuredClone(musinsaPayload);
  later.data.modules[1].items[0].image.rank = 2;
  later.data.modules[1].items[1].image.rank = 1;
  const second = await collectRankBoards({directory, boards, now: new Date('2026-10-30T00:00:00Z'),
    fetchText: async () => JSON.stringify(later)});
  assert.deepEqual(second.boards[0].items.map(i => [i.rank, i.movement]), [[1, 'up'], [2, 'down']]);
  assert.equal(second.boards[0].comparedWith, '2026-10-23T00:00:00.000Z');
  assert.equal(second.history.length, 2, 'every reading is kept');

  const refused = await collectRankBoards({directory, boards, now: new Date('2026-11-06T00:00:00Z'),
    fetchText: async () => { throw Error('HTTP 403'); }});
  assert.equal(refused.boards[0].items.length, 2, 'the last readable board stands');
  assert.equal(refused.boards[0].error, 'HTTP 403');
  assert.equal(refused.boards[0].staleSince, '2026-11-06T00:00:00.000Z');
  await fs.rm(directory, {recursive: true, force: true});
});

test('a board is the top fifteen', () => {
  assert.equal(BOARD_SIZE, 15);
});
