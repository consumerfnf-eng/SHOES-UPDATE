import {createHash} from 'node:crypto';
import {canonicalBrand, classifyFootwear, officialHybridReview, curateProduct, officialEvidenceFor, kstDay} from './curation.mjs';
import {productPresentation} from './product-presentation.mjs';
import {officialImageUrl, officialProductUrl, sourceMatches} from '../public/assets/catalog-view.mjs';

export const UGG_NEW_SHOES_URL = 'https://www.ugg.com/new-arrivals/?prefn1=type&prefv1=shoes';
export const UGG_BROWSER_TRANSPORT = 'chrome-rendered-main-dom';
export const UGG_BROWSER_EXTRACTION = 'DOM markup; scripts, SVG, templates, iframe content and nonessential attributes omitted';
const ORIGIN = 'https://www.ugg.com';
const UPDATE = '/on/demandware.store/Sites-UGG-US-Site/en_US/Search-UpdateGrid';
const sha = text => createHash('sha256').update(text).digest('hex');
const decode = text => String(text ?? '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, token) => {
  if (token[0] === '#') {const n = token[1].toLowerCase() === 'x' ? parseInt(token.slice(2), 16) : Number(token.slice(1)); return n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;}
  return {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' '}[token.toLowerCase()];
});
const cls = (node, name) => (node.a.class ?? '').split(/\s+/).includes(name);
const text = node => node ? node.children.map(n => typeof n === 'string' ? n : text(n)).join(' ').replace(/\s+/g, ' ').trim() : '';
const children = (node, predicate) => node.children.filter(n => typeof n !== 'string').flatMap(n => [...(predicate(n) ? [n] : []), ...children(n, predicate)]);
const within = (node, ancestor) => {for (let n = node; n; n = n.parent) if (n === ancestor) return true; return false;};
function hidden(node) {
  return !!node && (Object.hasOwn(node.a, 'hidden') || node.a['aria-hidden'] === 'true' || /(?:^|\s)(?:d-none|displaynone)(?:\s|$)/.test(node.a.class ?? '') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.a.style ?? '') || hidden(node.parent));
}
function dom(html) {
  const root = {tag: 'root', a: {}, children: []}, stack = [root];
  for (const m of html.replace(/<!--[\s\S]*?-->|<(script|style|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, '').matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
    const token = m[0];
    if (!token.startsWith('<')) {stack.at(-1).children.push(decode(token)); continue;}
    const tag = token.match(/^<\/?([\w-]+)/)[1].toLowerCase();
    if (token.startsWith('</')) {const i = stack.findLastIndex(n => n.tag === tag); if (i > 0) {stack[i].closed = true; stack.length = i;} continue;}
    const a = {};
    for (const [, key, dq, sq, bare] of token.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[key.toLowerCase()] = decode(dq ?? sq ?? bare);
    if (/\shidden(?:\s|>|=)/i.test(token)) a.hidden = '';
    const node = {tag, a, parent: stack.at(-1), children: []}; stack.at(-1).children.push(node);
    if (!/^(?:img|input|source|meta|link|br|hr|area|base|embed|wbr)$/.test(tag) && !token.endsWith('/>')) stack.push(node); else node.closed = true;
  }
  return root;
}
function key(value) {const u = new URL(value); u.searchParams.sort(); return u.href;}
function sourceUrl(value) {
  const u = new URL(value);
  if (u.origin !== ORIGIN || u.username || u.password || u.hash) throw Error('UGG unofficial source URL');
  const continuation = u.pathname === UPDATE;
  const keys = continuation ? ['cgid', 'prefn1', 'prefv1', 'start', 'sz'] : ['prefn1', 'prefv1'];
  if ((!continuation && u.pathname !== '/new-arrivals/') || [...u.searchParams.keys()].some(k => !keys.includes(k)) || keys.some(k => u.searchParams.getAll(k).length !== 1) ||
      u.searchParams.get('prefn1') !== 'type' || u.searchParams.get('prefv1') !== 'shoes' || (continuation && u.searchParams.get('cgid') !== 'new-arrivals')) throw Error('UGG exact New + Product Type Shoes source required');
  const start = continuation ? Number(u.searchParams.get('start')) : 0;
  const size = continuation ? Number(u.searchParams.get('sz')) : null;
  if (continuation && (!/^\d+$/.test(u.searchParams.get('start')) || !/^[1-9]\d*$/.test(u.searchParams.get('sz')) || !Number.isSafeInteger(start) || start < 1 || size > 100)) throw Error('UGG invalid observed continuation offset/size');
  return {url: u.href, start, size, continuation};
}
function receipt(record, requestedUrl, {now, maxAgeMs, parentUrl, detail = false}) {
  const source = detail ? identity(requestedUrl) : sourceUrl(requestedUrl);
  if (!record || typeof record !== 'object' || record.brand !== 'UGG' || key(record.url) !== key(requestedUrl)) throw Error('UGG receipt brand/URL mismatch');
  const at = Date.parse(record.checkedAt), age = now.getTime() - at;
  if (!Number.isFinite(at) || age < 0 || age > maxAgeMs) throw Error('UGG receipt timestamp missing/future/stale');
  if (typeof record.html !== 'string' || !record.html.trim() || Buffer.byteLength(record.html) > 4_000_000) throw Error('UGG source DOM missing/oversized');
  if (record.transport === UGG_BROWSER_TRANSPORT) {
    if (record.extraction !== UGG_BROWSER_EXTRACTION || /<(?:script|svg|template|iframe)\b/i.test(record.html)) throw Error('UGG browser extraction contract mismatch');
    if (record.status !== undefined || record.statusCode !== undefined || record.metadata?.statusCode !== undefined) throw Error('UGG browser receipt cannot assert HTTP status');
    if (source.continuation && (!record.parentUrl || key(record.parentUrl) !== key(parentUrl))) throw Error('UGG browser continuation parent URL mismatch');
  } else if (record.transport === 'official-http-html') {
    if (record.status !== 200 || record.extraction !== 'original-http-response-body') throw Error(`UGG official HTTP ${record.status ?? 'unknown'}`);
  } else throw Error('UGG unsupported receipt transport');
  if (/\b(?:access denied|just a moment|verify (?:that )?you are human|captcha challenge)\b/i.test(record.html.slice(0,4000))) throw Error('UGG blocked/challenge source');
  return {...source, checkedAt: record.checkedAt, transport: record.transport, contentHash: sha(record.html)};
}
function identity(value) {
  const u = new URL(value, ORIGIN), match = /^\/([^/]+)\/([^/]+)\/(\d{7}[A-Z]?)\.html$/.exec(u.pathname);
  if (u.origin !== ORIGIN || u.username || u.password || u.hash || !match) throw Error('UGG own product URL invalid');
  const model = match[3], color = u.searchParams.get(`dwvar_${model}_color`);
  if (!/^[A-Z0-9]{2,12}$/.test(color ?? '') || [...u.searchParams.keys()].some(k => k !== `dwvar_${model}_color`) || u.searchParams.getAll(`dwvar_${model}_color`).length !== 1) throw Error('UGG selected SKU/color URL missing');
  return {url: u.href, model, color, style: `${model}-${color}`, category: match[1], slug: match[2]};
}
function cardRow(card) {
  if (!/^\d{12,14}$/.test(card.a['data-pid'] ?? '') || !card.closed) throw Error('UGG card selected product ID missing/truncated');
  const title = children(card, n => cls(n, 'tile-product-name'));
  if (title.length !== 1) throw Error('UGG own card title block missing/ambiguous');
  const nameLinks = children(title[0], n => n.tag === 'a' && cls(n, 'pdp-link'));
  if (nameLinks.length !== 1 || !text(nameLinks[0])) throw Error('UGG own product title/link missing');
  const bound = identity(nameLinks[0].a.href), group = children(nameLinks[0], n => cls(n, 'product-group'));
  const audience = group.length === 1 ? text(group[0]) : '';
  const name = text(nameLinks[0]).slice(audience.length).trim();
  if (!audience || !name) throw Error('UGG card audience/name missing');
  const primary = children(card, n => n.tag === 'a' && cls(n, 'image-link'));
  if (primary.length !== 1 || identity(primary[0].a.href).url !== bound.url) throw Error('UGG own primary image anchor mismatch');
  // The image container can be the primary anchor's parent.
  const container = children(card, n => cls(n, 'image-container'));
  if (container.length !== 1 || container[0].a['data-product-id'] !== card.a['data-pid'] || !within(primary[0], container[0])) throw Error('UGG primary image container SKU mismatch');
  const candidates = children(primary[0], n => n.tag === 'img' || n.tag === 'source').flatMap(n => [n.a.src, n.a.srcset].filter(Boolean)).flatMap(v => v.split(/,\s+(?=https?:)/).map(s => s.replace(/\s+\d+(?:w|x)$/, '')));
  const images = [...new Set(candidates)].filter(value => {
    try {const u = new URL(value); return u.origin === 'https://dms.deckers.com' && !u.username && !u.password && !u.hash && u.pathname.startsWith('/ugg/image/upload/') && new RegExp(`^${bound.model}-${bound.color}_[1-9]\\d*\\.(?:png|jpe?g|webp|avif)$`, 'i').test(u.pathname.split('/').at(-1));} catch {return false;}
  });
  const price = children(card, n => cls(n, 'price'))[0], sale = price && children(price, n => cls(n, 'sales'))[0];
  const amount = text(sale ?? price).match(/\$\s*([\d,]+(?:\.\d{2})?)/)?.[1];
  return {...bound, productId: card.a['data-pid'], name, audience, image: images[0] ?? '', images, priceLabel: amount ? `USD ${amount.replaceAll(',', '')}` : ''};
}

/** Parses exactly the filtered root or an observed continuation. Browser DOM
 * receipts are proof of rendered content; no HTTP 200 or hidden script claim.
 */
export function parseUggNewPage(record, requestedUrl, {now = new Date(), maxAgeMs = 86400000, parentUrl, scope, expectedOffset = 0} = {}) {
  const page = receipt(record, requestedUrl, {now, maxAgeMs, parentUrl}), root = dom(record.html);
  let area = root, total;
  if (!page.continuation) {
    const mains = children(root, n => n.tag === 'main' && n.a.id === 'main-content');
    if (mains.length !== 1 || !mains[0].closed) throw Error('UGG complete rendered main missing');
    area = mains[0];
    if (!children(area, n => n.tag === 'h1').some(n => /^New Arrivals$/i.test(text(n)))) throw Error('UGG explicit New Arrivals heading missing');
    const selected = children(area, n => n.a.id === 'producttype-shoes-selected' && children(n, c => cls(c, 'selected') && text(c) === 'Shoes').length > 0);
    if (!selected.length) throw Error('UGG observed Product Type Shoes selection missing');
    const totals = children(area, n => cls(n, 'search-results-count')).map(n => text(n).match(/^(\d+)\s+Results(?:\s*\/\s*Refine:)?$/i)?.[1]).filter(Boolean).map(Number);
    if (!totals.length || totals.some(n => n !== totals[0])) throw Error('UGG filtered source totals missing/drifting');
    total = totals[0];
    const grids = children(area, n => cls(n, 'product-grid') && !hidden(n));
    if (grids.length !== 1) throw Error('UGG filtered product grid missing/ambiguous');
    area = grids[0];
  } else {
    if (!scope || key(scope.url) !== key(UGG_NEW_SHOES_URL) || !/^[a-f0-9]{64}$/.test(scope.contentHash) || !Number.isSafeInteger(scope.total)) throw Error('UGG continuation has no verified filtered root scope');
    if (page.transport !== scope.transport || !Number.isFinite(Date.parse(scope.checkedAt)) || Date.parse(page.checkedAt) < Date.parse(scope.checkedAt)) throw Error('UGG continuation receipt batch/chronology mismatch');
    total = scope.total;
  }
  const cards = children(area, n => cls(n, 'product') && n.a['data-pid'] && !hidden(n));
  const rows = cards.map(cardRow);
  if (!Number.isSafeInteger(total) || total < 0 || total > 10000 || page.start !== expectedOffset || (!rows.length && total > page.start) || new Set(rows.map(r => r.productId)).size !== rows.length || new Set(rows.map(r => r.style)).size !== rows.length || page.start + rows.length > total ||
      page.continuation && rows.length !== Math.min(page.size, total - page.start)) throw Error('UGG repeated/incomplete/overflow filtered product page');
  const footers = children(root, n => cls(n, 'grid-footer'));
  if (footers.length !== 1 || !footers[0].closed) throw Error('UGG terminal/footer DOM missing');
  const viewed = children(footers[0], n => cls(n, 'viewed-count'));
  for (const counter of viewed) {
    const m = /^You have viewed (\d+) of (\d+) products\.$/.exec(text(counter));
    if (!m || Number(m[1]) !== page.start + rows.length || Number(m[2]) !== total) throw Error('UGG viewed counter drift');
  }
  if (!page.continuation && !viewed.length) throw Error('UGG filtered root viewed counter missing');
  const more = children(footers[0], n => cls(n, 'show-more'));
  const urls = [...new Set(more.flatMap(n => children(n, c => c.tag === 'button' && c.a['data-url']).map(c => new URL(c.a['data-url'], page.url).href)))];
  if (urls.length > 1) throw Error('UGG observed Load More ambiguous');
  const next = urls[0] ?? null, end = page.start + rows.length;
  if (next) {const target = sourceUrl(next); if (!target.continuation || target.start !== end || target.size < rows.length || end >= total) throw Error('UGG observed Load More offset/scope drift');}
  else if (end !== total) throw Error('UGG continuation missing: filtered source incomplete');
  return {...page, rows, total, next, scope: scope ?? {url: page.url, total, contentHash: page.contentHash, checkedAt: page.checkedAt, transport: page.transport}};
}

/** Optional detailCaptures use the same sanitized browser receipt contract.
 * URL must equal a selected New card, including color. Within one rendered
 * .product-detail[data-pid=<card productId or manufacturer model>], capture
 * own h1, expanded #description-info with Item No. (or own description/features), and
 * .primary-images/.product-images/.product-image-gallery/.image-carousel.
 * The gallery must render a full model-color asset; recommendations, hidden
 * text, supplied summary/approval fields and URL taxonomy cannot prove a sole.
 */
function detailProof(record, row, page, options) {
  const proof = receipt(record, row.url, {...options, detail: true});
  if (proof.transport !== UGG_BROWSER_TRANSPORT || Date.parse(proof.checkedAt) < Date.parse(page.checkedAt)) throw Error('UGG detail browser receipt/chronology mismatch');
  const root = dom(record.html);
  const areas = children(root, n => !hidden(n) && n.closed && [row.productId, row.model].includes(n.a['data-pid']) && (cls(n, 'product-detail') || cls(n, 'product')));
  if (areas.length !== 1) throw Error('UGG detail selected product ID missing/ambiguous');
  const area = areas[0];
  const ownNode = n => {for (let p = n; p && p !== area; p = p.parent) if (p.a['data-pid'] && ![row.productId, row.model].includes(p.a['data-pid']) || ['recommendations','recommendation','product-recommendations'].some(c => cls(p,c))) return false; return true;};
  const visibleText = n => hidden(n) || !ownNode(n) ? '' : n.children.map(c => typeof c === 'string' ? c : visibleText(c)).join(' ').replace(/\s+/g, ' ').trim();
  const titles = children(area, n => n.tag === 'h1' && !hidden(n) && ownNode(n));
  if (!titles.length || titles.some(n => ![row.name, `${row.audience} ${row.name}`].includes(visibleText(n)))) throw Error('UGG detail own product heading mismatch');
  const ownDetails = children(area, n => !hidden(n) && ownNode(n) && n.a.id === 'description-info');
  const descriptions = ownDetails.length ? ownDetails : children(area, n => !hidden(n) && ownNode(n) && ['product-description','description','features'].some(c => cls(n,c)));
  if (ownDetails.length > 1) throw Error('UGG detail own Details ambiguous');
  if (ownDetails.length) {
    let card = ownDetails[0].parent;
    while (card && card !== area && !cls(card, 'card')) card = card.parent;
    if (!card || card === area || !children(card, n => n.tag === 'button' && n.a['aria-expanded'] === 'true' && children(n, h => h.tag === 'h2' && visibleText(h) === 'Details').length).length) throw Error('UGG detail own Details not visibly expanded');
  }
  const description = [...new Set(descriptions.map(visibleText))].join(' ');
  if (!new RegExp(`\\bItem No\\.\\s*${row.model}\\b`).test(description)) throw Error('UGG detail manufacturer Item No mismatch');
  const galleries = children(area, n => !hidden(n) && ownNode(n) && ['primary-images','product-images','product-image-gallery','image-carousel'].some(c => cls(n,c)));
  const images = [...new Set(galleries.flatMap(g => children(g, n => !hidden(n) && ownNode(n) && (n.tag === 'img' || n.tag === 'source'))).flatMap(n => [n.a.src,n.a.srcset].filter(Boolean)).flatMap(v => v.split(/,\s*(?=https?:)/)).map(v => v.trim().replace(/\s+\d+(?:w|x)$/, '')))].filter(value => {
    try {const u = new URL(value); return u.origin === 'https://dms.deckers.com' && !u.username && !u.password && !u.hash && u.pathname.startsWith('/ugg/image/upload/') && new RegExp(`^${row.model}-${row.color}_[1-9]\\d*\\.(?:png|jpe?g|webp|avif)$`, 'i').test(u.pathname.split('/').at(-1));} catch {return false;}
  });
  if (!row.image || !images.length) throw Error('UGG detail own selected SKU gallery image missing');
  const sneaker = /\b(?:sneakers?|trainers?)\b/i;
  const sole = /\b(?:rubber|foam|EVA|SugarSole)[^.!?]{0,50}\b(?:outsole|midsole|sole)\b|\b(?:outsole|midsole|sole)\b[^.!?]{0,50}\b(?:rubber|foam|EVA|SugarSole)\b/i;
  // Some conventional Lowmel PDPs describe the closed sneaker construction
  // without using the word sneaker. Require every own construction cue together;
  // mixed, slip-on and molded forms still need explicit sneaker-base review.
  const mixed = /\b(?:ballet|mary[ -]?jane|hybrids?|clogs?|mules?|slip[ -]?on|sandals?|slides?|slippers?|loafers?|molded)\b/i.test(row.name);
  const closedConstruction = !mixed && /^(?:men-shoes-sneakers|women-casuals-sneakers)$/.test(row.category)
    && /\bupper\b/i.test(description) && /\bmesh\b/i.test(description) && /\blaces?\b/i.test(description)
    && /\bpadded collar\b/i.test(description) && /\bpadded tongue\b/i.test(description)
    && /\b(?:molded|EVA) footbed\b/i.test(description)
    && /\b(?:rubber|foam|EVA) outsole\b/i.test(description);
  if ((!sneaker.test(description) && !closedConstruction) || !sole.test(description) || /\b(?:not|no|without|inspired|inspiration|like)\b[^.!?]{0,60}\b(?:sneaker|trainer|rubber|foam|EVA|sole)/i.test(description)) throw Error('UGG detail explicit sneaker and rubber/foam sole unproven');
  return {...proof, description, image: images[0], images, constructionBasis: sneaker.test(description) ? 'explicit-sneaker-and-sole' : 'own-closed-laced-mesh-upper-cushioned-outsole'};
}

function classify(row, page, detail) {
  const own = `${row.name} ${row.audience} ${row.category} ${row.slug}`.replaceAll('-', ' ');
  const base = {brand: 'UGG', style: row.style, productId: row.productId, name: row.name, url: row.url, image: row.image, sourceUrl: page.url, contentHash: page.contentHash, checkedAt: page.checkedAt};
  if (/\b(?:kids?|children|toddlers?|baby|babies|youth|juniors?|infants?|preschool)\b/i.test(own)) return {bucket: 'excluded', value: {...base, reason: 'children'}};
  if (/\b(?:clogs?|loafers?|hikers?|hiking|boots?|sandals?|mules?|slides?|slippers?|cleats?|spikes?|wedge|ballet flat)\b/i.test(own)) return {bucket: 'excluded', value: {...base, reason: 'non-sneaker-form'}};
  if (!/^(?:Men|Women)'s$/.test(row.audience) || !detail && !/^(?:men-shoes-sneakers|women-casuals-sneakers)$/.test(row.category)) return {bucket: 'held', value: {...base, reason: 'adult-sneaker-scope-unproven'}};
  // This broad Shoes shelf and its mixed sneaker/casual PDP paths include
  // molded clogs and other forms. A generic model name alone proves no sole.
  if (!detail && !/\b(?:sneakers?|trainers?)\b/i.test(row.name)) return {bucket: 'held', value: {...base, reason: 'sneaker-construction-not-declared-in-own-card'}};
  const candidate = {brand: canonicalBrand('UGG'), name: row.name, style: row.style, url: row.url, image: row.image, officialCategory: row.name, description: detail?.description ?? row.name};
  if (detail) candidate.hybridReview = officialHybridReview(candidate, detail.description, detail.checkedAt) ?? undefined;
  const type = classifyFootwear(candidate);
  if (!['sneaker', 'hybrid'].includes(type.category)) return {bucket: 'held', value: {...base, reason: type.reason ?? 'existing-sneaker-gate-rejected'}};
  if (!row.image) return {bucket: 'held', value: {...base, reason: 'own-selected-sku-image-not-rendered'}};
  const proof = {verified: true, brand: 'UGG', style: row.style, verifiedAt: page.checkedAt, contentHash: page.contentHash, verificationMethod: 'official-new-listing-sku-image', transport: page.transport};
  const p = {...candidate, id: `ugg-new-${row.style.toLowerCase()}`, manufacturerStyle: row.model, productVariantId: row.style, selectedProductId: row.productId,
    modelGroupId: `UGG|${row.model}`, sourceImageUrl: row.image, imageCandidates: row.images.map(url => ({url, alt: row.name})),
    productType: type.category, category: type.category, audience: 'adult', gender: row.audience.startsWith('Women') ? 'Women' : 'Men', country: 'US', colorCode: row.color, colorway: '', colors: [], priceLabel: row.priceLabel,
    firstSeen: page.checkedAt, productVerifiedAt: page.checkedAt, productEvidenceUrl: page.url, sourceSignals: [],
    arrivalEvidence: {...proof, kind: 'new-arrivals-listing', url: page.url, productUrl: row.url, excerpt: `Official New Arrivals; selected Product Type Shoes; ${row.name}; ${row.style}`},
    officialProductEvidence: {...proof, url: row.url}, officialImageEvidence: {...proof, url: row.image, sourceUrl: page.url},
    sourceTileBinding: {...proof, url: row.url, image: row.image, sourceUrl: page.url},
    scopeEvidence: {verified: true, sourceUrl: page.scope.url, contentHash: page.scope.contentHash, selection: 'Product Type Shoes', transport: page.transport},
  };
  if (detail) {
    const pdpProof = {...proof, verifiedAt: detail.checkedAt, contentHash: detail.contentHash, transport: detail.transport, verificationMethod: 'official-new-arrivals-and-product-page'};
    p.productVerifiedAt = detail.checkedAt;
    p.image = detail.image;
    p.sourceImageUrl = detail.image;
    p.imageCandidates = detail.images.map(url => ({url, alt: row.name}));
    p.productEvidenceUrl = row.url;
    p.officialProductEvidence = {...pdpProof, url: row.url};
    p.officialImageEvidence = {...pdpProof, url: detail.image, sourceUrl: row.url};
    p.officialDetailEvidence = {...pdpProof, url: row.url};
    p.constructionEvidence = {...pdpProof, url: row.url, excerpt: detail.description, constructionBasis: detail.constructionBasis};
  }
  const curated = curateProduct(p, kstDay(page.checkedAt), new Date(page.checkedAt));
  const presented = curated.product && productPresentation(curated.product, {products: []});
  if (!officialEvidenceFor(p, kstDay(page.checkedAt)) || !presented || !officialProductUrl(presented, kstDay(page.checkedAt)) || !officialImageUrl(presented, kstDay(page.checkedAt)) || !sourceMatches(presented, 'brand', kstDay(page.checkedAt))) return {bucket: 'held', value: {...base, reason: curated.reason ?? 'presentation-or-client-proof-gate'}};
  return {bucket: 'products', value: p};
}

/** Ordinary HTTP capture, never labeled as browser DOM. No retries of denials. */
export async function readUggOfficial(url, {fetchImpl = fetch, now = new Date()} = {}) {
  sourceUrl(url);
  const response = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.timeout(25000), headers: {Accept: 'text/html'}});
  return {brand: 'UGG', url: response.url, checkedAt: now.toISOString(), transport: 'official-http-html', extraction: 'original-http-response-body', status: response.status, html: await response.text()};
}

/** captures: original sanitized browser receipt array (or URL -> receipt Map).
 * With no captures, try the official HTTP reader and report actual failures.
 * Verified per-card products survive partial traversal. Full brand completion
 * requires both reconciled traversal and no unresolved eligibility holds.
 */
export async function collectUggNew({captures, detailCaptures, now = new Date(), read = readUggOfficial, maxPages = 5, maxAgeMs = 86400000} = {}) {
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20 || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw Error('UGG invalid collection bounds');
  const supplied = captures instanceof Map ? [...captures.values()] : captures ?? [];
  if (!Array.isArray(supplied)) throw Error('UGG captures must be an array or Map');
  const records = new Map();
  for (const capture of supplied) {const url = sourceUrl(capture.url).url, k = key(url); if (records.has(k)) throw Error('UGG duplicate source receipt'); records.set(k, capture);}
  const details = detailCaptures instanceof Map ? [...detailCaptures.values()] : detailCaptures ?? [];
  if (!Array.isArray(details)) throw Error('UGG detailCaptures must be an array or Map');
  const detailRecords = new Map();
  for (const record of details) {const k = key(identity(record.url).url); if (detailRecords.has(k)) throw Error('UGG duplicate detail receipt'); detailRecords.set(k, record);}
  const detailSourceRecords = [], detailErrors = [];
  const products = [], excluded = [], held = [], pages = [], sourceRecords = [], errors = [], seen = new Set(), ids = new Set(), variants = new Set();
  let url = UGG_NEW_SHOES_URL, parentUrl, scope, offset = 0, reads = 0;
  while (url) {
    try {
      if (reads >= maxPages || seen.has(key(url))) throw Error('UGG page limit/repeated continuation');
      seen.add(key(url)); reads++;
      const capture = supplied.length ? records.get(key(url)) : await read(url, {now});
      if (!capture) throw Error('UGG observed continuation browser receipt missing');
      sourceRecords.push({url, record: structuredClone(capture)});
      const page = parseUggNewPage(capture, url, {now, maxAgeMs, parentUrl, scope, expectedOffset: offset});
      scope ??= page.scope;
      for (const row of page.rows) {if (ids.has(row.productId) || variants.has(row.style)) throw Error('UGG repeated selected SKU across pages'); ids.add(row.productId); variants.add(row.style);}
      for (const row of page.rows) {
        let detail;
        const record = detailRecords.get(key(row.url));
        if (record) {
          detailSourceRecords.push({url: row.url, record: structuredClone(record)});
          try {detail = detailProof(record, row, page, {now, maxAgeMs});}
          catch (cause) {detailErrors.push({brand: 'UGG', url: row.url, error: cause.message});}
        }
        const decision = classify(row, page, detail); ({products, excluded, held})[decision.bucket].push(decision.value);
      }
      offset += page.rows.length;
      pages.push({url: page.url, checkedAt: page.checkedAt, transport: page.transport, extraction: capture.extraction, contentHash: page.contentHash, offset: page.start, read: page.rows.length, total: page.total, next: page.next,
        ...(capture.transport === 'official-http-html' ? {status: capture.status} : {})});
      parentUrl = page.url; url = page.next;
    } catch (cause) {errors.push({brand: 'UGG', url, error: cause.message || String(cause)}); break;}
  }
  const classified = products.length + excluded.length + held.length;
  const traversalComplete = !errors.length && !url && !!scope && ids.size === scope.total && offset === scope.total && classified === scope.total;
  const complete = traversalComplete && !held.length;
  const at = [...pages.map(p => p.checkedAt), ...products.map(p => p.productVerifiedAt)].sort().at(-1) ?? null;
  return {brand: 'UGG', checkedAt: at, products, excluded, held, errors, pages, reads, sourceRecords, detailSourceRecords, detailErrors,
    complete, traversalComplete, exhausted: traversalComplete, exhaustive: complete,
    coverage: {brand: 'UGG', sourceUrl: UGG_NEW_SHOES_URL, status: complete ? 'complete' : 'incomplete', total: traversalComplete ? scope.total : null, reportedTotal: scope?.total ?? null,
      read: offset, classified, verified: products.length, excluded: excluded.length, held: held.length, pages: pages.length,
      exhaustive: complete, exhausted: traversalComplete, traversalComplete, classificationComplete: complete, eligibilityComplete: complete,
      scope: 'official-New-Arrivals-selected-Product-Type-Shoes', sourceSelection: scope ?? null}};
}
