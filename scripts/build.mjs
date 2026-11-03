import {buildCatalogChunks} from './build-catalog-chunks.mjs';
import {isSiteBrandAllowed,canonicalSiteBrand} from '../public/assets/site-brand-policy.mjs';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readJson,atomicJson,publishCurated} from './publish-curated.mjs';
import {finalizeCatalogIdentity} from './finalize-catalog-identity.mjs';
import {encodeCatalog,decodeCatalog} from '../public/assets/catalog-wire.mjs';
import {publicPublicationStatus} from './publication-status.mjs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),html=await fs.readFile(new URL('public/index.html',root),'utf8');
if(Buffer.byteLength(html)>250000)throw Error('Public HTML must remain below 250 KB; crawler/data belongs outside UI.');
if(/SEED_PRODUCTS|__MLB_RUN_SERVER|scheduleDaily\(|s\.jina\.ai|r\.jina\.ai|JINA_API_KEY/.test(html))throw Error('Collection runtime found in public page');
for(const folder of ['collector','internal']){try{await fs.access(new URL(`public/${folder}`,root));throw Error('Private source folder under public');}catch(e){if(e.code!=='ENOENT')throw e;}}
try{await fs.access(new URL('public/data/catalog-source.json',root));throw Error('Raw source must not be deployed');}catch(e){if(e.code!=='ENOENT')throw e;}
// Check all shipped text, including external JS modules; moving a crawler out of HTML
// must not accidentally move it into another public asset.
// The retailer boards are published as their own file: a reader on the data
// tab should not wait for them, and the grid does not use them at all.
try {
  const boards = await fs.readFile(new URL('data/rank-boards.json', root), 'utf8');
  const parsed = JSON.parse(boards);
  const scopedBoards=parsed.boards.filter(board=>board.items?.length);
  const published = {schemaVersion: parsed.schemaVersion, checkedAt: parsed.checkedAt, boards: scopedBoards};
  await fs.writeFile(new URL('public/data/rank-boards.json', root), JSON.stringify(published) + '\n');
  console.log(`Published ${parsed.boards.filter(b => b.items?.length).length} retailer ranking boards.`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const publicRoot=fileURLToPath(new URL('public/',root));
async function inspect(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const filename=path.join(directory,entry.name),relative=path.relative(publicRoot,filename).replaceAll('\\','/');
  if(/(?:^|\/)(?:collector|internal|archive-audit|backups|\.env)(?:\/|$)|(?:catalog-source|archive-ledger|archive-report|archive-queue|curation-review|curation-summary)\.json$/.test(relative))throw Error('Private data under public: '+relative);
  if(entry.isDirectory()){await inspect(filename);continue;}
  if(!/\.(?:html|m?js|json|css)$/.test(entry.name))continue;
  const text=await fs.readFile(filename,'utf8');
  if(/JINA_API_KEY|GOOGLE_SERVICE_ACCOUNT_JSON|ARCHIVE_BACKUP_KEY|BEGIN (?:RSA )?PRIVATE KEY|s\.jina\.ai|r\.jina\.ai|__MLB_RUN_SERVER|SEED_PRODUCTS/.test(text))throw Error('Secret/collection runtime in public: '+relative);
}}
await inspect(publicRoot);
let catalog=JSON.parse(await fs.readFile(new URL('public/data/catalog.json',root),'utf8'));
// A presentation can be assigned after `npm run photos` already ran (a later
// re-curation inside that same step, or a recovered collection) and reach this
// file with no cached image. That used to abort the whole weekly deploy over
// one shoe; now it is held the same way an unfetchable photo already is
// (cache-product-photos.mjs), and the snapshot is rebuilt so every section -
// keywords, style board, counts - still agrees with the products left in it.
const missing=catalog.products.filter(p=>p.presentation&&!/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(p.presentation.cachedPath||''));
if(missing.length){
  const cache=await readJson(new URL('data/photo-cache.json',root),{schemaVersion:1,images:{},unavailable:{}});
  cache.unavailable={...cache.unavailable,...Object.fromEntries(missing.map(p=>[p.presentation.image,{error:'no cached image at build time',checkedAt:new Date().toISOString()}]))};
  await atomicJson(new URL('data/photo-cache.json',root),cache);
  console.log(`Held ${missing.length} product(s) with no cached photo at build time: ${missing.map(p=>p.id).join(', ')}`);
  catalog=(await publishCurated({})).snapshot;
}
await finalizeCatalogIdentity();
catalog=JSON.parse(await fs.readFile(new URL('public/data/catalog.json',root),'utf8'));
publicPublicationStatus(catalog);
const monthly=await readJson(new URL('public/data/monthly-catalog.json',root),{retail:[]});
for(const p of monthly.retail||[]){
  const cached=p.presentation?.cachedPath;if(!cached)continue;
  if(!/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(cached))throw Error('Invalid retail photo cache: '+p.id);
  const bytes=await fs.readFile(new URL('public'+cached,root));
  if(createHash('sha256').update(bytes).digest('hex')!==path.basename(cached).split('.')[0])throw Error('Retail photo cache checksum mismatch: '+p.id);
}
for(const p of catalog.products){
  if(!p.presentation)continue;
  // 'product-photo' is the brand's own representative image at whatever
  // angle it chose; the two named views are stills confirmed as such.
  if(!['side','three-quarter','product-photo'].includes(p.presentation.view))throw Error('Unreviewed photo view: '+p.id);
  const cached=p.presentation.cachedPath;
  if(!/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(cached||''))throw Error('Run npm run photos before publication: '+p.id);
  const bytes=await fs.readFile(new URL('public'+cached,root));
  if(createHash('sha256').update(bytes).digest('hex')!==path.basename(cached).split('.')[0])throw Error('Official photo cache checksum mismatch: '+p.id);
}
const commit=process.env.CF_PAGES_COMMIT_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
execFileSync('python',['scripts/build-card-thumbnails.py'],{cwd:root,stdio:'inherit'});
catalog=JSON.parse(await fs.readFile(new URL('public/data/catalog.json',root),'utf8'));
publicPublicationStatus(catalog);
await fs.writeFile(new URL('public/data/catalog.json',root),JSON.stringify(catalog)+'\n');
await buildCatalogChunks(catalog,path.join(publicRoot,'data'));
const wire=encodeCatalog(catalog);
assert.deepEqual(decodeCatalog(JSON.parse(JSON.stringify(wire))),catalog,'The delivered catalogue must preserve every product fact');
await fs.writeFile(new URL('public/data/catalog-ui.json',root),JSON.stringify(wire)+'\n');
// The canonical local JSON is retained for collectors. Direct Upload serves
// its lossless wire representation at both catalogue URLs (see staging).
for(const name of ['catalog-ui.json','monthly-catalog.json'])if((await fs.stat(new URL('public/data/'+name,root))).size>25*1024*1024)throw Error('Pages individual asset limit exceeded: '+name);
const checkedRenditions=new Set();
const renderedMonthly=await readJson(new URL('public/data/monthly-catalog.json',root),{retail:[]});
for(const p of [...catalog.products,...renderedMonthly.retail]){
 const rendered=p.presentation?.thumbnail;if(!rendered)continue;
 if(!/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(rendered.path)||!(rendered.width>0&&rendered.height>0))throw Error('Invalid card rendition: '+p.id);
 if(checkedRenditions.has(rendered.path))continue;
 const bytes=await fs.readFile(new URL('public'+rendered.path,root));
 if(createHash('sha256').update(bytes).digest('hex')!==path.basename(rendered.path).split('.')[0])throw Error('Card rendition checksum mismatch: '+p.id);
 checkedRenditions.add(rendered.path);
}
await fs.writeFile(new URL('public/deployment.json',root),JSON.stringify({commit,builtAt:new Date().toISOString()},null,2));
console.log(`Validated lightweight static dashboard for ${commit}; HTML ${Buffer.byteLength(html)} bytes.`);
