import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createJinaClient } from './jina_client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function validateState(state, required) {
  if (!Array.isArray(state.products) || !state.products.length) throw Error('Empty product snapshot; keeping the previous dashboard');
  const coverage = new Map((state.coverage || []).map(row => [row.brand, row]));
  const missing = required.filter(brand => !coverage.has(brand) || !coverage.get(brand).attempts);
  if (missing.length) throw Error(`MANDATORY_BRANDS_NOT_ATTEMPTED: ${missing.join(', ')}`);
  if (!required.some(brand => coverage.get(brand)?.responses > 0)) throw Error('ALL_MANDATORY_SOURCES_UNAVAILABLE: keeping the previous dashboard');
  return { attempted: required.length, responded: required.filter(brand => coverage.get(brand).responses > 0).length };
}

export async function runDaily({ read, brands, output = path.join(root, 'data/runtime_state.json'), channel = process.env.PLAYWRIGHT_CHANNEL, skipTrends = false } = {}) {
  await fs.mkdir(path.join(root, 'logs'), { recursive: true });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.rm(output, { force: true });
  await fs.writeFile(path.join(root, 'logs/daily-progress.jsonl'), '');
  const required = JSON.parse(await fs.readFile(path.join(root, 'config/mandatory_brands.json'), 'utf8')).brands.map(row => row.canonical);
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const sources = JSON.parse(await fs.readFile(path.join(root, 'config/daily_sources.json'), 'utf8'));
  const server = http.createServer((request, response) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/') { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const client = createJinaClient({ key: process.env.JINA_API_KEY || '' });
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', error => { errors.push(error.message); console.error('[pageerror]', error.message); });
    await page.route('**/*', route => ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue());
    await page.addInitScript(sources => { window.__MLB_SERVER_MODE__ = true; window.__MLB_DAILY_SOURCES__ = sources; }, sources);
    await page.exposeFunction('__MLB_FETCH_TEXT__', read || client.read);
    await page.exposeFunction('__MLB_DAILY_PROGRESS__', async row => {
      console.log(`${row.brand}: ${row.status}, ${row.responses}/${row.attempts} source responses, ${row.found} candidates`);
      await fs.appendFile(path.join(root, 'logs/daily-progress.jsonl'), JSON.stringify(row) + '\n');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?noauto=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => typeof window.__MLB_RUN_SERVER_DAILY__ === 'function', null, { timeout: 30000 });
    if (errors.length) throw Error('Dashboard initialization failed; see page errors');
    console.log(`Starting daily update; ${required.length} mandatory brands; Jina key ${process.env.JINA_API_KEY ? 'configured' : 'absent (anonymous Reader)'}.`);
    const state = await page.evaluate(options => window.__MLB_RUN_SERVER_DAILY__(options), { brands, concurrency: 3, skipTrends });
    const health = validateState(state, brands || required);
    state.crawler = { ...client.stats, ...health, scope: brands ? 'test' : 'full' };
    await fs.writeFile(output + '.tmp', JSON.stringify(state, null, 2));
    await fs.rename(output + '.tmp', output);
    console.log(`Daily update complete: ${health.responded}/${health.attempted} mandatory brands responded; ${state.products.length} products retained.`);
    return state;
  } catch (error) {
    await fs.writeFile(path.join(root, 'logs/daily-error.json'), JSON.stringify({ error: error.message, pageErrors: errors, crawler: client.stats }, null, 2));
    throw error;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runDaily().catch(error => { console.error(error.message); process.exitCode = 1; });
}
