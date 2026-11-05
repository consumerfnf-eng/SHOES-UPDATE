import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

export const ADIDAS_LIVE_NEW_SOURCES = Object.freeze({
  adidas: 'https://www.adidas.com/us/shoes-new_arrivals?sort=newest-to-oldest',
  'Y-3': 'https://www.adidas.com/us/y_3-new_arrivals',
});
const fields = {men: 'multi_age_gender_en_us', women: 'multi_age_gender_en_us', shoes: 'division', athletic_sneakers: 'producttype_en_us', new_arrivals: 'new_arrivals_en_us', y_3: 'brand_en_us'};
const adult = /\b(?:men|women|unisex)\b/i;
const child = /\b(?:kids?|children|junior|youth|infants?|toddlers?|preschool|boys?|girls?)\b/i;
const notSneaker = /\b(?:cleats?|boots?|sandals?|slides?|mules?|clogs?|loafers?|socks?|shirts?|pants?|jackets?|bags?|caps?|tights?|shorts?|jerseys|hoodies)\b/i;
const adidasLabels = new Set(['Originals', 'Performance', 'Sportswear', 'Terrex', 'TERREX', 'Five Ten', 'adidas by Stella McCartney']);
const hash = text => createHash('sha256').update(text).digest('hex');
class ProgressCallbackError extends Error {
  constructor(cause) { super('Progress callback failed', {cause}); }
}

function categoryUrl(value, brand) {
  if (!Object.hasOwn(ADIDAS_LIVE_NEW_SOURCES, brand)) throw Error('Unsupported brand');
  const url = new URL(value);
  if (url.origin !== 'https://www.adidas.com' || url.username || url.password || url.hash) throw Error('Unofficial category URL');
  const path = decodeURIComponent(url.pathname);
  if (!path.startsWith('/us/')) throw Error('Wrong category locale');
  const taxonomy = path.slice(4), tokens = taxonomy.split('-').flatMap(token => token.split('|'));
  if (new Set(tokens).size !== tokens.length || !tokens.includes('new_arrivals') || tokens.some(token => !Object.hasOwn(fields, token)) ||
      (brand === 'Y-3') !== tokens.includes('y_3') || (brand === 'adidas' && !tokens.includes('shoes'))) throw Error('Wrong New category/brand binding');
  for (const key of url.searchParams.keys()) {
    if (!['start', 'sort'].includes(key) || url.searchParams.getAll(key).length !== 1) throw Error('Unexpected category query');
  }
  if (url.searchParams.has('sort') && url.searchParams.get('sort') !== 'newest-to-oldest') throw Error('Wrong category sort');
  const startText = url.searchParams.get('start') ?? '0';
  if (!/^\d+$/.test(startText) || !Number.isSafeInteger(Number(startText))) throw Error('Invalid pagination offset');
  return {url, path, taxonomy, tokens, start: Number(startText)};
}

function urlKey(value) {
  const url = new URL(value);
  url.pathname = decodeURIComponent(url.pathname);
  url.searchParams.sort();
  return url.href;
}

function binding(row, brand) {
  if (!row || typeof row !== 'object' || !/^[A-Z0-9]{6}$/.test(row.id) || typeof row.title !== 'string' || !row.title.trim() || typeof row.subTitle !== 'string' || typeof row.category !== 'string') throw Error('Invalid original product record');
  const productUrl = new URL(row.url), image = new URL(row.image);
  if (productUrl.origin !== 'https://www.adidas.com' || productUrl.username || productUrl.password || productUrl.search || productUrl.hash || !productUrl.pathname.startsWith('/us/') || !productUrl.pathname.endsWith(`/${row.id}.html`)) throw Error(`Product SKU URL binding missing: ${row.id}`);
  if (image.origin !== 'https://assets.adidas.com' || image.username || image.password || image.hash || !image.pathname.startsWith('/images/') || !image.pathname.split('/').at(-1).includes(`_${row.id}_`)) throw Error(`Own SKU image binding missing: ${row.id}`);
  if (brand === 'Y-3' ? row.category !== 'Y-3' : !adidasLabels.has(row.category) && row.category !== 'Y-3') throw Error(`Product category brand mismatch: ${row.id}`);
}

/** Accept only original rawHtml with upstream status/URL evidence. A processed
 * HTML/markdown/AI-json result is insufficient. Supports Firecrawl data envelopes.
 * pageProps.fullUrl is deliberately unused: observed live pages report the
 * malformed www.www.adidas.com host there; metadata + query/path are checked.
 */
export function parseAdidasLiveNewPage(record, requestedUrl, {brand = 'adidas'} = {}) {
  const expected = categoryUrl(requestedUrl, brand);
  if (!record || typeof record !== 'object' || record.success === false || record.error) throw Error('Unsuccessful original category response');
  const data = record.data ?? record, meta = data.metadata ?? {};
  const urls = [record.requestedUrl, record.url, data.requestedUrl, data.url, meta.sourceURL, meta.url].filter(v => v !== undefined);
  const statuses = [record.status, record.statusCode, data.status, data.statusCode, meta.statusCode].filter(v => v !== undefined);
  if (!urls.length || urls.some(url => urlKey(url) !== urlKey(requestedUrl))) throw Error('Category response URL mismatch/missing');
  if (!statuses.length || statuses.some(status => status !== 200)) throw Error(`HTTP ${statuses.find(status => status !== 200) ?? 'unknown'}: original category status unavailable`);
  if (typeof data.rawHtml !== 'string') throw Error('Original rawHtml required; processed HTML strips hydration');
  const scripts = [...data.rawHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => /(?:^|\s)id\s*=\s*["']__NEXT_DATA__["']/i.test(match[1]));
  if (scripts.length !== 1) throw Error('Original __NEXT_DATA__ missing/ambiguous');
  let next;
  try { next = JSON.parse(scripts[0][2]); } catch { throw Error('Invalid original hydration JSON'); }
  const page = next.props?.pageProps;
  if (!page || page.context?.brand !== 'adidas' || page.context?.locale !== 'en_US' || next.query?.path !== 'us' ||
      page.taxonomy !== expected.taxonomy || next.query.taxonomy !== expected.taxonomy || page.pathname !== expected.path ||
      (next.query.sort ?? '') !== (expected.url.searchParams.get('sort') ?? '') ||
      Number(next.query.start ?? 0) !== expected.start) throw Error('Hydration source category/brand mismatch');
  if (expected.url.searchParams.has('sort') && page.sortParam !== 'newest-to-oldest') throw Error('Hydration sort mismatch');
  if (!Array.isArray(page.selectedFilters) || !Array.isArray(page.filters) || !Array.isArray(page.products)) throw Error('Invalid category schema');
  const selected = page.selectedFilters.map(f => `${f.on}:${f.value}`).sort();
  const wanted = expected.tokens.map(token => `${fields[token]}:${token}`).sort();
  if (JSON.stringify(selected) !== JSON.stringify(wanted)) throw Error('Selected category filters do not bind requested New/brand scope');
  const info = page.info;
  if (!info || !Number.isSafeInteger(info.count) || info.count < 0 || !Number.isSafeInteger(info.viewSize) || info.viewSize < 1 || info.viewSize > 1000 || info.startIndex !== expected.start ||
      (info.count === 0 ? expected.start !== 0 : expected.start >= info.count) || page.products.length !== Math.min(info.viewSize, info.count - expected.start)) throw Error('Incomplete category page/count/offset');
  const ids = new Set();
  for (const row of page.products) {
    binding(row, brand);
    if (ids.has(row.id)) throw Error('Repeated SKU within category page');
    ids.add(row.id);
  }
  const links = [];
  for (const match of data.rawHtml.matchAll(/<a\b[^>]*\shref\s*=\s*(["'])(.*?)\1/gi)) {
    let url;
    try { url = new URL(match[2].replaceAll('&amp;', '&'), requestedUrl).href; } catch { continue; }
    if (url.includes('start=')) links.push(url);
  }
  const nextStart = expected.start + page.products.length;
  const nextLinks = links.filter(url => {
    try {
      const candidate = categoryUrl(url, brand);
      return candidate.taxonomy === expected.taxonomy && candidate.start === nextStart && candidate.start > expected.start &&
        (candidate.url.searchParams.get('sort') ?? '') === (expected.url.searchParams.get('sort') ?? '');
    } catch { return false; }
  });
  if (nextStart < info.count && !nextLinks.length) throw Error('Explicit next category link missing');
  // Any same-category forward link contradicting a terminal count is unsafe.
  if (nextStart >= info.count && links.some(url => {
    try { const candidate = categoryUrl(url, brand); return candidate.taxonomy === expected.taxonomy && candidate.start > expected.start; } catch { return false; }
  })) throw Error('Terminal category pagination contradiction');
  return {url: requestedUrl, brand, taxonomy: expected.taxonomy, tokens: expected.tokens, total: info.count, start: expected.start,
    viewSize: info.viewSize, rows: page.products, filters: page.filters, next: nextStart < info.count ? nextLinks[0] : null,
    contentHash: hash(data.rawHtml)};
}

function excludedReason(row, brand) {
  if (brand === 'adidas' && row.category === 'Y-3') return 'other-brand-y-3';
  if (child.test(`${row.title} ${row.subTitle}`)) return 'children';
  if (notSneaker.test(row.title)) return 'not-sneakers';
  return '';
}

function facet(page, on, value, brand) {
  const matches = page.filters.filter(filter => filter.id === on).flatMap(filter => filter.values ?? []).filter(v => v.value === value && v.on === on);
  if (matches.length !== 1 || typeof matches[0].url !== 'string' || !Number.isSafeInteger(matches[0].count) || matches[0].count <= 0) throw Error(`Official category facet unavailable: ${value}`);
  const url = new URL(matches[0].url, page.url).href;
  const target = categoryUrl(url, brand), expectedTokens = [...new Set([...page.tokens, value])].sort();
  if (target.start !== 0 || JSON.stringify([...target.tokens].sort()) !== JSON.stringify(expectedTokens) ||
      (target.url.searchParams.get('sort') ?? '') !== (new URL(page.url).searchParams.get('sort') ?? '')) throw Error(`Category facet escapes scope: ${value}`);
  return url;
}

function productRecord(row, brand, rootPage, scopePage, at) {
  const style = row.id, name = row.title;
  const proof = {verified: true, brand, style, verifiedAt: at, verificationMethod: 'official-new-listing-sku-image', contentHash: rootPage.contentHash};
  const prices = row.priceData?.prices;
  const price = Array.isArray(prices) ? prices.find(p => p.type === 'sale') ?? prices.find(p => p.type === 'original') : null;
  const gender = adult.exec(row.subTitle)?.[0];
  const color = new URL(row.image).pathname.split('/').at(-1).split(`_${style}_`)[0].split('_').at(-1);
  return {id: `${brand === 'Y-3' ? 'y-3' : 'adidas'}-new-${style}`, brand, name, style, manufacturerStyle: style,
    ...(typeof row.modelNumber === 'string' && row.modelNumber ? {modelGroupId: `${brand}|${row.modelNumber}`} : {}),
    url: row.url, image: row.image, sourceImageUrl: row.image,
    category: 'sneaker', productType: 'sneaker', officialCategory: 'Athletic & Sneakers', audience: 'adult',
    description: `${name} — ${row.subTitle}`, gender: gender ? gender[0].toUpperCase() + gender.slice(1).toLowerCase() : '',
    colorway: /^(?:white|black|grey|gray|pink|blue|green|beige|brown|yellow|orange|red|purple|silver|gold|navy|multi)$/i.test(color) ? color : '', colors: [], country: 'US',
    priceLabel: price && Number.isFinite(price.value) && price.value >= 0 ? `USD ${price.value}` : '',
    firstSeen: at, productVerifiedAt: at, productEvidenceUrl: rootPage.url, sourceSignals: [],
    arrivalEvidence: {verified: true, brand, style, productUrl: row.url, kind: 'new-arrivals-listing', url: rootPage.url, verifiedAt: at, contentHash: rootPage.contentHash, excerpt: name},
    officialProductEvidence: {...proof, url: row.url},
    officialImageEvidence: {...proof, url: row.image, sourceUrl: rootPage.url},
    scopeEvidence: {verified: true, url: scopePage.url, contentHash: scopePage.contentHash, filters: [...scopePage.tokens], style, verifiedAt: at},
    ...(row.priceData?.isSoldOut === true ? {availability: 'sold-out'} : {}),
    ...(row.badges?.some(b => b.style === 'preview' && b.text === 'Coming Soon') ? {availability: 'coming-soon'} : {}),
  };
}

async function defaultRead(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(30000), headers: {Accept: 'text/html'}});
  return {rawHtml: await response.text(), url: response.url, status: response.status};
}

/** read(url,{brand,formats:['rawHtml'],onlyMainContent:false,maxAge:0}) must
 * return a full original source record. No AI-extracted JSON is consumed.
 * Root New pages are fully enumerated, then the site's own Shoes -> Men
 * -> Sneakers -> Women facet links bind adult sneaker membership. No guessed API.
 * Each brand is atomic: failures return diagnostics and no products for it.
 * onProgress(event), onCheckpoint(snapshot) are awaited; persistence is caller-owned.
 */
export async function collectAdidasLiveNew({read = defaultRead, brands = ['adidas', 'Y-3'], now = new Date(), maxPages = 20, maxReads = 32,
  minIntervalMs = 500, wait = sleep, onProgress, onCheckpoint} = {}) {
  if (!Array.isArray(brands) || new Set(brands).size !== brands.length || brands.some(b => !Object.hasOwn(ADIDAS_LIVE_NEW_SOURCES, b)) ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 || !Number.isInteger(maxReads) || maxReads < 1 || maxReads > 200 ||
      !Number.isFinite(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 60000) throw Error('Invalid bounded collection options');
  const at = now.toISOString(), outputs = {}, errors = [], cache = new Map();
  let reads = 0;
  for (const brand of brands) {
    const pagesRead = [], rootPages = [];
    // Keep callbacks outside data failure recovery: failed persistence rejects.
    const notify = async event => {
      try { await onProgress?.(structuredClone({brand, ...event})); }
      catch (cause) { throw new ProgressCallbackError(cause); }
    };
    const get = async url => {
      const key = `${brand}:${urlKey(url)}`;
      if (cache.has(key)) return cache.get(key);
      if (reads >= maxReads) throw Error('Read budget reached: collection incomplete');
      categoryUrl(url, brand);
      if (reads) await wait(minIntervalMs);
      reads++;
      await notify({type: 'read', url, reads});
      const record = await read(url, {brand, formats: ['rawHtml'], onlyMainContent: false, maxAge: 0});
      const page = parseAdidasLiveNewPage(record, url, {brand});
      cache.set(key, page); pagesRead.push(page);
      return page;
    };
    const enumerate = async first => {
      const pages = [], seen = new Set();
      let page = first;
      for (;;) {
        if (pages.length >= maxPages) throw Error('Page limit reached: collection incomplete');
        if (page.total !== first.total || page.viewSize !== first.viewSize || page.taxonomy !== first.taxonomy || page.start !== seen.size) throw Error('Category count/offset changed: collection incomplete');
        for (const row of page.rows) {
          if (seen.has(row.id)) throw Error('Repeated SKU/page: collection incomplete');
          seen.add(row.id);
        }
        pages.push(page);
        await notify({type: 'page', url: page.url, total: first.total, read: seen.size, scope: page.taxonomy, scopeComplete: !page.next});
        if (!page.next) break;
        if (pages.length >= maxPages) throw Error('Page limit reached: collection incomplete');
        page = await get(page.next);
      }
      if (seen.size !== first.total) throw Error('Category pagination incomplete');
      return pages;
    };
    let output, failure;
    try {
      const root = await get(ADIDAS_LIVE_NEW_SOURCES[brand]);
      rootPages.push(...await enumerate(root));
      const roots = new Map(rootPages.flatMap(page => page.rows.map(row => [row.id, {row, page}])));
      let scopePages = [];
      if ([...roots.values()].some(({row}) => !excludedReason(row, brand))) {
        let scope = root;
        for (const [on, value] of [['division', 'shoes'], ['multi_age_gender_en_us', 'men'], ['producttype_en_us', 'athletic_sneakers'], ['multi_age_gender_en_us', 'women']]) {
          if (!scope.tokens.includes(value)) scope = await get(facet(scope, on, value, brand));
        }
        scopePages = await enumerate(scope);
      }
      const scoped = new Map();
      for (const page of scopePages) for (const row of page.rows) {
        const original = roots.get(row.id);
        if (!original || original.row.title !== row.title || original.row.url !== row.url || original.row.image !== row.image || original.row.category !== row.category) throw Error('Scoped SKU differs from root New inventory');
        if (child.test(`${row.title} ${row.subTitle}`)) throw Error('Adult sneaker category contains contradictory child product');
        // The live sneaker facet includes KI5301, explicitly titled American
        // Football Cleats. Preserve enumeration but let the title exclusion
        // below win over a broad/mistagged official category.
        scoped.set(row.id, page);
      }
      const products = [], excluded = [];
      for (const {row, page} of roots.values()) {
        const reason = excludedReason(row, brand) || (!scoped.has(row.id) ? 'outside-official-adult-sneaker-scope' : '');
        if (reason) excluded.push({brand, style: row.id, name: row.title, reason, url: row.url, sourceUrl: page.url});
        else products.push(productRecord(row, brand, page, scoped.get(row.id), at));
      }
      output = {checkedAt: at, status: 'complete', products, excluded, coverage: {exhaustive: true, total: root.total, read: roots.size,
        pages: rootPages.length, adultSneakerTotal: scopePages[0]?.total ?? 0, adultSneakerPages: scopePages.length, eligible: products.length,
        sourceUrl: root.url, scopeUrl: scopePages[0]?.url ?? null,
        sources: pagesRead.map(p => ({url: p.url, contentHash: p.contentHash, total: p.total, start: p.start, read: p.rows.length}))}};
    } catch (error) {
      if (error instanceof ProgressCallbackError) throw error.cause;
      failure = error.message || String(error);
    }
    if (failure) {
      errors.push({brand, error: failure, status: 'incomplete'});
      await notify({type: 'source-complete', status: 'incomplete', error: failure});
      await onCheckpoint?.(structuredClone({brand, status: 'incomplete', error: failure, products: [], coverage: {exhaustive: false, validatedPages: pagesRead.length}}));
    } else {
      outputs[brand] = output;
      await notify({type: 'source-complete', status: 'complete', products: output.products.length, excluded: output.excluded.length});
      await onCheckpoint?.(structuredClone({brand, ...output}));
    }
  }
  return {checkedAt: at, outputs, errors, reads};
}
