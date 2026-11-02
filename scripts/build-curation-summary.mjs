// Say on the site why a brand shows nothing.
//
// More records are held in curation than are published - 3,044 against 2,733
// when this was written - and the page gave no sign of it. A brand that has
// released nothing and a brand whose every record is stuck behind a missing
// piece of evidence both read as a bare "0", so nobody can tell a quiet season
// from a stalled pipeline. This writes the counts the page needs to tell them
// apart.
//
// Internal only. The summary names which brands this collection cannot verify,
// which is our own QA state and not something to publish on a site anyone can
// open - so it is gitignored and reaches the internal deployment the same way
// the catwalk renditions do: by direct upload, never through the repository.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REVIEW = path.join(ROOT, 'data', 'curation-review.json');
const CATALOG = path.join(ROOT, 'public', 'data', 'catalog.json');
const OUT = path.join(ROOT, 'public', 'data', 'curation-summary.json');

// What a hold actually means, in the words a merchandiser would use. A reason
// with no entry here is still counted and shown under its own code rather than
// being dropped, so a new gate never disappears from the board.
export const REASON_LABELS = {
  'product-verification-required': '공식 상품페이지 확인 필요',
  'kids-sizing': '아동 사이즈',
  'release-day-evidence-required': '공식 발매일 근거 필요',
  'hybrid-review-required': '혼합형 품목 검토 필요',
  'not-footwear': '신발 아님',
  'brand-excluded-or-unverified': '브랜드 제외·미검증',
  'product-url-or-image-required': '상품 URL·이미지 필요',
  'footwear-type-unverified': '품목 분류 미확정',
  'representative-photo-review': '대표 사진 검토',
  'official-product-id-evidence-required': '공식 상품코드 근거 필요',
};

export function summarise(held, publishedProducts, {now = new Date().toISOString()} = {}) {
  const items = Array.isArray(held) ? held : (held?.held ?? held?.items ?? held?.records ?? []);
  const byReason = new Map(), byBrand = new Map();
  for (const item of items) {
    const reason = String(item?.reason ?? 'unknown');
    const brand = String(item?.brand ?? '').trim();
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    if (!brand) continue;
    const entry = byBrand.get(brand) ?? {brand, held: 0, reasons: new Map()};
    entry.held++;
    entry.reasons.set(reason, (entry.reasons.get(reason) ?? 0) + 1);
    byBrand.set(brand, entry);
  }
  const published = new Map();
  for (const product of publishedProducts ?? []) {
    const brand = String(product?.brand ?? '').trim();
    if (brand) published.set(brand, (published.get(brand) ?? 0) + 1);
  }
  const reasons = [...byReason].map(([reason, count]) => ({reason, label: REASON_LABELS[reason] ?? reason, count}))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const brands = [...byBrand.values()].map(entry => {
    const [reason, count] = [...entry.reasons].sort((a, b) => b[1] - a[1])[0];
    return {brand: entry.brand, held: entry.held, published: published.get(entry.brand) ?? 0,
            topReason: reason, topReasonLabel: REASON_LABELS[reason] ?? reason, topReasonCount: count};
  }).sort((a, b) => b.held - a.held || a.brand.localeCompare(b.brand));
  return {
    schemaVersion: 1, builtAt: now,
    totals: {held: items.length, published: publishedProducts?.length ?? 0,
             brandsHolding: brands.length, brandsHoldingEverything: brands.filter(b => !b.published).length},
    reasons, brands,
  };
}

async function main() {
  const held = await fs.readFile(REVIEW, 'utf8').then(JSON.parse).catch(() => null);
  if (!held) { console.error(`No curation queue at ${path.relative(ROOT, REVIEW)} - nothing to summarise.`); return 2; }
  const catalog = await fs.readFile(CATALOG, 'utf8').then(JSON.parse).catch(() => ({products: []}));
  const summary = summarise(held, catalog.products ?? []);
  await fs.writeFile(OUT, JSON.stringify(summary) + '\n', 'utf8');
  const {totals} = summary;
  console.log(`held ${totals.held.toLocaleString()} · published ${totals.published.toLocaleString()} `
    + `· ${totals.brandsHolding} brands holding, ${totals.brandsHoldingEverything} of them publishing nothing`);
  for (const reason of summary.reasons.slice(0, 6)) console.log(`  ${String(reason.count).padStart(5)}  ${reason.label}`);
  console.log(`-> ${path.relative(ROOT, OUT)}`);
  return 0;
}

if (process.argv[1]?.endsWith('build-curation-summary.mjs')) process.exit(await main());
