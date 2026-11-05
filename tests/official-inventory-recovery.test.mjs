import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeShopifyFeedBody} from '../scripts/shopify-feed-body.mjs';
import {readShopifyInventory, collectOfficialInventory} from '../scripts/collect-official-inventory.mjs';
import {resolveBrand} from '../scripts/assemble-official-expansion.mjs';

const source = {brand: 'Cecilie Bahnsen', root: 'https://ceciliebahnsen.com'};
const endpoint = `${source.root}/products.json?limit=250&page=1`;
const json = JSON.stringify({products: [{id: 123, title: 'Shoe &quot; test', body_html: '<p>A &amp; B</p>', variants: [], images: []}]}).replaceAll('<', '\\u003c');
const envelope = body => ({body, url: endpoint, status: 200});
const firecrawl = fields => ({success: true, data: {...fields, metadata: {sourceURL: endpoint, statusCode: 200, contentType: 'application/json'}}});
const feedText = products => JSON.stringify({products});

test('true JSON remains byte-for-byte source text and preserves product strings', () => {
  const result = normalizeShopifyFeedBody(json, endpoint);
  assert.equal(result.text, json);
  assert.equal(result.raw, json);
  assert.equal(result.format, 'json');
  assert.equal(result.value.products[0].body_html, '<p>A &amp; B</p>');
  assert.equal(result.value.products[0].title, 'Shoe &quot; test');
});

test('Firecrawl literal body, pre and markdown preserve escaped JSON before entity decoding', () => {
  for (const fields of [
    {html: `<html><body>${json}</body></html>`},
    {html: `<html><head><meta charset="utf-8"></head><body><pre style="white-space: pre-wrap">${json}</pre></body></html>`},
    {markdown: '```json\n' + json + '\n```'},
  ]) assert.deepEqual(normalizeShopifyFeedBody(firecrawl(fields), endpoint).value, JSON.parse(json));
  // Literal HTML inside a JSON string also remains valid source JSON.
  const literal = json.replaceAll('\\u003c', '<');
  assert.deepEqual(normalizeShopifyFeedBody(envelope(`<html><body>${literal}</body></html>`), endpoint).value, JSON.parse(json));
});

test('HTML-escaped pre is decoded once only when literal JSON parsing fails', () => {
  const encoded = json.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const result = normalizeShopifyFeedBody(envelope(`<pre>${encoded}</pre>`), endpoint);
  assert.deepEqual(result.value, JSON.parse(json));
  assert.equal(result.raw, `<pre>${encoded}</pre>`);
});

test('challenge HTML, embedded snippets, truncated JSON and malformed schemas fail closed', () => {
  for (const body of [
    '<html><body><h1>Just a moment...</h1><script>challenge()</script></body></html>',
    `<html><body>Checking your browser<pre>${json}</pre></body></html>`,
    `<html><body><script type="application/json">${json}</script></body></html>`,
    'prefix ```json\n{"products":[]}\n``` suffix',
    '{"products":', '{}', '{"products":null}', '{"products":{}}',
    '{"products":[null]}', '{"products":[{}]}', '{"products":[{"id":1,"title":{}}]}',
    '{"products":[{"id":1,"variants":[null]}]}',
  ]) assert.throws(() => normalizeShopifyFeedBody(envelope(body), endpoint), /HTML|JSON|schema|identity|product/);
});

test('structured source evidence is mandatory and all supplied URLs/statuses must agree', () => {
  for (const input of [
    {body: json}, {body: json, url: endpoint}, {body: json, status: 200},
    {...envelope(json), url: endpoint.replace('page=1', 'page=2')},
    {...envelope(json), url: 'https://other.example/products.json?limit=250&page=1'},
    {...envelope(json), status: 429}, {...envelope(json), status: 403},
    {...firecrawl({html: json}), success: false},
    {...firecrawl({html: json}), status: 200, data: {html: json, metadata: {sourceURL: endpoint, statusCode: 503}}},
    {...firecrawl({html: json}), url: source.root},
    {...firecrawl({html: json}), requestedUrl: endpoint.replace('page=1', 'page=2')},
  ]) assert.throws(() => normalizeShopifyFeedBody(input, endpoint));
  assert.deepEqual(normalizeShopifyFeedBody({...envelope(json), url: `${source.root}/products.json?page=1&limit=250`}, endpoint).value, JSON.parse(json));
});

test('recovered feeds still require an empty terminal and hash exact captured body', async () => {
  const checkpoints = [], events = [];
  const result = await readShopifyInventory(source, {
    read: async url => ({body: `<html><body>${url.endsWith('page=1') ? json : feedText([])}</body></html>`, url, status: 200}),
    onProgress: async event => events.push(event),
    onCheckpoint: async feed => { checkpoints.push(structuredClone(feed)); feed.products.length = 0; },
  });
  assert.equal(result.exhausted, true);
  assert.equal(result.products.length, 1);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[1].products, 0);
  assert.equal(result.pages[0].hash, createHash('sha256').update(`<html><body>${json}</body></html>`).digest('hex'));
  assert.equal(checkpoints[0].exhausted, false);
  assert.equal(checkpoints.at(-1).exhausted, true);
  assert.deepEqual(events.map(e => e.type), ['page', 'page', 'source-complete']);
});

test('repeated products within/across recovered pages and ceilings remain incomplete', async () => {
  for (const products of [[{id: 1}], [{id: 1}, {id: 1}]]) {
    const result = await readShopifyInventory(source, {read: async () => `<pre>${feedText(products)}</pre>`});
    assert.equal(result.exhausted, false);
    assert.match(result.error, /Repeated/);
  }
  const result = await readShopifyInventory(source, {read: async () => json, maxPages: 1});
  assert.equal(result.exhausted, false);
  assert.match(result.error, /limit/);
});

test('429 retries honor Retry-After seconds and dates and retain the exact page URL', async () => {
  for (const [header, expected] of [['3', 3000], ['Thu, 05 Nov 2026 00:00:05 GMT', 5000]]) {
    let calls = 0;
    const waits = [], urls = [], events = [];
    const result = await readShopifyInventory(source, {
      read: async (url, context) => {
        urls.push(url); assert.equal(context.page, 1); assert.equal(context.attempt, calls);
        if (calls++ === 0) return {body: 'limited', status: 429, url, headers: {'Retry-After': header}};
        return feedText([]);
      },
      wait: async ms => waits.push(ms), clock: () => Date.parse('2026-11-05T00:00:00Z'),
      onProgress: event => events.push(event),
    });
    assert.equal(result.exhausted, true);
    assert.deepEqual(waits, [expected]);
    assert.deepEqual(urls, [endpoint, endpoint]);
    assert.equal(events[0].type, 'retry');
  }
});

test('retry bounds, non-429 errors and over-budget Retry-After fail without extra requests', async () => {
  for (const [status, header, expectedCalls] of [[429, undefined, 3], [403, undefined, 1], [503, undefined, 1], [429, '120', 1]]) {
    let calls = 0;
    const checkpoints = [], waits = [];
    const result = await readShopifyInventory(source, {
      read: async url => { calls++; return {url, status, body: 'error', headers: header ? {'retry-after': header} : {}}; },
      wait: async ms => waits.push(ms), onCheckpoint: feed => checkpoints.push(feed),
    });
    assert.equal(calls, expectedCalls);
    assert.equal(result.exhausted, false);
    assert.equal(result.pages.length, 0);
    assert.match(result.error, new RegExp(`HTTP ${status}`));
    assert.equal(checkpoints.at(-1).error, result.error);
    if (expectedCalls === 3) assert.deepEqual(waits, [1000, 2000]);
    else assert.deepEqual(waits, []);
  }
});

test('thrown HTTP 429 supports Headers and keeps prior accepted page checkpoint', async () => {
  let failures = 0;
  const waits = [], checkpoints = [];
  const result = await readShopifyInventory(source, {
    read: async url => {
      if (url.endsWith('page=1')) return json;
      failures++;
      throw Object.assign(Error('HTTP 429'), {status: 429, headers: new Headers({'Retry-After': '2'})});
    }, wait: async ms => waits.push(ms), onCheckpoint: feed => checkpoints.push(feed),
  });
  assert.equal(failures, 3);
  assert.deepEqual(waits, [2000, 2000]);
  assert.equal(result.products.length, 1);
  assert.equal(result.exhausted, false);
  assert.equal(checkpoints.at(-1).products.length, 1);
});

test('checkpoint/progress persistence failures propagate', async () => {
  for (const option of ['onCheckpoint', 'onProgress']) {
    await assert.rejects(readShopifyInventory(source, {read: async () => feedText([]), [option]: async () => { throw Error('disk full'); }}), /disk full/);
  }
});

test('a challenge after an accepted page cannot fabricate an empty terminal', async () => {
  const checkpoints = [];
  const result = await readShopifyInventory(source, {
    read: async url => ({url, status: 200, body: url.endsWith('page=1') ? json : '<html><body>Just a moment...</body></html>'}),
    onCheckpoint: feed => checkpoints.push(feed),
  });
  assert.equal(result.exhausted, false);
  assert.match(result.error, /JSON/);
  assert.equal(result.products.length, 1);
  assert.equal(result.pages.length, 1);
  assert.equal(checkpoints.at(-1).exhausted, false);
});

test('collector serializes reads and holds every worker through the 429 cooldown', async () => {
  const trace = [], checkpoints = [];
  let first = true, active = 0, peak = 0;
  const result = await collectOfficialInventory({
    sources: [source, {brand: 'Toga', root: 'https://int.toga.jp'}], concurrency: 2, minIntervalMs: 7,
    read: async url => {
      active++; peak = Math.max(peak, active); trace.push(`read:${new URL(url).host}`);
      await Promise.resolve(); active--;
      if (first) { first = false; return {url, status: 429, body: 'limited', headers: {'Retry-After': '2'}}; }
      return feedText([]);
    },
    wait: async ms => trace.push(`wait:${ms}`), onCheckpoint: feed => checkpoints.push(feed),
  });
  assert.equal(peak, 1);
  assert.deepEqual(trace.slice(0, 4), ['read:ceciliebahnsen.com', 'wait:2000', 'read:ceciliebahnsen.com', 'wait:7']);
  assert.equal(result.diagnostics.length, 2);
  assert.ok(result.diagnostics.every(d => d.exhausted));
  assert.ok(checkpoints.some(feed => feed.brand === 'Toga'));
});

test('Toga source retains vendor-based allowed label resolution', () => {
  assert.equal(resolveBrand('Toga', 'TOGA PULLA SHOE'), 'Toga Pulla');
  assert.equal(resolveBrand('Toga', 'TOGA VIRILIS'), 'Toga Virilis');
  assert.equal(resolveBrand('Toga', 'TOGA TOO'), '');
});
