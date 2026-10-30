import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanProductName, labelNameVariantColours} from '../scripts/curation.mjs';
import {keepOnePerProductUrl, holdPhotosSharedAcrossModels} from '../scripts/publish-curated.mjs';
import {variantGroupKey, variantGroupName} from '../public/assets/catalog-view.mjs';

test('a multi-shade colourway comes off the card name, not just a single word', () => {
  // Balenciaga states "Black/dark Grey" and titles the listing "... in
  // Black/dark Grey". Split on the slash, "dark Grey" is preceded by one, and
  // the boundary that only admitted whitespace never found it - so four
  // colourways of one Triple S.2 stood as four cards.
  const shades = ['Black/dark Grey', 'Blue/white/yellow', 'Eggshell', 'Grey/green', 'Grey/red/white'];
  const keys = new Set(shades.map(colorway => variantGroupKey({
    brand: 'Balenciaga', name: `Men's Triple S.2 Sneaker in ${colorway}`, colorway,
  })));
  assert.equal(keys.size, 1, [...keys].join(' | '));
  assert.equal([...keys][0], 'balenciaga|triples2');
});

test('a colour the brand only wrote into the name is lifted out by its group', () => {
  // ALOHAS publishes one shoe four times with the colour field empty every
  // time. One name on its own proves nothing - a model can be called Black
  // Sheep - so it is the group of names identical but for that word.
  const products = ['Blue', 'Brown', 'Cream', 'Yellow'].map(shade => ({
    brand: 'ALOHAS', name: `Tb.205 Bara Nylon ${shade} Sneakers`, colorway: '',
  }));
  labelNameVariantColours(products);
  assert.deepEqual(products.map(p => p.colorway), ['Blue', 'Brown', 'Cream', 'Yellow']);
  assert.equal(new Set(products.map(variantGroupKey)).size, 1);
});

test('a lone colour word in a name is left alone', () => {
  const products = [{brand: 'Vans', name: 'Black Sheep Slip-On', colorway: ''}];
  labelNameVariantColours(products);
  assert.equal(products[0].colorway, '');
});

test('one product URL publishes once, and the page keeps the colour it names', () => {
  // The colour selector in the URL is what tells five Balenciaga colourways
  // apart, so these are five products. Two records on the identical URL,
  // selector included, are one product twice.
  const held = [];
  const variants = ['1011', '4497'].map(code => ({
    id: `v${code}`, brand: 'Balenciaga', colorway: code === '1011' ? 'Black' : 'Eggshell',
    url: `https://www.balenciaga.com/en-us/triple-s.2-sneaker-black-865849.html?dwvar_865849_color=${code}`,
  }));
  assert.equal(keepOnePerProductUrl(variants, held).length, 2);
  assert.equal(held.length, 0);

  const twice = [
    {id: 'a', brand: 'On', colorway: 'Silver Ore', url: 'https://www.on.com/p/cloudvista-3-waterproof/silver-ore-shoes'},
    {id: 'b', brand: 'On', colorway: 'Black', url: 'https://www.on.com/p/cloudvista-3-waterproof/silver-ore-shoes'},
  ];
  const kept = keepOnePerProductUrl(twice, held);
  assert.deepEqual(kept.map(p => p.id), ['a'], 'the slug names Silver Ore, so that is the record the page is evidence for');
  assert.equal(held[0].reason, 'duplicate-product-url');
});

test('two different models cannot both be the shoe in one photograph', () => {
  // Brooks published the Adrenaline GTS 10, the Ghost 18 and the Ghost Max 4
  // with one image between them; the n>=4 rule written for Havaianas' 38
  // never saw a group of three.
  const held = [];
  const image = 'https://cdn.brooks/one-photo.jpg';
  const products = ['Adrenaline GTS 10', 'Ghost 18', 'Ghost Max 4'].map((name, i) => ({
    id: `b${i}`, brand: 'Brooks', name, presentation: {image},
  }));
  const kept = holdPhotosSharedAcrossModels(products, held);
  assert.equal(kept.length, 1);
  assert.equal(held.length, 2);
  assert.ok(held.every(h => h.reason === 'photo-shared-across-models'));
});

test('two colour chips of one model may share a shot', () => {
  const held = [];
  const image = 'https://cdn.brooks/ghost-18.jpg';
  const products = ['Black', 'White'].map((colorway, i) => ({
    id: `g${i}`, brand: 'Brooks', name: 'Ghost 18', colorway, presentation: {image},
  }));
  assert.equal(holdPhotosSharedAcrossModels(products, held).length, 2);
  assert.equal(held.length, 0);
});

test("a shop's image furniture is not part of the product's name", () => {
  const cases = [
    ['Image 4: Main product image of XT-MM6 MAISON MARGIELA - Unisex · Sneakers', 'XT-MM6 MAISON MARGIELA'],
    ['XT-WHISPER KRAFT - Unisex · Sneakers', 'XT-WHISPER KRAFT'],
    ['AERO GLIDE 4 GRADIENT - Men · Road running', 'AERO GLIDE 4 GRADIENT'],
    ['Image 183: Cascadia Elite image number 1', 'Cascadia Elite'],
    ['Image 163: Side view of a black and beige X Bend sneaker with yellow sole', 'X Bend'],
    ['Image 171: Side view of an orange Camp platform Sneaker with yellow laces and sole', 'Camp platform'],
  ];
  for (const [input, want] of cases) assert.equal(cleanProductName(input), want, input);
});

test("a shop's own colour-first naming survives the cleanup", () => {
  // SSENSE names products colour-first. Nothing fired on this one, so no
  // leading colour is taken off it.
  assert.equal(cleanProductName('Purple Speedcat Croc Sneakers'), 'Purple Speedcat Croc Sneakers');
  // The card name then loses the colour and the material by the existing
  // rules - Croc is a material, the way Curb Snake and Curb Velvet are one
  // Curb - which is a different step from the furniture cleanup above.
  assert.equal(variantGroupName({brand: 'PUMA', name: 'Purple Speedcat Croc Sneakers', colorway: 'Purple'}),
               'Speedcat');
});
