import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterProducts, isOverlay, overlayKind, overlayReleaseState, overlayWindowDay,
  retailerId, sourceMatches, trendKeywordMatches, trendTerms, variantGroupKey,
  uniqueColorVariants, colorSwatch, foldTerm,
} from '../public/assets/catalog-view.mjs';

const TODAY = '2026-10-29';
const retail = (over = {}) => ({
  id: 'r1', overlay: true, source: 'retail-29cm', brand: 'PUMA', name: 'Speedcat',
  // A card with no photograph is no longer published, so every fixture that
  // expects to appear in the grid carries one.
  image: 'https://example.org/speedcat.jpg',
  listedAt: '2026-10-01T00:00:00+09:00', category: 'sneaker', footwearTypes: ['sneaker'], ...over,
});
const article = (over = {}) => ({
  id: 'n1', overlay: true, source: 'newsletter-hypebeast', brand: 'Nike', name: 'Air Max 95',
  image: 'https://example.org/am95.jpg',
  publishedAt: '2026-10-20T00:00:00Z', category: 'sneaker', footwearTypes: ['sneaker'], ...over,
});
const official = (over = {}) => ({ id: 'o1', brand: 'adidas', name: 'Samba', image: 'https://example.org/samba.jpg', ...over });

const state = (over = {}) => ({
  search: '', brands: new Set(), fit: 'all', category: 'all', source: 'all',
  release: 'released', sort: 'newest', retailer: 'all', trendTerms: null, ...over,
});

test('an overlay record is recognised and classified by its source', () => {
  assert.equal(isOverlay(retail()), true);
  assert.equal(isOverlay(official()), false);
  assert.equal(overlayKind(retail()), 'retail');
  assert.equal(overlayKind(article()), 'newsletter');
  assert.equal(retailerId(retail()), 'retail-29cm');
  assert.equal(retailerId(article()), '');
});

test('the window date is the one the source actually stated', () => {
  assert.equal(overlayWindowDay(retail()), '2026-10-01');
  assert.equal(overlayWindowDay(article()), '2026-10-20');
  assert.equal(overlayWindowDay(retail({ listedAt: '', firstDetectedAsNewAt: '2026-10-05T00:00:00+09:00' })), '2026-10-05');
  assert.equal(overlayWindowDay(retail({ listedAt: '' })), '');
});

test('only the last three months publish, and an undated record does not', () => {
  assert.equal(overlayReleaseState(retail(), TODAY), 'released');
  assert.equal(overlayReleaseState(retail({ listedAt: '2026-05-01T00:00:00+09:00' }), TODAY), null);
  assert.equal(overlayReleaseState(retail({ listedAt: '' }), TODAY), null);
});

test('a future listing date is not published as if it were already here', () => {
  assert.equal(overlayReleaseState(retail({ listedAt: '2026-12-01T00:00:00+09:00' }), TODAY), null);
});

test('an article whose stated release is still ahead shows as upcoming', () => {
  const upcoming = article({ releaseStatus: 'upcoming', releaseDate: '2026-12-24' });
  assert.equal(overlayReleaseState(upcoming, TODAY), 'upcoming');
});

test('overlay records never reach the official-evidence tabs', () => {
  assert.equal(sourceMatches(retail(), 'brand', TODAY), false);
  assert.equal(sourceMatches(retail(), 'sns', TODAY), false);
  assert.equal(sourceMatches(retail(), 'all', TODAY), true);
  assert.equal(sourceMatches(retail(), 'retail', TODAY), true);
  assert.equal(sourceMatches(retail(), 'newsletter', TODAY), false);
  assert.equal(sourceMatches(article(), 'newsletter', TODAY), true);
});

test('official records never reach the retail or newsletter tabs', () => {
  assert.equal(sourceMatches(official(), 'retail', TODAY), false);
  assert.equal(sourceMatches(official(), 'newsletter', TODAY), false);
});

test('an item matched by this week\'s trend keywords is shown on the SNS tab', () => {
  assert.equal(sourceMatches(retail({ snsTrending: true }), 'sns', TODAY), true);
  assert.equal(sourceMatches(official({ snsTrending: true }), 'sns', TODAY), true);
});

test('the retailer sub-filter narrows the retail tab to one source', () => {
  const items = [retail({ id: 'a', source: 'retail-29cm' }), retail({ id: 'b', source: 'retail-ssense' })];
  assert.deepEqual(filterProducts(items, state({ source: 'retail' }), TODAY).map(p => p.id), ['a', 'b']);
  assert.deepEqual(filterProducts(items, state({ source: 'retail', retailer: 'retail-ssense' }), TODAY).map(p => p.id), ['b']);
});

test('retail is ordered newest first by the date each source stated', () => {
  const items = [
    retail({ id: 'old', listedAt: '2026-08-01T00:00:00+09:00' }),
    retail({ id: 'new', listedAt: '2026-10-20T00:00:00+09:00' }),
    retail({ id: 'mid', listedAt: '2026-09-10T00:00:00+09:00' }),
  ];
  assert.deepEqual(filterProducts(items, state({ source: 'retail' }), TODAY).map(p => p.id), ['new', 'mid', 'old']);
});

test('the same model from two retailers is one card, kept as two colour chips', () => {
  const a = retail({ id: 'a', source: 'retail-29cm', colorway: 'Black' });
  const b = retail({ id: 'b', source: 'retail-ssense', colorway: 'White' });
  assert.equal(variantGroupKey(a), variantGroupKey(b));
  assert.deepEqual(uniqueColorVariants([a, b], 'a').map(p => p.id), ['a', 'b']);
});

test('a retailer hex becomes the chip fill, and an unknown colour never does', () => {
  assert.equal(colorSwatch(retail({ colorSwatches: ['#4C3A31'] })), '#4C3A31');
  assert.match(colorSwatch(retail({ colorway: 'Zzyzx Gloaming' })), /repeating-linear-gradient/);
});

test('trend terms fold both sides and ignore terms too short to mean anything', () => {
  assert.equal(foldTerm('#Ballet Sneakers!'), 'balletsneakers');
  // NFKD would decompose Hangul into Jamo and strip it all away, so every
  // Korean keyword would silently match nothing.
  assert.equal(foldTerm('스피드캣 고'), '스피드캣고');
  assert.equal(foldTerm('Courrèges'), 'courreges');
  assert.deepEqual(trendTerms({ hashtag: '스피드캣', relatedKeywords: ['on', '스피드캣 고'] }), ['스피드캣', '스피드캣고']);
});

test('a trend keyword matches the items it actually names', () => {
  const terms = trendTerms({ hashtag: '스피드캣', relatedKeywords: [] });
  assert.equal(trendKeywordMatches(retail({ name: '푸마 스피드캣 OG' }), terms), true);
  assert.equal(trendKeywordMatches(retail({ name: 'Cortez' }), terms), false);
  assert.equal(trendKeywordMatches(retail({ name: 'Cortez' }), []), true);
});
