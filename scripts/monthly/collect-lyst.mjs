// Collect women's sneakers from Lyst's "Newest" sort. Lyst blocks curl_cffi
// (TLS-impersonated requests, 403) and headless Playwright (403), but real
// (non-headless) Playwright gets through cleanly - confirmed by hand. In CI
// this runs under xvfb-run so "headless: false" still works without a real
// display. Lyst's "Newest" sort has no visible per-item date (verified: no
// date field anywhere in the card markup), so - exactly like SSENSE - the
// only honest signal for "new" is a month-over-month delta against our own
// prior snapshot, computed by update.py. This script only reports what it
// currently sees.
import {chromium} from 'playwright';
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

const url = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out')+1] : null;
if (!url) { console.error('--out <path> required'); process.exit(1); }

const BASE = 'https://www.lyst.com/shop/sneakers/?view=newest';
const MAX_PAGES = 10;
const SNEAKER_EXCLUDE = /\b(loafers?|oxfords?|derbys?|derbies|boots?|heels?|pumps?|mules?|sandals?|slides?|flats?|slingbacks?|espadrilles?|clogs?|mary ?janes?|wedges?|moccasins?|monk straps?)\b/i;
const KIDS_EXCLUDE = /\b(kids?|baby|toddler|infant|junior|youth|little ?kids?|big ?kids?|grade ?school|pre-?school)\b|\((?:gs|ps|td)\)/i;

function parseCard(cardHtml) {
  const imgMatch = cardHtml.match(/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"/);
  const priceMatch = cardHtml.match(/data-testid="product-price"[^>]*>.*?\$([\d,.]+)/s);
  const urlMatch = cardHtml.match(/href="(\/shoes\/[^"?]+)/);
  const retailerMatch = cardHtml.match(/aria-label="View [^"]+ at ([^"]+)"/);
  if (!imgMatch || !urlMatch) return null;
  const [, image, alt] = imgMatch;
  // alt format: "<Brand...> <Name...> - <Color>"
  const dash = alt.lastIndexOf(' - ');
  const namePart = dash > 0 ? alt.slice(0, dash) : alt;
  const color = dash > 0 ? alt.slice(dash + 3) : '';
  const words = namePart.trim().split(/\s+/);
  const brand = words.slice(0, Math.min(3, Math.max(1, words.length - 2))).join(' ');
  return {
    brand: brand || namePart,
    name: namePart,
    colorway: color,
    image,
    url: 'https://www.lyst.com' + urlMatch[1] + '/',
    priceLabel: priceMatch ? `$${priceMatch[1]}` : '',
    retailer: retailerMatch ? retailerMatch[1] : '',
  };
}

async function main() {
  const browser = await chromium.launch({headless: false});
  const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
  const items = [];
  const seen = new Set();
  const diagnostics = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const pageUrl = `${BASE}&page=${p}`;
    const status = {page: p, url: pageUrl, cards: 0, errors: []};
    try {
      const resp = await page.goto(pageUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
      if (!resp || resp.status() !== 200) { status.errors.push({error: `http-${resp ? resp.status() : 'none'}`}); diagnostics.push(status); break; }
      await page.waitForTimeout(1800);
      const html = await page.content();
      const cards = html.split('data-testid="product-card"').slice(1);
      let newThisPage = 0;
      for (const raw of cards) {
        const parsed = parseCard(raw.slice(0, 4000));
        if (!parsed || seen.has(parsed.url)) continue;
        seen.add(parsed.url);
        newThisPage++;
        if (SNEAKER_EXCLUDE.test(parsed.name) || KIDS_EXCLUDE.test(parsed.name) || KIDS_EXCLUDE.test(parsed.url)) continue;
        items.push({...parsed, gender: 'women', source: 'retail-lyst'});
      }
      status.cards = newThisPage;
      diagnostics.push(status);
      if (newThisPage === 0) break;
    } catch (e) {
      status.errors.push({error: e.message});
      diagnostics.push(status);
      break;
    }
  }
  await browser.close();
  mkdirSync(dirname(url), {recursive: true});
  const result = {status: items.length ? 'ok' : (diagnostics.some(d => d.cards) ? 'ok' : 'unavailable'),
    checkedAt: new Date().toISOString(), items, diagnostics};
  writeFileSync(url, JSON.stringify(result, null, 2));
  console.error(`Lyst collection: ${result.status} - ${items.length} sneaker items across ${diagnostics.length} pages`);
}
main().catch(e => { console.error('Lyst collection failed:', e.message); process.exit(1); });
