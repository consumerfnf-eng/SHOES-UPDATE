import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {shopifyRows} from './assemble-official-expansion.mjs';
import {isSiteBrandAllowed} from '../public/assets/site-brand-policy.mjs';
import {kstDay} from './curation.mjs';
import {normalizeShopifyFeedBody} from './shopify-feed-body.mjs';

async function defaultRead(url) {
  const r = await fetch(url, {signal: AbortSignal.timeout(25000), headers: {Accept: 'application/json', 'User-Agent': 'Mozilla/5.0'}});
  return {body: await r.text(), url: r.url, status: r.status, headers: r.headers};
}

function retryDelay(error, attempt, {retryBaseMs, maxRetryDelayMs, clock}) {
  const headers = error.headers;
  const raw = error.retryAfter ?? headers?.get?.('retry-after') ?? Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
  let delay = retryBaseMs * 2 ** attempt;
  if (raw !== undefined && raw !== null) {
    const seconds = Number(raw);
    const parsed = String(raw).trim() !== '' && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(raw) - clock();
    if (Number.isFinite(parsed)) delay = Math.max(delay, parsed, 0);
  }
  // Never shorten Retry-After to fit the budget: fail closed instead.
  return Number.isFinite(delay) && delay <= maxRetryDelayMs ? delay : null;
}

/** read(url, {source,page,attempt}) returns text, {body,url,status,headers?},
 * or Firecrawl {success,data:{html|markdown,metadata:{sourceURL,statusCode}}}.
 * onProgress(event) and onCheckpoint(feed) are awaited. Checkpoints are detached
 * snapshots after each accepted page and at completion/failure. No file writes.
 */
export async function readShopifyInventory(source, {
  read = defaultRead, maxPages = 100, maxRetries = 2, retryBaseMs = 1000,
  maxRetryDelayMs = 60000, wait = sleep, clock = Date.now,
  pageSize = source.pageSize ?? 250,
  onProgress, onCheckpoint, schedule = task => task(),
} = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10 || !Number.isFinite(retryBaseMs) || retryBaseMs < 0 || !Number.isFinite(maxRetryDelayMs) || maxRetryDelayMs < 0 || maxRetryDelayMs > 2147483647) throw Error('Invalid inventory limits');
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>250)throw Error('Invalid inventory page size');
  const products = [], pages = [], seen = new Set();
  let exhausted = false, error = '';
  const snapshot = () => structuredClone({...source, products, pages, exhausted, error});
  for (let page = 1; page <= maxPages; page++) {
    const url = source.root.replace(/\/$/, '') + `/products.json?limit=${pageSize}&page=${page}`;
    // Callback errors propagate; they must not become ordinary feed diagnostics.
    const outcome = await schedule(async () => {
      for (let attempt = 0; ; attempt++) {
        let failure;
        try { return {normalized: normalizeShopifyFeedBody(await read(url, {source, page, attempt}), url)}; }
        catch (cause) { failure = cause; }
        const rateLimited = Number(failure?.status ?? failure?.statusCode) === 429 || /^HTTP 429\b/.test(failure?.message ?? '');
        const delayMs = rateLimited && attempt < maxRetries ? retryDelay(failure, attempt, {retryBaseMs, maxRetryDelayMs, clock}) : null;
        if (delayMs === null) return {error: failure?.message || String(failure)};
        await onProgress?.({type: 'retry', source: {...source}, url, page, attempt: attempt + 1, delayMs, status: 429});
        await wait(delayMs);
      }
    });
    if (outcome.error) { error = outcome.error; break; }
    const normalized = outcome.normalized;
    const ids = normalized.value.products.map(p => String(p.id));
    if (new Set(ids).size !== ids.length || ids.some(id => seen.has(id))) { error = 'Repeated product/page: exhaustion unproven'; break; }
    pages.push({url, status: 200, products: ids.length, hash: createHash('sha256').update(normalized.raw).digest('hex'), format: normalized.format});
    products.push(...normalized.value.products);
    ids.forEach(id => seen.add(id));
    if (!ids.length) exhausted = true;
    await onProgress?.({type: 'page', source: {...source}, url, page, products: ids.length, totalProducts: products.length, exhausted});
    await onCheckpoint?.(snapshot());
    if (exhausted) break;
  }
  if (!exhausted && !error) error = 'Page limit reached: exhaustion unproven';
  await onCheckpoint?.(snapshot());
  await onProgress?.({type: 'source-complete', source: {...source}, exhausted, error, pages: pages.length, products: products.length});
  return snapshot();
}

/** Endpoint reads, retries and cooldowns are serialized per invocation even
 * with concurrent source workers. Separate collectors sharing a quota should
 * receive the same caller-owned schedule(task) function.
 */
export async function collectOfficialInventory({now = new Date(), sources, concurrency = 1, minIntervalMs = 250, ...options} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isFinite(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 2147483647) throw Error('Invalid collection pacing');
  sources ??= JSON.parse(await fs.readFile(new URL('../config/official-inventory-sources.json', import.meta.url), 'utf8')).sources;
  const products = [], diagnostics = [];
  let next = 0, queue = Promise.resolve();
  const wait = options.wait ?? sleep;
  const schedule = options.schedule ?? (task => {
    const result = queue.then(task);
    queue = result.then(() => wait(minIntervalMs), () => wait(minIntervalMs));
    return result;
  });
  await Promise.all(Array.from({length: Math.min(concurrency, sources.length)}, async () => {
    while (next < sources.length) {
      const source = sources[next++];
      if (source.brand !== 'Toga' && !isSiteBrandAllowed(source.brand)) continue;
      await options.onProgress?.({type: 'source-start', source: {...source}});
      const feed = await readShopifyInventory(source, {...options, schedule});
      const result = shopifyRows(source, {...feed,root:source.productRoot||feed.root}, {at: now.toISOString(), today: kstDay(now)});
      products.push(...result.products);
      diagnostics.push({brand: source.brand, adapter: 'official-shopify-inventory', exhausted: feed.exhausted, error: feed.error, pages: feed.pages.length, feedProducts: feed.products.length, verified: result.products.length, excluded: result.excluded.length});
    }
  }));
  await queue;
  return {products, diagnostics};
}
