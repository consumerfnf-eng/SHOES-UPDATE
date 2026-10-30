import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {curateProduct,POLICY,validDay,httpUrl,shiftMonth,validateSignals,popularity,kstDay,officialEvidenceFor,inPublishedScope} from './curation.mjs';
import {validateSocialMetrics,withSocialComparisons} from './social-metrics.mjs';
import {releaseWindow,releaseState} from '../public/assets/release-window.mjs';
import {hasArrivalEvidence,publicationWindow} from '../public/assets/publication-window.mjs';
import {hasObservedArrival} from '../public/assets/observed-arrival.mjs';
import {SEARCH_CONCEPTS,validPublicSearchConcepts,productCollaborationBrands} from './keyword-taxonomy.mjs';
import {buildKeywordCatalog,KEYWORD_METHOD} from './search-keywords.mjs';
import {buildStyleTrendBoard} from './style-trend-board.mjs';
export function validateSnapshot(catalog, {watch=null}={}) {
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
    // The publishable set lives in curation.mjs. Listing it again here let the
    // two drift: the scope gained slipper and loafer, the validator did not, and
    // the build - which Pages runs - refused the catalogue it had just curated.
    assert(inPublishedScope(p.category),'Invalid product category: '+p.category);
    // Brand fit no longer exists: it was a keyword guess that held back 1,600
    // verified products. Its reasons survive as optional planning notes.
    assert(p.fit===undefined,'Brand fit was removed and must not be republished');
    assert(p.fitReasons===undefined||Array.isArray(p.fitReasons),'Invalid selection reasons');
    const release=releaseWindow(p),state=releaseState(p,catalog.asOf);
    const arrival=hasArrivalEvidence(p,catalog.asOf);
    // A shoe that turned up on a brand's shelf while we were watching it is
    // dated by that observation, which is the third thing a record can stand
    // on. Curation has published on it since the watch was written down; this
    // list had only the first two, so the first run where the watch actually
    // carried a product failed the build and 1,133 products never left CI.
    const observed=!!p.observedArrivalAt&&validDay(p.observedArrivalAt)
      &&(!watch||hasObservedArrival(p,catalog.asOf,watch));
    assert(release||arrival||observed,'Missing release, New Arrivals or observed-arrival evidence');
    assert(['released','upcoming'].includes(state),'Product outside confirmed publication window');
    assert.equal(p.releaseStatus,state,'Wrong release state');
    if(!arrival&&!observed){
      assert(p.dateEvidence?.verified===true&&['day','month'].includes(p.dateEvidence.precision),'Missing release evidence');
      assert(httpUrl(p.dateEvidence.url)&&p.dateEvidence.excerpt&&Number.isFinite(Date.parse(p.dateEvidence.verifiedAt)),'Invalid release provenance');
    }
    if(release?.precision==='month')assert.deepEqual(p.verifiedReleaseWindow,{start:release.start,end:release.end},'Missing exact month interval');
    if(catalog.retentionBasis==='first-published')assert(publicationWindow(p),'Missing first publication timestamp');
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
if(process.argv[1]?.endsWith('validate_catalog.mjs')){const c=JSON.parse(await fs.readFile(new URL('../public/data/catalog.json',import.meta.url),'utf8'));
  // The same watch curation published on, so an observed arrival is checked
  // against the record of when we started reading that brand's shelf.
  const watch=await fs.readFile(new URL('../data/source-watch.json',import.meta.url),'utf8').then(JSON.parse).catch(()=>null);
  validateSnapshot(c,{watch});console.log(`PASS: ${c.products.length} products; mandatory25; exact dates, taxonomy and calendar window.`);}
