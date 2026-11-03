import {isExcludedBrand} from './brand-exclusions.mjs';
import {isSiteBrandAllowed} from './site-brand-policy.mjs';
import {isPublishedFootwear} from './footwear-policy.mjs';
import {preferOfficialVariants} from './product-identity.mjs';
import {releaseState,preferWomenVariants,unifyVariantGroups,groupProductVariants,variantGroupKey,productBrandNames,trendTermGroups,trendKeywordMatches,overlayReleaseState,keywordProductIds} from './catalog-view.mjs';
import {variantGroupName} from './catalog-view.mjs';
const OVERLAY_SOURCE_LABELS = {'retail-ssense':'SSENSE','retail-musinsa':'무신사','retail-29cm':'29CM','retail-wconcept':'W컨셉','retail-lyst':'Lyst','retail-farfetch':'Farfetch','retail-mytheresa':'Mytheresa','retail-netaporter':'Net-a-Porter','retail-mrporter':'MR PORTER','retail-kith':'Kith'};
function adaptOverlay(item, sources) {
  const source = sources[item.source] || {};
  const hexes = (item.colorSwatches || []).filter(c => /^#[0-9a-f]{6}$/i.test(c));
  return {
    ...item,
    overlay: true,
    retailerLabel: source.label || OVERLAY_SOURCE_LABELS[item.source] || item.source || '',
    listingUrl: source.listingUrl || '',
    checkedAt: source.checkedAt || '',
    fit: [],
    colors: hexes.length ? hexes.map((hex, i) => ({name: i === 0 ? (item.colorway || '') : '', hex}))
                         : (item.colorway ? [{name: item.colorway}] : []),
    presentation: {...item.presentation,image: item.presentation?.image || item.image || ''},
  };
}

function overlayProducts(overlay,today) {
  if (!overlay) return [];
  const sources = overlay.sources || {};
  return [...(overlay.retail || []), ...(overlay.newsletter || [])]
    .filter(item => item && !isExcludedBrand(item.brand) && isSiteBrandAllowed(item.brand) && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.brand === 'string')
    .map(item => adaptOverlay(item, sources))
    .filter(item => isPublishedFootwear(item) && overlayReleaseState(item, today));
}

export function prepareCatalog(catalog,overlay,trends,today) {
  let products=[],brandCounts=new Map(),productGroups=new Map();
  const eligible = catalog.products.filter(p => p && !isExcludedBrand(p.brand) && isSiteBrandAllowed(p.brand) && isPublishedFootwear(p) && releaseState(p,today)==='released' && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.brand === 'string');
  const keywordLabels=new Map();
  for(const k of [...catalog.keywords,...(catalog.forecastKeywords||[])])for(const id of k.productIds||[]){if(!keywordLabels.has(id))keywordLabels.set(id,new Set());for(const label of [k.label,...(k.aliases||[])])keywordLabels.get(id).add(label);}
  products = preferWomenVariants(eligible).map(p => ({...p,keywords:[...new Set([...(p.keywords||[]),...(keywordLabels.get(p.id)||[])])]}));
  products = products.concat(overlayProducts(overlay,today));
  products = preferOfficialVariants(products);
  // Mark everything this week's trend keywords actually match, so the SNS tab
  // can show the real items behind a hashtag instead of only the hashtag.
  // How many of this week's trending hashtags name each item. One match puts
  // it on the SNS tab; the count is what orders it there, so the items the
  // most hashtags are talking about come first.
  // Which records are the same shoe, worked out once over the whole list -
  // the official catalogue and the retail overlay together - so a card is the
  // same card whichever tab it is seen from.
  unifyVariantGroups(products);
  const keywordTerms=(trends?.keywords||[]).map(k=>trendTermGroups(k)).filter(t=>t.length);
  if(keywordTerms.length)for(const p of products){
    const hits=keywordTerms.filter(terms=>trendKeywordMatches(p,terms)).length;
    if(hits){p.snsTrending=true;p.snsTrendMatches=hits;}
  }
  brandCounts = new Map();
  const allGroups=groupProductVariants(products);
  productGroups=new Map(allGroups.map(group=>[variantGroupKey(group[0]),group]));
  allGroups.forEach(group => [...new Set(group.flatMap(p=>productBrandNames(p,today)))].forEach(brand=>brandCounts.set(brand,(brandCounts.get(brand)||0)+1)));
  const keywordViews=new Map();
  for(const keyword of catalog.styleTrendKeywords?.items||[]){
    const ids=keywordProductIds(keyword,products,today);
    keywordViews.set(keyword.id,{ids,count:new Set(products.filter(p=>ids.has(p.id)).map(variantGroupKey)).size});
  }
  const variantNames=new Map(products.map(p=>[p.id,variantGroupName(p)]));
  return {products,brandCounts,productGroups,keywordViews,variantNames};

}
