// Two more ways to read an official store that will not answer normally.
//
// Thirty-five of sixty brands published nothing. The reasons split cleanly:
// some pages are drawn by JavaScript (the rendered reader handles those),
// some sites refuse automation outright, and some simply answer a different
// country's site when the configured one is blocked or gone.
//
//   locale alternates - Umbro's global store answered with no product links
//     while umbro.co.kr listed sixty, and Le Coq Sportif's US collections
//     path is a 404 while the Korean store lists sixty-seven. Swapping the
//     country in the URL is the whole fix, and it needs no new service.
//
//   sitemaps - a store that refuses a crawler still publishes the list of
//     its own product URLs, because that is what a sitemap is for. It is
//     served as XML from a path robots.txt names, costs one request per
//     file, and needs no rendering. Probed before this was written: ROA 55
//     URLs, Alo 2,323, and KEEN, HOKA and Golden Goose answer with regional
//     indexes.
//
// Both return markdown links, which is what the collector already reads, so
// nothing downstream has to know where a listing came from.
import {setTimeout as delay} from 'node:timers/promises';

const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept': 'text/html,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,ko;q=0.8',
};

// --- locale alternates ------------------------------------------------------
const LOCALE_PATH = /\/(?:[a-z]{2}-[a-z]{2}|[a-z]{2}\/[a-z]{2}|(?:us|kr|gb|uk|jp|eu|fr|it|de|ww))(?=\/|$)/i;
const COUNTRY_HOSTS = ['.co.kr', '.kr', '.com', '.jp', '.co.jp'];
const LOCALES = ['kr/ko', 'ko-kr', 'us/en', 'en-us', 'ww/en', 'us', 'kr'];

export function localeAlternates(url, limit = 4) {
  let base;
  try { base = new URL(url); } catch { return []; }
  const out = new Set();
  // The same page in another country first - it keeps the path, so it is
  // still the shoes listing and not the home page.
  if (LOCALE_PATH.test(base.pathname)) {
    for (const locale of LOCALES) {
      const path = base.pathname.replace(LOCALE_PATH, '/' + locale);
      if (path !== base.pathname) out.add(new URL(path + base.search, base.origin).href);
    }
  }
  // Then the same brand on another country's host: umbro.com -> umbro.co.kr.
  const stem = base.hostname.replace(/^www\./, '').replace(/\.(?:co\.kr|kr|com|jp|co\.jp)$/i, '');
  for (const suffix of COUNTRY_HOSTS) {
    const host = `www.${stem}${suffix}`;
    if (host !== base.hostname) out.add(`https://${host}/`);
  }
  return [...out].slice(0, limit);
}

// --- sitemaps ---------------------------------------------------------------
const PRODUCT_PATH = /\/(?:products?|product|shop|item|goods|pr|p|dp|style)\//i;
const SITEMAP_SKIP = /(?:blog|article|news|story|journal|page|collection|category|lookbook)/i;

function locsOf(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>|<sitemap>([\s\S]*?)<\/sitemap>/gi)].map(m => {
    const block = m[1] || m[2] || '';
    const loc = (block.match(/<loc>\s*([^<]+?)\s*<\/loc>/i) || [])[1] || '';
    const mod = (block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i) || [])[1] || '';
    return loc ? {loc: loc.replaceAll('&amp;', '&'), lastmod: mod.slice(0, 10)} : null;
  }).filter(Boolean);
}

export function createSitemapReader({fetchImpl = fetch, sleep = delay, maxFiles = 8,
                                     maxLinks = 300, intervalMs = 800, shouldContinue = () => true} = {}) {
  const stats = {files: 0, links: 0, origins: 0, failures: {}};
  const cache = new Map();
  // The file budget is per brand, not per run: one store's regional indexes
  // must not use up what the next store needs.
  let budget = maxFiles;

  async function get(url) {
    if (budget <= 0) throw Error('SITEMAP_FILE_LIMIT');
    budget--;
    if (!shouldContinue()) throw Error('SITEMAP_TIME_BUDGET');
    if (stats.files) await sleep(intervalMs);
    stats.files++;
    const response = await fetchImpl(url, {headers: BROWSER, redirect: 'follow', signal: AbortSignal.timeout(25000)});
    if (!response.ok) throw Error(`SITEMAP_HTTP_${response.status}`);
    const text = await response.text();
    if (text.length > 8_000_000) throw Error('SITEMAP_TOO_LARGE');
    return text;
  }

  async function sitemapUrls(origin) {
    const found = [];
    try {
      const robots = await get(new URL('/robots.txt', origin).href);
      for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) found.push(m[1]);
    } catch { /* robots.txt is optional */ }
    if (!found.length) found.push(new URL('/sitemap.xml', origin).href);
    // Only this brand's own sitemaps, never somewhere else's.
    return found.filter(u => { try { return new URL(u).origin === new URL(origin).origin; } catch { return false; } });
  }

  /** Markdown links to the product pages a store lists in its own sitemap. */
  async function read(target) {
    const origin = new URL(target).origin;
    if (cache.has(origin)) return cache.get(origin);
    budget = maxFiles;
    const queue = await sitemapUrls(origin);
    const links = [], seen = new Set();
    while (queue.length && links.length < maxLinks) {
      const next = queue.shift();
      let xml;
      try { xml = await get(next); }
      catch (error) { stats.failures[error.message] = (stats.failures[error.message] || 0) + 1; continue; }
      const entries = locsOf(xml);
      const nested = entries.filter(e => /\.xml(?:\.gz)?(?:$|\?)/i.test(e.loc) && !SITEMAP_SKIP.test(e.loc));
      if (nested.length) {
        // Newest-looking children first; a store's product sitemap is usually
        // the one it has touched most recently.
        nested.sort((a, b) => (b.lastmod || '').localeCompare(a.lastmod || ''));
        queue.unshift(...nested.map(e => e.loc).slice(0, maxFiles));
        continue;
      }
      for (const entry of entries) {
        if (!PRODUCT_PATH.test(entry.loc) || SITEMAP_SKIP.test(entry.loc) || seen.has(entry.loc)) continue;
        seen.add(entry.loc);
        links.push(entry);
      }
    }
    // A sitemap lists the whole store. Shoes first, then by how recently the
    // store touched the page, so a capped read still reaches footwear -
    // Alo's sitemap opens with yoga books and KEEN's with boots.
    const FOOTWEAR_SLUG = /(?:shoe|sneaker|trainer|runner|running|boot|sandal|clog|slide|slipper|loafer|footwear|slip-?on|스니커|신발|운동화|슈즈)/i;
    links.sort((a, b) => (Number(FOOTWEAR_SLUG.test(b.loc)) - Number(FOOTWEAR_SLUG.test(a.loc)))
      || (b.lastmod || '').localeCompare(a.lastmod || ''));
    const kept = links.slice(0, maxLinks);
    stats.links += kept.length;
    stats.origins++;
    if (!kept.length) throw Error('SITEMAP_NO_PRODUCT_LINKS');
    // The label is the slug read back as words: the collector takes the name
    // from the product page itself, and this only has to identify the link.
    const markdown = '# New Arrivals\n\n' + kept.map(e => {
      const slug = decodeURIComponent(new URL(e.loc).pathname.split('/').filter(Boolean).pop() || '')
        .replace(/\.[a-z]{2,5}$/i, '').replace(/[-_]+/g, ' ').trim();
      return `[${slug || 'product'}](${e.loc})`;
    }).join('\n\n');
    cache.set(origin, markdown);
    return markdown;
  }

  return {read, stats};
}
