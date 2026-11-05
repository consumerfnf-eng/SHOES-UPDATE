import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {observedPhotoCandidates, bindPhotoRepair} from '../scripts/collect-photo-repairs.mjs';
const today = '2026-11-05', at = '2026-11-03T06:00:00Z';
function fixture() {
  const url = 'https://korea.coach.com/products/soho-sneaker/CEE46.html?frp=CEE46+CHK', image = 'https://coach.scene7.com/is/image/Coach/cee46_chk_a0?$desktopThumbnail$';
  const large = 'https://coach.scene7.com/is/image/Coach/cee46_chk_a0?$desktopProduct$';
  const proof = {verified: true, brand: 'Coach', style: 'CEE46', verifiedAt: at, contentHash: 'a'.repeat(64), verificationMethod: 'official-new-arrivals-and-product-page'};
  return {id: 'coach-cee46', brand: 'Coach', style: 'CEE46', name: 'Soho Sneaker', url, image,
    productEvidenceUrl: url, productVerifiedAt: at, category: 'sneaker', imageCandidates: [{url: image}, {url: large}],
    officialProductEvidence: {...proof, url}, officialImageEvidence: {...proof, url: image, sourceUrl: url},
    presentation: {image, cachedPath: '/images/old.webp', thumbnail: {path: '/images/old.webp'}}};
}
test('only actually recorded same-asset larger URLs qualify, never generated renditions or another color', () => {
  const p = fixture();
  const c = observedPhotoCandidates(p, p, p.image, today);
  assert.equal(c[0].url, p.imageCandidates[1].url);
  const q = fixture(); q.imageCandidates = [{url: 'https://coach.scene7.com/is/image/Coach/cee46_blk_a0?$desktopProduct$'}];
  assert.equal(observedPhotoCandidates(q, q, q.image, today).length, 1);
});
test('repair fully rebinds image and presentation while preserving old source verification timestamps/hash', () => {
  const p = fixture(), candidate = observedPhotoCandidates(p, p, p.image, today)[0], bytes = Buffer.from('image bytes supplied by independently validated image reader');
  const recovery = {candidate, asset: {url: candidate.url, referer: p.url, width: 760, height: 527, fetchedAt: '2026-11-05T06:00:00Z',
    sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64')}};
  const r = bindPhotoRepair(p, p, recovery, today);
  assert.equal(r.officialImageEvidence.url, candidate.url); assert.equal(r.presentation.image, candidate.url);
  assert.equal(r.officialImageEvidence.verifiedAt, at); assert.equal(r.productVerifiedAt, at);
  assert.equal(r.presentation.checkedAt, at); assert.equal(r.officialImageEvidence.contentHash, p.officialImageEvidence.contentHash);
  assert.equal(r.presentation.cachedPath, undefined); assert.equal(r.presentation.thumbnail, undefined);
  assert.equal(p.image, fixture().image);
});
test('unobserved URL, tampered bytes and nonofficial Referer reject a recovery', () => {
  const p = fixture(), candidate = observedPhotoCandidates(p, p, p.image, today)[0];
  const base = {candidate, asset: {url: candidate.url, referer: p.url, width: 760, height: 527, base64: 'aGVsbG8=', sha256: 'a'.repeat(64)}};
  assert.throws(() => bindPhotoRepair(p, p, base, today), /Unbound/);
  assert.throws(() => bindPhotoRepair(p, p, {...base, asset: {...base.asset, url: 'https://evil.example/image.jpg'}}, today), /Unbound/);
});
