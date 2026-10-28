import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../public/assets/monthly-view.mjs';

const { groupKey, uniqueVariants, swatchFor, colorLabel, modelName, splitColorFromName } = __test__;

const item = (over = {}) => ({ id: 'x', brand: 'Nike', source: 'retail-ssense', name: '', fullName: '', ...over });

test('a leading colorway is split off a retail title', () => {
  assert.deepEqual(splitColorFromName('Black & White Cloudtilt Sneakers'),
    { color: 'Black & White', rest: 'Cloudtilt Sneakers' });
  assert.deepEqual(splitColorFromName('Cloudtilt Sneakers'), { color: '', rest: 'Cloudtilt Sneakers' });
});

test('the colorway field wins over re-deriving it from the title', () => {
  assert.equal(colorLabel(item({ colorway: '페일리스트 퍼플', fullName: 'Black Gabe Sneakers' })), '페일리스트 퍼플');
  assert.equal(colorLabel(item({ fullName: 'Black Gabe Sneakers' })), 'Black');
  assert.equal(colorLabel(item({ fullName: 'Gabe Sneakers' })), '');
});

test('same model in different colours is one card', () => {
  const black = item({ id: 'a', name: 'Gabe Sneakers', colorway: 'Black' });
  const white = item({ id: 'b', name: 'Gabe Sneakers', colorway: 'White' });
  assert.equal(groupKey(black), groupKey(white));
});

test('different models never merge, even sharing a colour', () => {
  assert.notEqual(
    groupKey(item({ id: 'a', name: 'Gabe Sneakers', colorway: 'Black' })),
    groupKey(item({ id: 'b', name: 'Cortez Sneakers', colorway: 'Black' })));
});

test('the same model at two retailers stays separate, since prices and links differ', () => {
  assert.notEqual(
    groupKey(item({ id: 'a', name: 'Gabe Sneakers', source: 'retail-ssense' })),
    groupKey(item({ id: 'b', name: 'Gabe Sneakers', source: 'retail-29cm' })));
});

test('a trailing category word does not split one model into two cards', () => {
  assert.equal(groupKey(item({ name: 'Cloudtilt Sneakers' })), groupKey(item({ name: 'Cloudtilt' })));
});

test('one chip per named colour, and unnamed colours never collapse into each other', () => {
  const group = [
    item({ id: 'a', colorway: 'Black' }),
    item({ id: 'b', colorway: 'black' }),
    item({ id: 'c', colorway: 'White' }),
    item({ id: 'd' }),
    item({ id: 'e' }),
  ];
  const variants = uniqueVariants(group);
  assert.deepEqual(variants.map(v => v.id), ['a', 'c', 'd', 'e']);
});

test('swatches come from the retailer hex when it gave one', () => {
  assert.equal(swatchFor(item({ colorSwatches: ['#4C3A31'] })), '#4C3A31');
  assert.match(swatchFor(item({ colorSwatches: ['#000000', '#FFFFFF'] })), /^linear-gradient/);
});

test('a named colour falls back to the palette in both languages', () => {
  assert.equal(swatchFor(item({ colorway: 'Black' })), '#1b1b1b');
  assert.equal(swatchFor(item({ colorway: '블랙' })), '#1b1b1b');
});

test('a palette word anywhere in a compound colour name still resolves', () => {
  assert.equal(swatchFor(item({ colorway: 'Pale Lilac Dust' })), '#c7b3d9');
  assert.equal(swatchFor(item({ colorway: '서밋 화이트' })), '#f4f4f4');
});

test('an unrecognised colour name gets the neutral chip, never a guessed hex', () => {
  assert.match(swatchFor(item({ colorway: 'Meteorite Shadow' })), /repeating-linear-gradient/);
  assert.match(swatchFor(item({})), /repeating-linear-gradient/);
});

test('the display name is the model, with the full listing title kept separately', () => {
  assert.equal(modelName(item({ name: 'Gabe Sneakers', fullName: 'Black Gabe Sneakers' })), 'Gabe Sneakers');
  assert.equal(modelName(item({ name: '', fullName: 'Black Gabe Sneakers' })), 'Gabe Sneakers');
});
