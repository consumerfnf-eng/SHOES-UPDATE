// Deploy the internal build: the same dashboard, plus the WGSN catwalk.
//
// Why a second project and not a path on the public one
// -----------------------------------------------------
// This repository is public. A `/internal/` path in it would put the
// subscription imagery on github.com for anyone to fetch, whichever access
// control the site itself carried - so the renditions are gitignored and
// never committed. They reach the internal project by direct upload from
// this machine instead, which means they exist in exactly two places: the
// collecting PC and an access-controlled deployment.
//
// Nothing conditional is needed in the page. The public build simply has no
// public/data/catwalk.json, and the CATWALK tab hides itself when there are
// no looks behind it; the internal build has the file, so the tab appears.
//
// Before the first run
// --------------------
//   npx wrangler login                     once, in a browser
//   npx wrangler pages project create shoes-update-internal --production-branch main
//   npm run internal:set-password
// then re-run this script. The password (functions/_middleware.js) is what
// makes this project internal; this script will not deploy without one set
// on the project - see docs/internal-deployment.md.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareDeploymentAssets,removeDeploymentAssets} from './deployment-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const PROJECT = process.env.INTERNAL_PAGES_PROJECT || 'shoes-update-internal';

async function exists(file) {
  try { await fs.stat(path.join(root, file)); return true; } catch { return false; }
}

async function count(dir) {
  try { return (await fs.readdir(path.join(root, dir))).length; } catch { return 0; }
}

function passwordIsSet(project) {
  const list = spawnSync('npx', ['wrangler', 'pages', 'secret', 'list', '--project-name', project],
    {cwd: root, encoding: 'utf8', shell: process.platform === 'win32'});
  return list.status === 0 && /INTERNAL_SITE_PASSWORD/.test(list.stdout ?? '');
}

const snapshot = await exists('public/data/catwalk.json');
const renditions = await count('public/catwalk');
const appHtml=await fs.readFile(path.join(root,'public/index.html'),'utf8');
if(appHtml.includes('data-source="brief"')){
 const brief=JSON.parse(await fs.readFile(path.join(root,'public/data/season-proposals.json'),'utf8'));
 if(brief.schemaVersion!==2||!Array.isArray(brief.ideas)||['27SS','27FW','28SS'].some(s=>brief.ideas.filter(i=>i.season===s).length<5))throw Error('Season proposals missing or incomplete; run npm run build before deployment');
 for(const board of [...brief.ideas,...Object.values(brief.seasonBoards)])for(const asset of [board.download,board.preview])if(!await exists('public/'+asset.replace(/^\//,'')))throw Error('Proposal asset missing: '+asset);
 for(const idea of brief.ideas)for(const ref of idea.references)for(const asset of [ref.image,ref.original])if(!await exists('public/'+asset.replace(/^\//,'')))throw Error('Proposal reference missing: '+asset);
}
if(appHtml.includes('data-source="forecast"')){
 if(!await exists('public/data/forecast.json')||!await count('public/forecast'))throw Error('Forecast assets missing; refusing to erase the existing internal research library');
 const research=JSON.parse(await fs.readFile(path.join(root,'public/data/forecast.json'),'utf8'));
 for(const report of research.reports||[])for(const asset of [report.cover,...report.pages])if(!await exists('public/'+asset.replace(/^\//,'')))throw Error('Forecast asset missing: '+asset);
}

console.log(`internal deployment of "${PROJECT}"`);
console.log(`  catwalk snapshot : ${snapshot ? 'present' : 'MISSING - run npm run catwalk'}`);
console.log(`  renditions       : ${renditions.toLocaleString()} files`);

if (!snapshot || !renditions) {
  console.error('\nNothing to deploy internally. Build the cards first:\n'
    + '  npm run catwalk -- "<the collection folder>"');
  process.exit(2);
}
console.log('  checking INTERNAL_SITE_PASSWORD is set on the project...');
if (!passwordIsSet(PROJECT)) {
  console.error('\nRefusing to deploy: no INTERNAL_SITE_PASSWORD secret is set on this project,\n'
    + 'so the password gate (functions/_middleware.js) would pass every request through.\n'
    + 'Set one first:\n'
    + '  npm run internal:set-password\n'
    + 'then re-run this script. See docs/internal-deployment.md.');
  process.exit(3);
}

// A Pages project serves whatever is uploaded, so the upload is the whole
// public/ folder - the same site, with the catwalk files present.
const staged=await prepareDeploymentAssets(path.join(root,'public'));
// Compile the password middleware explicitly: the upload directory is temporary
// and must never rely on Wrangler discovering a neighbouring functions folder.
// Wrangler's deprecated --outfile emits multipart upload data, not JavaScript.
// Advanced-mode Pages accepts an _worker.js directory with an index.js module.
const worker=path.join(staged.directory,'_worker.js');
const compiled=spawnSync('npx',['wrangler','pages','functions','build',path.join(root,'functions'),
  '--outdir',worker,'--project-directory',root,'--build-output-directory',staged.directory],
  {cwd:root,stdio:'inherit',shell:process.platform==='win32'});
if(compiled.status!==0)throw Error('Internal password middleware compilation failed; upload cancelled');
const workerSource=await fs.readFile(path.join(worker,'index.js'),'utf8');
if(!workerSource.includes('INTERNAL_SITE_PASSWORD'))throw Error('Password gate absent from compiled worker; upload cancelled');
const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:workerSource,encoding:'utf8'});
if(syntax.status!==0)throw Error('Compiled password worker is not a JavaScript module; upload cancelled');
await fs.mkdir(path.join(root,'logs'),{recursive:true});
await fs.writeFile(path.join(root,'logs/internal-assets-receipt.json'),JSON.stringify(staged.manifest,null,2)+'\n');
console.log(`  serving ${staged.manifest.referencedPhotos} referenced photos; ${staged.manifest.unusedPhotosOmitted} unused cached files omitted from upload`);
const args = ['wrangler', 'pages', 'deploy', staged.directory,
              '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true'];
console.log(`\n> npx ${args.join(' ')}\n`);
const run = spawnSync('npx', args, {cwd: root, stdio: 'inherit', shell: process.platform === 'win32'});
if(run.status===0)await removeDeploymentAssets(staged.directory);
process.exit(run.status ?? 1);
