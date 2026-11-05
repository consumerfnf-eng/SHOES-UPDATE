import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export const NIKE_NEW_SOURCES = Object.freeze({
  Nike: 'https://www.nike.com/w/new-shoes-3n82yzy7ok',
  Jordan: 'https://www.nike.com/w/new-jordan-shoes-37eefz3n82yzy7ok',
});
export const NIKE_ADULT_NEW_SOURCES = Object.freeze([
  'https://www.nike.com/w/new-mens-shoes-3n82yznik1zy7ok',
  'https://www.nike.com/w/new-womens-shoes-3n82yz5e1x6zy7ok',
]);
export const NIKE_WALL_ENDPOINT = 'https://api.nike.com/discover/product_wall/v1/marketplace/US/language/en/consumerChannelId/d9a5bc42-4b9c-4976-858a-f159cf99c647';
export const NIKE_PRODUCT_ENDPOINT = 'https://api.nike.com/product_feed/threads/v3/';
const caller = 'com.nike.commerce.nikedotcom.web';
const categories = new Set([...Object.values(NIKE_NEW_SOURCES), ...NIKE_ADULT_NEW_SOURCES]);
const digest = value => createHash('sha256').update(value).digest('hex');
const child = /\b(?:kids?|children|boys?|girls?|youth|junior|baby|babies|toddlers?|infants?|preschool)\b/i;
const notSneaker = /\b(?:cleats?|spikes?|(?:duck)?boots?|sandals?|slides?|mules?|clogs?|slippers?|loafers?|socks?|gift\s*cards?)\b/i;
const upcoming = /COMING_SOON|coming soon|upcoming|pre[ -]?order|available (?:on|at)/i;

function category(value) {
  if (!categories.has(value)) throw Error('Unapproved official New category');
  return new URL(value).pathname;
}

/** Live public JSON endpoint; the caller ID identifies Nike's public web client,
 * not a credential. Does not request or claim to read HTML product pages. */
export async function readNikeOfficialJson(url, {fetchImpl = fetch} = {}) {
  const target = new URL(url);
  if (![NIKE_WALL_ENDPOINT, NIKE_PRODUCT_ENDPOINT].includes(target.origin + target.pathname) || target.username || target.password || target.hash) throw Error('Unofficial Nike API endpoint');
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(30000), redirect: 'error',
    headers: {Accept: 'application/json', 'nike-api-caller-id': caller}});
  return {url: response.url, status: response.status, body: await response.text(), transport: 'official-public-json-api'};
}

export function nikeNewApiUrl(sourceUrl, {count = 100} = {}) {
  if (![24, 50, 100].includes(count)) throw Error('Invalid Nike page size');
  const url = new URL(NIKE_WALL_ENDPOINT);
  url.search = new URLSearchParams({path: category(sourceUrl), queryType: 'PRODUCTS', anchor: '0', count: String(count)});
  return url.href;
}

export function nikeAdultProductUrl(sku) {
  if (!/^[A-Z0-9]{6,10}-\d{3}$/.test(sku ?? '')) throw Error('Invalid Nike SKU');
  const url = new URL(NIKE_PRODUCT_ENDPOINT);
  for (const filter of ['marketplace(US)', 'language(en)', 'channelId(d9a5bc42-4b9c-4976-858a-f159cf99c647)', `productInfo.merchProduct.styleColor(${sku})`]) url.searchParams.append('filter', filter);
  return url.href;
}

/** Resolve rare New-wall SKUs omitted from both adult New facets using Nike's
 * own exact-SKU merchandise genders. Images remain bound to the wall variant.
 * Thread publish/commerce dates are availability checks, never release dates. */
export function parseNikeAdultProductEvidence(record, row, {now = new Date()} = {}) {
  const url = nikeAdultProductUrl(row.productCode);
  if (record?.url !== url || record.status !== 200 || typeof record.body !== 'string' || record.error || record.success === false) throw Error('Original adult product JSON unavailable');
  const payload = JSON.parse(record.body), matches = [];
  if (payload.pages?.next || payload.pages?.totalResources !== 1 || payload.objects?.length !== 1) throw Error('Exact-SKU thread pagination ambiguous');
  payload.objects.forEach((thread, ti) => {
    if (thread.marketplace !== 'US' || thread.language !== 'en' || thread.channelId !== 'd9a5bc42-4b9c-4976-858a-f159cf99c647') throw Error('Wrong adult product thread locale/channel');
    thread.productInfo?.forEach((p, pi) => {
      if (p.merchProduct?.styleColor === row.productCode) matches.push({p, pointer: `/objects/${ti}/productInfo/${pi}`});
    });
  });
  if (matches.length !== 1) throw Error('Exact adult product identity missing/ambiguous');
  const {p, pointer} = matches[0], m = p.merchProduct, c = p.productContent;
  if (m.id !== row.merchProductId || m.productType !== 'FOOTWEAR' || c?.title !== row.copy.title ||
      c.colorDescription !== row.displayColors.colorDescription || !Array.isArray(m.genders)) throw Error('Adult product SKU/color identity mismatch');
  const adult = m.genders.length > 0 && m.genders.every(g => ['MEN', 'WOMEN', 'UNISEX'].includes(g));
  const active = m.status === 'ACTIVE' && m.preOrder === false && p.availability?.available === true &&
    Number.isFinite(Date.parse(m.commerceStartDate)) && Date.parse(m.commerceStartDate) <= now.getTime();
  return {adult: adult && active, pointer, page: {sourceUrl: url, url, contentHash: digest(record.body), transport: 'official-public-json-api'}};
}

function apiRequest(value, sourceUrl) {
  const url = new URL(value, NIKE_WALL_ENDPOINT);
  if (url.origin + url.pathname !== NIKE_WALL_ENDPOINT || url.username || url.password || url.hash ||
      url.searchParams.get('path') !== category(sourceUrl) || url.searchParams.get('queryType') !== 'PRODUCTS') throw Error('API cursor escapes official New scope');
  const allowed = ['path', 'queryType', 'anchor', 'count', 'attributeIds'];
  for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw Error('Unexpected Nike cursor parameter');
  const anchor = url.searchParams.get('anchor'), count = url.searchParams.get('count');
  if (!/^\d+$/.test(anchor ?? '') || !Number.isSafeInteger(Number(anchor)) || ![24, 50, 100].includes(Number(count))) throw Error('Invalid Nike cursor offset/count');
  return {url: url.href, anchor: Number(anchor), count: Number(count)};
}

function unbox(value) {
  if (value?.structuredContent) return value.structuredContent;
  if (value?.content) {
    const block = value.content.find(block => block.type === 'text');
    if (!block) throw Error('Provider response has no JSON content');
    return JSON.parse(block.text);
  }
  return value;
}

/** Pass execute(args) backed by firecrawl_scrape. Exact discovered contract:
 * nike-com/products/search, first {path,count:100}, then {cursor:next_cursor}
 * WITHOUT path/count/query. The wrapper preserves provider receipts and timestamps.
 * Captures from this reader, or {url,status,body} direct captures, can be replayed
 * via collectNikeOfficialNew({read: async url => capturedByUrl[url]}).
 * Provider integration: collectNikeOfficialNew({read:createNikeProviderReader(execute),
 * readProduct:readNikeOfficialJson}); the provider contract covers wall pages only.
 */
export function createNikeProviderReader(execute, {conversationId} = {}) {
  if (typeof execute !== 'function') throw Error('Provider executor required');
  return async (url, {sourceUrl} = {}) => {
    const request = apiRequest(url, sourceUrl);
    const options = request.anchor === 0 ? {path: category(sourceUrl), count: request.count} : {cursor: new URL(url).pathname + new URL(url).search};
    const response = unbox(await execute({objective: 'Collect complete official Nike and Jordan New adult sneakers',
      ...(conversationId ? {conversationId} : {}), alexandria: [{provider: 'nike-com', capability: 'products/search', options}]}));
    if (response.conversationId) conversationId = response.conversationId;
    return {transport: 'nike-com/products/search', url, requestOptions: options, response};
  };
}

function providerPayload(record, expected) {
  const envelope = unbox(record.response);
  if (envelope?.success === false || envelope?.error) throw Error('Unsuccessful Nike provider response');
  const entries = envelope?.data?.alexandria;
  if (!Array.isArray(entries) || entries.length !== 1) throw Error('Ambiguous Nike provider result');
  const entry = entries[0];
  if (entry.provider !== 'nike-com' || entry.capability !== 'products/search' || entry.error || !entry.data) throw Error(`Nike provider failure: ${entry.error?.message ?? 'wrong contract/data'}`);
  const expectedOptions = expected.anchor === 0 ? {path: new URL(expected.url).searchParams.get('path'), count: expected.count} : {cursor: new URL(expected.url).pathname + new URL(expected.url).search};
  if (JSON.stringify(record.requestOptions) !== JSON.stringify(expectedOptions)) throw Error('Provider request scope mismatch');
  const p = entry.data;
  if (p.country !== 'US' || p.language !== 'en' || !Array.isArray(p.groups) || !Object.hasOwn(p, 'next_cursor')) throw Error('Invalid Nike provider page schema');
  return {payload: {canonicalUrl: p.canonical_url, marketplace: p.country, language: p.language,
    productGroupings: p.groups.map(g => ({cardType: g.card_type, products: g.variants?.map(v => ({
      productCode: v.style_color, productType: v.product_type, globalProductId: v.global_product_id, merchProductId: v.merch_product_id,
      groupKey: v.group_key, copy: {title: v.title, subTitle: v.subtitle}, displayColors: {colorDescription: v.color},
      colorwayImages: {squarishURL: v.images?.square, portraitURL: v.images?.portrait}, pdpUrl: {url: v.url},
      prices: {currency: v.price?.currency, currentPrice: v.price?.current}, featuredAttributes: v.attributes, badgeLabel: v.badge,
    }))})), pages: {next: p.next_cursor, totalResources: p.total_resources, totalPages: p.total_pages}},
    provenance: {provider: entry.provider, capability: entry.capability, requestId: envelope.requestId,
      providerRequestId: entry.providerRequestId, alexandriaId: entry.alexandriaId, observedAtMs: p.observed_at_ms}};
}

/** Parse original API/provider JSON only. Each variant remains a single record;
 * images/colors are never borrowed from a group, sibling SKU or another page. */
export function parseNikeOfficialNewPage(record, requestedUrl, {sourceUrl} = {}) {
  const request = apiRequest(requestedUrl, sourceUrl);
  if (!record || record.url !== request.url || record.success === false || record.error) throw Error('API response URL mismatch/failure');
  let payload, provenance = {}, raw;
  const transport = record.transport ?? 'official-public-json-api';
  if (transport === 'nike-com/products/search') {
    ({payload, provenance} = providerPayload(record, request));
    raw = JSON.stringify(record.response);
  } else {
    if (transport !== 'official-public-json-api' || record.status !== 200 || typeof record.body !== 'string') throw Error(`HTTP ${record.status ?? 'unknown'}: original API JSON required`);
    raw = record.body;
    payload = JSON.parse(raw);
  }
  // Nike intentionally returns canonicalUrl:null on continuation pages. Their
  // validated explicit cursor path retains category binding across those pages.
  if ((payload.canonicalUrl !== sourceUrl && !(request.anchor > 0 && payload.canonicalUrl === null)) || payload.marketplace !== 'US' || payload.language !== 'en' || payload.searchTerm ||
      !Array.isArray(payload.productGroupings) || !payload.pages) throw Error('JSON category/locale/schema mismatch');
  const {totalResources: total, totalPages, next} = payload.pages;
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(totalPages) || totalPages < 0 ||
      ![Math.ceil(total / request.count), ...(total === 0 ? [1] : [])].includes(totalPages) ||
      payload.productGroupings.length !== Math.min(request.count, total - request.anchor) ||
      !Object.hasOwn(payload.pages, 'next') || !(next === null || typeof next === 'string')) throw Error('Incomplete API page/count metadata');
  const end = request.anchor + payload.productGroupings.length;
  if (end < total ? !next : !!next) throw Error('Explicit pagination contradicts total');
  let nextUrl = null;
  if (next) {
    const target = apiRequest(next, sourceUrl);
    if (target.anchor !== end || target.count !== request.count) throw Error('Noncontiguous Nike cursor');
    nextUrl = target.url;
  }
  const rows = [];
  payload.productGroupings.forEach((group, groupIndex) => {
    // Editorial cards may be counted in the wall but contain no shoe variants.
    if (!Array.isArray(group.products)) throw Error('Missing variant array');
    group.products.forEach((row, variantIndex) => rows.push({row, pointer: `/productGroupings/${groupIndex}/products/${variantIndex}`,
      ...(transport === 'nike-com/products/search' ? {pointer: `/groups/${groupIndex}/variants/${variantIndex}`} : {})}));
  });
  return {...request, sourceUrl, total, totalPages, groupCount: payload.productGroupings.length, rows, next: nextUrl,
    transport, provenance, contentHash: digest(raw)};
}

function excludedReason(row) {
  const text = `${row.copy?.title ?? ''} ${row.copy?.subTitle ?? ''}`;
  if (row.productType !== 'FOOTWEAR') return 'not-footwear';
  if (child.test(text)) return 'children';
  if (notSneaker.test(text)) return 'not-sneakers';
  if (upcoming.test(`${row.badgeLabel ?? ''} ${row.badgeAttribute ?? ''} ${(row.featuredAttributes ?? []).join(' ')}`)) return 'upcoming';
  if (row.customization || /\bcustom\b|\bby you\b/i.test(text)) return 'custom-product';
  if (!/\b(?:shoes?|sneakers?)\b/i.test(row.copy?.subTitle ?? '')) return 'unproven-sneaker-type';
  return '';
}

function bind(row) {
  const sku = row.productCode;
  if (!/^[A-Z0-9]{6,10}-\d{3}$/.test(sku ?? '') || !row.copy?.title?.trim() || !row.displayColors?.colorDescription?.trim()) throw Error('Missing SKU/title/color binding');
  const url = new URL(row.pdpUrl?.url);
  if (url.origin !== 'https://www.nike.com' || url.username || url.password || url.search || url.hash ||
      !(url.pathname.startsWith('/t/') || url.pathname === `/launch/r/${sku}`) || url.pathname.split('/').at(-1) !== sku) throw Error(`SKU/product URL mismatch: ${sku}`);
  const image = row.colorwayImages?.squarishURL || row.colorwayImages?.portraitURL;
  const img = new URL(image);
  if (img.origin !== 'https://static.nike.com' || img.username || img.password || img.hash || !img.pathname.startsWith('/a/images/')) throw Error(`Unofficial own-variant image: ${sku}`);
  if (!row.globalProductId || !row.merchProductId) throw Error(`Missing product identity: ${sku}`);
  return {sku, url: url.href, image: img.href, color: row.displayColors.colorDescription};
}

function identity(row) {
  const b = bind(row);
  return JSON.stringify([b, row.globalProductId, row.merchProductId, row.copy.title]);
}

function productRecord(entry, adultEntry, brand, at) {
  const {row, page, pointer} = entry, {sku: style, url, image, color} = bind(row);
  // Explicit API contract for core/UI gates. This is a verified JSON variant,
  // not the legacy HTML-listing method or a product-page read. Preserve this
  // field when cleaning evidence in curation; sourceApiUrl and canonicalUrl
  // intentionally differ. Consumers must cross-check ALL bound variant fields.
  const apiVariant = {version: 1, verified: true, brand, style, productUrl: url, imageUrl: image, colorway: color,
    sourceApiUrl: page.url, canonicalUrl: page.sourceUrl, contentHash: page.contentHash,
    jsonPointer: pointer, payloadPointer: page.transport === 'nike-com/products/search' ? '/data/alexandria/0/data' : '',
    transport: page.transport, globalProductId: row.globalProductId, merchProductId: row.merchProductId,
    paginationComplete: true, verifiedAt: at};
  const proof = {verified: true, brand, style, verifiedAt: at, verificationMethod: 'official-new-category-json-variant',
    contentHash: page.contentHash, sourceUrl: page.url, categoryUrl: page.sourceUrl, transport: page.transport,
    jsonPointer: pointer, payloadPointer: page.transport === 'nike-com/products/search' ? '/data/alexandria/0/data' : '',
    provenance: page.provenance, globalProductId: row.globalProductId, merchProductId: row.merchProductId, apiVariant};
  const scopeEvidence = {verified: true, style, audience: 'adult', url: adultEntry.page.sourceUrl, sourceUrl: adultEntry.page.url,
    contentHash: adultEntry.page.contentHash, jsonPointer: adultEntry.pointer, transport: adultEntry.page.transport, verifiedAt: at};
  return {id: `${brand.toLowerCase()}-new-${style}`, brand, name: row.copy.title, style, manufacturerStyle: style,
    url, image, sourceImageUrl: image, colorway: color, colors: [], category: 'sneaker', productType: 'sneaker', audience: 'adult',
    officialCategory: row.copy.subTitle, description: `${row.copy.title} — ${row.copy.subTitle}`, country: 'US',
    priceLabel: Number.isFinite(row.prices?.currentPrice) ? `${row.prices.currency} ${row.prices.currentPrice}` : '',
    firstSeen: at, productVerifiedAt: at, productEvidenceUrl: page.url,
    arrivalEvidence: {...proof, kind: 'new-arrivals-listing', url: page.sourceUrl, productUrl: url, excerpt: row.copy.title},
    officialProductEvidence: {...proof, url, scopeEvidence}, officialImageEvidence: {...proof, url: image},
    scopeEvidence,
    // isNewUntil is a badge expiry, NOT a release date. No releaseDate is inferred.
    sourceSignals: [],
  };
}

/** Reference contract for the explicit core/UI extension (no core gates changed).
 * A consumer should retain its existing identity/date/arrival checks, use this
 * alternative to the legacy listing source test, and preserve apiVariant plus
 * sourceUrl/categoryUrl/jsonPointer/payloadPointer/transport/provenance in its
 * cleaned evidence. This validates bindings, not a fresh network read.
 */
export function hasBoundNikeApiVariant(product) {
  try {
    const p = product.officialProductEvidence, i = product.officialImageEvidence, a = product.arrivalEvidence, v = p?.apiVariant;
    if (!v || v.version !== 1 || v.verified !== true || v.paginationComplete !== true ||
        !Object.hasOwn(NIKE_NEW_SOURCES, product.brand) || v.brand !== product.brand || v.style !== product.style ||
        v.productUrl !== product.url || v.imageUrl !== product.image || v.colorway !== product.colorway ||
        !v.globalProductId || !v.merchProductId || !/^[a-f0-9]{64}$/.test(v.contentHash) ||
        v.canonicalUrl !== NIKE_NEW_SOURCES[product.brand] || a?.url !== v.canonicalUrl ||
        a.kind !== 'new-arrivals-listing' || a.productUrl !== product.url || product.productEvidenceUrl !== v.sourceApiUrl) return false;
    apiRequest(v.sourceApiUrl, v.canonicalUrl);
    const provider = v.transport === 'nike-com/products/search';
    if ((!provider && v.transport !== 'official-public-json-api') ||
        v.payloadPointer !== (provider ? '/data/alexandria/0/data' : '') ||
        !(provider ? /^\/groups\/\d+\/variants\/\d+$/ : /^\/productGroupings\/\d+\/products\/\d+$/).test(v.jsonPointer)) return false;
    for (const e of [p, i, a]) {
      if (e?.verified !== true || e.verificationMethod !== 'official-new-category-json-variant' ||
          e.brand !== product.brand || e.style !== product.style || e.verifiedAt !== v.verifiedAt ||
          e.contentHash !== v.contentHash || e.sourceUrl !== v.sourceApiUrl || e.categoryUrl !== v.canonicalUrl ||
          e.transport !== v.transport || e.jsonPointer !== v.jsonPointer || e.payloadPointer !== v.payloadPointer ||
          e.globalProductId !== v.globalProductId || e.merchProductId !== v.merchProductId ||
          JSON.stringify(e.apiVariant) !== JSON.stringify(v)) return false;
    }
    return p.url === product.url && i.url === product.image;
  } catch { return false; }
}

/** No disk/canonical writes. Returns integration-ready products + diagnostics and
 * per-source raw SKU inventories. All requested root and adult scopes must finish;
 * any failed/repeated/truncated/drifting pagination returns NO publishable rows.
 * Nike's root includes Jordan: fully enumerated Jordan membership partitions them
 * even when a Jordan title says Luka/Tatum/Zion rather than 'Jordan'.
 */
export async function collectNikeOfficialNew({read = readNikeOfficialJson, readProduct = read, brands = ['Nike', 'Jordan'], now = new Date(),
  maxPages = 100, count = 100, minIntervalMs = 250, wait = sleep, onProgress, onCheckpoint} = {}) {
  if (!Array.isArray(brands) || !brands.length || new Set(brands).size !== brands.length || brands.some(b => !Object.hasOwn(NIKE_NEW_SOURCES, b)) ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000 || ![24, 50, 100].includes(count) ||
      !Number.isFinite(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 60000) throw Error('Invalid Nike collection options');
  const at = now.toISOString(), inventories = [], pages = [], excluded = [], diagnostics = [];
  let reads = 0, failure;
  const roots = [...new Set([...brands.map(b => NIKE_NEW_SOURCES[b]), NIKE_NEW_SOURCES.Jordan, ...NIKE_ADULT_NEW_SOURCES])];
  for (const sourceUrl of roots) {
    const inventory = {sourceUrl, rows: [], pages: [], exhausted: false, error: ''}, seenPages = new Set();
    let next = nikeNewApiUrl(sourceUrl, {count}), total, groups = 0;
    inventories.push(inventory);
    while (next) {
      let page;
      try {
        if (inventory.pages.length >= maxPages) throw Error('Page limit reached: exhaustion unproven');
        if (reads++) await wait(minIntervalMs);
        page = parseNikeOfficialNewPage(await read(next, {sourceUrl}), next, {sourceUrl});
        if (total !== undefined && page.total !== total) throw Error('Wall total changed during pagination');
        if (page.anchor !== groups) throw Error('Wall offset gap');
        const fingerprint = digest(JSON.stringify(page.rows.map(({row}) => [row.productCode, row.globalProductId])));
        if (seenPages.has(fingerprint)) throw Error('Repeated wall page: exhaustion unproven');
        seenPages.add(fingerprint); total = page.total; groups += page.groupCount;
      } catch (error) { failure = error; inventory.error = error.message; break; }
      inventory.pages.push(page); pages.push(page);
      inventory.rows.push(...page.rows.map(entry => ({...entry, page})));
      next = page.next;
      inventory.exhausted = !next && groups === total;
      await onProgress?.({type: 'page', sourceUrl, pages: inventory.pages.length, groups, total, exhausted: inventory.exhausted});
      // A checkpoint is diagnostic; it never claims partially enumerated rows verified.
      await onCheckpoint?.(structuredClone({sourceUrl, pages: inventory.pages.length, groups, total, exhausted: inventory.exhausted}));
    }
    diagnostics.push({sourceUrl, pages: inventory.pages.length, groups, total, exhausted: inventory.exhausted, error: inventory.error});
    if (failure) break;
  }
  let products = [];
  if (!failure) {
    try {
      const index = inventory => {
        const result = new Map();
        for (const entry of inventory.rows) {
          const reason = excludedReason(entry.row);
          if (reason) { excluded.push({sourceUrl: inventory.sourceUrl, style: entry.row.productCode, reason}); continue; }
          const key = identity(entry.row), previous = result.get(entry.row.productCode);
          if (previous && identity(previous.row) !== key) throw Error(`Conflicting SKU variant: ${entry.row.productCode}`);
          result.set(entry.row.productCode, entry);
        }
        return result;
      };
      const maps = new Map(inventories.map(inventory => [inventory.sourceUrl, index(inventory)]));
      const adults = new Map();
      for (const sourceUrl of NIKE_ADULT_NEW_SOURCES) for (const [sku, entry] of maps.get(sourceUrl)) {
        if (adults.has(sku) && identity(adults.get(sku).row) !== identity(entry.row)) throw Error(`Adult scope SKU mismatch: ${sku}`);
        adults.set(sku, entry);
      }
      const jordan = maps.get(NIKE_NEW_SOURCES.Jordan);
      // Exact-SKU fallback resolves adult rows that the wall's gender facets omit.
      const fallback = new Map();
      for (const brand of brands) for (const [sku, entry] of maps.get(NIKE_NEW_SOURCES[brand])) {
        if (adults.has(sku) || fallback.has(sku) || (brand === 'Nike' && jordan.has(sku))) continue;
        if (reads++) await wait(minIntervalMs);
        const evidence = parseNikeAdultProductEvidence(await readProduct(nikeAdultProductUrl(sku), {style: sku}), entry.row, {now});
        fallback.set(sku, evidence);
        if (evidence.adult) adults.set(sku, {...evidence, row: entry.row});
      }
      for (const brand of brands) for (const [sku, entry] of maps.get(NIKE_NEW_SOURCES[brand])) {
        if (brand === 'Nike' && jordan.has(sku)) continue;
        const adult = adults.get(sku);
        if (!adult) { excluded.push({sourceUrl: entry.page.sourceUrl, style: sku, reason: 'adult-membership-unproven'}); continue; }
        if (identity(entry.row) !== identity(adult.row)) throw Error(`Root/adult variant binding mismatch: ${sku}`);
        products.push(productRecord(entry, adult, brand, at));
      }
    } catch (error) { failure = error; products = []; }
  }
  return {products, excluded, diagnostics, exhausted: !failure && inventories.every(i => i.exhausted),
    error: failure?.message ?? '', pages, inventories, observedAt: at};
}

// Standalone reader prints JSON to stdout; integration/persistence remains caller-owned.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await collectNikeOfficialNew();
  console.log(JSON.stringify({...result, pages: result.pages.map(({rows, ...page}) => page),
    inventories: result.inventories.map(({rows, pages, ...inventory}) => ({...inventory, variants: rows.length}))}, null, 2));
  if (!result.exhausted) process.exitCode = 1;
}
