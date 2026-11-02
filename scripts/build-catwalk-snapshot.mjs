// Assemble public/data/catwalk.json out of one fragment per collected season,
// and delete what falls outside the retention rule.
//
// Why fragments and not one growing file
// --------------------------------------
// A season is collected on its own, months apart from the next one, and a
// collection that fails halfway must not damage the seasons already on the
// site. So each season is written to data/catwalk/<season>.json as it is
// built, and this script is the only thing that composes them into the file
// the page reads. Re-running it is always safe: it rebuilds the snapshot from
// whatever fragments exist rather than editing the snapshot in place.
//
// Nothing here is committed. The fragments carry WGSN's own metadata and the
// renditions are subscription imagery; both are gitignored, and both reach
// the internal deployment by direct upload (see docs/internal-deployment.md).
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {retainSeasons, SEASONS_KEPT} from '../public/assets/catwalk-seasons.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const FRAGMENTS = path.join(ROOT, 'data', 'catwalk');
export const IMAGES = path.join(ROOT, 'public', 'catwalk');
export const SNAPSHOT = path.join(ROOT, 'public', 'data', 'catwalk.json');
const CONFIG = path.join(ROOT, 'config', 'wgsn-runway.json');
const LOCAL_CONFIG = path.join(ROOT, 'config', 'wgsn-runway.local.json');

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

// The public half of the configuration describes the collection - the tags,
// the shelves, the licence. The local half names WGSN's own endpoints and the
// saved search that identifies this subscription, and is gitignored: this
// repository is public. Collection therefore only works where that file is.
export async function readConfig() {
  const base = await readJson(CONFIG).catch(() => ({}));
  const local = await readJson(LOCAL_CONFIG).catch(() => null);
  if (!local) return base;
  return {...base, ...local, librarySearch: {...(base.librarySearch ?? {}), ...(local.librarySearch ?? {})},
          licence: {...(base.licence ?? {}), ...(local.licence ?? {})}};
}

// The page reads one list of looks and one list of seasons; the season tabs
// and every count on screen come from these. Looks stay in season order,
// newest season first, and within a season in the order the builder settled
// on, so the grid does not reshuffle itself between runs.
export function composeSnapshot(fragments, {kept = SEASONS_KEPT, config = {}, builtAt} = {}) {
  const bySeason = new Map();
  for (const fragment of fragments) {
    const season = String(fragment?.season ?? '').trim();
    if (!season || !Array.isArray(fragment.looks) || !fragment.looks.length) continue;
    // Two fragments for one season: the later collection wins outright rather
    // than being merged, so a re-collection cannot leave half of an old one.
    const existing = bySeason.get(season);
    if (!existing || String(fragment.collectedAt ?? '') >= String(existing.collectedAt ?? '')) bySeason.set(season, fragment);
  }
  const {keep, drop} = retainSeasons([...bySeason.keys()], kept);
  const seasons = keep.map(season => {
    const fragment = bySeason.get(season);
    return {
      season, seasonId: String(fragment.seasonId ?? ''), collectedAt: fragment.collectedAt ?? '',
      looks: fragment.looks.length, shows: new Set(fragment.looks.map(l => l.brand)).size,
      cities: [...new Set(fragment.looks.map(l => l.city).filter(Boolean))].sort(),
    };
  });
  const looks = keep.flatMap(season => bySeason.get(season).looks.map(look => ({...look, season})));
  const library = config.librarySearch ?? {};
  return {
    snapshot: {
      schemaVersion: 2, provider: 'WGSN',
      currentSeason: keep[0] ?? '', seasons,
      builtAt: builtAt ?? new Date().toISOString(),
      licence: config.licence ?? {}, cardWidth: 480,
      source: {kind: 'image-library-saved-search', url: library.url ?? '',
               tagCount: (library.tags ?? []).length,
               note: "Every result is a shoe photographed on its own; brand, season and city are WGSN's own caption."},
      shelves: [{id: 'library-footwear', label: '신발 클로즈업', footwearShelf: true, searchUrl: library.url ?? ''}],
      looks,
    },
    keep, drop,
    // Every file the kept seasons still point at. Anything else under
    // public/catwalk is a rendition no card can reach any more.
    referenced: new Set(looks.map(l => String(l.image ?? '').replace(/^\/catwalk\//, '')).filter(Boolean)),
  };
}

// A v1 snapshot held one season inline. Adopting it as that season's fragment
// keeps the collection already on the site when the layout changes under it,
// rather than asking for 247 photographs to be collected a second time.
export function fragmentFromV1(snapshot) {
  if (!snapshot || Number(snapshot.schemaVersion) !== 1 || !Array.isArray(snapshot.looks) || !snapshot.looks.length) return null;
  // v1 named the season at the top level; if that is blank, the looks carry it.
  const season = (String(snapshot.season ?? '').trim() || String(snapshot.looks[0]?.season ?? '').trim());
  if (!season) return null;
  return {season, seasonId: String(snapshot.seasonId ?? ''), collectedAt: snapshot.builtAt ?? '',
          adoptedFrom: 'schemaVersion 1 snapshot', looks: snapshot.looks};
}

export const seasonFile = season => path.join(FRAGMENTS, `${String(season).replace(/[\\/:*?"<>|]+/g, '-').trim()}.json`);

async function listFragments() {
  try {
    const names = (await fs.readdir(FRAGMENTS)).filter(n => n.endsWith('.json'));
    return await Promise.all(names.map(async n => ({file: path.join(FRAGMENTS, n), ...(await readJson(path.join(FRAGMENTS, n)))})));
  } catch { return []; }
}

async function main() {
  const apply = !process.argv.includes('--dry-run');
  await fs.mkdir(FRAGMENTS, {recursive: true});
  let fragments = await listFragments();

  if (!fragments.length) {
    const adopted = fragmentFromV1(await readJson(SNAPSHOT).catch(() => null));
    if (!adopted) { console.error('No season fragments in data/catwalk, and no v1 snapshot to adopt. Collect a season first.'); return 2; }
    console.log(`adopting the season already on the site: ${adopted.season} (${adopted.looks.length} looks)`);
    if (apply) await fs.writeFile(seasonFile(adopted.season), JSON.stringify(adopted), 'utf8');
    fragments = [{file: seasonFile(adopted.season), ...adopted}];
  }

  const config = await readConfig();
  const {snapshot, keep, drop, referenced} = composeSnapshot(fragments, {config});
  console.log(`seasons held : ${keep.join(' · ') || '(none)'}`);
  if (drop.length) console.log(`seasons dropped by the three-season rule: ${drop.join(' · ')}`);

  // Refuse to write a snapshot with nothing in it. An empty read is far more
  // likely to be a broken collection than a real instruction to clear the tab.
  if (!snapshot.looks.length) { console.error('Refusing to publish an empty catwalk: no looks survived composition.'); return 3; }

  let removed = 0;
  const files = await fs.readdir(IMAGES).catch(() => []);
  for (const name of files) {
    if (referenced.has(name)) continue;
    removed++;
    if (apply) await fs.rm(path.join(IMAGES, name), {force: true});
  }
  for (const season of drop) if (apply) await fs.rm(seasonFile(season), {force: true});

  if (apply) await fs.writeFile(SNAPSHOT, JSON.stringify(snapshot) + '\n', 'utf8');
  console.log(`${snapshot.looks.length.toLocaleString()} looks across ${keep.length} season(s); `
    + `${removed.toLocaleString()} rendition(s) ${apply ? 'deleted' : 'would be deleted'}`);
  for (const season of snapshot.seasons) console.log(`  ${season.season}: ${season.looks} looks, ${season.shows} shows`);
  if (!apply) console.log('(dry run - nothing written)');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-catwalk-snapshot.mjs')) {
  process.exit(await main());
}
