import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export const LULULEMON_NEW_ROOT = 'https://shop.lululemon.com/c/whats-new-shoes/n1colrzq0cf';
export const LULULEMON_NEW_SOURCES = Object.freeze([
  LULULEMON_NEW_ROOT,
  'https://shop.lululemon.com/c/women-whats-new-shoes/n16o10zcolrzq0cf',
  'https://shop.lululemon.com/c/men-whats-new-shoes/n1colrznrqwzq0cf',
]);
const brand = 'Lululemon';
const hash = value => createHash('sha256').update(value).digest('hex');
const child = /\b(?:kids?|children|girls?|boys?|juniors?|youth|babies|toddlers?|infants?)\b/i;
const nonSneaker = /\b(?:boots?|mules?|slides?|sandals?|slippers?|cleats?|spikes?|flip[ -]?flops?|flat mate)\b/i;

function source(value) {
  const url = new URL(value);
  if (url.origin !== 'https://shop.lululemon.com' || url.username || url.password || url.hash ||
      !LULULEMON_NEW_SOURCES.some(root => new URL(root).pathname === url.pathname)) throw Error('Wrong official New footwear category');
  for (const key of url.searchParams.keys()) if (!['offset', 'page', 'pageSize'].includes(key) || url.searchParams.getAll(key).length !== 1 || !/^\d+$/.test(url.searchParams.get(key))) throw Error('Unexpected New category query');
  const [, , slug, categoryId] = url.pathname.split('/');
  return {url, slug, categoryId};
}

function productUrl(value, id) {
  const url = new URL(value, 'https://shop.lululemon.com');
  if (url.origin !== 'https://shop.lululemon.com' || url.username || url.password || url.hash ||
      !/^\/p\/[^/]+\/[a-z0-9]+$/i.test(url.pathname) || url.pathname.split('/').at(-1) !== id) throw Error('Product URL identity mismatch');
  return url;
}

function unwrap(value) {
  if (value?.structuredContent) return value.structuredContent;
  if (value?.content) {
    const block = value.content.find(c => c.type === 'text');
    if (!block) throw Error('No HTML response');
    return JSON.parse(block.text);
  }
  return value;
}

/** Ordinary public HTML request. Direct requests may return GE401001 (400) in
 * some regions. Inject Firecrawl read(url, options) or replay original captures;
 * the collector never treats a regional error or challenge as a zero inventory.
 */
export async function readLululemonNewHtml(url, {fetchImpl = fetch} = {}) {
  source(url);
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(25000), redirect: 'error', headers: {Accept: 'text/html'}});
  return {url: response.url, status: response.status, rawHtml: await response.text(), observedAt: new Date().toISOString()};
}

/** Original raw HTML hydration, not AI-extracted JSON or an API/PDP read.
 * The current category's metadata intentionally canonicalizes to the broader
 * /c/whats-new/n1q0cf. Request URL + Next route + category query + selected Shoes
 * refinement + per-product parentCategory bind the actual footwear scope.
 */
export function parseLululemonNewPage(input, requestedUrl, {now = new Date()} = {}) {
  const expected = source(requestedUrl), envelope = unwrap(input);
  if (!envelope || envelope.success === false || envelope.error || envelope.warning) throw Error('Unsuccessful source retrieval');
  const record = envelope.data ?? envelope, meta = record.metadata ?? {};
  const urls = [record.url, meta.sourceURL, meta.url].filter(v => v !== undefined);
  const statuses = [record.status, record.statusCode, meta.statusCode].filter(v => v !== undefined);
  if (!urls.length || urls.some(u => new URL(u).href !== expected.url.href)) throw Error('Source response URL mismatch');
  if (!statuses.length || statuses.some(s => s !== 200) || meta.error) throw Error(`HTTP ${statuses.find(s => s !== 200) ?? 'unknown'}: original New footwear HTML unavailable`);
  if (typeof record.rawHtml !== 'string') throw Error('Original rawHtml required; processed HTML/markdown cannot prove hydration');
  const html = record.rawHtml, title = html.match(/<title\b[^>]*>([^]*?)<\/title>/i)?.[1] ?? '';
  if (/captcha|access denied|client challenge|just a moment|pardon our interruption|verify.{0,30}human/i.test(title)) throw Error('OFFICIAL_ACCESS_CHALLENGE');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([^]*?)<\/script>/gi)].filter(m => /\bid\s*=\s*["']__NEXT_DATA__["']/i.test(m[1]));
  if (scripts.length !== 1) throw Error('Unique original hydration missing');
  const next = JSON.parse(scripts[0][2]), props = next.props?.pageProps;
  if (props?.locale !== 'en-us' || (props.statusCode != null && props.statusCode !== 200) ||
      JSON.stringify(next.query?.slug) !== JSON.stringify([expected.slug, expected.categoryId])) throw Error('Hydration route/locale mismatch');
  const queries = props.dehydratedState?.queries;
  if (!Array.isArray(queries)) throw Error('Category hydration queries missing');
  const matches = queries.map((q, index) => ({q, index})).filter(({q}) => q.queryKey?.[0] === 'catalogPageData' && q.queryKey[1] === 'cdp');
  if (matches.length !== 1) throw Error('Ambiguous category query');
  const {q, index: queryIndex} = matches[0], query = q.queryKey[2];
  if (q.state?.status !== 'success' || q.state.error || query?.hash !== expected.categoryId || query.slug !== expected.slug ||
      q.state.data?.pages?.length !== 1) throw Error('Category query binding mismatch');
  const page = q.state.data.pages[0], attributes = page.data?.attributes, relationships = page.data?.relationships;
  if (page.data?.type !== 'category-details' || !attributes || !Array.isArray(page.included) ||
      relationships?.pageData?.data?.id !== expected.categoryId || !Array.isArray(relationships.products?.data)) throw Error('Category schema mismatch');
  if (!/what['’]s new.*shoes/i.test(attributes.title ?? '') ||
      !attributes.breadcrumbs?.some(b => /^what['’]s new$/i.test(b.label) && b.path === '/c/whats-new/n1q0cf') ||
      !attributes.appliedRefinements?.some(r => r.dimensionName === 'product.categoryFacet' && r.label === 'Shoes')) throw Error('Explicit New footwear scope missing');
  const {totalCount: total, offset, limit} = attributes;
  const expectedOffset = expected.url.searchParams.has('offset') ? Number(expected.url.searchParams.get('offset')) :
    expected.url.searchParams.has('page') ? (Number(expected.url.searchParams.get('page')) - 1) * limit : 0;
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(offset) || offset < 0 || offset !== expectedOffset ||
      !Number.isInteger(limit) || limit < 1 || limit > 200 || query.offset !== offset || query.pageSize !== limit) throw Error('Category offset/count/limit mismatch');
  const refs = relationships.products.data;
  if (refs.some(r => r.type !== 'products') || new Set(refs.map(r => r.id)).size !== refs.length || refs.length !== Math.min(limit, total - offset)) throw Error('Missing/repeated product references or truncated category page');
  const pageData = page.included.filter(r => r.type === 'category-page-data' && r.id === expected.categoryId);
  if (pageData.length !== 1 || !Object.hasOwn(pageData[0].links?.related ?? {}, 'next')) throw Error('Explicit category pagination metadata missing');
  const continuation = pageData[0].links.related.next;
  if (!(continuation === null || typeof continuation === 'string') || (offset + refs.length < total ? !continuation : !!continuation)) throw Error('Category total/next contradiction');
  const nextUrl = continuation ? new URL(continuation, requestedUrl).href : null;
  if (nextUrl && source(nextUrl).url.pathname !== expected.url.pathname) throw Error('Continuation escapes New footwear category');
  const observedAt = meta.cacheState === 'hit' ? meta.cachedAt : record.observedAt ?? meta.cachedAt ?? now.toISOString();
  if (!Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > now.getTime()) throw Error('Invalid original capture timestamp');
  const contentHash = hash(html), provenance = {format: 'original-html-hydration', sourceUrl: requestedUrl, upstreamStatus: 200,
    observedAt, reportedCanonicalUrl: pageData[0].attributes?.canonicalUrl,
    ...(meta.scrapeId ? {scrapeId: meta.scrapeId} : {}), ...(meta.cacheState ? {cacheState: meta.cacheState} : {}), ...(meta.cachedAt ? {cachedAt: meta.cachedAt} : {})};
  const products = [], excluded = [];
  for (const ref of refs) {
    const resources = page.included.map((p, i) => ({p, i})).filter(({p}) => p.type === 'products' && p.id === ref.id);
    if (resources.length !== 1) throw Error('Product reference missing/ambiguous in original category');
    const {p, i: productIndex} = resources[0], a = p.attributes;
    if (!a || a.parentCategory?.id !== expected.categoryId || a.parentCategory.name !== attributes.title || !a.name) throw Error('Product New category membership mismatch');
    let reason = child.test(a.name) ? 'children' : nonSneaker.test(a.name) ? 'not-sneakers' : '';
    if (!reason && !/\b(?:men|women|unisex)\b/i.test(a.name)) reason = 'adult-audience-unproven';
    if (!reason && !/\bsneakers?\b|\b(?:running|workout|training) shoes?\b/i.test(a.name)) reason = 'athletic-sneaker-type-unproven';
    if (reason) {excluded.push({productId: p.id, name: a.name, reason}); continue;}
    if (!Array.isArray(a.styles) || !a.styles.length || !Array.isArray(a.colors) || !Array.isArray(a.skus)) throw Error('Original style/color/SKU arrays missing');
    productUrl(a.url, p.id);
    for (const [styleIndex, style] of a.styles.entries()) {
      if (!/^L[WM]\d[A-Z0-9]{4,7}$/.test(style.id ?? '') || !Array.isArray(style.colors) || !style.colors.length) throw Error('Manufacturer style identity missing');
      for (const [colorIndex, variant] of style.colors.entries()) {
        const colorToken = variant.id?.startsWith(style.id + '-') ? variant.id.slice(style.id.length + 1) : '';
        if (!/^\d{4,6}$/.test(colorToken)) throw Error('Manufacturer style-color identity mismatch');
        const colors = a.colors.filter(c => /^\d+$/.test(c.id) && Number(c.id) === Number(colorToken));
        const skus = a.skus.filter(s => s.styleId === style.id && Number(s.color?.id) === Number(colorToken));
        if (colors.length !== 1 || !colors[0].name || !skus.length || skus.some(s => !s.id || s.color?.name !== colors[0].name)) throw Error('Own color/SKU label binding missing');
        const sku = skus.find(s => s.availability?.isAvailable === true) ?? skus[0];
        if (variant.availability?.isAvailable !== true || sku.availability?.isAvailable !== true) {excluded.push({productId: p.id, style: style.id, variant: variant.id, reason: 'unavailable'}); continue;}
        // Use the observed representative SKU URL verbatim, including its size.
        // Sizes collapse by manufacturer style/color, never by guessing a PDP URL.
        const url = productUrl(sku.url, p.id);
        if (url.searchParams.getAll('color').length !== 1 || Number(url.searchParams.get('color')) !== Number(colorToken) ||
            [...url.searchParams.keys()].some(k => !['color', 'size', 'skuId', 'sz'].includes(k))) throw Error('Own product color URL mismatch');
        const images = variant.images?.map(image => image.url).filter(value => {
          try {const u = new URL(value); return u.origin === 'https://images.lululemon.com' && !u.username && !u.password && !u.hash &&
            new RegExp(`^/is/image/lululemon/${style.id}_${colorToken}_[1-9]\\d*$`).test(u.pathname);} catch {return false;}
        }) ?? [];
        if (!images.length) throw Error('Own manufacturer SKU/color shoe image missing');
        const image = images[0], pointer = `/props/pageProps/dehydratedState/queries/${queryIndex}/state/data/pages/0/included/${productIndex}/attributes/styles/${styleIndex}/colors/${colorIndex}`;
        const proof = {verified: true, brand, style: style.id, verifiedAt: observedAt, verificationMethod: 'official-new-listing-sku-image', contentHash,
          provenance, jsonPointer: pointer, productId: p.id, productVariantId: variant.id, representativeSkuId: sku.id};
        products.push({id: `lululemon-new-${variant.id.toLowerCase()}`, brand, name: a.name, style: style.id, manufacturerStyle: style.id,
          productVariantId: variant.id, officialProductId: p.id, representativeSkuId: sku.id, colorCode: colors[0].id,
          url: url.href, image, sourceImageUrl: image, colorway: colors[0].name, colors: [],
          imageCandidates: images.map(url => ({url, alt: `${a.name} — ${colors[0].name}`})),
          category: 'sneaker', productType: 'sneaker', officialCategory: a.name, audience: 'adult',
          gender: /^women/i.test(a.name) ? 'Women' : /^men/i.test(a.name) ? 'Men' : 'Unisex', country: 'US',
          description: `${a.name}. Official What's New Shoes category.`,
          priceLabel: Number.isFinite(variant.price?.listPrice) ? `${variant.price.currencyCode} ${variant.price.listPrice}` : '',
          firstSeen: observedAt, productVerifiedAt: observedAt, productEvidenceUrl: requestedUrl, sourceSignals: [],
          sourceVariantBinding: {verified: true, brand, style: style.id, productVariantId: variant.id, productId: p.id, representativeSkuId: sku.id,
            colorway: colors[0].name, url: url.href, image, sourceUrl: requestedUrl, jsonPointer: pointer, contentHash, verifiedAt: observedAt},
          arrivalEvidence: {...proof, kind: 'new-arrivals-listing', url: requestedUrl, productUrl: url.href, excerpt: attributes.title + ': ' + a.name},
          officialProductEvidence: {...proof, url: url.href}, officialImageEvidence: {...proof, url: image, sourceUrl: requestedUrl},
        });
      }
    }
  }
  if (new Set(products.map(p => p.productVariantId)).size !== products.length) throw Error('Duplicate manufacturer color variant');
  return {url: requestedUrl, total, offset, limit, modelIds: refs.map(r => r.id), products, excluded, next: nextUrl, contentHash, provenance};
}

/** Inject read(url,{formats:['rawHtml'],onlyMainContent:false,maxAge:0}) for
 * Firecrawl, or replay captures. All model references, original variants and
 * explicit terminal paging must finish before a source emits products.
 * Persistence is caller-owned; callbacks are awaited, and callback errors reject.
 */
export async function collectLululemonNew({read = readLululemonNewHtml, sources = [LULULEMON_NEW_ROOT], now = new Date(),
  maxPages = 50, minIntervalMs = 250, wait = sleep, onProgress, onCheckpoint} = {}) {
  if (!Array.isArray(sources) || !sources.length || new Set(sources).size !== sources.length || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 ||
      !Number.isFinite(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 60000) throw Error('Invalid lululemon collection limits');
  sources.forEach(source);
  const products = new Map(), coverage = [], pages = [], excluded = [];
  let reads = 0;
  for (const root of sources) {
    let next = root, total, models = 0, error = '';
    const seen = new Set(), seenUrls = new Set(), accepted = [], sourcePages = [];
    while (next) {
      let page;
      try {
        if (sourcePages.length >= maxPages || seenUrls.has(next)) throw Error('Page limit/repeated continuation: exhaustion unproven');
        seenUrls.add(next); if (reads++) await wait(minIntervalMs);
        page = parseLululemonNewPage(await read(next, {formats: ['rawHtml'], onlyMainContent: false, maxAge: 0}), next, {now});
        total ??= page.total;
        if (page.total !== total || page.offset !== models || page.modelIds.some(id => seen.has(id))) throw Error('Repeated models, total drift or pagination gap');
        page.modelIds.forEach(id => seen.add(id)); models += page.modelIds.length;
      } catch (cause) {error = cause.message; break;}
      sourcePages.push(page); pages.push(page); accepted.push(...page.products); excluded.push(...page.excluded); next = page.next;
      await onProgress?.({sourceUrl: root, pages: sourcePages.length, models, total, variants: accepted.length});
      await onCheckpoint?.(structuredClone({sourceUrl: root, pages: sourcePages.length, models, total, exhausted: !next}));
    }
    const exhausted = !error && !next && total === models;
    if (exhausted) for (const p of accepted) if (!products.has(p.productVariantId)) products.set(p.productVariantId, p);
    coverage.push({brand, adapter: 'official-lululemon-new-html-hydration', sourceUrl: root, pages: sourcePages.length, models, total,
      exhausted, exhaustive: exhausted, error, verified: exhausted ? accepted.length : 0, provenance: sourcePages.map(p => p.provenance)});
  }
  return {products: [...products.values()], coverage, pages, excluded, exhausted: coverage.every(c => c.exhausted), complete: coverage.every(c => c.exhausted), checkedAt: now.toISOString()};
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await collectLululemonNew(); console.log(JSON.stringify(result, null, 2)); if (!result.complete) process.exitCode = 1;
}
