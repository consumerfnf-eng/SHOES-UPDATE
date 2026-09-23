import { setTimeout as delay } from 'node:timers/promises';

// Credentials stay in Node, never in the page, snapshot, artifact or console.
export function createJinaClient({ key = '', fetchImpl = fetch, intervalMs, timeoutMs = 20000, sleep = delay, log = console.log } = {}) {
  let authenticated = Boolean(key), nextRequest = 0, queue = Promise.resolve();
  const stats = { requests: 0, responses: 0, authFallbacks: 0, rateLimitRetries: 0, errors: {} };
  async function pace() {
    const turn = queue.then(async () => {
      await sleep(Math.max(0, nextRequest - Date.now()));
      nextRequest = Date.now() + (intervalMs ?? (authenticated ? 1100 : 3200));
    });
    queue = turn.catch(() => {});
    await turn;
  }
  async function read(url, requestedTimeout = timeoutMs) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['r.jina.ai', 's.jina.ai'].includes(target.hostname)) throw Error('Unsupported crawler host');
    if (target.hostname === 's.jina.ai' && !authenticated) throw Error('Jina Search unavailable without a valid key; official Reader sources were still attempted');
    for (let attempt = 0; attempt < 3; attempt++) {
      await pace();
      const headers = { Accept: 'text/plain' };
      if (authenticated) headers.Authorization = `Bearer ${key}`;
      stats.requests++;
      let response;
      try { response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(Math.min(requestedTimeout, timeoutMs)) }); }
      catch (error) {
        stats.errors.network = (stats.errors.network || 0) + 1;
        throw Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Source request timed out' : 'Source network request failed');
      }
      if ([401, 402, 403].includes(response.status) && authenticated) {
        authenticated = false; stats.authFallbacks++;
        log('Jina authentication/quota unavailable; continuing with anonymous Reader.');
        await response.body?.cancel();
        if (target.hostname === 's.jina.ai') throw Error('Jina Search authentication unavailable');
        continue;
      }
      if (response.status === 429 && attempt < 2) {
        stats.rateLimitRetries++;
        const retrySeconds = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        await sleep(Math.min(15000, Math.max(3200, Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 5000)));
        continue;
      }
      if (!response.ok) {
        stats.errors[response.status] = (stats.errors[response.status] || 0) + 1;
        throw Error(`Source HTTP ${response.status}`);
      }
      const text = await response.text();
      if (text.length < 80 || /^(?:\s*\{\s*"(?:code|error)"|[\s\S]{0,400}Warning: Target URL returned error)/i.test(text)) throw Error('Source returned no usable page');
      stats.responses++;
      return text;
    }
    throw Error('Source retry limit reached');
  }
  return { read, stats };
}
