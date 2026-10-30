// The Monday-morning email: what came out, what moved, and what broke.
//
// Three things were asked for and they belong in one message rather than
// three. A person should not have to open GitHub Actions to learn that a
// brand collected nothing, and a brand that quietly drops to zero because
// its site changed is exactly the failure that goes unnoticed for weeks.
//
//   what came out  - counts, the week's new arrivals, price/colour/material
//                    shape, and the keywords the week produced.
//   what to watch  - any brand whose collection fell away against the weeks
//                    before it, and any source that answered nothing.
//   what broke     - collection steps that failed, and readers that were
//                    blocked, named rather than buried in a log.
//
// Writes logs/weekly-briefing.html and .txt, and - given --out <directory> or
// SHOES_BRIEFING_DIR - a dated copy named for the week it covers, so a folder
// of them reads as a run of weeks rather than one file overwritten in place.
// The old comment below describes the mail route, which is no longer used.
// mail credentials are configured it still writes them and says so, because
// a briefing that exists is better than one that was never generated.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {priceDistribution, colourDistribution, materialDistribution, priceKrw, RATE_NOTE, categoryDistribution}
  from '../public/assets/analysis.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async (rel, fallback) => {
  try { return JSON.parse(await fs.readFile(path.join(root, rel), 'utf8')); }
  catch { return fallback; }
};
const day = iso => String(iso || '').slice(0, 10);
const num = n => Number(n || 0).toLocaleString('ko-KR');

// How far back a brand's count has to fall before it is worth a line.
const DROP_RATIO = 0.5;
const HISTORY_FILE = 'data/collection-history.json';

export function brandWatch(history, current, {dropRatio = DROP_RATIO} = {}) {
  const weeks = (history.weeks || []).slice(-5);
  const rows = [];
  for (const [brand, count] of Object.entries(current)) {
    const past = weeks.map(w => w.brands?.[brand]).filter(n => Number.isFinite(n));
    if (past.length < 2) continue;
    const typical = Math.round(past.reduce((a, b) => a + b, 0) / past.length);
    if (typical >= 3 && count <= typical * dropRatio) rows.push({brand, count, typical});
  }
  // Brands that used to collect and now do not, worst first.
  return rows.sort((a, b) => (b.typical - b.count) - (a.typical - a.count));
}

export function buildBriefing({catalog, overlay, trends, report, coverage, history, diagnostics}) {
  const asOf = catalog.asOf || day(new Date().toISOString());
  const products = [...(catalog.products || []), ...(overlay.retail || []), ...(overlay.newsletter || [])];
  const fresh = products.filter(p => {
    const d = day(p.listedAt || p.publishedAt || p.firstPublishedAt);
    return d && (Date.parse(asOf) - Date.parse(d)) / 86400000 <= 7;
  });

  const current = {};
  for (const p of products) if (p.brand) current[p.brand] = (current[p.brand] || 0) + 1;

  const price = priceDistribution(fresh.length ? fresh : products);
  const colour = colourDistribution(fresh.length ? fresh : products);
  const material = materialDistribution(fresh.length ? fresh : products);
  const category = categoryDistribution(fresh.length ? fresh : products);

  // A brand only counts as empty when nothing of its reached the page.
  // `verified` can be zero while products publish through another path -
  // adidas, PUMA and Jordan all do - and reporting those as failures would
  // make the list noise that nobody reads.
  const silent = (coverage || []).filter(c => !c.responses && !current[c.brand]).map(c => c.brand);
  const empty = (coverage || []).filter(c => c.responses && !current[c.brand]).map(c => c.brand);
  const watch = brandWatch(history || {}, current);

  const failures = [];
  for (const [id, source] of Object.entries(report?.sources || {}))
    if (source.status && source.status !== 'ok') failures.push(`${id}: ${source.status}`);
  for (const [name, stat] of Object.entries(diagnostics || {}))
    if (stat && stat.quotaStopped) failures.push(`${name}: quota stopped`);

  const topBrands = Object.entries(current).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const keywords = (trends?.keywords || []).slice(0, 8).map(k => `#${k.hashtag}`);

  return {
    asOf,
    counts: {products: products.length, fresh: fresh.length,
             official: (catalog.products || []).length, retail: (overlay.retail || []).length,
             newsletter: (overlay.newsletter || []).length},
    price, colour, material, category, topBrands, keywords, silent, empty, watch, failures,
    rereleases: report?.rereleasesExcluded ?? null,
    collected: report?.retailCollected ?? null,
  };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

export function briefingHtml(b) {
  const row = (label, value, note = '') =>
    `<tr><td style="padding:7px 10px;border-bottom:1px solid #eef1f5;color:#4d5765">${esc(label)}</td>`
    + `<td style="padding:7px 10px;border-bottom:1px solid #eef1f5;text-align:right;font-weight:600;color:#0b57d0">${esc(value)}</td>`
    + `<td style="padding:7px 10px;border-bottom:1px solid #eef1f5;color:#8690a0;font-size:12px">${esc(note)}</td></tr>`;
  const bars = rows => rows.slice(0, 6).map(r =>
    `<tr><td style="padding:5px 10px;color:#4d5765">${esc(r.label || r.name)}</td>`
    + `<td style="padding:5px 10px;text-align:right;color:#36414f">${num(r.count)}</td></tr>`).join('');
  const list = (items, empty) => items.length
    ? `<ul style="margin:6px 0 0;padding-left:18px;color:#4d5765">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
    : `<p style="margin:6px 0 0;color:#8690a0">${esc(empty)}</p>`;

  return `<div style="font-family:'Noto Sans KR','Malgun Gothic',Arial,sans-serif;color:#202124;max-width:720px;margin:0 auto;padding:22px">
  <p style="font-size:11px;letter-spacing:1.6px;color:#708094;margin:0 0 6px;font-weight:600">SHOES RESEARCH · 주간 브리핑</p>
  <h1 style="font-size:22px;font-weight:500;margin:0 0 4px;letter-spacing:-.6px">${esc(b.asOf)} 기준</h1>
  <p style="font-size:13px;color:#657287;margin:0 0 20px">이번 주 신상 ${num(b.counts.fresh)}건 · 전체 ${num(b.counts.products)}건</p>

  <h2 style="font-size:14px;margin:0 0 8px">무엇이 나왔나</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    ${row('이번 주 신규', num(b.counts.fresh) + '건', '등록일 7일 이내')}
    ${row('브랜드 공식', num(b.counts.official) + '건')}
    ${row('리테일', num(b.counts.retail) + '건', b.collected != null ? `수집 ${num(b.collected)}건에서 검증 통과` : '')}
    ${row('뉴스레터', num(b.counts.newsletter) + '건')}
    ${b.rereleases != null ? row('재출시 제외', num(b.rereleases) + '건', '신상에서 내림') : ''}
  </table>

  <h2 style="font-size:14px;margin:22px 0 8px">이번 주 상위 브랜드</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    ${b.topBrands.map(([name, n]) => `<tr><td style="padding:5px 10px;color:#4d5765">${esc(name)}</td><td style="padding:5px 10px;text-align:right">${num(n)}</td></tr>`).join('')}
  </table>

  <h2 style="font-size:14px;margin:22px 0 8px">가격대 · 컬러 · 소재</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr><th colspan="2" style="text-align:left;padding:4px 10px;font-size:11px;color:#8690a0">가격대</th></tr>
    ${bars(b.price.bands)}
    <tr><th colspan="2" style="text-align:left;padding:10px 10px 4px;font-size:11px;color:#8690a0">컬러</th></tr>
    ${bars(b.colour.rows)}
    <tr><th colspan="2" style="text-align:left;padding:10px 10px 4px;font-size:11px;color:#8690a0">소재</th></tr>
    ${bars(b.material.rows)}
  </table>
  <p style="font-size:11px;color:#8690a0;margin:8px 0 0">${esc(RATE_NOTE)}</p>

  <h2 style="font-size:14px;margin:22px 0 8px">SNS 키워드</h2>
  <p style="font-size:13px;color:#4d5765;margin:0">${b.keywords.length ? esc(b.keywords.join('  ')) : '이번 주 키워드가 없습니다.'}</p>

  <h2 style="font-size:14px;margin:22px 0 8px">살펴볼 것</h2>
  <p style="font-size:12px;color:#8690a0;margin:0">수집량이 평소의 절반 아래로 떨어진 브랜드입니다. 사이트 구조가 바뀌었을 수 있습니다.</p>
  ${list(b.watch.map(w => `${w.brand} — 이번 주 ${w.count}건 (평소 ${w.typical}건)`), '급감한 브랜드가 없습니다.')}

  <h2 style="font-size:14px;margin:22px 0 8px">수집 실패</h2>
  ${list([...b.failures, ...b.silent.map(s => `${s}: 응답 없음`), ...b.empty.map(s => `${s}: 응답했으나 발행 0건`)],
         '실패한 소스가 없습니다.')}

  <p style="margin:26px 0 0;font-size:12px"><a href="https://shoes-update.pages.dev/" style="color:#0b57d0">사이트에서 보기 ↗</a></p>
</div>`;
}

export function briefingText(b) {
  const lines = [
    `SHOES RESEARCH 주간 브리핑 · ${b.asOf}`, '',
    `이번 주 신규 ${num(b.counts.fresh)}건 / 전체 ${num(b.counts.products)}건`,
    `  브랜드 공식 ${num(b.counts.official)} · 리테일 ${num(b.counts.retail)} · 뉴스레터 ${num(b.counts.newsletter)}`,
    b.rereleases != null ? `  재출시 제외 ${num(b.rereleases)}건` : '', '',
    '상위 브랜드: ' + b.topBrands.map(([n, c]) => `${n} ${c}`).join(', '), '',
    '가격대: ' + b.price.bands.map(x => `${x.label} ${x.count}`).join(' / '),
    '컬러: ' + b.colour.rows.slice(0, 6).map(x => `${x.name} ${x.count}`).join(' / '),
    '소재: ' + b.material.rows.slice(0, 6).map(x => `${x.name} ${x.count}`).join(' / '),
    '카테고리: ' + b.category.rows.slice(0, 8).map(x => `${x.name} ${x.count}`).join(' / ')
      + ` (분류 ${num(b.category.placed)}건 · 이름만으로 알 수 없는 ${num(b.category.unplaced)}건 제외)`, '',
    'SNS 키워드: ' + (b.keywords.join(' ') || '없음'), '',
    '살펴볼 것:',
    ...(b.watch.length ? b.watch.map(w => `  - ${w.brand}: 이번 주 ${w.count}건 (평소 ${w.typical}건)`) : ['  급감한 브랜드 없음']),
    '',
    '수집 실패:',
    ...([...b.failures, ...b.silent.map(s => `${s}: 응답 없음`), ...b.empty.map(s => `${s}: 발행 0건`)]
        .map(s => `  - ${s}`).slice(0, 40) || []),
    '', 'https://shoes-update.pages.dev/',
  ];
  return lines.filter(l => l !== '').join('\n');
}

export async function main() {
  const catalog = await read('public/data/catalog.json', {products: []});
  const overlay = await read('public/data/monthly-catalog.json', {retail: [], newsletter: []});
  const trends = await read('public/data/trend-keywords.json', {keywords: []});
  const report = await read('data/monthly-run-report.json', {});
  const diagnostics = await read('logs/weekly-diagnostics.json', {});
  const history = await read(HISTORY_FILE, {weeks: []});
  const coverage = catalog.sourceStatus?.coverage || [];

  const brief = buildBriefing({catalog, overlay, trends, report, coverage, history,
                               diagnostics: {firecrawl: diagnostics.renderedOfficial,
                                             scrapingbee: diagnostics.scrapingBeeOfficial}});

  // Keep this week's per-brand counts so next week can see a fall.
  const counts = {};
  for (const p of [...(catalog.products || []), ...(overlay.retail || [])]) if (p.brand) counts[p.brand] = (counts[p.brand] || 0) + 1;
  const weeks = [...(history.weeks || []).filter(w => w.asOf !== brief.asOf), {asOf: brief.asOf, brands: counts}].slice(-12);
  await fs.mkdir(path.join(root, 'data'), {recursive: true});
  await fs.writeFile(path.join(root, HISTORY_FILE), JSON.stringify({schemaVersion: 1, weeks}, null, 2));

  await fs.mkdir(path.join(root, 'logs'), {recursive: true});
  await fs.writeFile(path.join(root, 'logs/weekly-briefing.html'), briefingHtml(brief));
  await fs.writeFile(path.join(root, 'logs/weekly-briefing.txt'), briefingText(brief));
  await fs.writeFile(path.join(root, 'logs/weekly-briefing.json'), JSON.stringify(brief, null, 2));
  const outDir = outputDirectory();
  if (outDir) {
    await fs.mkdir(outDir, {recursive: true});
    // Named for the day the briefing covers, not the day it was written: a
    // Monday re-run of last week's figures should land on last week's file.
    const stamp = brief.asOf.slice(0, 10);
    await fs.writeFile(path.join(outDir, `${stamp}.txt`), briefingText(brief).replace(/\n/g, '\r\n'), 'utf8');
    await fs.writeFile(path.join(outDir, `${stamp}.html`), briefingHtml(brief), 'utf8');
    console.log(`저장: ${path.join(outDir, stamp + '.txt')}`);
  }
  console.log(briefingText(brief));
  return brief;
}

/** Where the dated copy goes: --out wins, then SHOES_BRIEFING_DIR, then
 *  nowhere - a CI run writes only the repository copies. */
export function outputDirectory(argv = process.argv, env = process.env) {
  const flag = argv.indexOf('--out');
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1];
  return env.SHOES_BRIEFING_DIR || '';
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href.replace('file:////', 'file:///'))
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
