// What is actually selling, and what the shop itself is pushing.
//
// Two boards, each read from the page a shopper sees:
//
//   Musinsa's sneaker ranking, which the store builds from its own sales and
//   serves as JSON to its own front end. Rank, brand, product name, the price
//   after discount and the photo all come from that one response.
//
//   SSENSE's sneakers category in its default order, which the site labels
//   TRENDING. There is no rank field; the order of the page is the rank, and
//   SSENSE prints one Product block of structured data per card in that order.
//
// A rank on its own says little. What moved is the point, so every collection
// is kept and each item carries what it did since the last one: climbed from
// 9th, new to the board, fell to 14th. The comparison is against the previous
// snapshot, not against a fixed week, so a re-run on the same day compares
// with the run before it rather than with itself.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run = promisify(execFile);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BOARD_FILE = 'data/rank-boards.json';
export const BOARD_SIZE = 15;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export const BOARDS = [
  {
    id: 'musinsa-sneaker-ranking',
    label: '무신사 스니커즈 판매랭킹',
    retailer: 'Musinsa',
    basis: '무신사 스니커즈 랭킹 · 스토어가 집계한 판매 순위',
    pageUrl: 'https://www.musinsa.com/main/sneaker/ranking?categoryCode=103004',
    apiUrl: 'https://api.musinsa.com/api2/hm/v5/pans/ranking?storeCode=sneaker&subPan=product',
    read: musinsaBoard,
  },
  {
    id: 'ssense-sneakers-trending',
    label: 'SSENSE 스니커즈 TRENDING',
    retailer: 'SSENSE',
    basis: 'SSENSE 스니커즈 기본 정렬(TRENDING) · 노출 순서',
    pageUrl: 'https://www.ssense.com/en-us/men/sneakers',
    apiUrl: 'https://www.ssense.com/en-us/men/sneakers',
    read: ssenseBoard,
  },
];

async function readText(url, accept) {
  // SSENSE refuses a request that only says it wants HTML. The headers a
  // browser always sends are what it is checking for.
  const response = await fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(40000), headers: {
    'User-Agent': UA, Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': accept.includes('html') ? 'document' : 'empty',
    'Sec-Fetch-Mode': accept.includes('html') ? 'navigate' : 'cors',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  }});
  if (response.ok) return await response.text();
  // SSENSE refuses Node's HTTP client whatever headers it sends - the check is
  // on the client itself, not the request - and answers curl with the same
  // headers perfectly well. So curl is the second attempt rather than the
  // first: one stack failing is not the page being unavailable.
  try {
    const {stdout} = await run('curl', ['-sS', '-L', '--max-time', '40', '-A', UA, '-H', `Accept: ${accept}`, url],
      {maxBuffer: 64 * 1024 * 1024});
    if (stdout && stdout.length > 2048) return stdout;
  } catch {}
  throw Error(`HTTP ${response.status}`);
}

/** Musinsa serves its ranking as the modules its own page renders: each
 *  THREECOLUMN module holds up to three PRODUCT_COLUMN cards, and the card's
 *  image carries the rank the store assigned it. */
export function musinsaBoard(payload) {
  const modules = payload?.data?.modules || [];
  const rows = [];
  for (const module of modules) {
    if (module?.type !== 'THREECOLUMN') continue;
    for (const item of module.items || []) {
      if (item?.type !== 'PRODUCT_COLUMN' || !item.id || !item.info?.productName) continue;
      const price = Number(item.info.finalPrice);
      rows.push({
        rank: Number(item.image?.rank) || rows.length + 1,
        key: String(item.id),
        brand: String(item.info.brandName || '').trim(),
        name: String(item.info.productName || '').trim(),
        priceLabel: Number.isFinite(price) ? `${price.toLocaleString('ko-KR')}원` : '',
        discountRatio: Number(item.info.discountRatio) || 0,
        image: String(item.image?.url || ''),
        url: String(item.onClick?.url || `https://www.musinsa.com/products/${item.id}`),
        soldOut: item.info.isSoldOut === true,
      });
    }
  }
  return rows.sort((a, b) => a.rank - b.rank);
}

/** SSENSE prints one Product block per card, in the order the cards appear.
 *  The order is the ranking: the page is sorted TRENDING by default and says
 *  so. The photo is not in the block, but the sku names it on their CDN. */
export function ssenseBoard(html) {
  const blocks = [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const rows = [];
  for (const [, body] of blocks) {
    let product;
    try { product = JSON.parse(body); } catch { continue; }
    if (product?.['@type'] !== 'Product' || !product.sku || !product.name) continue;
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    const price = Number(offer?.price);
    const currency = String(offer?.priceCurrency || '').trim();
    rows.push({
      rank: rows.length + 1,
      key: String(product.sku),
      brand: String(product.brand?.name || product.brand || '').trim(),
      name: String(product.name || '').trim(),
      priceLabel: Number.isFinite(price) ? `${currency ? currency + ' ' : ''}${price.toLocaleString('en-US')}`.trim() : '',
      image: `https://img.ssensemedia.com/image/upload/b_white,c_lpad,g_south,ar_2:3/f_auto,c_limit,w_768,q_85/${product.sku}_1.jpg`,
      url: String(product.url || ''),
    });
  }
  return rows;
}

/** What each item did since the previous reading of the same board. */
export function withMovement(items, previous) {
  const before = new Map(Object.entries(previous?.ranks || {}).map(([key, rank]) => [key, Number(rank)]));
  return items.map(item => {
    const was = before.get(item.key);
    if (!before.size) return {...item, movement: 'first'};
    if (!Number.isFinite(was)) return {...item, movement: 'new'};
    if (was === item.rank) return {...item, movement: 'same', previousRank: was};
    return {...item, movement: was > item.rank ? 'up' : 'down', previousRank: was, change: Math.abs(was - item.rank)};
  });
}

/** Items that were on the board last time and are not on it now. */
export function departures(items, previous, size = BOARD_SIZE) {
  const now = new Set(items.map(item => item.key));
  return Object.entries(previous?.ranks || {})
    .filter(([key, rank]) => !now.has(key) && Number(rank) <= size)
    .map(([key, rank]) => ({key, rank: Number(rank), name: previous?.names?.[key] || ''}))
    .sort((a, b) => a.rank - b.rank);
}

export async function collectRankBoards({directory = root, now = new Date(), fetchText = readText, boards = BOARDS} = {}) {
  const file = path.join(directory, BOARD_FILE);
  const stored = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  const checkedAt = new Date(now).toISOString();
  const history = Array.isArray(stored?.history) ? stored.history.slice(-25) : [];
  const previous = Object.fromEntries((stored?.boards || []).map(board => [board.id, {
    ranks: Object.fromEntries((board.items || []).map(item => [item.key, item.rank])),
    names: Object.fromEntries((board.items || []).map(item => [item.key, `${item.brand} ${item.name}`.trim()])),
    checkedAt: board.checkedAt,
  }]));

  const collected = [];
  for (const board of boards) {
    try {
      const body = await fetchText(board.apiUrl, board.id.startsWith('musinsa') ? 'application/json' : 'text/html');
      const parsed = board.id.startsWith('musinsa') ? board.read(JSON.parse(body)) : board.read(body);
      const items = parsed.slice(0, BOARD_SIZE);
      if (!items.length) throw Error('no ranked products in the response');
      collected.push({
        id: board.id, label: board.label, retailer: board.retailer, basis: board.basis,
        sourceUrl: board.pageUrl, checkedAt, size: BOARD_SIZE,
        comparedWith: previous[board.id]?.checkedAt || null,
        items: withMovement(items, previous[board.id]),
        departed: departures(items, previous[board.id]),
      });
    } catch (error) {
      // A board that could not be read keeps the last one it could, said so.
      const kept = (stored?.boards || []).find(b => b.id === board.id);
      collected.push(kept
        ? {...kept, staleSince: checkedAt, error: error.message}
        : {id: board.id, label: board.label, retailer: board.retailer, basis: board.basis,
           sourceUrl: board.pageUrl, checkedAt, size: BOARD_SIZE, items: [], departed: [], error: error.message});
    }
  }

  const snapshot = {schemaVersion: 1, checkedAt, boards: collected,
    history: [...history, {checkedAt, boards: Object.fromEntries(collected.filter(b => b.items.length)
      .map(b => [b.id, Object.fromEntries(b.items.map(item => [item.key, item.rank]))]))}]};
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2) + '\n');
  return snapshot;
}

if (process.argv[1]?.endsWith('collect-rank-boards.mjs')) {
  const snapshot = await collectRankBoards({});
  for (const board of snapshot.boards) {
    const moved = board.items.filter(i => i.movement === 'up' || i.movement === 'down').length;
    console.log(`${board.label}: ${board.items.length} ranked${board.error ? ` (kept previous: ${board.error})` : ''}`
      + `${board.items.length ? `, ${board.items.filter(i => i.movement === 'new').length} new, ${moved} moved, ${board.departed.length} left` : ''}`);
  }
}
