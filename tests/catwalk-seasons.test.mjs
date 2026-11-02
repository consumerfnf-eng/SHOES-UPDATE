import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonOrder, sortSeasons, retainSeasons, isNewerSeason, SEASONS_KEPT} from '../public/assets/catwalk-seasons.mjs';

test('a season label is read into calendar order, not sorted as text', () => {
  // Autumn comes after Spring within a year; the next year comes after both.
  assert(seasonOrder('Spring/Summer 2027') < seasonOrder('Autumn/Winter 2027'));
  assert(seasonOrder('Autumn/Winter 2027') < seasonOrder('Resort 2028'));
  assert(seasonOrder('Resort 2028') < seasonOrder('Spring/Summer 2028'));
  // The library has used both spellings of the same season.
  assert.equal(seasonOrder('Fall/Winter 2027'), seasonOrder('Autumn/Winter 2027'));
  assert.equal(seasonOrder('S/S 2027'), seasonOrder('Spring/Summer 2027'));
  // Pre-Fall sits between the two main seasons of its year.
  assert(seasonOrder('Spring/Summer 2027') < seasonOrder('Pre-Fall 2027'));
  assert(seasonOrder('Pre-Fall 2027') < seasonOrder('Autumn/Winter 2027'));
  // A label with no year cannot be placed.
  for (const label of ['', null, undefined, 'Spring/Summer', '   ']) assert.equal(seasonOrder(label), null);
});

test('seasons list newest first, and an unplaceable label never sorts current', () => {
  assert.deepEqual(sortSeasons(['Spring/Summer 2027', 'Spring/Summer 2028', 'Autumn/Winter 2027']),
    ['Spring/Summer 2028', 'Autumn/Winter 2027', 'Spring/Summer 2027']);
  assert.deepEqual(sortSeasons(['Spring/Summer 2027', ' Spring/Summer 2027 ', '', null]), ['Spring/Summer 2027']);
  assert.equal(sortSeasons(['Spring/Summer 2027', 'Mystery Season'])[0], 'Spring/Summer 2027');
});

test('three seasons are kept and the oldest is dropped, by order rather than by arrival', () => {
  assert.equal(SEASONS_KEPT, 3);
  // Collected out of order on purpose: what stays is decided by the calendar.
  const {keep, drop} = retainSeasons(['Spring/Summer 2027', 'Spring/Summer 2028', 'Autumn/Winter 2026', 'Autumn/Winter 2027']);
  assert.deepEqual(keep, ['Spring/Summer 2028', 'Autumn/Winter 2027', 'Spring/Summer 2027']);
  assert.deepEqual(drop, ['Autumn/Winter 2026']);
  // Fewer than the limit drops nothing, and one season never evicts itself.
  assert.deepEqual(retainSeasons(['Spring/Summer 2027']).drop, []);
  assert.deepEqual(retainSeasons([]).keep, []);
  // A nonsense limit falls back to the default rather than emptying the tab.
  for (const limit of [0, -2, NaN, null, 'three'])
    assert.equal(retainSeasons(['Spring/Summer 2028', 'Autumn/Winter 2027', 'Spring/Summer 2027', 'Autumn/Winter 2026'], limit).keep.length,
      SEASONS_KEPT, `limit ${String(limit)}`);
});

test('only a genuinely newer season triggers a collection', () => {
  const known = ['Spring/Summer 2027', 'Autumn/Winter 2026'];
  assert.equal(isNewerSeason('Autumn/Winter 2027', known), true);
  assert.equal(isNewerSeason('Spring/Summer 2027', known), false, 'already collected');
  assert.equal(isNewerSeason('Spring/Summer 2026', known), false, 'older than what is held');
  assert.equal(isNewerSeason('Spring/Summer 2028', []), true, 'nothing collected yet');
  // A caption WGSN reshapes must not evict a real season by looking new.
  assert.equal(isNewerSeason('Mystery Season', known), false);
  assert.equal(isNewerSeason('', known), false);
});
