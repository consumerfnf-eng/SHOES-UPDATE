// Republish a collection whose own run could not push it.
//
// A weekly collection takes over an hour. If main moves while it runs - a
// hand-made commit, another workflow - the publish step has to rebase, and
// every file it carries is a *generated* one: catalog-source.json,
// public/data/catalog.json, curation-review.json, archive-queue.json. Git
// cannot merge those; it conflicted three times and the run threw away
// 1,277 verified products, 192 of them from brands that had never been
// collected before.
//
// The collection itself is not lost in that situation: `onProgress` writes
// every verified record to logs/weekly-progress.json as it goes, and the
// workflow uploads that file as an artifact. This script takes that file,
// merges its products into the current catalogue the ordinary way - by id,
// through mergePreserving, on top of whatever main now holds - and
// republishes. Nothing is overwritten, so running it twice is a no-op, and
// running it on top of a newer collection keeps the newer records.
//
//   node scripts/recover-collection.mjs logs/weekly-progress.json
//
// The publish step uses it too (see .github/workflows/weekly-update.yml): on
// a rebase conflict it resets to origin/main and re-applies the collection
// through this path instead of asking git to merge generated JSON.
import {fileURLToPath} from 'node:url';
import {publishCurated,readJson,atomicJson} from './publish-curated.mjs';
import {mergePreserving} from './collect-evidence.mjs';
import {maisonShelfProduct} from './new-arrivals.mjs';
import {isLuxuryMaison} from './luxury-shelves.mjs';

const root=new URL('../',import.meta.url);

/** The collection record to store, from a progress file plus whatever the
 *  catalogue already knows.
 *
 *  Only the fields a collection actually establishes are taken from the
 *  progress file. Keyword ranks, the source directory and the social status
 *  are separate collections with their own evidence, and a recovery must not
 *  claim to have re-checked them: those are carried from the snapshot that
 *  is already published.
 */
export function recoveredCollection(progress,previous={}) {
  const coverage=progress.coverage||[];
  return {...previous,
    checkedAt:progress.checkedAt||previous.checkedAt,
    lastSuccessfulCollectionAt:progress.completedAt||progress.checkedAt||previous.lastSuccessfulCollectionAt,
    coverage,unavailableBrands:coverage.filter(c=>!c.responses).map(c=>c.brand),
    scope:'weekly',selectionBasis:'official-new-arrivals',catalogExhaustive:false,
    ...(progress.brandFingerprint?{brandFingerprint:progress.brandFingerprint}:{})};
}

export async function recoverCollection({file,now=new Date(),log=console.log}) {
  const progress=await readJson(file);
  const verified=progress.products||[];
  if(!verified.length)throw Error('RECOVER_NO_PRODUCTS: the progress file carries no verified records');
  // A maison candidate the run never got to check is not waste either: the
  // shelf it was found on is the brand's own page, and for these shops that
  // is the whole of what can be known. Same rule as the collection applies
  // (scripts/new-arrivals.mjs), so recovering and collecting agree.
  const shelfBasis=[];
  for(const entry of progress.pending||[]){
    if(!isLuxuryMaison(entry.brand)||!entry.candidate?.url)continue;
    try{const p=maisonShelfProduct(entry.candidate,progress.checkedAt||new Date(now).toISOString());if(p)shelfBasis.push(p);}catch{}
  }
  const seen=new Set(verified.map(p=>p.id));
  const products=[...verified,...shelfBasis.filter(p=>!seen.has(p.id)&&seen.add(p.id))];
  if(shelfBasis.length)log(`${products.length-verified.length} maison cards taken on their shelf's authority.`);
  const sourceFile=new URL('data/catalog-source.json',root);
  const source=await readJson(sourceFile);
  const before=source.products.length;
  source.products=mergePreserving(source.products,products);
  source.collection=recoveredCollection(progress,source.collection||{});
  await atomicJson(sourceFile,source);
  // Candidates this run found but never got to verify are the next run's
  // head start, not waste. See scripts/new-arrivals.mjs.
  if(Array.isArray(progress.pending)&&progress.pending.length)
    await atomicJson(new URL('data/pending-candidates.json',root),
      {schemaVersion:1,savedAt:new Date(now).toISOString(),checkedAt:progress.checkedAt||null,candidates:progress.pending});
  log(`Recovered ${products.length} collected records (${source.products.length-before} new); ${progress.coverage?.length||0} brands in coverage.`);
  const result=await publishCurated({now:new Date(now),incoming:products,collection:source.collection});
  log(`Republished: ${result.snapshot.products.length} public products; ${result.review.held.length} held.`);
  return result;
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const file=process.argv[2];
  if(!file){console.error('usage: node scripts/recover-collection.mjs <weekly-progress.json>');process.exit(2);}
  await recoverCollection({file});
}
