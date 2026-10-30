import test from 'node:test';
import assert from 'node:assert/strict';
import {compareByBrandGroup, displayBrandGroup, brandGroupRank, BRAND_GROUPS} from '../public/assets/brand-groups.mjs';

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

test('every house named for LUX reads as LUX, including the two added later', () => {
  const named = ['Louis Vuitton','Dior','Balenciaga','Prada','Gucci','Celine','Saint Laurent',
    'Hermès','Chanel','Miu Miu','Alexander McQueen','Fendi','Valentino Garavani','Givenchy',
    'Maison Margiela','Bottega Veneta','Loewe','Lanvin','Rick Owens','Jil Sander','Off-White',
    'AMIRI','Loro Piana','Brunello Cucinelli','Zegna','Moncler','The Row','Golden Goose',
    'Maison Mihara Yasuhiro','Common Projects','Axel Arigato','Autry','PANE','ALOHAS'];
  assert.deepEqual(BRAND_GROUPS[0].priority, named);
  for (const name of named) assert.equal(displayBrandGroup({name}), 'LUX', name);
});

test("Valentino's own name and its shoe line's name reach the same group", () => {
  assert.equal(displayBrandGroup({name: 'Valentino'}), 'LUX');
  assert.equal(displayBrandGroup({name: 'Valentino Garavani'}), 'LUX');
});

test('a luxury house nobody named follows its policy group instead of dropping into SPORTS', () => {
  assert.equal(displayBrandGroup({name: "Tod's", group: 'luxury'}), 'LUX');
  assert.equal(displayBrandGroup({name: 'Ferragamo', group: 'luxury'}), 'LUX');
  // ...and a contemporary brand with no listing is still SPORTS.
  assert.equal(displayBrandGroup({name: 'Some Label', group: 'contemporary'}), 'SPORTS');
});

test('the named order is the order on the page, and sports still follows all of it', () => {
  const sorted = ['Nike', 'Axel Arigato', 'Autry', 'Dior', 'Louis Vuitton', 'Rockfish Weatherwear']
    .map(name => ({name})).sort(compareByBrandGroup).map(b => b.name);
  assert.deepEqual(sorted, ['Louis Vuitton', 'Dior', 'Axel Arigato', 'Autry',
    'Rockfish Weatherwear', 'Nike']);
});
