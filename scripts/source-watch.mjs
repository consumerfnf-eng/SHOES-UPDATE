// When we started watching each brand, and when we last read it.
//
// 1,788 records are held for want of a release date, and for most of them no
// release date exists to find: Nike, On, Reebok, Melissa and Dior publish a
// product page with no date on it anywhere. Reading harder will not produce
// one, so the honest question is not "when was it released" but "what can we
// actually prove about when it turned up".
//
// We can prove this much: if we have been reading a brand's listing every
// week since August, and a shoe appears in October that was not there before,
// then it was newly listed in October. That is an observation of our own,
// timestamped and repeatable, and it is never presented as a launch date -
// the site says 최초 확인, the way it already says NEW · 확인 for a shoe found
// on a brand's own new-arrivals page.
//
// The claim only holds while the watch does, which is why it is written down
// rather than assumed. A brand read for the first time this week tells us
// nothing: everything on its shelf is new to us and old to the world. Those
// stay held until a second read gives something to compare against.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WATCH_FILE = 'data/source-watch.json';
const day = value => (Number.isFinite(Date.parse(value))
  ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10) : '');

/** A brand is being watched from the first day we read its listing and got
 *  something back. Reads that failed do not count: a week when a brand's site
 *  refused us is a week we were not watching, and a shoe that appeared during
 *  it cannot be called new on our say-so. */
export function updateWatch(prior, {coverage = [], products = [], checkedAt}) {
  const today = day(checkedAt) || day(new Date().toISOString());
  const brands = {...(prior?.brands || {})};

  // Seed from what the collected records already show. The earliest record we
  // hold of a brand is the earliest we can claim to have been reading it.
  for (const p of products) {
    const seen = day(p.firstSeen);
    if (!p.brand || !seen) continue;
    const entry = brands[p.brand] || (brands[p.brand] = {watchingSince: seen, lastReadAt: '', reads: 0});
    if (seen < entry.watchingSince) entry.watchingSince = seen;
  }

  for (const source of coverage) {
    if (!source?.brand) continue;
    const answered = (source.responses || 0) > 0 && !['failed', 'blocked', 'unavailable'].includes(source.status);
    const entry = brands[source.brand] || (brands[source.brand] = {watchingSince: today, lastReadAt: '', reads: 0});
    if (!answered) { entry.lastFailedAt = today; continue; }
    if (!entry.watchingSince || today < entry.watchingSince) entry.watchingSince = today;
    // A gap in the reading restarts the claim. We cannot say a shoe is new to
    // the shelf if we looked away for a month while it arrived.
    if (entry.lastReadAt && daysBetween(entry.lastReadAt, today) > 21) {
      entry.watchingSince = today;
      entry.restartedAt = today;
      entry.restartReason = `${daysBetween(entry.lastReadAt, today)}일 동안 읽지 못함`;
    }
    entry.lastReadAt = today;
    entry.reads = (entry.reads || 0) + 1;
  }
  return {schemaVersion: 1, updatedAt: new Date().toISOString(), brands};
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

export async function main() {
  const source = JSON.parse(await fs.readFile(path.join(root, 'data/catalog-source.json'), 'utf8'));
  let prior = {brands: {}};
  try { prior = JSON.parse(await fs.readFile(path.join(root, WATCH_FILE), 'utf8')); } catch {}
  const watch = updateWatch(prior, {
    coverage: source.collection?.coverage || [],
    products: source.products || [],
    checkedAt: source.collection?.checkedAt,
  });
  await fs.writeFile(path.join(root, WATCH_FILE), JSON.stringify(watch, null, 2) + '\n');
  const entries = Object.entries(watch.brands);
  const earliest = entries.map(([, v]) => v.watchingSince).filter(Boolean).sort()[0] || '-';
  console.log(`watching ${entries.length} brands · earliest since ${earliest}`);
  const restarted = entries.filter(([, v]) => v.restartedAt);
  if (restarted.length) console.log(`watch restarted after a gap: ${restarted.map(([b]) => b).join(', ')}`);
  return watch;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href.replace('file:////', 'file:///'))
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
