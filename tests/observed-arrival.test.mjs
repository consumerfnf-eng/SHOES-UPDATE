import test from 'node:test';
import assert from 'node:assert/strict';
import {hasObservedArrival, observedArrivalLabel} from '../public/assets/observed-arrival.mjs';
import {updateWatch, daysBetween} from '../scripts/source-watch.mjs';

const TODAY = '2026-10-30';
const watch = {brands: {Nike: {watchingSince: '2026-09-01', lastReadAt: TODAY, reads: 8}}};
const shoe = (firstSeen, brand = 'Nike') => ({brand, firstSeen});

test('a shoe that appeared after we started watching counts as newly listed', () => {
  assert(hasObservedArrival(shoe('2026-10-24T08:00:00+09:00'), TODAY, watch));
});

test('a shoe that was there when we arrived proves nothing', () => {
  // Same day as the watch began: it was on the shelf when we first looked.
  assert(!hasObservedArrival(shoe('2026-09-01T08:00:00+09:00'), TODAY, watch));
  assert(!hasObservedArrival(shoe('2026-08-20T08:00:00+09:00'), TODAY, watch));
});

test('a brand we have never read tells us nothing about any of its shoes', () => {
  assert(!hasObservedArrival(shoe('2026-10-24T08:00:00+09:00', 'Hermès'), TODAY, watch));
  assert(!hasObservedArrival(shoe('2026-10-24T08:00:00+09:00'), TODAY, {brands: {}}));
  assert(!hasObservedArrival(shoe('2026-10-24T08:00:00+09:00'), TODAY, null));
});

test('the sighting still has to be inside the three-month window', () => {
  assert(!hasObservedArrival(shoe('2026-06-01T08:00:00+09:00'), TODAY, watch), 'five months ago');
  assert(!hasObservedArrival(shoe('2026-12-01T08:00:00+09:00'), TODAY, watch), 'not in the future either');
});

test('the label says what the date is, and what it is not', () => {
  const label = observedArrivalLabel(shoe('2026-10-24T08:00:00+09:00'));
  assert(label.includes('최초 확인'));
  assert(label.includes('출시일 미공개'), 'it must never read as a launch date');
  assert(!/^\d{4}-\d{2}-\d{2}$/.test(label), 'a bare date would be read as a release date');
});

test('looking away for a month restarts the claim', () => {
  const prior = {brands: {Nike: {watchingSince: '2026-08-01', lastReadAt: '2026-09-01', reads: 4}}};
  const after = updateWatch(prior, {coverage: [{brand: 'Nike', responses: 3, status: 'ok'}], checkedAt: '2026-10-30T00:00:00Z'});
  assert.equal(after.brands.Nike.watchingSince, '2026-10-30', 'a 60-day gap means we cannot vouch for what arrived in it');
  assert.equal(after.brands.Nike.restartedAt, '2026-10-30');
  // A week's gap is the normal cadence and changes nothing.
  const weekly = updateWatch({brands: {Nike: {watchingSince: '2026-08-01', lastReadAt: '2026-10-23', reads: 9}}},
    {coverage: [{brand: 'Nike', responses: 3, status: 'ok'}], checkedAt: '2026-10-30T00:00:00Z'});
  assert.equal(weekly.brands.Nike.watchingSince, '2026-08-01');
  assert.equal(weekly.brands.Nike.restartedAt, undefined);
});

test('a read that failed is not a week of watching', () => {
  const prior = {brands: {}};
  const after = updateWatch(prior, {coverage: [{brand: 'Hermès', responses: 0, status: 'failed'}], checkedAt: '2026-10-30T00:00:00Z'});
  assert.equal(after.brands['Hermès'].watchingSince, '2026-10-30');
  assert.equal(after.brands['Hermès'].lastReadAt, '', 'a refusal is not a reading');
  assert.equal(after.brands['Hermès'].lastFailedAt, '2026-10-30');
});

test('the watch is seeded from the earliest record we already hold', () => {
  const after = updateWatch({brands: {}}, {
    products: [{brand: 'On', firstSeen: '2026-09-20T00:00:00Z'}, {brand: 'On', firstSeen: '2026-08-01T00:00:00Z'}],
    checkedAt: '2026-10-30T00:00:00Z',
  });
  assert.equal(after.brands.On.watchingSince, '2026-08-01');
});

test('daysBetween counts whole days', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-30'), 29);
});
