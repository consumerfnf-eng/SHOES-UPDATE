import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJinaClient } from '../scripts/jina_client.mjs';
import { runDaily, validateState } from '../scripts/run_daily_update.mjs';

const text = 'Official new arrivals. There are no matching new sneakers in this test fixture. '.repeat(3);
test('Invalid Jina key falls back to anonymous Reader without leaking credentials', async () => {
  const calls = [], logs = [];
  const client = createJinaClient({ key: 'test-secret', intervalMs: 0, sleep: async()=>{}, log: line=>logs.push(line), fetchImpl: async (url, options) => {
    calls.push(options.headers); return calls.length === 1 ? new Response('Invalid key', { status: 401 }) : new Response(text);
  }});
  assert.equal(await client.read('https://r.jina.ai/https://example.com/'), text);
  assert.equal(calls[0].Authorization, 'Bearer test-secret');
  assert.equal(calls[1].Authorization, undefined);
  assert(!JSON.stringify(logs).includes('test-secret'));
  await assert.rejects(client.read('https://s.jina.ai/query'), /without a valid key/);
  await assert.rejects(client.read('https://example.com/'), /Unsupported crawler host/);
});
test('Rate-limited sources retry and upstream error pages are not counted as success', async () => {
  let attempts = 0;
  const client = createJinaClient({ intervalMs: 0, sleep: async()=>{}, fetchImpl: async()=> ++attempts < 2 ? new Response('', {status:429}) : new Response(text) });
  assert.equal(await client.read('https://r.jina.ai/https://example.com/'), text);
  assert.equal(attempts, 2);
  const blocked = createJinaClient({ intervalMs:0, sleep:async()=>{}, fetchImpl:async()=>new Response('Warning: Target URL returned error 403: Forbidden\n'+text) });
  await assert.rejects(blocked.read('https://r.jina.ai/https://example.com/'), /no usable page/);
});
test('No response or omitted mandatory brand cannot become a successful run', () => {
  assert.throws(()=>validateState({products:[{}],coverage:[]},['Nike']), /NOT_ATTEMPTED/);
  assert.throws(()=>validateState({products:[{}],coverage:[{brand:'Nike',attempts:3,responses:0}]},['Nike']), /ALL_MANDATORY/);
});
test('Large dashboard initializes and exports a full 116-brand run without localStorage quota failure', { timeout: 120000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shoes-daily-test-'));
  try {
    const state = await runDaily({ read:async()=>text, skipTrends:true, output:path.join(dir,'state.json') });
    assert.equal(state.crawler.scope, 'full');
    assert.equal(state.crawler.attempted, 116);
    assert.equal(state.crawler.responded, 116);
    assert(state.products.length >= 2000);
    assert.equal(state.products.filter(product=>product.catalogVerification).length,1571);
    assert.equal(state.meta.lastNewItems,0);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
