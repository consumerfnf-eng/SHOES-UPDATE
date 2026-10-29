// Distributions over everything the page already publishes.
//
// The grid answers "what came out"; these answer "what is the shape of it" -
// which price bands a brand is crowding into, which materials are showing up,
// which colours are gaining. Nothing here collects anything new: price,
// material and body colour are already on every record, and the colour was
// read off each product's own photograph.
//
// Pure functions over an array of products, so the same code backs the screen
// and the CSV, and so they can be tested without a browser.

// --- price ------------------------------------------------------------------
// Listings carry their own currency, so a number alone would put a 1,250 USD
// Balenciaga in the same bucket as a 1,250 KRW sock. Everything is converted
// to KRW at a fixed, stated rate - a shopping-basket rate, not a trading one.
// It is here rather than fetched so a week's figures never move under a reader.
export const RATES_KRW = {KRW: 1, USD: 1380, EUR: 1490, GBP: 1760, JPY: 9.2, CNY: 193};
export const RATE_NOTE = '1 USD = 1,380원 · 1 EUR = 1,490원 · 1 GBP = 1,760원 · 100 JPY = 920원 기준';

const CURRENCY = [
  [/₩|원|KRW/i, 'KRW'], [/\$|USD/i, 'USD'], [/€|EUR/i, 'EUR'],
  [/£|GBP/i, 'GBP'], [/¥|JPY|엔/i, 'JPY'], [/CNY|RMB|위안/i, 'CNY'],
];

export function priceKrw(product) {
  const label = String(product?.priceLabel || '').trim();
  if (!label) return null;
  // The first number with at least three digits: "$ 1,250", "119,000원",
  // "USD 1030". A two-digit number is usually a size or a discount percent.
  const found = label.replace(/\s/g, '').match(/\d[\d,.]{2,}/);
  if (!found) return null;
  const digits = Number(found[0].replace(/[,.](?=\d{3}\b)/g, '').replace(/,/g, ''));
  if (!Number.isFinite(digits) || digits <= 0) return null;
  const currency = (CURRENCY.find(([re]) => re.test(label)) || [, digits >= 10000 ? 'KRW' : 'USD'])[1];
  const krw = Math.round(digits * (RATES_KRW[currency] ?? 1));
  return krw >= 5000 && krw <= 20_000_000 ? krw : null;
}

export const PRICE_BANDS = [
  [0, 100_000, '10만원 미만'], [100_000, 200_000, '10–20만원'], [200_000, 300_000, '20–30만원'],
  [300_000, 500_000, '30–50만원'], [500_000, 1_000_000, '50–100만원'],
  [1_000_000, 2_000_000, '100–200만원'], [2_000_000, Infinity, '200만원 이상'],
];

export function priceBand(krw) {
  return krw == null ? '' : (PRICE_BANDS.find(([lo, hi]) => krw >= lo && krw < hi) || [])[2] || '';
}

// --- material ---------------------------------------------------------------
// Retailers write a composition, not a word: "Suede / Neoprene", "소가죽 100%".
// Each named material counts once for the shoe, so one shoe can land in two
// rows - which is the honest reading of a mixed upper.
const MATERIALS = [
  ['가죽', /\bleather\b|가죽|레더/i], ['스웨이드', /\bsuede\b|스웨이드/i],
  ['메시', /\bmesh\b|메쉬|메시/i], ['캔버스', /\bcanvas\b|캔버스/i],
  ['니트', /\bknit\b|니트/i], ['합성피혁', /synthetic|인조가죽|합성피혁|pu\b/i],
  ['나일론', /\bnylon\b|나일론/i], ['고무', /\brubber\b|고무/i],
  ['스웨이드/누벅', /\bnubuck\b|누벅/i], ['텍스타일', /\btextile\b|텍스타일|섬유/i],
  ['네오프렌', /\bneoprene\b|네오프렌/i], ['코듀로이', /corduroy|코듀로이/i],
  ['울', /\bwool\b|울\b|양모/i], ['데님', /\bdenim\b|데님/i],
  ['EVA·폼', /\beva\b|\bfoam\b|폼\b/i], ['고어텍스', /gore[- ]?tex|고어텍스/i],
];

export function materialsOf(product) {
  const text = `${product?.material || ''} ${product?.description || ''}`;
  const out = MATERIALS.filter(([, re]) => re.test(text)).map(([name]) => name);
  return out.length ? out : [];
}

// --- colour -----------------------------------------------------------------
// Grouped by hue so a chart has rows a person can read. The source is the
// colour read off each product's own photograph, which is the one field every
// record has.
export const COLOUR_FAMILIES = [
  ['블랙', '#242424'], ['화이트', '#f2f2ee'], ['그레이', '#9a9ea3'], ['베이지·탄', '#c9b89e'],
  ['브라운', '#70472f'], ['레드', '#cf303a'], ['핑크', '#e4a9bb'], ['오렌지', '#e17a31'],
  ['옐로우', '#e6c953'], ['그린', '#53745c'], ['블루', '#4479ad'], ['퍼플', '#866799'],
];

export function colourFamily(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const light = max / 255, sat = max ? d / max : 0;
  if (sat < 0.16) return light < 0.26 ? '블랙' : light > 0.82 ? '화이트' : '그레이';
  let hue = 0;
  if (max === r) hue = ((g - b) / d + 6) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  // Low-saturation warm tones read as beige or brown rather than orange.
  if (hue < 45 && sat < 0.45) return light > 0.55 ? '베이지·탄' : '브라운';
  if (hue < 16 || hue >= 330) return '레드';
  if (hue < 45) return light < 0.5 ? '브라운' : '오렌지';
  if (hue < 70) return '옐로우';
  if (hue < 165) return '그린';
  if (hue < 255) return '블루';
  if (hue < 290) return '퍼플';
  return '핑크';
}

// --- distributions ----------------------------------------------------------
const tally = (rows, keyOf) => {
  const counts = new Map();
  for (const row of rows) for (const k of [].concat(keyOf(row) || [])) {
    if (k === '' || k == null) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
};

export function priceDistribution(products, {by = 'brand'} = {}) {
  const priced = products.map(p => ({p, krw: priceKrw(p)})).filter(x => x.krw != null);
  const bands = PRICE_BANDS.map(([, , label]) => ({
    label, count: priced.filter(x => priceBand(x.krw) === label).length,
  }));
  const groups = [...tally(priced, x => String(x.p[by] || '')).keys()].map(name => {
    const rows = priced.filter(x => String(x.p[by] || '') === name).map(x => x.krw).sort((a, b) => a - b);
    return {
      name, count: rows.length,
      median: rows[Math.floor(rows.length / 2)],
      low: rows[0], high: rows[rows.length - 1],
    };
  }).sort((a, b) => b.count - a.count);
  return {priced: priced.length, missing: products.length - priced.length, bands, groups};
}

export function materialDistribution(products) {
  const counts = tally(products, materialsOf);
  const stated = products.filter(p => materialsOf(p).length).length;
  return {
    stated, missing: products.length - stated,
    rows: [...counts].map(([name, count]) => ({name, count})).sort((a, b) => b.count - a.count),
  };
}

export function colourDistribution(products) {
  const counts = tally(products, p => colourFamily(p.bodyColor));
  const read = products.filter(p => colourFamily(p.bodyColor)).length;
  const order = COLOUR_FAMILIES.map(([name]) => name);
  return {
    read, missing: products.length - read,
    rows: [...counts].map(([name, count]) => ({
      name, count, hex: (COLOUR_FAMILIES.find(([n]) => n === name) || [, '#bbb'])[1],
    })).sort((a, b) => b.count - a.count || order.indexOf(a.name) - order.indexOf(b.name)),
  };
}

// --- csv --------------------------------------------------------------------
const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function toCsv(header, rows) {
  // A BOM so Excel opens Korean columns without a mangled first cell.
  return '﻿' + [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
}

/** The same table the CSV writes, as arrays - so the spreadsheet writer and
 *  the CSV writer never drift apart, and neither has to parse the other. */
export function analysisRows(products, kind) {
  if (kind === 'price') {
    const d = priceDistribution(products);
    return [['구분', '항목', '건수', '중앙값(원)', '최저(원)', '최고(원)'],
      ...d.bands.map(b => ['가격대', b.label, b.count, '', '', '']),
      ...d.groups.map(g => ['브랜드', g.name, g.count, g.median, g.low, g.high])];
  }
  if (kind === 'material') {
    const d = materialDistribution(products);
    return [['소재', '건수', '비중(%)'],
      ...d.rows.map(r => [r.name, r.count, (r.count / Math.max(1, d.stated) * 100).toFixed(1)])];
  }
  if (kind === 'colour') {
    const d = colourDistribution(products);
    return [['컬러 계열', '건수', '비중(%)'],
      ...d.rows.map(r => [r.name, r.count, (r.count / Math.max(1, d.read) * 100).toFixed(1)])];
  }
  return [['브랜드', '상품명', '컬러', '컬러계열', '가격(원)', '가격대', '소재', '카테고리', '등록일', 'URL'],
    ...products.map(p => [p.brand, p.name, p.colorway || '', colourFamily(p.bodyColor),
      priceKrw(p) ?? '', priceBand(priceKrw(p)), materialsOf(p).join(' / '),
      p.category || '', (p.listedAt || p.publishedAt || p.firstPublishedAt || '').slice(0, 10), p.url || ''])];
}

export function analysisCsv(products, kind) {
  const rows = analysisRows(products, kind);
  return toCsv(rows[0], rows.slice(1));
}

