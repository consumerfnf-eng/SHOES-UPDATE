import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {collectUggNew} from './collect-ugg-new.mjs';
import {curateCatalog, officialEvidenceFor, kstDay} from './curation.mjs';
import {productPresentation} from './product-presentation.mjs';
import {reviewAdminProducts} from './admin-publication-review.mjs';
import {reviewScopedNew} from './review-scoped-new.mjs';
import {officialProductUrl, officialImageUrl, sourceMatches} from '../public/assets/catalog-view.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshot = file => ({file, bytes: fs.readFileSync(file)});

/** Local replay only. Missing/invalid listing receipts or failed publication
 * gates leave the previous report intact. Rejected optional PDPs remain held
 * with their original receipts and errors in the report. Nothing is fetched.
 * CLI: node scripts/prepare-ugg-detail-replay.mjs [report-directory]
 */
export async function prepareUggDetailReplay({
  reportDir = path.join(repo, 'reports/admin-recheck-followup-20261105'),
  detailDir = path.join(reportDir, 'ugg-detail-dom'),
  output = path.join(reportDir, 'manual-ugg-products.json'),
  now = new Date(),
} = {}) {
  output = path.resolve(output);
  const previous = fs.existsSync(output) ? snapshot(output) : null;
  const listingFiles = ['manual-ugg-browser-dom.json', 'manual-ugg-next-browser-dom.json'].map(name => path.join(reportDir, name));
  const detailFiles = fs.existsSync(detailDir)
    ? fs.readdirSync(detailDir).filter(name => /^\d+\.json$/.test(name)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5))).map(name => path.join(detailDir, name))
    : [];
  const inputs = [...listingFiles, ...detailFiles].map(snapshot);
  const records = inputs.map(({bytes}) => JSON.parse(bytes.toString('utf8')));
  const captures = records.slice(0, listingFiles.length);
  const detailCaptures = records.slice(listingFiles.length);
  const result = await collectUggNew({captures, detailCaptures, now, read: async () => {throw Error('UGG replay cannot fetch');}});
  assert.deepEqual(result.errors, [], 'UGG listing replay failed; previous report retained');
  assert.equal(result.traversalComplete, true, 'UGG listing traversal did not reconcile');
  assert.equal(result.products.length + result.excluded.length + result.held.length, result.coverage.total);
  assert.equal(result.complete, result.held.length === 0);
  assert.equal(result.coverage.exhaustive, result.complete);
  assert.deepEqual(result.sourceRecords.map(({record}) => record), captures);
  for (const {url, record} of result.detailSourceRecords) {
    assert.deepEqual(record, detailCaptures.find(capture => capture.url === url));
  }
  const admin = reviewAdminProducts(result.products, {});
  assert.deepEqual(admin.held, [], 'UGG admin publication gate rejected replay products');
  const scoped = reviewScopedNew(admin.products);
  assert.deepEqual(scoped.held, [], 'UGG New scope gate rejected replay products');
  const curated = curateCatalog(scoped.products, {now}).snapshot.products;
  assert.equal(curated.length, result.products.length, 'UGG curation lost replay products');
  const presented = curated.map(product => productPresentation(product, {products: []}));
  assert.ok(presented.every(product => product && officialEvidenceFor(product, kstDay(now))
    && officialProductUrl(product, kstDay(now)) && officialImageUrl(product, kstDay(now))
    && sourceMatches(product, 'brand', kstDay(now))), 'UGG presentation/public proof gate rejected replay products');
  for (const product of result.products) {
    const page = result.pages.find(page => page.url === product.arrivalEvidence.url);
    assert.ok(page, 'UGG product lost original New membership');
    assert.equal(product.arrivalEvidence.contentHash, page.contentHash);
    assert.equal(product.arrivalEvidence.verifiedAt, page.checkedAt);
    assert.equal(product.firstSeen, page.checkedAt);
  }
  const report = {
    schemaVersion: 1,
    adapter: 'official-ugg-new-selected-rendered-dom',
    ...result,
    sourceFiles: inputs.map(({file}) => path.relative(repo, file).split(path.sep).join('/')),
    validation: {
      source: 'captured Chrome rendered main DOM, observed Load More and optional own PDP Details DOM',
      proofHashScope: 'exact original sanitized receipt html; no HTTP status claim added',
      allClassified: result.coverage.classified,
      curated: curated.length,
      presentationReady: presented.length,
      publicOfficialTab: presented.length,
      receiptMetadataPreserved: true,
      collectionDates: 'original listing and PDP checkedAt retained separately',
      adapterSha256: sha(fs.readFileSync(new URL('./collect-ugg-new.mjs', import.meta.url))),
      traversalComplete: result.traversalComplete,
      fullBrandComplete: result.complete,
      detailReceipts: detailCaptures.length,
      detailMatched: result.detailSourceRecords.length,
      detailRejected: result.detailErrors.length,
    },
  };
  const serialized = JSON.stringify(report, null, 2) + '\n';
  assert.equal(JSON.stringify(JSON.parse(serialized), null, 2) + '\n', serialized);
  // Capture files may still be arriving. Check only the exact batch read above;
  // new filenames are picked up by the next invocation.
  const assertUnchanged = () => {
    for (const {file, bytes} of inputs) assert.ok(fs.readFileSync(file).equals(bytes), `UGG capture changed during replay: ${file}`);
    if (previous) assert.ok(fs.readFileSync(output).equals(previous.bytes), 'UGG report changed concurrently');
    else assert.equal(fs.existsSync(output), false, 'UGG report appeared concurrently');
  };
  assertUnchanged();
  const temporary = output + `.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, serialized, {flag: 'wx'});
    assert.equal(fs.readFileSync(temporary, 'utf8'), serialized);
    assertUnchanged();
    fs.renameSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return {output, products: result.products.length, excluded: result.excluded.length, held: result.held.length,
    details: detailCaptures.length, detailRejected: result.detailErrors.length,
    traversalComplete: result.traversalComplete, complete: result.complete,
    detailErrors: result.detailErrors};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--help')) console.log('Usage: node scripts/prepare-ugg-detail-replay.mjs [report-directory]');
    else {
      if (process.argv.length > 3) throw Error('Expected at most one report-directory argument');
      console.log(JSON.stringify(await prepareUggDetailReplay(process.argv[2] ? {reportDir: path.resolve(process.argv[2])} : {}), null, 2));
    }
  } catch (error) {
    console.error(`UGG replay not saved: ${error.message}`);
    process.exitCode = 1;
  }
}
