import test from 'node:test';
import assert from 'node:assert/strict';
import {createScrapingBeeReader} from '../scripts/scrapingbee-reader.mjs';

const target='https://official.example/jp/sneakers';
const goodHtml=`<html><head><title>Official Sneakers</title></head><body>
<h1>Runner Sneakers</h1>
<p>Official product description with rubber outsole and mesh upper, available now in the official catalogue with verified shoe specifications and sizing details for every release.</p>
<a href="https://official.example/products/runner">View product</a>
</body></html>`;
const blockedHtml='<html><body>Just a moment...</body></html>';

test('with no api key, read throws immediately without any fetch', async () => {
  let calls = 0;
  const client = createScrapingBeeReader({origins: [target], apiKey: '', fetchImpl: async () => { calls++; return new Response(goodHtml); }});
  await assert.rejects(client.read(target), /SCRAPINGBEE_NO_KEY/);
  assert.equal(calls, 0);
});

test('rejects a target outside the allowed origins', async () => {
  const client = createScrapingBeeReader({origins: [target], apiKey: 'k', fetchImpl: async () => new Response(goodHtml)});
  await assert.rejects(client.read('https://unreviewed.example/'), /NOT_ALLOWED/);
});

test('a usable light fetch is accepted without escalating to premium', async () => {
  const calls = [];
  const client = createScrapingBeeReader({
    origins: [target], apiKey: 'k', sleep: async () => {},
    fetchImpl: async url => { calls.push(url); return new Response(goodHtml, {status: 200}); },
  });
  const result = await client.read(target);
  assert(result.includes('official.example/products/runner'));
  assert.equal(calls.length, 1);
  assert(calls[0].includes('render_js=false'));
  assert.equal(client.stats.creditsUsed, 1);
  assert.equal(client.stats.readable, 1);
});

test('a blocked-looking light fetch escalates to the premium (render_js) fetch', async () => {
  const calls = [];
  const client = createScrapingBeeReader({
    origins: [target], apiKey: 'k', sleep: async () => {},
    fetchImpl: async url => {
      calls.push(url);
      return calls.length === 1 ? new Response(blockedHtml, {status: 200}) : new Response(goodHtml, {status: 200});
    },
  });
  const result = await client.read(target);
  assert(result.includes('official.example/products/runner'));
  assert.equal(calls.length, 2);
  assert(calls[1].includes('render_js=true'));
  assert(calls[1].includes('premium_proxy=true'));
  assert.equal(client.stats.creditsUsed, 26);
});

test('401/402 from the provider stops the account for the rest of the run', async () => {
  let calls = 0;
  const client = createScrapingBeeReader({origins: [target], apiKey: 'k', sleep: async () => {}, fetchImpl: async () => { calls++; return new Response('', {status: 402}); }});
  await assert.rejects(client.read(target), /SCRAPINGBEE_HTTP_402/);
  assert(client.stats.quotaStopped);
  await assert.rejects(client.read(target + '?x=2'), /QUOTA_STOPPED/);
  assert.equal(calls, 1);
});

test('a per-run credit cap stops further requests before spending more', async () => {
  const client = createScrapingBeeReader({origins: [target], apiKey: 'k', sleep: async () => {}, maxCreditsPerRun: 1, fetchImpl: async () => new Response(blockedHtml, {status: 200})});
  await assert.rejects(client.read(target), /RUN_BUDGET_WOULD_EXCEED_PREMIUM/);
  assert.equal(client.stats.creditsUsed, 1);
});

test('repeated reads of the same target are cached, not re-fetched', async () => {
  let calls = 0;
  const client = createScrapingBeeReader({origins: [target], apiKey: 'k', sleep: async () => {}, fetchImpl: async () => { calls++; return new Response(goodHtml, {status: 200}); }});
  const [a, b] = await Promise.all([client.read(target), client.readHtml(target)]);
  assert.equal(a, b);
  assert.equal(calls, 1);
});
