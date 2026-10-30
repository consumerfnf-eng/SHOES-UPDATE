// A dictionary of model -> kind of sneaker, built from filings that already
// exist in the catalogue.
//
// Most of the catalogue is a model name and nothing else. "Air Force 1",
// "젤-1130", "SL 72 프로" say nothing about what kind of shoe they are, so
// 3,096 of 4,275 records sit in 기타·미분류. The brands' own category listings
// would answer it, but newbalance.co.kr, adidas.co.kr and puma.com all refuse
// an ordinary request (000/403/301 when tried on 2026-10-30), so that door is
// shut without spending the rendering budget on it.
//
// What is already here: the same model usually appears more than once, and
// one of those appearances is often filed by its shop. Musinsa files 러닝화;
// the collector records mule/ballet/platform in footwearTypes. So when one
// record of a model is placed and the others are not, the others can take it.
//
// Two rules keep that honest:
//
//   1. The model grouping is the repository's own `variantGroupKey`, not a
//      prefix of the name. A first-three-words key collapsed all 258 ASH
//      records into one group - every Korean listing of theirs begins
//      "[공식] ASH(아쉬)" - and one 플랫폼 record would have labelled the lot.
//   2. The vote has to be unanimous. Where records of one model disagree the
//      model is left alone rather than decided by majority.
//
// It is written down rather than computed each time because the record that
// knows the answer ages out of the three-month window while the model stays.
// Once "젤-1130 is 러닝" has been seen, it does not need seeing again.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sneakerCategory, UNPLACED_CATEGORY} from '../public/assets/analysis.mjs';
import {variantGroupKey, variantGroupName} from '../public/assets/catalog-view.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (file, fallback) => {
  try { return JSON.parse(await fs.readFile(path.join(root, file), 'utf8')); }
  catch { return fallback; }
};

export const modelKey = p => `${p.brand}|${variantGroupKey(p)}`;

/** Models whose kind one record already establishes, where no record of that
 *  model says anything different. */
export function buildDictionary(products, {now = new Date()} = {}) {
  const votes = new Map();
  for (const p of products) {
    const category = sneakerCategory(p);
    if (category === UNPLACED_CATEGORY) continue;
    const key = modelKey(p);
    if (!votes.has(key)) votes.set(key, {counts: {}, name: variantGroupName(p), brand: p.brand, urls: new Set()});
    const entry = votes.get(key);
    entry.counts[category] = (entry.counts[category] || 0) + 1;
    if (p.url) entry.urls.add(p.url);
  }
  const entries = [], split = [];
  for (const [key, entry] of votes) {
    const categories = Object.keys(entry.counts);
    if (categories.length > 1) { split.push({key, categories}); continue; }
    entries.push({
      key, brand: entry.brand, model: entry.name, category: categories[0],
      seenOn: entry.counts[categories[0]],
      source: [...entry.urls][0] || '',
      recordedAt: now.toISOString().slice(0, 10),
    });
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  return {entries, split};
}

export async function main() {
  const catalog = await read('public/data/catalog.json', {products: []});
  const overlay = await read('public/data/monthly-catalog.json', {retail: [], newsletter: []});
  const products = [...(catalog.products || []), ...(overlay.retail || []), ...(overlay.newsletter || [])];

  const prior = await read('public/data/model-categories.json', {entries: []});
  const {entries, split} = buildDictionary(products);

  // Keep what was learned before. A model drops out of the catalogue long
  // before it stops being a running shoe.
  const merged = new Map(prior.entries.map(e => [e.key, e]));
  let added = 0, changed = 0;
  for (const e of entries) {
    const was = merged.get(e.key);
    if (!was) { merged.set(e.key, e); added++; continue; }
    if (was.category !== e.category) {
      // A disagreement with what was recorded is not resolved quietly.
      merged.set(e.key, {...was, category: e.category, previousCategory: was.category, recordedAt: e.recordedAt});
      changed++;
    }
  }
  const out = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    note: '상점이 직접 분류했거나 상품명에 종류가 적힌 기록에서 모델별로 모은 사전입니다. 같은 모델의 기록이 서로 다른 종류를 가리키면 기록하지 않습니다.',
    entries: [...merged.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
  await fs.writeFile(path.join(root, 'public/data/model-categories.json'), JSON.stringify(out, null, 2) + '\n');

  const unplaced = products.filter(p => sneakerCategory(p) === UNPLACED_CATEGORY);
  const dictionary = new Map(out.entries.map(e => [e.key, e.category]));
  const reached = unplaced.filter(p => dictionary.has(modelKey(p))).length;
  console.log(`models in the dictionary: ${out.entries.length} (+${added} new, ${changed} changed)`);
  console.log(`models left alone because records of them disagreed: ${split.length}`);
  console.log(`unplaced records the dictionary now answers: ${reached} of ${unplaced.length}`);
  return out;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href.replace('file:////', 'file:///'))
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
