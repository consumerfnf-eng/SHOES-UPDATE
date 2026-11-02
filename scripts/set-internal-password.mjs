// Sets (or rotates) the shared password that gates the internal deployment.
// See functions/_middleware.js and docs/internal-deployment.md.
import {spawnSync} from 'node:child_process';

const PROJECT = process.env.INTERNAL_PAGES_PROJECT || 'shoes-update-internal';
const args = ['wrangler', 'pages', 'secret', 'put', 'INTERNAL_SITE_PASSWORD',
              '--project-name', PROJECT];
console.log(`> npx ${args.join(' ')}`);
console.log('(paste the password at the prompt - it will not echo)');
const run = spawnSync('npx', args, {stdio: 'inherit', shell: process.platform === 'win32'});
process.exit(run.status ?? 1);
