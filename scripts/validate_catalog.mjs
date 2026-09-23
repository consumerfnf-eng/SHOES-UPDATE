import fs from 'node:fs/promises';import assert from 'node:assert/strict';import vm from 'node:vm';
const root=new URL('../',import.meta.url),read=async name=>JSON.parse(await fs.readFile(new URL(name,root),'utf8'));
const products=await read('data/catalog-2026-09-23.json'),audit=await read('data/catalog-audit-2026-09-23.json');
assert.equal(products.length,audit.addedRecords);assert.equal(audit.coverage.length,116);assert.equal(new Set(audit.coverage.map(b=>b.brand)).size,116);assert.equal(audit.complete,false);
assert.equal(new Set(products.map(p=>p.id)).size,products.length);assert.equal(new Set(products.map(p=>p.url)).size,products.length);
for(const p of products){
 assert(new URL(p.url).hostname.includes('.'));assert(new URL(p.image).hostname.includes('.'));assert(new URL(p.sourceEvidence.url).hostname.includes('.'));
 assert.equal(p.productType,'sneaker');assert(p.name.length>=3&&p.name.length<=135);assert.equal(p.imageValidation.status,'verified');assert(p.imageValidation.width>=120&&p.imageValidation.height>=100);assert(/^#[\dA-F]{6}$/i.test(p.primaryColor.hex));
 if(p.releaseDate){assert(p.sourceEvidence.releaseDateConfirmed);assert(p.releaseDate>=audit.window.from);assert(p.releaseDate<=audit.window.to||p.status==='upcoming');}else assert(!p.sourceEvidence.releaseDateConfirmed);
}
const html=await fs.readFile(new URL('public/index.html',root),'utf8');
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/src=|application\/ld\+json/.test(m[1]))new vm.Script(m[2]);
for(const p of products)assert(html.includes(JSON.stringify(p.id)),'Missing embedded product '+p.id);
console.log(`PASS: ${products.length} unique verified sneakers, 116 coverage rows, release-date provenance, image metadata, embedded catalog and JavaScript syntax.`);
