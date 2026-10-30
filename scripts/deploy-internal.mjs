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
// then put the project behind Cloudflare Access - see docs/internal-deployment.md.
// Access is what makes this internal; this script will not deploy without
// being told the policy is in place.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const PROJECT = process.env.INTERNAL_PAGES_PROJECT || 'shoes-update-internal';

async function exists(file) {
  try { await fs.stat(path.join(root, file)); return true; } catch { return false; }
}

async function count(dir) {
  try { return (await fs.readdir(path.join(root, dir))).length; } catch { return 0; }
}

const confirmed = process.argv.includes('--access-policy-in-place')
  || process.env.INTERNAL_ACCESS_POLICY_IN_PLACE === 'true';

const snapshot = await exists('public/data/catwalk.json');
const renditions = await count('public/catwalk');

console.log(`internal deployment of "${PROJECT}"`);
console.log(`  catwalk snapshot : ${snapshot ? 'present' : 'MISSING - run npm run catwalk'}`);
console.log(`  renditions       : ${renditions.toLocaleString()} files`);

if (!snapshot || !renditions) {
  console.error('\nNothing to deploy internally. Build the cards first:\n'
    + '  npm run catwalk -- "<the collection folder>"');
  process.exit(2);
}
if (!confirmed) {
  console.error('\nRefusing to deploy: this project must sit behind Cloudflare Access before\n'
    + 'subscription imagery goes on it. Set the policy (docs/internal-deployment.md),\n'
    + 'then re-run with --access-policy-in-place.');
  process.exit(3);
}

// A Pages project serves whatever is uploaded, so the upload is the whole
// public/ folder - the same site, with the catwalk files present.
const args = ['wrangler', 'pages', 'deploy', 'public',
              '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true'];
console.log(`\n> npx ${args.join(' ')}\n`);
const run = spawnSync('npx', args, {cwd: root, stdio: 'inherit', shell: process.platform === 'win32'});
process.exit(run.status ?? 1);
