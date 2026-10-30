import test from 'node:test';
import assert from 'node:assert/strict';
import {compareByBrandGroup, displayBrandGroup, brandGroupRank} from '../public/assets/brand-groups.mjs';

const order = names => names.map(name => ({name})).sort(compareByBrandGroup).map(b => b.name);

test('every LUX brand comes before any SPORTS brand', () => {
  const sorted = order(['Nike', 'Gucci', 'adidas', 'Prada', 'Rockfish Weatherwear', 'Louis Vuitton']);
  const firstSports = sorted.findIndex(n => displayBrandGroup({name: n}) === 'SPORTS');
  const lastLux = sorted.map(n => displayBrandGroup({name: n})).lastIndexOf('LUX');
  assert(lastLux < firstSports, `LUX must not be interleaved: ${sorted.join(' · ')}`);
});

test('Rockfish leads SPORTS', () => {
  const sorted = order(['Nike', 'On', 'adidas', 'Rockfish Weatherwear', 'ASICS']);
  assert.equal(sorted[0], 'Rockfish Weatherwear');
  // ...and the rest keep the order the priority list gives them.
  assert.deepEqual(sorted, ['Rockfish Weatherwear', 'On', 'ASICS', 'New Balance', 'adidas', 'Nike']
    .filter(n => sorted.includes(n)));
});

test('a brand nobody listed lands alphabetically after the listed ones, not at the top', () => {
  const sorted = order(['Zzz Brand', 'Nike', 'Aaa Brand', 'On']);
  assert.deepEqual(sorted, ['On', 'Nike', 'Aaa Brand', 'Zzz Brand']);
  assert.equal(brandGroupRank({name: 'Aaa Brand'}).priority, Number.MAX_SAFE_INTEGER);
});

test('the order is stable and total - sorting twice changes nothing', () => {
  const names = ['Nike', 'Gucci', 'Rockfish Weatherwear', 'Aaa Brand', 'Dior', 'On'];
  assert.deepEqual(order(order(names)), order(names));
  // A brand compared with itself is a tie, which a total order requires.
  assert.equal(compareByBrandGroup({name: 'Nike'}, {name: 'Nike'}), 0);
});
