import test from 'node:test';
import assert from 'node:assert/strict';
import {shapeTrend, freshThisWeek} from '../scripts/weekly-briefing.mjs';

const week = (asOf, colours) => ({asOf, colours});

test('a shape trend waits for enough weeks before it says anything', () => {
  const trend = shapeTrend([week('2026-10-25', {브라운: 10, 블랙: 90})], 'colours');
  assert.equal(trend.ready, false);
  assert.equal(trend.weeks, 1);
  assert.equal(trend.needs, 3);
  assert.deepEqual(trend.rows, [], 'nothing is claimed from one week');
});

test('it compares shares, not counts, so growth of the whole is not a trend', () => {
  // Every colour doubles. Nothing has gained ground on anything.
  const weeks = [
    week('2026-10-11', {브라운: 100, 블랙: 100, 블루: 100}),
    week('2026-10-18', {브라운: 200, 블랙: 200, 블루: 200}),
    week('2026-10-25', {브라운: 400, 블랙: 400, 블루: 400}),
  ];
  assert.deepEqual(shapeTrend(weeks, 'colours').rows, []);
});

test('it reports a colour that actually gained ground, against the mean of the weeks before', () => {
  const weeks = [
    week('2026-10-11', {브라운: 100, 블랙: 450, 블루: 450}),
    week('2026-10-18', {브라운: 100, 블랙: 450, 블루: 450}),
    week('2026-10-25', {브라운: 300, 블랙: 350, 블루: 350}),
  ];
  const trend = shapeTrend(weeks, 'colours');
  assert.equal(trend.ready, true);
  const brown = trend.rows.find(r => r.name === '브라운');
  assert(brown, '브라운 went from a tenth to three tenths and should be reported');
  assert(brown.move > 1, 'that is better than a doubling of share');
  assert(trend.rows[0].name === '브라운', 'the largest move is reported first');
});

test('the unplaced bucket is never reported as a trend, and neither is a sliver', () => {
  const weeks = [
    week('2026-10-11', {'기타·미분류': 900, 브라운: 99, 퍼플: 1}),
    week('2026-10-18', {'기타·미분류': 100, 브라운: 99, 퍼플: 1}),
    week('2026-10-25', {'기타·미분류': 900, 브라운: 99, 퍼플: 50}),
  ];
  const trend = shapeTrend(weeks, 'colours');
  assert(!trend.rows.some(r => r.name === '기타·미분류'), 'what we could not classify is not a market movement');
  // 퍼플 did move a long way, and it is now a big enough share to be worth saying.
  assert(trend.rows.some(r => r.name === '퍼플'));
  // ...but a colour that stayed below the share floor is left out.
  const tiny = shapeTrend([
    week('a', {브라운: 999, 퍼플: 1}), week('b', {브라운: 999, 퍼플: 1}), week('c', {브라운: 996, 퍼플: 4}),
  ], 'colours');
  assert(!tiny.rows.some(r => r.name === '퍼플'), 'four records out of a thousand is not a trend');
});

test('a week with no stored shape is skipped rather than counted as zero', () => {
  const weeks = [week('a', {브라운: 50, 블랙: 50}), {asOf: 'b'}, week('c', {브라운: 50, 블랙: 50})];
  const trend = shapeTrend(weeks, 'colours');
  assert.equal(trend.ready, false, 'two usable weeks is still not three');
  assert.equal(trend.weeks, 2);
});

test('fresh is counted against the week being reported, not against today', () => {
  const products = [
    {id: 'a', listedAt: '2026-10-24'}, {id: 'b', listedAt: '2026-10-18'},
    {id: 'c', listedAt: '2026-09-01'}, {id: 'd'},
  ];
  const fresh = freshThisWeek(products, '2026-10-25');
  assert.deepEqual(fresh.map(p => p.id), ['a', 'b'], 'seven days back from the as-of date');
});
