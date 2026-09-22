import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.DASHBOARD_URL || 'http://127.0.0.1:8000/internal/dashboard.html?noauto=1';
const key = process.env.JINA_API_KEY || '';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(0);
page.on('console', m => console.log('[browser]', m.type(), m.text()));
page.on('pageerror', e => console.error('[pageerror]', e.message));
if (key) {
  await page.addInitScript(({key}) => localStorage.setItem('shoes-jina-key-v1', key), {key});
}
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => typeof window.__MLB_RUN_SERVER_DAILY__ === 'function', null, { timeout: 120000 });
console.log('Starting strict daily update...');
const state = await page.evaluate(async () => await window.__MLB_RUN_SERVER_DAILY__());
await fs.writeFile('data/runtime_state.json', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'logs/last-run.png', fullPage: true });
const coverage = state.coverage || [];
const mandatory = new Set(state.mandatoryBrands || []);
const checked = coverage.filter(x => mandatory.has(x.brand));
const failed = checked.filter(x => !x.responses).map(x => x.brand);
const missing = [...mandatory].filter(b => !checked.some(x => x.brand === b));
console.log(`Mandatory coverage: ${checked.length}/${mandatory.size}`);
console.log(`Products: ${state.products?.length || 0}; failed mandatory sources: ${failed.length}; missing: ${missing.length}`);
await browser.close();
if (missing.length) {
  console.error('MANDATORY_BRANDS_NOT_ATTEMPTED:', missing.join(', '));
  process.exitCode = 2;
}
