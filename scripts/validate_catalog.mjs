import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {curateProduct,POLICY,validDay,httpUrl,shiftMonth,validateSignals,popularity} from './curation.mjs';
export function validateSnapshot(catalog) {
  assert.equal(catalog.schemaVersion,1);assert(Array.isArray(catalog.products));assert(Array.isArray(catalog.brands));assert(Array.isArray(catalog.keywords));
  assert(Number.isFinite(Date.parse(catalog.publishedAt)),'Invalid publication timestamp');assert(validDay(catalog.asOf),'Invalid catalog date');
  assert.equal(catalog.periodStart,shiftMonth(catalog.asOf,-3),'Wrong calendar cutoff');
  assert.equal(new Set(catalog.products.map(p=>p.id)).size,catalog.products.length,'Duplicate public IDs');
  assert.equal(POLICY.brands.filter(b=>b.mandatory).length,25,'Mandatory policy changed');
  for(const brand of POLICY.brands.filter(b=>b.mandatory))assert(catalog.brands.some(b=>b.name===brand.name),'Missing mandatory brand '+brand.name);
  for(const p of catalog.products) {
    assert(typeof p.id==='string'&&p.id&&typeof p.name==='string'&&p.name.trim(),'Missing product identity');
    assert(catalog.brands.some(b=>b.name===p.brand),'Unknown product brand');
    assert(['sneaker','clog','sandal','platform-sandal','hybrid'].includes(p.category),'Invalid product category');
    assert(Array.isArray(p.fit)&&p.fit.length&&p.fit.every(f=>['MLB','DISCOVERY'].includes(f)),'Invalid fit');
    assert(Array.isArray(p.fitReasons)&&p.fitReasons.length,'Missing selection reasons');
    assert(validDay(p.releaseDate),'Invalid release day');
    assert.equal(p.releaseStatus,p.releaseDate>catalog.asOf?'upcoming':'released','Wrong release state');
    assert(p.releaseDate>=catalog.periodStart&&p.releaseDate<=shiftMonth(catalog.asOf,3),'Product outside publication window');
    assert(p.dateEvidence?.verified===true&&p.dateEvidence.precision==='day','Missing release evidence');
    assert(httpUrl(p.dateEvidence.url)&&p.dateEvidence.excerpt&&Number.isFinite(Date.parse(p.dateEvidence.verifiedAt)),'Invalid release provenance');
    if(p.releaseStatus==='upcoming')assert(p.dateEvidence.official===true,'Upcoming date must be official');
    assert(httpUrl(p.url)&&httpUrl(p.image)&&httpUrl(p.productEvidenceUrl),'Invalid product/image evidence URL');
    assert(Number.isFinite(Date.parse(p.lastVerifiedAt)),'Invalid product verification timestamp');
    assert(Array.isArray(p.sourceSignals),'Missing signal list');
    assert.equal(validateSignals(p.sourceSignals,catalog.asOf).length,p.sourceSignals.length,'Unverified or expired public signal');
    assert.deepEqual(p.popularity,popularity(p.sourceSignals,catalog.asOf),'Unsubstantiated popularity flag');
    const r=curateProduct({...p,productVerifiedAt:p.lastVerifiedAt,productEvidenceUrl:p.productEvidenceUrl,hybridReview:p.hybridReview,modelReview:p.modelReview},catalog.asOf);
    assert(r.product&&!r.expired,`Ineligible published product ${p.id}: ${r.reason||'expired'}`);
  }
  const ids=new Set(catalog.products.map(p=>p.id));
  for(const keyword of catalog.keywords){assert(keyword.id&&keyword.label,'Missing keyword identity');assert(Array.isArray(keyword.productIds)&&keyword.productIds.length,'Empty keyword');assert(keyword.productIds.every(id=>ids.has(id)),'Keyword references absent product');assert.equal(keyword.productCount,new Set(keyword.productIds).size,'Keyword product count mismatch');}
  return true;
}
if(process.argv[1]?.endsWith('validate_catalog.mjs')){const c=JSON.parse(await fs.readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));validateSnapshot(c);console.log(`PASS: ${c.products.length} products; mandatory25; exact dates, fit, taxonomy and calendar window.`);}
