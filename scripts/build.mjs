import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const html = await fs.readFile(new URL('public/index.html', root), 'utf8');
if (Buffer.byteLength(html) >= 25 * 1024 * 1024) throw Error('index.html exceeds the Cloudflare Pages asset limit');
for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (!/src=|application\/ld\+json/.test(script[1])) new vm.Script(script[2]);
}
const commit = process.env.CF_PAGES_COMMIT_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await fs.writeFile(new URL('public/deployment.json', root), JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2));
console.log(`Validated static dashboard for ${commit}`);
