import test from 'node:test';
import assert from 'node:assert/strict';
import {composeSnapshot, fragmentFromV1} from '../scripts/build-catwalk-snapshot.mjs';

const look = (id, brand, city) => ({id: String(id), brand, city, image: `/catwalk/${id}.jpg`,
  width: 933, height: 1400, imageType: '신발 클로즈업', shelf: 'library-footwear'});
const fragment = (season, seasonId, ids, collectedAt = '2026-10-30T00:00:00Z') =>
  ({season, seasonId, collectedAt, looks: ids.map(id => look(id, `Brand ${id}`, 'Paris'))});

test('the snapshot holds three seasons, newest first, and names the files the fourth leaves behind', () => {
  const {snapshot, keep, drop, referenced} = composeSnapshot([
    fragment('Spring/Summer 2027', '2913181', [1, 2]),
    fragment('Autumn/Winter 2026', '2913000', [3]),
    fragment('Spring/Summer 2028', '2913999', [4, 5]),
    fragment('Autumn/Winter 2027', '2913500', [6]),
  ], {builtAt: '2026-11-02T00:00:00Z'});

  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.currentSeason, 'Spring/Summer 2028');
  assert.deepEqual(keep, ['Spring/Summer 2028', 'Autumn/Winter 2027', 'Spring/Summer 2027']);
  assert.deepEqual(drop, ['Autumn/Winter 2026']);
  assert.deepEqual(snapshot.seasons.map(s => s.season), keep, 'the tabs are in calendar order');
  assert.deepEqual(snapshot.seasons.map(s => s.looks), [2, 1, 2]);
  // Every look carries the season it walked in, so the tab can filter on it.
  assert.deepEqual([...new Set(snapshot.looks.map(l => l.season))], keep);
  assert.equal(snapshot.looks.length, 5);
  // The dropped season's photograph is not referenced, so the writer deletes it.
  assert.deepEqual([...referenced].sort(), ['1.jpg', '2.jpg', '4.jpg', '5.jpg', '6.jpg']);
  assert(!referenced.has('3.jpg'), 'the evicted season leaves no file behind');
});

test('re-collecting a season replaces it outright rather than merging two halves', () => {
  const {snapshot, referenced} = composeSnapshot([
    fragment('Spring/Summer 2027', '2913181', [1, 2, 3], '2026-10-30T00:00:00Z'),
    fragment('Spring/Summer 2027', '2913181', [7, 8], '2026-11-02T00:00:00Z'),
  ]);
  assert.equal(snapshot.seasons.length, 1);
  assert.deepEqual(snapshot.looks.map(l => l.id), ['7', '8'], 'the later collection wins');
  assert.deepEqual([...referenced].sort(), ['7.jpg', '8.jpg']);
});

test('an empty or malformed fragment cannot evict a real season', () => {
  const {snapshot, keep} = composeSnapshot([
    fragment('Spring/Summer 2027', '2913181', [1]),
    {season: 'Autumn/Winter 2027', seasonId: 'x', looks: []},
    {season: '', seasonId: 'y', looks: [look(9, 'Nobody', 'Paris')]},
    {seasonId: 'z', looks: null},
    null,
  ]);
  assert.deepEqual(keep, ['Spring/Summer 2027']);
  assert.equal(snapshot.looks.length, 1);
  assert.equal(snapshot.currentSeason, 'Spring/Summer 2027');
});

test('the season already published is adopted rather than collected again', () => {
  const v1 = {schemaVersion: 1, season: 'Spring/Summer 2027', seasonId: '2913181',
    builtAt: '2026-10-30T20:11:37+09:00', looks: [look(1, 'AARON ESH', 'London')]};
  const adopted = fragmentFromV1(v1);
  assert.equal(adopted.season, 'Spring/Summer 2027');
  assert.equal(adopted.seasonId, '2913181');
  assert.equal(adopted.collectedAt, v1.builtAt);
  assert.equal(adopted.looks.length, 1);
  // A snapshot that is already v2, empty, or seasonless is not a fragment.
  assert.equal(fragmentFromV1({...v1, schemaVersion: 2}), null);
  assert.equal(fragmentFromV1({...v1, looks: []}), null);
  assert.equal(fragmentFromV1({...v1, season: '', looks: [{...look(1, 'A', 'B'), season: undefined}]}), null);
  assert.equal(fragmentFromV1(null), null);
  // A v1 file whose season lives only on its looks is still adoptable.
  assert.equal(fragmentFromV1({...v1, season: '', looks: [{...look(1, 'A', 'B'), season: 'Resort 2027'}]}).season, 'Resort 2027');
});
