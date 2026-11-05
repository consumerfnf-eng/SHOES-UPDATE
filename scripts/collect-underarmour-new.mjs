import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export const UNDERARMOUR_NEW_ROOT = 'https://www.underarmour.com/en-us/c/shoes/new-arrivals/';
export const UNDERARMOUR_NEW_SOURCES = Object.freeze([
  UNDERARMOUR_NEW_ROOT,
  UNDERARMOUR_NEW_ROOT + 'mens/',
  UNDERARMOUR_NEW_ROOT + 'womens-sneakers/',
]);
const brand = 'Under Armour';
const sha = value => createHash('sha256').update(value).digest('hex');
const decode = s => String(s ?? '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, entity) => {
  const e = entity.toLowerCase();
  if (e[0] === '#') {const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;}
  return {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' '}[e];
});
const text = html => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const child = /\b(?:kids?|boys?|girls?|children|grade school|pre[ -]?school|youth|juniors?|jr\.?|toddlers?|infants?|babies)\b/i;
const other = /\b(?:cleats?|spikes?|boots?|sandals?|slides?|mules?|clogs?|slippers?|flip[ -]?flops?)\b/i;

function attrs(tag) {
  const result = {};
  for (const m of tag.replace(/^<\/?[\w:-]+/, '').matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) result[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return result;
}

// Balanced source elements keep a tile's photo inside its own tile even when a
// sibling, recommendation, nav or swatch contains a plausible-looking SKU.
function elements(html) {
  const safe = html.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1>/gi, m => ' '.repeat(m.length));
  const stack = [], result = [], voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const m of safe.matchAll(/<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const tag = m[1].toLowerCase();
    if (m[0].startsWith('</')) {
      const i = stack.findLastIndex(n => n.tag === tag);
      if (i < 0) continue;
      const node = stack[i]; node.close = m.index; node.end = m.index + m[0].length; node.closed = true;
      stack.splice(i); continue;
    }
    const node = {tag, attrs: attrs(m[0]), start: m.index, open: m.index + m[0].length, parent: stack.at(-1)};
    result.push(node);
    if (voids.has(tag) || /\/>$/.test(m[0])) {node.close = node.open; node.end = node.open; node.closed = true;}
    else stack.push(node);
  }
  return result;
}

function source(value) {
  const url = new URL(value);
  if (url.origin !== 'https://www.underarmour.com' || url.username || url.password || url.hash ||
      !UNDERARMOUR_NEW_SOURCES.some(root => new URL(root).pathname === url.pathname)) throw Error('Unofficial/wrong New shoes category');
  for (const key of url.searchParams.keys()) if (!['start', 'sz', 'page'].includes(key) || url.searchParams.getAll(key).length !== 1 || !/^\d+$/.test(url.searchParams.get(key))) throw Error('Unapproved category pagination query');
  return url;
}

function productUrl(value) {
  const url = new URL(value, 'https://www.underarmour.com'), model = url.pathname.match(/^\/en-us\/p\/[^/]+\/(\d{7})\.html$/)?.[1];
  if (url.origin !== 'https://www.underarmour.com' || url.username || url.password || url.hash || !model) throw Error('Invalid official SKU product URL');
  const color = url.searchParams.get(`dwvar_${model}_color`);
  if (!/^\d{3}$/.test(color ?? '') || [...url.searchParams.keys()].some(k => k !== `dwvar_${model}_color`) || url.searchParams.getAll(`dwvar_${model}_color`).length !== 1) throw Error('Exact product color URL binding missing');
  return {url: url.href, model, color, variant: `${model}-${color}`};
}

function unwrap(record) {
  if (record?.structuredContent) return record.structuredContent;
  if (record?.content) {
    const block = record.content.find(c => c.type === 'text');
    if (!block) throw Error('Missing HTML response');
    return JSON.parse(block.text);
  }
  return record;
}

/** A single ordinary public request; no CAPTCHA solving, stealth/proxy rotation,
 * credential injection or automatic retries of denials. Firecrawl callers can
 * inject read(url,{formats:['rawHtml'],maxAge:0,onlyMainContent:false}). */
export async function readUnderArmourNewHtml(url, {fetchImpl = fetch} = {}) {
  source(url);
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(20000), redirect: 'error', headers: {Accept: 'text/html'}});
  return {url: response.url, status: response.status, rawHtml: await response.text(), observedAt: new Date().toISOString()};
}

/** Accepts original HTML, a Firecrawl rendered HTML capture, or an explicit
 * {brand,url,checkedAt,transport:'chrome-rendered-main-dom',extraction,html}
 * receipt of a complete main DOM. A browser receipt makes NO HTTP status claim.
 * Never consumes markdown or
 * AI-extracted JSON. Hashes the HTML actually inspected and records its format.
 * Cached captures retain cachedAt as verifiedAt; replay time is NOT a fresh read.
 * Only visible SKU/color/photo tuples are proved. Swatch links alone do not
 * prove an image, and this adapter never constructs a Scene7 photo URL.
 */
export function parseUnderArmourNewPage(input, requestedUrl, {now = new Date()} = {}) {
  const requested = source(requestedUrl), envelope = unwrap(input);
  if (!envelope || envelope.success === false || envelope.error || envelope.warning) throw Error('Unsuccessful HTML retrieval');
  const record = envelope.data ?? envelope, meta = record.metadata ?? {};
  const browserDOM = record.transport === 'chrome-rendered-main-dom';
  const urls = [record.url, record.requestedUrl, meta.sourceURL, meta.url].filter(v => v !== undefined);
  const statuses = [record.status, record.statusCode, meta.statusCode].filter(v => v !== undefined);
  if (!urls.length || urls.some(u => new URL(u).href !== requested.href)) throw Error('Official HTML response URL mismatch');
  if (browserDOM) {
    // The browser receipt attests rendered DOM, not an HTTP response. Do not
    // manufacture a 200 or silently consume a contradictory HTTP claim.
    if (record.brand !== brand || record.url !== requested.href || statuses.length || record.rawHtml !== undefined ||
        typeof record.checkedAt !== 'string' || typeof record.extraction !== 'string' || !/DOM markup/i.test(record.extraction)) throw Error('Invalid Chrome DOM receipt');
  } else if (!statuses.length || statuses.some(s => s !== 200)) throw Error(`HTTP ${statuses.find(s => s !== 200) ?? 'unknown'}: official HTML unavailable`);
  const html = record.rawHtml ?? record.html;
  if (typeof html !== 'string' || !html.trim()) throw Error('HTML required; markdown cannot bind product tiles');
  const title = text(html.match(/<title\b[^>]*>([^]*?)<\/title>/i)?.[1] ?? '');
  if (/captcha|access denied|client challenge|just a moment|robot|pardon our interruption|verify.{0,30}human/i.test(title) || /verify (?:that )?you are human|YOUR ACCESS.{0,100}RESTRICTED|powered and protected by.{0,80}akamai/i.test(text(html.slice(0,10000)))) throw Error('OFFICIAL_ACCESS_CHALLENGE');
  const nodes = elements(html), inside = (n, root) => n.start >= root.open && n.end <= root.close;
  if (browserDOM) {
    const roots = nodes.filter(n => !n.parent), main = roots[0];
    if (roots.length !== 1 || main.tag !== 'main' || main.attrs.id !== 'main' || !main.closed ||
        html.slice(0, main.start).trim() || html.slice(main.end).trim()) throw Error('Chrome receipt requires one complete official main DOM');
  }
  const contents = n => html.slice(n.open, n.close);
  const headings = nodes.filter(n => n.tag === 'h1' && n.closed).map(n => text(contents(n)));
  if (!headings.some(h => /new (?:releases?|arrivals?).*shoes/i.test(h))) throw Error('New shoes page heading missing');
  const counts = [...new Set(nodes.filter(n => n.tag === 'p' && n.closed).map(n => text(contents(n))).filter(t => /^\d[\d,]* Items?$/i.test(t)).map(t => Number(t.match(/^[\d,]+/)[0].replaceAll(',', ''))))];
  if (counts.length !== 1) throw Error('Explicit unique listing total missing');
  const total = counts[0], tiles = nodes.filter(n => (browserDOM
    ? n.tag === 'div' && /^product-\d{7}-\d{3}-/.test(n.attrs.id ?? '') && /__product-tile-container(?:\s|$)/.test(n.attrs.class ?? '')
    : n.attrs['data-testid'] === 'product-tile-container') && (() => {
    for (let p = n.parent; p; p = p.parent) if (/\bproducts_list\b/.test(p.attrs.class ?? '')) return true;
    return false;
  })());
  if (tiles.some(t => !t.closed) || (total > 0 && !tiles.length)) throw Error('Incomplete/missing product tiles');
  const cached = meta.cacheState === 'hit';
  const observedAt = browserDOM ? record.checkedAt : cached ? meta.cachedAt : record.observedAt ?? meta.cachedAt ?? now.toISOString();
  if (!Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > now.getTime()) throw Error('Invalid/missing original capture timestamp');
  const contentHash = sha(html), format = browserDOM ? 'chrome-rendered-main-dom' : record.rawHtml !== undefined ? 'raw-html' : 'firecrawl-rendered-html';
  const provenance = {format, sourceUrl: requested.href, ...(browserDOM ? {transport: record.transport, extraction: record.extraction} : {upstreamStatus: 200}), observedAt,
    ...(meta.scrapeId ? {scrapeId: meta.scrapeId} : {}), ...(meta.cacheState ? {cacheState: meta.cacheState} : {}), ...(meta.cachedAt ? {cachedAt: meta.cachedAt} : {})};
  const products = [], excluded = [], unresolved = [], tileIds = [];
  for (const tile of tiles) {
    const children = nodes.filter(n => inside(n, tile));
    const heading = children.find(n => n.tag === 'h3' && n.closed);
    const link = heading && children.find(n => n.tag === 'a' && inside(n, heading));
    if (!link?.attrs.href) throw Error('Original product title/URL missing');
    const bound = productUrl(link.attrs.href), name = text(contents(link));
    tileIds.push(bound.variant);
    if (!(tile.attrs.id ?? '').startsWith(`product-${bound.variant}-`)) throw Error('Tile SKU/color identity mismatch');
    const sub = children.find(n => n.tag === 'span' && /product-sub-header/.test(n.attrs.class ?? ''));
    const subtitle = sub ? text(contents(sub)) : '', words = `${name} ${subtitle} ${new URL(bound.url).pathname}`;
    let reason = child.test(words.replaceAll('_', ' ')) ? 'children' : other.test(words.replaceAll('_', ' ')) ? 'not-sneakers' : '';
    if (!reason && !/\b(?:men|women|unisex)\b/i.test(subtitle)) reason = 'adult-audience-unproven';
    if (!reason && !/\b(?:shoes?|sneakers?)\b/i.test(subtitle)) reason = 'shoe-type-unproven';
    if (!reason && /coming soon|pre[ -]?order|upcoming/i.test(text(contents(tile)))) reason = 'upcoming';
    if (reason) {excluded.push({style: bound.model, variant: bound.variant, name, reason}); continue;}
    const imageLink = children.find(n => n.tag === 'a' && /product-image-link/.test(n.attrs.class ?? ''));
    if (!imageLink || productUrl(imageLink.attrs.href).url !== bound.url) throw Error('Own tile photo link differs from product');
    const primaryImages = children.filter(n => n.tag === 'img' && inside(n, imageLink) && (browserDOM || n.attrs['data-testid'] === 'tile-image'));
    if (browserDOM && primaryImages.length !== 1) throw Error('Ambiguous/missing own Chrome tile photograph');
    const img = primaryImages[0];
    let image;
    try {image = new URL(img?.attrs.src);} catch {image = null;}
    if (!image || image.origin !== 'https://underarmour.scene7.com' || image.username || image.password || image.hash ||
        !new RegExp(`^/is/image/Underarmour/${bound.variant}_(?:DEFAULT|PAIR)$`).test(image.pathname)) {
      unresolved.push({style: bound.model, variant: bound.variant, name, reason: 'own-sku-color-shoe-photo-unproven', observedImage: img?.attrs.src ?? ''}); continue;
    }
    const swatches = children.filter(n => n.tag === 'a' && (browserDOM ? /product-color-swatch/.test(n.attrs.class ?? '') : /^View Color /i.test(n.attrs.title ?? '')));
    const colors = new Map();
    for (const swatch of swatches) {
      const b = productUrl(swatch.attrs.href), label = swatch.attrs.title?.match(/^View Color (.+)-(\d{3})$/i);
      const colorway = browserDOM ? swatch.attrs['aria-label']?.trim() : label?.[1];
      if (b.model !== bound.model || !colorway || (!browserDOM && label?.[2] !== b.color)) throw Error('Swatch SKU/color identity mismatch');
      if (colors.has(b.color) && colors.get(b.color).colorway !== colorway) throw Error('Contradictory original color labels');
      colors.set(b.color, {url: b.url, colorway});
    }
    const color = colors.get(bound.color);
    if (!color || color.url !== bound.url) throw Error('Own selected color label missing');
    const additional = [...colors].filter(([code]) => code !== bound.color).map(([colorCode, v]) => ({...v, colorCode}));
    unresolved.push(...additional.map(v => ({style: bound.model, variant: `${bound.model}-${v.colorCode}`, name,
      reason: 'swatch-only-no-own-photo', url: v.url, colorway: v.colorway})));
    const proof = {verified: true, brand, style: bound.model, verifiedAt: observedAt, verificationMethod: 'official-new-listing-sku-image', contentHash, provenance};
    const price = children.find(n => n.attrs['data-testid'] === 'price-display-sales-price') ?? children.find(n => n.attrs['data-testid'] === 'price-display-list-price');
    const imageUrl = image.href;
    products.push({id: `under-armour-new-${bound.variant}`, brand, name, style: bound.model, manufacturerStyle: bound.model,
      productVariantId: bound.variant, colorCode: bound.color, colorway: color.colorway, colors: [],
      url: bound.url, image: imageUrl, sourceImageUrl: imageUrl, imageCandidates: [{url: imageUrl, alt: img.attrs.alt ?? name}],
      category: 'sneaker', productType: 'sneaker', officialCategory: subtitle, audience: 'adult', country: 'US',
      description: `${name} — ${subtitle}`, gender: /women/i.test(subtitle) ? 'Women' : /unisex/i.test(subtitle) ? 'Unisex' : 'Men',
      priceLabel: price ? text(contents(price)) : '', firstSeen: observedAt, productVerifiedAt: observedAt, productEvidenceUrl: requested.href,
      sourceSignals: [], sourceTileBinding: {verified: true, brand, style: bound.model, productVariantId: bound.variant, colorCode: bound.color,
        url: bound.url, image: imageUrl, sourceUrl: requested.href, tileId: tile.attrs.id, contentHash, verifiedAt: observedAt},
      arrivalEvidence: {...proof, kind: 'new-arrivals-listing', url: requested.href, productUrl: bound.url, excerpt: `${name} — ${subtitle}`},
      officialProductEvidence: {...proof, url: bound.url}, officialImageEvidence: {...proof, url: imageUrl, sourceUrl: requested.href},
    });
  }
  if (new Set(tileIds).size !== tileIds.length) throw Error('Repeated product tile within page');
  const nexts = nodes.filter(n => n.tag === 'a' && /(?:^|\s)next(?:\s|$)/i.test(n.attrs.rel ?? '') && n.attrs.href).map(n => new URL(n.attrs.href, requested).href);
  if (new Set(nexts).size > 1) throw Error('Ambiguous explicit next page');
  const next = nexts[0] ?? null;
  if (next) {
    const target = source(next);
    if (target.pathname !== requested.pathname || target.href === requested.href ||
        !(Number(target.searchParams.get('start')) > Number(requested.searchParams.get('start') ?? 0) || Number(target.searchParams.get('page')) > Number(requested.searchParams.get('page') ?? 1))) throw Error('Next page escapes New scope or fails to advance');
  }
  return {url: requested.href, total, tileIds, tileCount: tiles.length, products, excluded, unresolved, next, contentHash, provenance, observedAt};
}

/** Caller-owned persistence. Each source is atomic: failures discard its rows.
 * exhausted proves traversal of displayed model tiles, NOT all color swatches.
 * complete additionally requires every source and color/photo binding to finish.
 * onProgress and onCheckpoint are awaited diagnostic callbacks (no files written).
 */
export async function collectUnderArmourNew({read = readUnderArmourNewHtml, sources = UNDERARMOUR_NEW_SOURCES,
  now = new Date(), maxPages = 50, minIntervalMs = 250, wait = sleep, onProgress, onCheckpoint} = {}) {
  if (!Array.isArray(sources) || !sources.length || new Set(sources).size !== sources.length || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 ||
      !Number.isFinite(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 60000) throw Error('Invalid Under Armour collection limits');
  sources.forEach(source);
  const products = new Map(), coverage = [], excluded = [], unresolved = [], pages = [];
  let reads = 0;
  for (const root of sources) {
    let next = root, total, error = '', count = 0;
    const seenUrls = new Set(), seenTiles = new Set(), sourceProducts = [], sourcePages = [];
    while (next) {
      let page;
      try {
        if (sourcePages.length >= maxPages) throw Error('Page limit reached: exhaustion unproven');
        if (seenUrls.has(next)) throw Error('Repeated pagination URL');
        seenUrls.add(next);
        if (reads++) await wait(minIntervalMs);
        page = parseUnderArmourNewPage(await read(next, {formats: ['rawHtml'], onlyMainContent: false, maxAge: 0}), next, {now});
        total ??= page.total;
        if (page.total !== total) throw Error('Listing total changed');
        if (page.tileIds.some(id => seenTiles.has(id))) throw Error('Repeated SKU/page: exhaustion unproven');
        const offset = Number(new URL(next).searchParams.get('start') ?? count);
        if (offset !== count) throw Error('Noncontiguous category page');
        page.tileIds.forEach(id => seenTiles.add(id)); count += page.tileCount;
        if (count > total || (!page.next && count !== total) || (page.next && count >= total)) throw Error('Explicit total/continuation contradiction');
      } catch (cause) {error = cause.message; break;}
      sourcePages.push(page); pages.push(page); sourceProducts.push(...page.products);
      excluded.push(...page.excluded); unresolved.push(...page.unresolved); next = page.next;
      await onProgress?.({sourceUrl: root, url: page.url, pages: sourcePages.length, tiles: count, total, products: sourceProducts.length});
      await onCheckpoint?.(structuredClone({sourceUrl: root, pages: sourcePages.length, tiles: count, total, exhausted: !next, error: ''}));
    }
    const exhausted = !error && !next && count === total;
    if (exhausted) for (const p of sourceProducts) {
      const old = products.get(p.productVariantId);
      if (!old || Date.parse(p.productVerifiedAt) > Date.parse(old.productVerifiedAt)) products.set(p.productVariantId, p);
    }
    coverage.push({brand, adapter: 'official-underarmour-new-html', sourceUrl: root, pages: sourcePages.length, tiles: count,
      total, exhausted, exhaustive: exhausted && sourcePages.every(p => !p.unresolved.length), error,
      provenance: sourcePages.map(p => p.provenance), verified: exhausted ? sourceProducts.length : 0});
  }
  return {products: [...products.values()], coverage, excluded, unresolved, pages,
    exhausted: coverage.every(c => c.exhausted), complete: coverage.every(c => c.exhaustive), checkedAt: now.toISOString()};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await collectUnderArmourNew();
  console.log(JSON.stringify(result, null, 2));
  if (!result.complete) process.exitCode = 1;
}
