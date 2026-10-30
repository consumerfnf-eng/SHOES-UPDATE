// Read a WGSN catwalk collection's own record into this repo.
//
// Why an import and not a collector
// ---------------------------------
// WGSN's catwalk library needs a logged-in subscriber session, which cannot
// live in a CI secret, so the collection runs on a person's own machine and
// leaves a record of what it saved: brand, market, image type, season,
// dimensions, SHA-256, the search URL whose filters produced it, and the
// original's URL. That record is the authority here. This script reads it and
// writes two things:
//
//   data/wgsn-runway.json      every image, for internal reference.
//   public/data/wgsn-runway.json   the shows, their counts and a deep link
//                                  into WGSN for each - no image URLs.
//
// Nothing WGSN serves is republished. The board says a show exists and how
// much of it was read; opening it needs the reader's own subscription. See
// config/wgsn-runway.json for the licence basis and
// docs/wgsn-runway-automation.md for running the collection itself.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJson, atomicJson} from './publish-curated.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** The filter ids a recorded search URL was built from. */
export function filtersOf(sourceUrl) {
  try {
    const raw = new URL(sourceUrl).searchParams.get('filters');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** The search URL for one show on one shelf, built from the config's own ids. */
export function showSearchUrl(config, shelf, brandId) {
  const filters = {...shelf.filters, ...(brandId ? {brands: [String(brandId)]} : {})};
  return `${config.searchEndpoint}?filters=${encodeURIComponent(JSON.stringify(filters))}`;
}

/** Which configured shelf a recorded image belongs to.
 *
 *  Matched on the filter ids in the image's own source URL, not on its folder
 *  name: the folders were arranged by hand afterwards, and 92 partial looks
 *  were moved between them during review.
 */
export function shelfOf(config, image) {
  const filters = filtersOf(image.source);
  if (!filters) return null;
  return config.shelves.find(shelf => Object.entries(shelf.filters)
    .every(([field, values]) => JSON.stringify(filters[field] || []) === JSON.stringify(values))) || null;
}

/** WGSN's own image-type label as a field name. */
export function imageTypeKey(label) {
  return String(label || 'unknown').toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_, c) => c ? c.toUpperCase() : '');
}

export function buildRunway(config, images, {now = new Date()} = {}) {
  const shows = new Map();
  const unmatched = [];
  for (const image of images) {
    if (image.provider !== config.provider) continue;
    const shelf = shelfOf(config, image);
    const brandId = filtersOf(image.source)?.brands?.[0] || '';
    if (!shelf) { unmatched.push({brand: image.brand, source: image.source}); continue; }
    const show = shows.get(image.brand) || {
      brand: image.brand, brandIds: new Set(), season: image.season,
      counts: {}, markets: new Set(), shelves: new Set(), items: [],
    };
    if (brandId) show.brandIds.add(brandId);
    // Counted by what the picture is, not by the shelf it came off. One
    // search returned both: the womenswear full-length filter also served the
    // 92 partial looks that the review moved to close-ups, so counting by
    // shelf would report them as full-length looks.
    show.counts[imageTypeKey(image.image_type)] = (show.counts[imageTypeKey(image.image_type)] || 0) + 1;
    show.shelves.add(shelf.id);
    show.markets.add(image.category);
    show.items.push({
      id: String(image.key || '').replace(/^image-item-/, ''),
      shelf: shelf.id, market: image.category, imageType: image.image_type,
      width: image.width, height: image.height, sha256: image.sha256,
      file: String(image.file || '').replace(/\\/g, '/'),
      originalUrl: image.original_url, downloadControl: image.download_control,
    });
    shows.set(image.brand, show);
  }
  const seasonId = Object.keys(config.filters.seasons)[0];
  const season = config.filters.seasons[seasonId];
  const ordered = [...shows.values()].sort((a, b) => a.brand.localeCompare(b.brand));
  const common = {
    schemaVersion: 1, provider: config.provider, season, seasonId,
    importedAt: new Date(now).toISOString(),
    licence: config.licence,
    shelves: config.shelves.map(({id, label, footwearShelf}) => ({id, label, footwearShelf: !!footwearShelf})),
  };
  const internal = {...common, shows: ordered.map(show => ({
    ...show, brandIds: [...show.brandIds], markets: [...show.markets].sort(),
    shelves: [...show.shelves].sort(),
  })), unmatched};
  // The public board carries no image URL, no file path and no hash: it says
  // which shows were read, how much of each, and where to open it in WGSN.
  const published = {...common, shows: ordered.map(show => ({
    brand: show.brand, markets: [...show.markets].sort(), counts: show.counts,
    total: show.items.length,
    links: config.shelves
      .filter(shelf => show.shelves.has(shelf.id))
      .map(shelf => ({shelf: shelf.id, label: shelf.label,
                      url: showSearchUrl(config, shelf, [...show.brandIds][0])})),
  }))};
  return {internal, published};
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error('usage: node scripts/import-wgsn-runway.mjs <path to the collection\'s 저장목록.json>');
    process.exit(2);
  }
  const config = await readJson(path.join(root, 'config/wgsn-runway.json'));
  const images = await readJson(path.resolve(source));
  if (!Array.isArray(images)) throw Error('The collection record must be an array of images.');
  const {internal, published} = buildRunway(config, images);
  await atomicJson(path.join(root, 'data/wgsn-runway.json'), internal);
  await atomicJson(path.join(root, 'public/data/wgsn-runway.json'), published);
  const totals = published.shows.reduce((sum, s) => sum + s.total, 0);
  console.log(`WGSN ${published.season}: ${published.shows.length} shows, ${totals} images recorded`
    + `${internal.unmatched.length ? `; ${internal.unmatched.length} outside the configured shelves` : ''}.`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
    || process.argv[1]?.endsWith('import-wgsn-runway.mjs')) await main();
