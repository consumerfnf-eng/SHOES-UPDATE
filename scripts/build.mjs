import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),html=await fs.readFile(new URL('public/index.html',root),'utf8');
if(Buffer.byteLength(html)>250000)throw Error('Public HTML must remain below 250 KB; crawler/data belongs outside UI.');
if(/SEED_PRODUCTS|__MLB_RUN_SERVER|scheduleDaily\(|s\.jina\.ai|r\.jina\.ai|JINA_API_KEY/.test(html))throw Error('Collection runtime found in public page');
for(const folder of ['collector','internal']){try{await fs.access(new URL(`public/${folder}`,root));throw Error('Private source folder under public');}catch(e){if(e.code!=='ENOENT')throw e;}}
try{await fs.access(new URL('public/data/catalog-source.json',root));throw Error('Raw source must not be deployed');}catch(e){if(e.code!=='ENOENT')throw e;}
// Check all shipped text, including external JS modules; moving a crawler out of HTML
// must not accidentally move it into another public asset.
const publicRoot=fileURLToPath(new URL('public/',root));
async function inspect(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const filename=path.join(directory,entry.name),relative=path.relative(publicRoot,filename).replaceAll('\\','/');
  if(/(?:^|\/)(?:collector|internal|archive-audit|backups|\.env)(?:\/|$)|(?:catalog-source|archive-ledger|archive-report|archive-queue|curation-review)\.json$/.test(relative))throw Error('Private data under public: '+relative);
  if(entry.isDirectory()){await inspect(filename);continue;}
  if(!/\.(?:html|m?js|json|css)$/.test(entry.name))continue;
  const text=await fs.readFile(filename,'utf8');
  if(/JINA_API_KEY|GOOGLE_SERVICE_ACCOUNT_JSON|ARCHIVE_BACKUP_KEY|BEGIN (?:RSA )?PRIVATE KEY|s\.jina\.ai|r\.jina\.ai|__MLB_RUN_SERVER|SEED_PRODUCTS/.test(text))throw Error('Secret/collection runtime in public: '+relative);
}}
await inspect(publicRoot);
const catalog=JSON.parse(await fs.readFile(new URL('public/data/catalog.json',root),'utf8'));
for(const p of catalog.products){
  if(!p.presentation)continue;
  if(!['side','three-quarter'].includes(p.presentation.view))throw Error('Unreviewed photo view: '+p.id);
  const cached=p.presentation.cachedPath;
  if(!/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(cached||''))throw Error('Run npm run photos before publication: '+p.id);
  const bytes=await fs.readFile(new URL('public'+cached,root));
  if(createHash('sha256').update(bytes).digest('hex')!==path.basename(cached).split('.')[0])throw Error('Official photo cache checksum mismatch: '+p.id);
}
const commit=process.env.CF_PAGES_COMMIT_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
await fs.writeFile(new URL('public/deployment.json',root),JSON.stringify({commit,builtAt:new Date().toISOString()},null,2));
console.log(`Validated lightweight static dashboard for ${commit}; HTML ${Buffer.byteLength(html)} bytes.`);
