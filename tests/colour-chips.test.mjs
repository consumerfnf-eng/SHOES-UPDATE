import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalColorKey, colorHex, colorSwatch, groupProductVariants,
  uniqueColorVariants, variantColorLabel, variantGroupKey, variantGroupName,
} from '../public/assets/catalog-view.mjs';

const NOTICE_29CM = '(입고 시기에 따라 정보가 상이할 수 있어, 수령하신 상품의 라벨을 참고하시기 바랍니다.)';
const NOTICE_MUSINSA = '(선택되지 않는 색상은 판매하지 않거나 품절인 상품입니다)';
const listing = (id, colorway, over = {}) => ({
  id, colorway, overlay: true, source: 'retail-musinsa',
  brand: 'BEARPAW', name: 'OLLA 양털슬립온', ...over,
});

test('one shade written in two languages draws one chip, not two', () => {
  // Musinsa lists OLLA's slip-on as 히커리 II and 29CM lists the identical
  // shoe as HICKORY II. Four colourways across two retailers, eight listings.
  const group = [
    listing('a', '히커리 II'), listing('b', 'HICKORY II', {source: 'retail-29cm'}),
    listing('c', '초콜릿'), listing('d', 'CHOCOLATE', {source: 'retail-29cm'}),
    listing('e', '블랙 II'), listing('f', 'BLACK II', {source: 'retail-29cm'}),
    listing('g', '실브라운'), listing('h', 'SEAL BROWN', {source: 'retail-29cm'}),
  ];
  assert.equal(uniqueColorVariants(group, 'a').length, 4);
});

test('two genuinely different colourways keep their own chips', () => {
  const group = [listing('a', '블랙'), listing('b', '아이보리'), listing('c', '네이비')];
  assert.equal(uniqueColorVariants(group, 'a').length, 3);
});

test('a colourway is not reordered into a different one', () => {
  // "black/white" names a black upper on a white sole; the reverse is a
  // different shoe, and folding them together would hide one.
  assert.notEqual(canonicalColorKey('BLACK/WHITE'), canonicalColorKey('WHITE/BLACK'));
});

test('a colour spelled as one word matches the same colour spelled as two', () => {
  assert.equal(canonicalColorKey('실브라운'), canonicalColorKey('Seal Brown'));
  assert.equal(canonicalColorKey('#블랙'), canonicalColorKey('BLACK'));
  assert.equal(canonicalColorKey('오프화이트'), canonicalColorKey('Off-White'));
});

test("a seller's standing notice never reaches a chip label", () => {
  assert.equal(variantColorLabel({colorway: `아이보리 ${NOTICE_MUSINSA}`}), '아이보리');
  assert.equal(variantColorLabel({colorway: `BGD0,BLK0,WHGY ${NOTICE_29CM}`}), '');
  assert.equal(variantColorLabel({colorway: '맨발신발 [남성용]'}), '');
  assert.equal(variantColorLabel({colorway: '설명페이지 참조'}), '');
});

test('a list of real colour names is not mistaken for product codes', () => {
  assert.equal(variantColorLabel({colorway: 'BLACK, WHITE'}), 'BLACK, WHITE');
  assert.equal(variantColorLabel({colorway: '화이트:서밋 화이트'}), '화이트:서밋 화이트');
});

test('the pipeline\'s model grouping decides the card, not a re-derived name', () => {
  // Nothing in these records says 실브라운 is a colour, so the card can only
  // be formed from the modelGroupId the collection step worked out.
  const members = [
    listing('a', '', {name: 'OLLA 양털슬립온 실브라운 (K3708240SD-W)', modelGroupId: 'bearpaw|olla양털슬립온'}),
    listing('b', '', {name: 'OLLA 양털슬립온 초콜릿 (K3708205SD-W)', modelGroupId: 'bearpaw|olla양털슬립온'}),
  ];
  assert.equal(variantGroupKey(members[0]), variantGroupKey(members[1]));
  assert.equal(groupProductVariants(members).length, 1);
});

test('an article is still one card per article, never grouped by model', () => {
  const article = (id) => ({
    id, overlay: true, source: 'newsletter-footwearnews', brand: 'Nike',
    name: 'Michael Jordan', modelGroupId: 'nike|michaeljordan',
  });
  assert.equal(groupProductVariants([article('n1'), article('n2')]).length, 2);
});

test('a card with no stated colour takes the colour read off its photo', () => {
  assert.equal(colorSwatch({colorway: '', bodyColor: '#e3e3e5'}), '#e3e3e5');
  // A reviewer's own hex still outranks the photo.
  assert.equal(colorSwatch({colorSwatches: ['#123456'], bodyColor: '#e3e3e5'}), '#123456');
  // Nothing known at all is a neutral pattern, never a guessed colour.
  assert.match(colorSwatch({colorway: '', bodyColor: ''}), /repeating-linear-gradient/);
});

test('colour names resolve across both languages to one hex', () => {
  assert.equal(colorHex('블랙'), colorHex('BLACK'));
  assert.equal(colorHex('아이보리'), colorHex('ivory'));
  assert.equal(colorHex('Pelotissima'), '');
});

test('a listing whose whole name is its brand is never merged with another', () => {
  // 29CM returns twelve different NEPA shoes all named "네파". Keyed on the
  // name alone they became one card holding twelve unrelated products.
  const nepa = (id) => ({
    id, overlay: true, source: 'retail-29cm', brand: 'NEPA', brandKo: '네파', name: '네파',
  });
  const listings = Array.from({length: 12}, (_, i) => nepa(`p${i}`));
  assert.equal(groupProductVariants(listings).length, 12);
  // A listing that does name a model still groups as before.
  const named = (id) => ({...nepa(id), name: '네파 에어 러너'});
  assert.equal(groupProductVariants([named('a'), named('b')]).length, 1);
});

test("a retailer's own code is stripped off the colour name", () => {
  assert.equal(variantColorLabel({colorway: 'CHARCOAL(B02),DARK KHAKI(B65),DARK BEIGE(D18)'}),
    'CHARCOAL, DARK KHAKI, DARK BEIGE');
  assert.equal(variantColorLabel({colorway: '(19)BLACK'}), 'BLACK');
  // Which is the point: the same colour written plainly now matches it.
  assert.equal(canonicalColorKey(variantColorLabel({colorway: 'BLACK(C01)'})),
    canonicalColorKey(variantColorLabel({colorway: '블랙'})));
  assert.equal(uniqueColorVariants(
    [listing('a', 'BLACK(C01)'), listing('b', '블랙')], 'a').length, 1);
});

test('lifting the colour off a name does not leave its separator behind', () => {
  assert.equal(variantGroupName({
    brand: 'KSNSLIFE', name: '어반트렉 메시 Ver. 3, 버건디', colorway: '버건디',
  }), '어반트렉 메시 Ver. 3');
});

test('a colour abbreviation gets a label and a real chip colour', () => {
  // "에버라스트 다이나믹 트레킹화 BLK / BRN / IVY" is one shoe in three colours.
  assert.equal(variantColorLabel({colorway: 'BLK'}), 'BLK');
  assert.equal(colorHex('BLK'), colorHex('black'));
  assert.equal(colorHex('IVY'), colorHex('ivory'));
  assert.equal(uniqueColorVariants([listing('a', 'BLK'), listing('b', '블랙')], 'a').length, 1);
});

test('a technology suffix of the same shape is not a colour', () => {
  for (const token of ['GTX', 'OG', 'DMX', 'LS']) assert.equal(colorHex(token), '', token);
});

test("a retailer's internal code list is still not a colour", () => {
  // Reading "BLK0" as black would let the whole code list through.
  assert.equal(colorHex('BLK0'), '');
  assert.equal(variantColorLabel({colorway: 'BGD0,BLK0,WHGY'}), '');
});

test('a style code in brackets is not part of the card name', () => {
  assert.equal(variantGroupName({
    brand: 'fitflop', name: '여성 네오D 하이커 패디드 메탈릭 트레이너  실버 (FT69K2N512)', colorway: '실버',
  }), '네오D 하이커 패디드 메탈릭 트레이너');
});
