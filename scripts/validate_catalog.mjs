import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {curateProduct,POLICY,validDay,httpUrl,shiftMonth,validateSignals,popularity,kstDay,officialEvidenceFor} from './curation.mjs';
import {validateSocialMetrics,withSocialComparisons} from './social-metrics.mjs';
import {releaseWindow,releaseState} from '../public/assets/release-window.mjs';
import {SEARCH_CONCEPTS,validPublicSearchConcepts,productCollaborationBrands} from './keyword-taxonomy.mjs';
import {buildKeywordCatalog,KEYWORD_METHOD} from './search-keywords.mjs';
import {buildStyleTrendBoard} from './style-trend-board.mjs';
export function validateSnapshot(catalog) {
  assert.equal(catalog.schemaVersion,1);assert(Array.isArray(catalog.products));assert(Array.isArray(catalog.brands));assert(Array.isArray(catalog.keywords));
  assert(Number.isFinite(Date.parse(catalog.publishedAt)),'Invalid publication timestamp');assert(validDay(catalog.asOf),'Invalid catalog date');
  // Older snapshots used keywordCheckedAt for both collection and evaluation.
  // Maintenance preserves collection time while recomputing expiry at this time.
  const keywordEvaluatedAt=catalog.keywordEvaluatedAt??catalog.keywordCheckedAt;
  assert(Number.isFinite(Date.parse(catalog.keywordCheckedAt)),'Invalid keyword verification time');
  assert(Number.isFinite(Date.parse(keywordEvaluatedAt))&&kstDay(keywordEvaluatedAt)===catalog.asOf,'Invalid keyword evaluation time');
  assert(Date.parse(catalog.keywordCheckedAt)<=Date.parse(keywordEvaluatedAt),'Keyword verification cannot be after evaluation');
  assert.equal(catalog.periodStart,shiftMonth(catalog.asOf,-3),'Wrong calendar cutoff');
  assert.equal(new Set(catalog.products.map(p=>p.id)).size,catalog.products.length,'Duplicate public IDs');
  assert.equal(POLICY.brands.filter(b=>b.mandatory).length,25,'Mandatory policy changed');
  for(const brand of POLICY.brands.filter(b=>b.mandatory))assert(catalog.brands.some(b=>b.name===brand.name),'Missing mandatory brand '+brand.name);
  for(const p of catalog.products) {
    assert(typeof p.id==='string'&&p.id&&typeof p.name==='string'&&p.name.trim(),'Missing product identity');
    assert(catalog.brands.some(b=>b.name===p.brand),'Unknown product brand');
    assert(['sneaker','clog','sandal','platform-sandal','hybrid','jelly','platform-shoe'].includes(p.category),'Invalid product category');
    assert(Array.isArray(p.fit)&&p.fit.length&&p.fit.every(f=>['MLB','DISCOVERY'].includes(f)),'Invalid fit');
    assert(Array.isArray(p.fitReasons)&&p.fitReasons.length,'Missing selection reasons');
    const release=releaseWindow(p),state=releaseState(p,catalog.asOf);
    assert(release,'Invalid verified release day/month');
    assert(['released','upcoming'].includes(state),'Product outside confirmed publication window');
    assert.equal(p.releaseStatus,state,'Wrong release state');
    assert(p.dateEvidence?.verified===true&&['day','month'].includes(p.dateEvidence.precision),'Missing release evidence');
    if(release.precision==='month')assert.deepEqual(p.verifiedReleaseWindow,{start:release.start,end:release.end},'Missing exact month interval');
    assert(httpUrl(p.dateEvidence.url)&&p.dateEvidence.excerpt&&Number.isFinite(Date.parse(p.dateEvidence.verifiedAt)),'Invalid release provenance');
    if(p.releaseStatus==='upcoming')assert(p.dateEvidence.official===true,'Upcoming date must be official');
    assert(httpUrl(p.url)&&httpUrl(p.image)&&httpUrl(p.productEvidenceUrl),'Invalid product/image evidence URL');
    assert(Number.isFinite(Date.parse(p.lastVerifiedAt)),'Invalid product verification timestamp');
    assert(Array.isArray(p.sourceSignals),'Missing signal list');
    assert(Array.isArray(p.searchConceptIds)&&p.searchConceptIds.every(id=>SEARCH_CONCEPTS.some(c=>c.id===id)),'Invalid product search concepts');
    assert(validPublicSearchConcepts(p),'Product search concept conflicts with its public brand/model/category/color facts');
    assert.equal(validateSignals(p.sourceSignals,catalog.asOf).length,p.sourceSignals.length,'Unverified or expired public signal');
    const official=officialEvidenceFor(p,catalog.asOf);
    if(p.officialProductEvidence||p.officialImageEvidence){assert(official,'Invalid official product/image proof');assert.deepEqual(p.officialProductEvidence,official.officialProductEvidence,'Invalid official model identity');assert.deepEqual(p.officialImageEvidence,official.officialImageEvidence,'Invalid official image fields');}
    assert.deepEqual(p.collaborationBrands,official?productCollaborationBrands(p):[],'Unverified collaborator brand');
    assert(Array.isArray(p.socialMetrics),'Missing social metric list');
    assert.deepEqual(p.popularity,popularity(p.sourceSignals,catalog.asOf,{product:p,socialMetrics:validateSocialMetrics(p,catalog.asOf,{officialEligible:!!official,now:keywordEvaluatedAt}),officialEligible:!!official,now:keywordEvaluatedAt}),'Unsubstantiated popularity flag');
    const r=curateProduct({...p,productVerifiedAt:p.lastVerifiedAt,productEvidenceUrl:p.productEvidenceUrl,hybridReview:p.hybridReview,modelReview:p.modelReview},catalog.asOf);
    assert(r.product&&!r.expired,`Ineligible published product ${p.id}: ${r.reason||'expired'}`);
  }
  const socialExpected=withSocialComparisons(catalog.products.map(p=>({...p,socialMetrics:validateSocialMetrics(p,catalog.asOf,{officialEligible:!!officialEvidenceFor(p,catalog.asOf),now:keywordEvaluatedAt})})));
  assert.deepEqual(catalog.products.map(p=>p.socialMetrics),socialExpected.map(p=>p.socialMetrics),'Unverified social metrics or invalid comparison ranks');
  const ids=new Set(catalog.products.map(p=>p.id));
  assert.equal(catalog.keywordMethod,KEYWORD_METHOD,'Unverified keyword ranking method');
  assert(Array.isArray(catalog.sourceRanks)&&Array.isArray(catalog.forecastKeywords)&&Array.isArray(catalog.searchRankStatus),'Missing source rankings or forecast list');
  const keywords=[...catalog.keywords,...catalog.forecastKeywords];
  assert.equal(new Set(keywords.map(k=>k.id)).size,keywords.length,'Duplicate keyword IDs');
  for(const keyword of keywords){
    assert.equal(keyword.keywordType,'style','Non-style keyword in trend list');
    assert(keyword.id&&keyword.label,'Missing keyword identity');assert(Array.isArray(keyword.productIds),'Missing keyword matches');
    assert(keyword.productIds.every(id=>ids.has(id)),'Keyword references absent product');
    assert.equal(keyword.matchedProductCount,new Set(keyword.productIds).size,'Keyword matched count mismatch');
    assert(Array.isArray(keyword.sourceRanks)&&keyword.sourceRanks.length,'Missing original keyword sources');
    assert(keyword.sourceRanks.some(s=>s.term===keyword.label),'Keyword label is not an original source term');
    assert.equal(keyword.sourceCount,new Set(keyword.sourceRanks.map(s=>s.platform)).size,'Keyword source count mismatch');
  }
  const expected=buildKeywordCatalog(catalog.products,catalog.sourceRanks,{now:keywordEvaluatedAt});
  assert.deepEqual(catalog.sourceRanks,expected.sourceRanks,'Invalid, expired or superseded original keyword source');
  assert.deepEqual(catalog.keywords,expected.keywords,'Current keyword score, original label or complete product matches differ from verified sources');
  assert.deepEqual(catalog.forecastKeywords,expected.forecastKeywords,'Forecast cannot affect the current popularity rank or broaden source terms');
  if(catalog.styleTrendKeywords?.method==='verified-style-board-v1')assert.deepEqual(catalog.styleTrendKeywords,buildStyleTrendBoard(catalog.products,catalog.styleTrendKeywords.observations,{now:keywordEvaluatedAt,updated:catalog.styleTrendKeywords.updated,sourceRanks:catalog.sourceRanks}),'Style board must match fresh evidence and bilingual product attributes');
  return true;
}
if(process.argv[1]?.endsWith('validate_catalog.mjs')){const c=JSON.parse(await fs.readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));validateSnapshot(c);console.log(`PASS: ${c.products.length} products; mandatory25; exact dates, fit, taxonomy and calendar window.`);}
