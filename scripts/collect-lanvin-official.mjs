import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {canonicalBrand, classifyFootwear, curateProduct, officialEvidenceFor, kstDay} from './curation.mjs';

export const LANVIN_MEN_SNEAKERS_URL = 'https://www.lanvin.com/en-us/man/shoes/sneakers/';
const origin = 'https://www.lanvin.com';
const hash = body => createHash('sha256').update(body).digest('hex');
const decode = text => text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/(?:^|\s)([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m => [m[1].toLowerCase(), decode(m[3])]));
}
function shelfUrl(value) {
  const url = new URL(value);
  const match = /^\/en-us\/(man|woman)\/shoes\/sneakers\/$/.exec(url.pathname);
  if (url.origin !== origin || !match || url.username || url.password || url.hash || [...url.searchParams.keys()].some(k => k !== 'page') || url.searchParams.getAll('page').length > 1) throw Error('Wrong official Lanvin sneaker category');
  const page = url.searchParams.get('page') ?? '1';
  if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) throw Error('Invalid Lanvin page number');
  return {url, page: Number(page), category: `${match[1] === 'man' ? 'men' : 'women'}-shoes-sneakers`};
}
function urlKey(value) { const url = new URL(value); url.searchParams.sort(); return url.href; }
function bodyRecord(record, requestedUrl) {
  if (!record || typeof record !== 'object' || record.success === false || record.error) throw Error('Unsuccessful Lanvin response');
  const data = record.data ?? record, meta = data.metadata ?? {};
  const urls = [record.url, record.requestedUrl, data.url, data.requestedUrl, meta.sourceURL, meta.url].filter(v => v !== undefined);
  const statuses = [record.status, record.statusCode, data.status, data.statusCode, meta.statusCode].filter(v => v !== undefined);
  if (!urls.length || urls.some(url => urlKey(url) !== urlKey(requestedUrl))) throw Error('Lanvin response URL missing/mismatch');
  if (!statuses.length || statuses.some(status => status !== 200)) throw Error(`HTTP ${statuses.find(s => s !== 200) ?? 'unknown'}: Lanvin source not successful`);
  if (typeof data.rawHtml !== 'string') throw Error('Original Lanvin rawHtml required');
  return data.rawHtml;
}
function links(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b([^>]*)>`, 'gi'))].map(m => attributes(m[1]));
}

/** Extract only the current official Mobify search page; explicit packed
 * defaults are applied exactly as published, never filled from nearby tiles.
 */
export function parseLanvinOfficialPage(record, requestedUrl) {
  const shelf = shelfUrl(requestedUrl), html = bodyRecord(record, requestedUrl);
  const documentLinks = links(html, 'link');
  const canonical = documentLinks.filter(link => link.rel === 'canonical');
  if (canonical.length !== 1 || new URL(canonical[0].href, requestedUrl).origin !== origin || new URL(canonical[0].href, requestedUrl).pathname !== shelf.url.pathname) throw Error('Lanvin canonical category mismatch');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => attributes(m[1]).id === 'mobify-data');
  if (scripts.length !== 1) throw Error('Original Lanvin mobify-data missing/ambiguous');
  let data;
  try { data = JSON.parse(scripts[0][2]); } catch { throw Error('Invalid Lanvin hydration JSON'); }
  const states = data?.__PRELOADED_STATE__?.__STATE_MANAGEMENT_LIBRARY?.reduxStoreState?.productSearchResult;
  if (!states || Object.keys(states).length !== 1) throw Error('Lanvin product search state unavailable/ambiguous');
  const state = Object.values(states)[0];
  if (state.selectedRefinements?.cgid !== shelf.category || state.selectedRefinements?.htype !== 'variation_group' || state.query !== '') throw Error('Lanvin hydration category mismatch');
  if (!Number.isSafeInteger(state.total) || state.total < 0 || !Number.isSafeInteger(state.offset) || state.offset < 0 || !Number.isSafeInteger(state.limit) || state.limit < 1 || state.limit > 500 || (shelf.page === 1 && state.offset !== 0)) throw Error('Invalid Lanvin count/offset');
  if (!state.pages || Object.keys(state.pages).length !== 1 || !Object.hasOwn(state.pages, String(shelf.page))) throw Error('Lanvin hydration pagination mismatch');
  const packed = state.pages[String(shelf.page)];
  if (packed?.__packed !== 1 || !packed.defaults || typeof packed.defaults !== 'object' || Array.isArray(packed.defaults) || !Array.isArray(packed.rows)) throw Error('Unknown Lanvin packed search schema');
  const rows = packed.rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Invalid Lanvin product row');
    return {...packed.defaults, ...row};
  });
  if ((state.total === 0 ? state.offset !== 0 : state.offset >= state.total) || rows.length !== Math.min(state.limit, state.total - state.offset)) throw Error('Incomplete Lanvin search page');
  const seen = new Set();
  for (const row of rows) {
    if (typeof row.productId !== 'string' || !/^[A-Z0-9]{10,40}$/.test(row.productId) || seen.has(row.productId)) throw Error('Invalid/repeated Lanvin product identity');
    seen.add(row.productId);
  }
  const nextLinks = documentLinks.filter(link => link.rel === 'next').map(link => new URL(link.href, requestedUrl).href);
  if (new Set(nextLinks).size > 1) throw Error('Ambiguous Lanvin next page');
  const next = nextLinks[0] ?? null;
  if (next) {
    const target = shelfUrl(next);
    if (target.url.pathname !== shelf.url.pathname || target.page !== shelf.page + 1 || state.offset + rows.length >= state.total) throw Error('Lanvin next page escapes category/count');
  } else if (state.offset + rows.length !== state.total) throw Error('Lanvin pagination incomplete: next link missing');
  const anchors = links(html, 'a').filter(link => link.href).map(link => {
    try { return new URL(link.href, requestedUrl).href; } catch { return ''; }
  });
  const womenUrl = `${origin}/en-us/woman/shoes/sneakers/`;
  return {url: requestedUrl, contentHash: hash(html), total: state.total, offset: state.offset, limit: state.limit, page: shelf.page,
    rows, next, anchors: [...new Set(anchors)], womenUrl: anchors.includes(womenUrl) ? womenUrl : null};
}

/** Bind a manufacturer's variation-group ID to its own color image and actual
 * locale product anchor. The hydration's /en/ URL is not rewritten/published:
 * it must agree with the real /en-us/ product link captured in the document.
 */
export function lanvinOfficialProduct(row, page, {now = new Date()} = {}) {
  const brand = canonicalBrand(row.c_brand), style = row.productId;
  if (brand !== 'Lanvin' || typeof row.productName !== 'string' || !row.productName.trim() || row.hitType !== 'variation_group') throw Error('Lanvin product brand/title/type missing');
  const matches = page.anchors.filter(value => {
    try { const url = new URL(value); return url.origin === origin && /^\/en-us\/(?:man|woman)\/shoes\/sneakers\/[^/]+\.html$/.test(url.pathname) && url.pathname.endsWith(`-${style}.html`) && !url.search && !url.hash && !url.username && !url.password; } catch { return false; }
  });
  if (matches.length !== 1) throw Error('Actual Lanvin SKU product anchor missing/ambiguous');
  const url = matches[0], hydrationUrl = new URL(row.c_url);
  if (hydrationUrl.origin !== origin || hydrationUrl.search || hydrationUrl.hash || hydrationUrl.pathname.replace(/^\/en\//, '/en-us/') !== new URL(url).pathname) throw Error('Lanvin hydration and product anchor disagree');
  const category = new URL(url).pathname.includes('/woman/') ? 'women-shoes-sneakers' : 'men-shoes-sneakers';
  if (row.c_primaryCategory !== category || row.representedProduct?.c_categoryId !== category) throw Error('Lanvin product gender/category disagrees with its own URL');
  if (!Array.isArray(row.imageGroups)) throw Error('Lanvin own image groups missing');
  const zooms = row.imageGroups.filter(group => group.viewType === 'zoom').flatMap(group => (group.images ?? []).map(image => ({image, group})));
  const bound = zooms.filter(({image, group}) => {
    try {
      const asset = new URL(image.disBaseLink), match = /^([A-Z0-9]+)_([A-Z0-9]+)_(\d+)\.(?:jpg|jpeg|png|webp|avif)$/i.exec(asset.pathname.split('/').at(-1));
      return asset.origin === origin && !asset.username && !asset.password && !asset.hash && asset.pathname.includes('/on/demandware.static/-/Sites-57/default/') && match && match[1] + match[2] === style &&
        group.variationAttributes?.some(a => a.id === 'color' && a.values?.some(v => v.value === match[2]));
    } catch { return false; }
  });
  if (!bound.length) throw Error('Lanvin own SKU/color image not bound');
  const chosen = bound[0].image, image = chosen.disBaseLink;
  if (chosen.title !== row.productName || !chosen.alt?.toLowerCase().startsWith('lanvin ')) throw Error('Lanvin image title/brand contradicts product');
  const basename = new URL(image).pathname.split('/').at(-1), modelStyle = basename.split('_')[0];
  if (/\b(?:kids?|junior|children|infants?|toddlers?|youth)\b/i.test(`${row.productName} ${chosen.alt}`)) throw Error('Child product is outside adult Lanvin scope');
  const at = now.toISOString(), contentHash = page.contentHash;
  const proof = {verified: true, brand, style, identifierType: 'official-product-id', verifiedAt: at, verificationMethod: 'official-new-listing-sku-image', contentHash};
  const p = {id: 'arrival-' + hash(`${brand}|official-assortment-listing|${style}`).slice(0, 20), brand, name: row.productName, style, manufacturerStyle: style,
    styleType: 'official-product-id', modelGroupId: `${brand}|${modelStyle}`, platform: 'official-mobify-listing', url, image, sourceImageUrl: image,
    officialCategory: 'Sneakers', productType: 'sneaker', category: 'sneaker', audience: 'adult', gender: category.startsWith('women') ? 'Women' : 'Men', country: 'US',
    description: String(row.representedProduct?.c_materialDescription ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    colorway: typeof row.representedProduct?.c_colorDescription === 'string' ? row.representedProduct.c_colorDescription : '', colors: [],
    priceLabel: row.currency === 'USD' && Number.isFinite(row.price) && row.price >= 0 ? `USD ${row.price}` : '',
    firstSeen: at, productVerifiedAt: at, productEvidenceUrl: page.url, sourceSignals: [],
    arrivalEvidence: {verified: true, brand, style, productUrl: url, kind: 'official-assortment-listing', url: page.url, verifiedAt: at, excerpt: row.productName, contentHash},
    officialProductEvidence: {...proof, url}, officialImageEvidence: {...proof, url: image, sourceUrl: page.url},
    sourceTileBinding: {verified: true, brand, style, url, image, sourceUrl: page.url, contentHash},
    ...(row.representedProduct?.c_badges === 'badge-coming-soon' ? {availability: 'coming-soon'} : {}),
    ...(row.orderable === false ? {availability: 'not-orderable'} : {}),
  };
  const type = classifyFootwear(p);
  if (!['sneaker', 'hybrid'].includes(type.category)) throw Error(`Existing footwear gate: ${type.reason ?? type.category}`);
  p.category = type.category; p.productType = type.category;
  if (!officialEvidenceFor(p, kstDay(now))) throw Error('Existing official evidence gate rejected Lanvin SKU/image');
  const gated = curateProduct(p, kstDay(now), now);
  if (!gated.product) throw Error(`Existing curation gate: ${gated.reason}`);
  return p;
}

async function defaultRead(url) {
  const r = await fetch(url, {signal: AbortSignal.timeout(30000), headers: {Accept: 'text/html'}});
  return {rawHtml: await r.text(), url: r.url, status: r.status};
}

/** read(url,{formats:['rawHtml'],maxAge:0,onlyMainContent:false}) returns a full
 * Firecrawl record. Sources are men's official root and women's actual nav.
 * Coverage is per shelf. A blocked/invalid continuation discards that shelf's
 * partial products; other completed shelves can still contribute products.
 * Product-level gate rejections are held and reported, never manufactured.
 */
export async function collectLanvinOfficial({read = defaultRead, now = new Date(), maxPages = 10, maxReads = 12, minIntervalMs = 500, wait = sleep, onProgress} = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 || !Number.isInteger(maxReads) || maxReads < 1 || maxReads > 100 || !Number.isFinite(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 60000) throw Error('Invalid Lanvin collection bounds');
  const products = new Map(), diagnostics = [], held = [], pages = [], sourceRecords = [], queue = [LANVIN_MEN_SNEAKERS_URL], cached = new Map();
  let reads = 0, womenDiscovery = null;
  const get = async url => {
    const key = urlKey(url);
    if (cached.has(key)) return cached.get(key);
    if (reads >= maxReads) throw Error('Lanvin read budget reached');
    if (reads) await wait(minIntervalMs);
    reads++;
    const record = await read(url, {formats: ['rawHtml'], onlyMainContent: false, maxAge: 0});
    // Keep the original receipt, including denied/invalid responses and all
    // capture metadata. Parsing must not erase the evidence for a failure.
    sourceRecords.push({url, record: structuredClone(record)});
    const page = parseLanvinOfficialPage(record, url);
    cached.set(key, page);
    return page;
  };
  for (const source of queue) {
    const sourceProducts = [], sourceHeld = [], seen = new Set(), sourcePages = [];
    let url = source, total = null, error = '';
    try {
      while (url) {
        if (sourcePages.length >= maxPages) throw Error('Lanvin page limit reached');
        const page = await get(url);
        if (source === LANVIN_MEN_SNEAKERS_URL && page.page === 1 && page.womenUrl && !queue.includes(page.womenUrl)) {
          queue.push(page.womenUrl); womenDiscovery = {url: source, targetUrl: page.womenUrl, contentHash: page.contentHash};
        }
        total ??= page.total;
        if (page.total !== total || page.offset !== seen.size) throw Error('Lanvin total/offset changed: exhaustion unproven');
        for (const row of page.rows) {
          if (seen.has(row.productId)) throw Error('Repeated Lanvin SKU/page: exhaustion unproven');
          seen.add(row.productId);
          try { sourceProducts.push(lanvinOfficialProduct(row, page, {now})); }
          catch (cause) { sourceHeld.push({style: row.productId, name: row.productName, sourceUrl: page.url, reason: cause.message}); }
        }
        sourcePages.push({url: page.url, contentHash: page.contentHash, total: page.total, offset: page.offset, read: page.rows.length});
        url = page.next;
      }
      if (seen.size !== total) throw Error('Lanvin source incomplete');
    } catch (cause) { error = cause.message || String(cause); }
    pages.push(...sourcePages); held.push(...sourceHeld);
    if (!error) {
      for (const p of sourceProducts) {
        const old = products.get(p.style);
        if (old && (old.url !== p.url || old.image !== p.image || old.name !== p.name)) {
          held.push({style: p.style, reason: 'Conflicting Lanvin identity across shelves'}); products.delete(p.style);
        } else products.set(p.style, old ?? p);
      }
    }
    const status = {brand: 'Lanvin', sourceUrl: source, status: error ? 'incomplete' : 'complete', exhaustive: !error, exhausted: !error,
      ...(error ? {failedUrl: url} : {}),
      total, read: seen.size, pages: sourcePages.length, verified: error ? 0 : sourceProducts.length, held: sourceHeld.length, error};
    diagnostics.push(status);
    await onProgress?.(structuredClone(status));
  }
  if (!womenDiscovery) diagnostics.push({brand: 'Lanvin', status: 'incomplete', exhaustive: false, exhausted: false, sourceUrl: null,
    failedUrl: LANVIN_MEN_SNEAKERS_URL, error: 'Actual women sneaker navigation not verified'});
  const errors = diagnostics.filter(d => d.error || d.exhaustive === false || d.exhausted === false).map(d => ({
    brand: d.brand, sourceUrl: d.sourceUrl, url: d.failedUrl || d.sourceUrl || LANVIN_MEN_SNEAKERS_URL,
    status: 'incomplete', error: d.error || 'Lanvin source enumeration incomplete',
  }));
  const exhaustive = diagnostics.length === 2 && !errors.length && diagnostics.every(d => d.exhaustive === true && d.exhausted !== false);
  return {schemaVersion: 1, brand: 'Lanvin', checkedAt: now.toISOString(), products: [...products.values()], diagnostics, errors, held, pages, reads,
    // A global explicit false prevents a legacy consumer from upgrading the
    // run when an exhausted flag describes only one completed shelf.
    exhaustive, exhausted: exhaustive, complete: exhaustive,
    coverage: {exhaustive, exhausted: exhaustive, scope: 'official-men-and-women-sneaker-assortments', womenDiscovery}, sourceRecords};
}
