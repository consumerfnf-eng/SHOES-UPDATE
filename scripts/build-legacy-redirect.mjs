// The retired public project only redirects to the authenticated primary site.
// Never upload catalogues, product photos or premium data to that project.
import fs from 'node:fs/promises';
const directory=new URL('../public-redirect/',import.meta.url);
const allowed=new Set(['index.html','_redirects','_headers']);
await fs.mkdir(directory,{recursive:true});
for(const name of await fs.readdir(directory))if(!allowed.has(name))throw Error('Unexpected file in legacy redirect output: '+name);
await fs.writeFile(new URL('index.html',directory),'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=https://shoes-update-internal.pages.dev/"><title>SHOES — 새 사이트로 이동</title><p><a href="https://shoes-update-internal.pages.dev/">새 SHOES 사이트로 이동</a></p></html>\n');
await fs.writeFile(new URL('_redirects',directory),'/* https://shoes-update-internal.pages.dev/:splat 302\n');
await fs.writeFile(new URL('_headers',directory),'/*\n  Cache-Control: no-store\n  X-Robots-Tag: noindex\n');
console.log('Legacy redirect ready: 3 small files; no product or premium assets.');
