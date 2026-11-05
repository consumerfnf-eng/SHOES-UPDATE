import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {officialEvidenceFor, isOfficialProductUrl, kstDay, curateCatalog} from './curation.mjs';
import {reviewScopedNew} from './review-scoped-new.mjs';
import {reviewAdminProducts} from './admin-publication-review.mjs';
import {officialImageUrl} from '../public/assets/catalog-view.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');

// Comparison only. NEVER use this normalized family to construct a URL.
function assetFamily(value) {
  const u = new URL(value);
  return u.origin + u.pathname.replace(/_(?:small|medium|large|grande|\d+x)(?=\.)/i, '')
    .replace(/_(?:\d{1,2}|[A-Z])(?=\.(?:jpg|jpeg|webp|png)$)/i, '');
}

export function observedPhotoCandidates(raw, prepared, failedUrl, today) {
  if (!raw || raw.id !== prepared.id || raw.brand !== prepared.brand || raw.style !== prepared.style || raw.url !== prepared.url ||
      raw.image !== failedUrl || !officialEvidenceFor(raw, today) || !isOfficialProductUrl(raw.brand, raw.url)) return [];
  const e = raw.officialImageEvidence, product = raw.officialProductEvidence;
  const pdp = e.sourceUrl === raw.url && raw.productEvidenceUrl === raw.url;
  const listing = e.verificationMethod === 'official-new-listing-sku-image' && e.sourceUrl === raw.arrivalEvidence?.url &&
    e.contentHash === raw.arrivalEvidence?.contentHash && product.contentHash === e.contentHash;
  if (!pdp && !listing) return [];
  const result = [{url: failedUrl, kind: 'unchanged-original', sourceUrl: e.sourceUrl, contentHash: e.contentHash, verifiedAt: e.verifiedAt}];
  for (const [index, candidate] of (raw.imageCandidates ?? []).entries()) {
    const url = typeof candidate === 'string' ? candidate : candidate.url;
    if (!url || result.some(c => c.url === url) || /outsole|bottom|top view|campaign|lookbook|_MDL\b/i.test(url + ' ' + (candidate.alt ?? ''))) continue;
    let same = false;
    try {
      const old = new URL(failedUrl), next = new URL(url);
      same = next.protocol === 'https:' && !next.username && !next.password && !next.hash && old.origin === next.origin &&
        (old.pathname === next.pathname || assetFamily(old.href) === assetFamily(next.href));
    } catch {}
    if (!same) continue;
    result.push({url, kind: 'observed-original-source-candidate', field: `imageCandidates[${index}]`,
      sourceUrl: e.sourceUrl, contentHash: e.contentHash, verifiedAt: e.verifiedAt, sourceRecordHash: sha(JSON.stringify(raw))});
  }
  // Prefer an observed larger rendition of exactly the same asset. No URL rewriting.
  return result.sort((a, b) => Number(/desktopProduct/.test(b.url)) - Number(/desktopProduct/.test(a.url))).slice(0, 3);
}

export function bindPhotoRepair(raw, prepared, recovery, today) {
  if (!recovery.asset) return null;
  const candidates = observedPhotoCandidates(raw, prepared, raw.image, today);
  const candidate = candidates.find(c => c.url === recovery.asset.url && c.url === recovery.candidate.url);
  if (!candidate || recovery.asset.referer !== raw.url || recovery.asset.width < 180 || recovery.asset.height < 180 ||
      sha(Buffer.from(recovery.asset.base64, 'base64')) !== recovery.asset.sha256) throw Error('Unbound photo recovery asset');
  const p = structuredClone(raw), image = candidate.url;
  p.image = image; p.sourceImageUrl = image;
  // Same original source, style, color-family and original source timestamp/hash.
  // The newly retrieved image bytes get their OWN fetchedAt, never a fake PDP read.
  p.officialImageEvidence = {...p.officialImageEvidence, url: image};
  if (p.sourceTileBinding?.image !== image) delete p.sourceTileBinding;
  p.presentation = {...prepared.presentation, image, sourceUrl: candidate.sourceUrl,
    checkedAt: candidate.verifiedAt, method: 'observed-official-source-photo-repair'};
  delete p.presentation.cachedPath; delete p.presentation.thumbnail;
  p.photoRepairEvidence = {kind: candidate.kind, originalImage: raw.image, image, sourceUrl: candidate.sourceUrl,
    originalVerifiedAt: candidate.verifiedAt, sourceContentHash: candidate.contentHash,
    ...(candidate.field ? {observedField: candidate.field, sourceRecordHash: candidate.sourceRecordHash} : {}),
    fetchedAt: recovery.asset.fetchedAt, referer: recovery.asset.referer, sha256: recovery.asset.sha256,
    width: recovery.asset.width, height: recovery.asset.height};
  if (!officialEvidenceFor(p, today) || reviewScopedNew([p]).products.length !== 1) throw Error('Rebound product failed official/scope gate');
  return p;
}

async function fetchImages(jobs) {
  const helper = fileURLToPath(new URL('./photo-repair-fetch.py', import.meta.url));
  return await new Promise((resolve, reject) => {
    const child = spawn('python', [helper], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => {stdout += chunk;}); child.stderr.on('data', chunk => {stderr += chunk;});
    child.on('error', reject); child.on('close', code => {
      if (code) reject(Error(stderr || `Image helper failed ${code}`));
      else {try {resolve(JSON.parse(stdout));} catch (error) {reject(error);}}
    });
    child.stdin.end(JSON.stringify(jobs));
  });
}

/** Suggestions only: a prior official URL with an identical asset filename is
 * not proof that today's blocked URL returned the same bytes. Verify existing
 * file SHA and preserve old cache observation time; never auto-publish these.
 */
export async function findCachedPhotoSuggestions(directory, products, unresolved) {
  const cache = JSON.parse(await fs.readFile(path.join(directory, 'data/photo-cache.json'), 'utf8'));
  const suggestions = [];
  for (const failure of unresolved) {
    const p = products.find(p => p.id === failure.id);
    if (!p) continue;
    const image = new URL(p.image), filename = image.pathname.split('/').at(-1);
    for (const [url, entry] of Object.entries(cache.images ?? {})) {
      let previous;
      try {previous = new URL(url);} catch {continue;}
      if (previous.origin !== image.origin || previous.pathname.split('/').at(-1) !== filename || !entry.path) continue;
      const absolute = path.resolve(directory, 'public', entry.path.replace(/^\//, ''));
      if (!absolute.startsWith(path.resolve(directory, 'public') + path.sep)) continue;
      try {
        const bytes = await fs.readFile(absolute), digest = sha(bytes);
        if (path.basename(entry.path).split('.')[0] !== digest || entry.sha256 && entry.sha256 !== digest) continue;
        suggestions.push({id: p.id, brand: p.brand, style: p.style, currentImage: p.image, previousObservedImage: url,
          cachedPath: entry.path, sha256: digest, bytes: bytes.length, previousObservedAt: entry.checkedAt,
          basis: 'prior-official-cache-entry-exact-asset-filename-and-validated-file-sha',
          currentBytesCompared: false, requiresSourceProofRebinding: true, publicationReady: false});
      } catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
  }
  return suggestions;
}

/** Reads snapshots and cache index only. Never writes cache, canonical or prepared
 * snapshots. Output assets contain exact downloaded bytes for caller-owned cache
 * integration; existingPath is set only when the existing file SHA matches bytes.
 */
export async function collectPhotoRepairs({directory = process.cwd(), now = new Date(), fetchAssets = fetchImages} = {}) {
  const read = async file => JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
  const [prepared, raw, cached, sources] = await Promise.all([
    read('reports/admin-rechecked-prepared.json'), read('reports/admin-rechecked-raw.json'),
    read('reports/admin-rechecked-cached.json'), read('config/daily_sources.json'),
  ]);
  const today = kstDay(now), records = new Map(), jobs = [], skipped = [];
  for (const error of cached.photoErrors ?? []) {
    const p = prepared.products.find(p => p.presentation?.image === error.url && p.image === error.url);
    const original = p && raw.products.find(r => r.id === p.id);
    if (!p || !original) {skipped.push({...error, reason: 'matching-official-raw-record-missing'}); continue;}
    const candidates = observedPhotoCandidates(original, p, error.url, today);
    if (!candidates.length) {skipped.push({...error, id: p.id, brand: p.brand, reason: 'original-source-binding-unproven'}); continue;}
    records.set(p.id, {raw: original, prepared: p});
    jobs.push({id: p.id, brand: p.brand, referer: original.url, candidates});
  }
  jobs.sort((a, b) => Number(['Coach', 'Jacquemus'].includes(b.brand)) - Number(['Coach', 'Jacquemus'].includes(a.brand)));
  const results = await fetchAssets(jobs), products = [], assets = {}, unresolved = [...skipped];
  for (const recovery of results) {
    const record = records.get(recovery.id);
    if (!recovery.asset) {unresolved.push({id: recovery.id, brand: record?.raw.brand, attempts: recovery.attempts}); continue;}
    try {
      const p = bindPhotoRepair(record.raw, record.prepared, recovery, today);
      const curated = curateCatalog([p], {now});
      if (reviewAdminProducts([p], sources).products.length !== 1 || curated.snapshot.products.length !== 1 ||
          officialImageUrl(curated.snapshot.products[0], today) !== p.image) throw Error('Rebound product failed publication/client gate');
      const asset = recovery.asset, relative = `/images/${asset.sha256}.${asset.extension}`;
      // Exact existing photo suggestions only: validate both containment and SHA.
      const absolute = path.resolve(directory, 'public', relative.slice(1));
      const publicRoot = path.resolve(directory, 'public') + path.sep;
      if (!absolute.startsWith(publicRoot)) throw Error('Invalid cache suggestion path');
      try {if (sha(await fs.readFile(absolute)) === asset.sha256) asset.existingPath = relative;} catch (error) {if (error.code !== 'ENOENT') throw error;}
      assets[asset.url] = asset; products.push(p);
    } catch (error) {unresolved.push({id: recovery.id, brand: record?.raw.brand, reason: error.message, attempts: recovery.attempts});}
  }
  const exactPhotoSuggestions = await findCachedPhotoSuggestions(directory, raw.products, unresolved);
  return {products, assets, unresolved, exactPhotoSuggestions, checkedAt: now.toISOString(), attempted: jobs.length,
    gateChecks: {officialAccepted: products.filter(p => officialEvidenceFor(p, today)).length,
      adminAccepted: reviewAdminProducts(products, sources).products.length,
      scopedPhotoAccepted: reviewScopedNew(products).products.length,
      curatedAccepted: curateCatalog(products, {now}).snapshot.products.length},
    coverage: [{adapter: 'verified-observed-photo-repair', errors: cached.photoErrors?.length ?? 0, recovered: products.length,
      unresolved: unresolved.length, complete: unresolved.length === 0}]};
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = path.resolve('reports/admin-recheck-followup-20261105/manual-photo-repairs-products.json');
  const result = await collectPhotoRepairs();
  await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({output, attempted: result.attempted, repaired: result.products.length,
    brands: result.products.reduce((a, p) => (a[p.brand] = (a[p.brand] ?? 0) + 1, a), {}),
    unresolved: result.unresolved.length, gateChecks: result.gateChecks}));
}
