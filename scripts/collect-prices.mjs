// Read the price off the brand's own product page for every published shoe
// that has none.
//
// 567 of 908 published products carried no price, and nothing in the stored
// source could recover them: only four records had a price anywhere in their
// text. The price is on the page, though - almost every storefront publishes
// schema.org Product/Offer markup for Google Shopping, and the ones that do
// not still carry the Open Graph product:price:amount pair. Both are read
// here, in that order, and nothing is inferred: a page that states no price
// leaves the record without one rather than taking a number off the markup
// that happens to look like money.
//
// What is read goes into data/price-cache.json keyed by the product URL, and
// into data/catalog-source.json so that re-curating republishes with it. The
// cache means a second run only asks the pages that are still missing.
import {readJson, atomicJson} from './publish-curated.mjs';

const root = new URL('../', import.meta.url);
const CONCURRENCY = 6;
const TIMEOUT_MS = 20000;
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};
const SYMBOL = {KRW: '원', USD: '$', EUR: '€', GBP: '£', JPY: '¥'};

export function formatPrice(amount, currency) {
  const value = Number(String(amount).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(value) || value <= 0) return '';
  const code = String(currency || '').toUpperCase();
  // A price in won is written after the number, every other currency before
  // it, and a currency this catalogue has not seen is written as its own code
  // rather than guessed at.
  if (code === 'KRW' || code === 'JPY') {
    const rounded = Math.round(value);
    return code === 'KRW' ? `${rounded.toLocaleString('ko-KR')}원` : `¥${rounded.toLocaleString('ja-JP')}`;
  }
  const shown = value % 1 === 0 ? value.toLocaleString('en-US') : value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  return SYMBOL[code] ? `${SYMBOL[code]}${shown}` : code ? `${code} ${shown}` : '';
}

function fromJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of blocks) {
    let parsed;
    try { parsed = JSON.parse(body.trim().replace(/^﻿/, '')); } catch { continue; }
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      for (const key of ['@graph', 'itemListElement', 'mainEntity', 'hasVariant']) {
        const nested = node[key];
        if (Array.isArray(nested)) queue.push(...nested);
        else if (nested && typeof nested === 'object') queue.push(nested);
      }
      const offers = node.offers ?? node.Offers;
      for (const offer of (Array.isArray(offers) ? offers : offers ? [offers] : [])) {
        if (!offer || typeof offer !== 'object') continue;
        if (Array.isArray(offer.offers)) queue.push(...offer.offers);
        const amount = offer.price ?? offer.lowPrice ?? offer.highPrice
          ?? offer.priceSpecification?.price ?? offer.priceSpecification?.minPrice;
        const currency = offer.priceCurrency ?? offer.priceSpecification?.priceCurrency;
        const label = formatPrice(amount, currency);
        if (label) return {label, basis: 'schema.org Product/Offer'};
      }
    }
  }
  return null;
}

// The same page states the colourway in its Product markup, and 286 published
// records have none. It costs nothing to read both while the page is open.
function colorFromJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of blocks) {
    let parsed;
    try { parsed = JSON.parse(body.trim().replace(/^﻿/, '')); } catch { continue; }
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      for (const key of ['@graph', 'mainEntity', 'hasVariant', 'itemListElement']) {
        const nested = node[key];
        if (Array.isArray(nested)) queue.push(...nested);
        else if (nested && typeof nested === 'object') queue.push(nested);
      }
      const color = typeof node.color === 'string' ? node.color.trim() : '';
      // A colour, not a sentence or a code: "Black/White" and "실버" qualify,
      // "AJ1-OG-2026" and a paragraph do not.
      if (color && color.length <= 40 && /^[\p{L}][\p{L}\s/&'-]*$/u.test(color)) return color;
    }
  }
  return '';
}

function fromMetaTags(html) {
  const meta = name => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i'))?.[1];
  const amount = meta('product:price:amount') || meta('og:price:amount') || meta('twitter:data1');
  const currency = meta('product:price:currency') || meta('og:price:currency') || meta('twitter:label1');
  const label = formatPrice(amount, currency);
  return label ? {label, basis: 'Open Graph product price'} : null;
}

async function readPrice(url) {
  let response;
  try {
    response = await fetch(url, {headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS)});
  } catch (error) {
    return {error: error.name === 'TimeoutError' ? 'timeout' : 'network'};
  }
  if (!response.ok) return {error: `http-${response.status}`};
  let html;
  try { html = await response.text(); } catch { return {error: 'body'}; }
  const found = fromJsonLd(html) || fromMetaTags(html);
  const color = colorFromJsonLd(html);
  const checkedAt = new Date().toISOString();
  if (found) return {...found, color, checkedAt};
  return color ? {color, checkedAt, error: 'no-price-on-page'} : {error: 'no-price-on-page'};
}

async function run() {
  const catalog = await readJson(new URL('public/data/catalog.json', root));
  const source = await readJson(new URL('data/catalog-source.json', root));
  const items = Array.isArray(source) ? source : source.products || [];
  const cache = await readJson(new URL('data/price-cache.json', root), {schemaVersion: 1, prices: {}, misses: {}});
  const byUrl = new Map(items.map(item => [item.url, item]));

  cache.colors ??= {};
  const needsPrice = p => !p.priceLabel && !cache.prices[p.url] && !cache.misses?.[p.url];
  const needsColor = p => !p.colorway && !cache.colors[p.url] && !cache.misses?.[p.url];
  const wanted = catalog.products.filter(p => p.url && (needsPrice(p) || needsColor(p)));
  const stats = {asked: 0, read: 0, colored: 0, failed: {}};
  let cursor = 0;
  await Promise.all(Array.from({length: Math.min(CONCURRENCY, wanted.length)}, async () => {
    while (cursor < wanted.length) {
      const product = wanted[cursor++];
      stats.asked++;
      const result = await readPrice(product.url);
      if (result.label) {
        cache.prices[product.url] = {priceLabel: result.label, basis: result.basis, checkedAt: result.checkedAt};
        stats.read++;
      }
      if (result.color) {
        cache.colors[product.url] = {colorway: result.color, basis: 'schema.org Product colour', checkedAt: result.checkedAt};
        stats.colored++;
      }
      if (!result.label && !result.color) {
        cache.misses[product.url] = {reason: result.error, checkedAt: new Date().toISOString()};
        stats.failed[result.error] = (stats.failed[result.error] || 0) + 1;
      }
    }
  }));

  // Write every known price back into the stored source, so re-curation
  // publishes it. A price the source already states is never overwritten.
  let applied = 0, coloured = 0;
  for (const [url, entry] of Object.entries(cache.prices)) {
    const item = byUrl.get(url);
    if (!item || item.priceLabel) continue;
    item.priceLabel = entry.priceLabel;
    applied++;
  }
  for (const [url, entry] of Object.entries(cache.colors)) {
    const item = byUrl.get(url);
    if (!item || item.colorway) continue;
    item.colorway = entry.colorway;
    coloured++;
  }
  cache.checkedAt = new Date().toISOString();
  await atomicJson(new URL('data/price-cache.json', root), cache);
  if (applied || coloured) await atomicJson(new URL('data/catalog-source.json', root), source);
  console.log(`read ${stats.asked} pages: ${stats.read} prices and ${stats.colored} colours; ` +
    `applied ${applied} prices and ${coloured} colours to the stored source` +
    (Object.keys(stats.failed).length ? ` · unanswered ${JSON.stringify(stats.failed)}` : ''));
}

if (process.argv[1]?.endsWith('collect-prices.mjs')) await run();
