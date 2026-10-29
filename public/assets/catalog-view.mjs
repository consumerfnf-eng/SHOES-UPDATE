import {footwearTypes,FOOTWEAR_TYPES} from './footwear-policy.mjs';
import {hasArrivalEvidence} from './publication-window.mjs';
export function kstToday(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}
export function shiftCalendarMonths(day, months) {
  return calendarShift(day,months);
}
export function validDay(value) {
  return validCalendarDay(value);
}
export function releaseState(product, today = kstToday()) {
  const state=windowState(product,today);return ['released','upcoming'].includes(state)?state:null;
}
export function releaseDateLabel(product){const range=releaseWindow(product);if(range?.precision==='month'){const [year,month]=product.releaseDate.split('-');return `${year}년 ${Number(month)}월 (일자 미공개)`;}return product.arrivalEvidence?`NEW · ${product.arrivalEvidence.verifiedAt.slice(0,10)} 확인`:product.releaseDate||'출시일 미공개';}
export function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
const sameIdentity = (evidence, product) => typeof evidence?.brand==='string' && typeof evidence?.style==='string' && !!product.brand && !!product.style && evidence.brand.normalize('NFC').trim().toLowerCase()===product.brand.normalize('NFC').trim().toLowerCase() && evidence.style.replace(/[^a-z0-9]/gi,'').toLowerCase()===product.style.replace(/[^a-z0-9]/gi,'').toLowerCase();
const verifiedDate = (value, today) => Number.isFinite(Date.parse(value)) && kstToday(new Date(value))<=today;
export function officialProductUrl(product, today = kstToday()) {
  const evidence=product.officialProductEvidence,url=safeUrl(product.url);
  return url && evidence?.verified===true && sameIdentity(evidence,product) && safeUrl(evidence.url)===url && verifiedDate(evidence.verifiedAt,today) ? url : '';
}
export function officialImageUrl(product, today = kstToday()) {
  const evidence=product.officialImageEvidence,url=safeUrl(product.image),sourceUrl=officialProductUrl(product,today);
  const listing=evidence?.verificationMethod==='official-new-listing-sku-image'&&hasArrivalEvidence(product,today)&&safeUrl(evidence.sourceUrl)===safeUrl(product.arrivalEvidence.url)&&evidence.contentHash===product.arrivalEvidence.contentHash;
  return url && sourceUrl && evidence?.verified===true && sameIdentity(evidence,product) && safeUrl(evidence.url)===url && (listing||safeUrl(evidence.sourceUrl)===sourceUrl) && verifiedDate(evidence.verifiedAt,today) ? url : '';
}
// A reviewed navigation link does not grant official-proof or popularity eligibility.
export function reviewedProductPageUrl(product, today = kstToday()) {
  const strict=officialProductUrl(product,today);if(strict)return strict;
  const p=product.presentation,url=safeUrl(p?.officialProductUrl);
  const image=safeUrl(p?.image).startsWith('https:')||/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(p?.cachedPath||'');
  return url.startsWith('https:')&&p.officialProductUrl===p.sourceUrl&&url===safeUrl(p.sourceUrl)&&verifiedDate(p.checkedAt,today)&&['side','three-quarter'].includes(p.view)&&image?url:'';
}
export function productBrandNames(product, today = kstToday()) {
  const collaborators=officialImageUrl(product,today)?(product.collaborationBrands||[]).filter(name=>typeof name==='string'&&name.trim()):[];
  return [...new Set([product.brand,...collaborators].filter(Boolean))];
}
export function visibleSocialMetrics(product, today = kstToday(), {now=Date.now()} = {}) {
  if(!officialImageUrl(product,today))return [];
  const units={'search-count':'searches','hashtag-post-count':'posts','view-count':'views'};
  const cutoff=shiftCalendarMonths(today,-3);
  return (product.socialMetrics||[]).filter(metric=>{
    const captured=Date.parse(metric?.capturedAt),day=Number.isFinite(captured)?kstToday(new Date(captured)):'';
    const period=metric?.scope==='cumulative'&&metric.periodStart==null&&metric.periodEnd==null||metric?.scope==='period'&&validDay(day)&&validDay(metric.periodStart)&&validDay(metric.periodEnd)&&metric.periodStart>=shiftCalendarMonths(day,-3)&&metric.periodStart<=metric.periodEnd&&metric.periodEnd<=day&&metric.periodEnd>=cutoff;
    const identity=metric?.identity,model=product.officialProductEvidence?.modelIdentity;
    const identityValid=identity?.level==='model'?!!officialProductUrl(product,today)&&model?.verified===true&&identity.brand===product.brand&&identity.modelId===model.id&&identity.modelName===model.name:(!identity?.level||identity.level==='variant')&&sameIdentity(identity,product);
    return metric?.verified===true && identityValid && metric.platform && metric.query && safeUrl(metric.sourceUrl).startsWith('https:') && units[metric.metric]===metric.unit && (metric.value===null||Number.isSafeInteger(metric.value)&&metric.value>=0) && period && day>=cutoff && day<=today && captured<=new Date(now).getTime();
  });
}
export function socialGroupKey(metric){
  const c=metric?.comparison;
  const level=metric?.identity?.level||'variant';
  return ['search-count','hashtag-post-count'].includes(metric?.metric)&&c?.id&&c.identityLevel===level&&c.verified===true&&c.population==='items'&&['observed-sample','published-ranking'].includes(c.coverage)&&Number.isInteger(c.rank)&&c.rank>0&&Number.isInteger(c.itemCount)&&c.itemCount>=c.rank&&c.itemCount>=2&&metric.value>0?JSON.stringify([c.id,metric.platform,metric.metric,metric.unit,metric.scope,level,metric.country||'',metric.periodStart||'',metric.periodEnd||'',metric.scope==='cumulative'?kstToday(new Date(metric.capturedAt)):'',c.coverage]):'';
}
export function socialComparisonGroups(products,today=kstToday()){
  const groups=new Map();for(const p of products.filter(p=>releaseState(p,today)&&sourceMatches(p,'sns',today)))for(const m of visibleSocialMetrics(p,today)){const key=socialGroupKey(m);if(!key)continue;if(!groups.has(key))groups.set(key,{key,...m,itemKeys:new Set()});groups.get(key).itemKeys.add(m.identity?.level==='model'?`${p.brand}:${m.identity.modelId}`:`${p.brand}:${p.style}`);}
  return [...groups.values()].map(({itemKeys,...group})=>({...group,matchedItemCount:itemKeys.size})).sort((a,b)=>b.matchedItemCount-a.matchedItemCount||Number(a.metric!=='search-count')-Number(b.metric!=='search-count')||a.key.localeCompare(b.key));
}
export function sourceMatches(product, type, today = kstToday()) {
  if(type==='all')return true;
  // The SNS tab is a view, not a source: it shows whatever this week's trend
  // keywords actually match, alongside official products that carry their own
  // published social metrics. Nothing is duplicated into a second record.
  if(type==='sns'&&product.snsTrending===true)return true;
  if(isOverlay(product)){
    // An overlay record can never satisfy the official-evidence tabs, and the
    // retail/newsletter tabs are overlay-only, so the two sets never bleed.
    const kind=overlayKind(product);
    if(type==='sns')return kind==='sns';
    return type===kind;
  }
  if(['retail','newsletter'].includes(type))return false;
  if(type==='media')return product.popularity?.media===true;
  if(type==='brand')return releaseState(product,today)==='released'&&!!officialProductUrl(product,today)&&!!officialImageUrl(product,today);
  if(type==='sns')return !!officialImageUrl(product,today)&&visibleSocialMetrics(product,today).some(m=>['search-count','hashtag-post-count'].includes(m.metric)&&m.value>0);
  return product.popularity?.[type]===true;
}
export function categoryMatches(product, key) {
  if (key === 'all') return true;
  if(FOOTWEAR_TYPES.includes(key))return footwearTypes(product).includes(key);
  const tags = [product.category, product.productType, ...(product.tags || [])].join(' ').toLowerCase();
  return ({sneaker:/sneaker|스니커즈|러닝|트레일|runner|running|court/,clog:/clog|클로그/,sandal:/sandal|샌들/,platform:/platform|플랫폼/,hybrid:/hybrid|혼합|메리제인|발레|mule|뮬/}[key] || /$a/).test(tags);
}
export function keywordProductIds(keyword, products, today = kstToday()) {
  // productIds is the publisher's complete attribute match set. evidenceProductIds
  // is intentionally not used: a ranking mention does not limit product discovery.
  const matched = new Set(keyword.productIds || []);
  return new Set(products.filter(p => matched.has(p.id) && releaseState(p, today)).map(p => p.id));
}
export function trendKeywords(keywords = [], {now = Date.now(), forecast = false, editorial = false} = {}) {
  const rankedKinds=editorial?new Set(['editorial-keyword']):new Set(['search-rank','composite-rank','hashtag-rank']);
  const unrankedKinds=new Set(forecast?['forecast-keyword']:editorial?[]:['search-popular','editorial-keyword']);
  return keywords.filter(k => k?.keywordType==='style' && typeof k.label === 'string' && k.label.trim() && Array.isArray(k.productIds)).flatMap(k => {
    const sourceRanks=(k.sourceRanks||[]).filter(s => {
      const day=kstToday(new Date(now)),age=now-Date.parse(s?.capturedAt),publicationAge=now-Date.parse(s?.publishedAt);
      const captureDay=Number.isFinite(Date.parse(s?.capturedAt))?kstToday(new Date(s.capturedAt)):'';
      const extraValid=s?.kind==='composite-rank'?s.latestPeriodVerified===true&&s.reportId&&validDay(s.periodEnd)&&(s.periodStart===undefined||validDay(s.periodStart)&&s.periodStart<=s.periodEnd)&&s.periodEnd<=captureDay&&s.validityBasis&&validDay(s.validUntil)&&s.validUntil>=s.periodEnd&&day<=s.validUntil:s?.kind==='editorial-keyword'?publicationAge>=0&&publicationAge<=30*86400000:true;
      const fresh=forecast?age>=0&&s.validityBasis==='season-end-policy'&&validDay(s?.validUntil)&&kstToday(new Date(now))<=s.validUntil:age>=0&&age<=7*86400000;
      return s?.verified===true && typeof s.term==='string' && s.term.trim() && s.platform && safeUrl(s.sourceUrl) && fresh && extraValid && (
        !forecast && rankedKinds.has(s.kind) && (editorial || Number.isInteger(s.rank) && s.rank>0) || unrankedKinds.has(s.kind) && s.rank===null
      );
    });
    // Combined ranks are published on the server. Do not retain a rank after a contributor expires.
    if(!sourceRanks.length||sourceRanks.length!==k.sourceRanks.length)return [];
    const rank=!forecast&&Number.isInteger(k.rank)&&k.rank>0&&Number.isFinite(k.score)&&k.score>0&&sourceRanks.some(s=>rankedKinds.has(s.kind))?k.rank:null;
    return [{...k,rank,sourceRanks}];
  }).sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));
}
export function sourceContext(type, products, directory = {}, today = kstToday()) {
  if(type==='media'){
    const contexts=['magazine','newsletter'].map(source=>sourceContext(source,products,directory,today));
    const unique=rows=>[...new Map(rows.map(row=>[row.id||row.url,row])).values()];
    const observed=unique(contexts.flatMap(c=>c.observed));
    return {observed,configured:unique(contexts.flatMap(c=>c.configured)).filter(c=>!observed.some(o=>o.id===c.id||o.url===c.url))};
  }
  const configured = (directory[type]?.configured || []).filter(s => s?.name && safeUrl(s.url));
  const entries = [...(directory[type]?.observed || []), ...configured];
  const host = value => { const url=safeUrl(value); return url ? new URL(url).hostname.replace(/^www\./,'') : ''; };
  const observed = new Map();
  for (const product of products) {
    if (!releaseState(product,today)) continue;
    for (const signal of product.sourceSignals || []) {
      if(signal.type !== type || !safeUrl(signal.url)) continue;
      const domain=host(signal.url);
      const entry=entries.find(e=>e?.id&&e.id===signal.publisherId || host(e?.url)&& (domain===host(e.url)||domain.endsWith('.'+host(e.url))));
      const id=entry?.id||signal.publisherId||domain;
      const name=signal.publisherName||signal.platformName||entry?.name||domain;
      observed.set(id,{id,name,url:safeUrl(entry?.url)||new URL(signal.url).origin,domain});
    }
  }
  const confirmed=[...observed.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const awaiting=configured.filter(c=>!confirmed.some(o=>o.id===c.id||o.domain===host(c.url)||o.domain.endsWith('.'+host(c.url))));
  return {observed:confirmed,configured:awaiting};
}
// A research card with no photograph is not worth a slot: the whole point of
// the grid is seeing the shoe. Where the page used to print "공식 이미지 확인 중"
// over an empty tile, the record is now left out of the catalog entirely.
const CACHED_IMAGE=/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/;
export function productImageUrl(product, today = kstToday()) {
  const cached=product?.presentation?.cachedPath;
  if(CACHED_IMAGE.test(cached||''))return cached;
  return safeUrl(product?.presentation?.image)
    || officialImageUrl(product,today)
    || safeUrl(product?.image) || '';
}
export function hasVisual(product, today = kstToday()) { return !!productImageUrl(product,today); }

export function filterProducts(products, state, today = kstToday()) {
  const query = state.search.trim().toLocaleLowerCase();
  return products.filter(p => {
    const release = isOverlay(p) ? overlayReleaseState(p, today) : releaseState(p, today);
    return release && hasVisual(p, today)
      && (state.release === 'all' || release === state.release)
      && (!state.retailer || state.retailer === 'all' || retailerId(p) === state.retailer)
      && (!state.brands.size || productBrandNames(p,today).some(brand=>state.brands.has(brand)))
      && categoryMatches(p, state.category)
      && sourceMatches(p,state.source,today)
      && (state.source!=='sns'||!state.socialGroup||visibleSocialMetrics(p,today).some(m=>socialGroupKey(m)===state.socialGroup))
      && (!state.keywordIds || state.keywordIds.has(p.id))
      && trendKeywordMatches(p, state.trendTerms)
      && (!query || [p.name,p.fullName,p.brand,p.brandAsListed,p.style,p.colorway,p.category,p.productType,...(p.keywords || []),...(p.keywordTags || [])].join(' ').toLocaleLowerCase().includes(query));
  }).sort((a,b)=>{
    if(state.source==='sns'&&state.socialGroup&&state.sort==='social'){
      const metric=p=>visibleSocialMetrics(p,today).find(m=>socialGroupKey(m)===state.socialGroup),aa=metric(a),bb=metric(b);
      if(aa&&bb)return bb.value-aa.value||aa.comparison.rank-bb.comparison.rank||a.id.localeCompare(b.id);
    }
    const recency=p=>isOverlay(p)?overlayWindowDay(p):releaseSortKey(p);
    return state.sort==='brand'?a.brand.localeCompare(b.brand,'en')||a.name.localeCompare(b.name):state.sort==='sources'?(b.sourceSignals?.length||0)-(a.sourceSignals?.length||0)||recency(b).localeCompare(recency(a)):recency(b).localeCompare(recency(a))||a.brand.localeCompare(b.brand);
  });
}
import {calendarShift,validCalendarDay,releaseWindow,releaseState as windowState,releaseSortKey} from './release-window.mjs';
export {releaseWindow,releaseSortKey};
// A comma is a separator too: Musinsa writes "어반트렉 메시 Ver. 3, 버건디",
// and lifting the colour off the end leaves the comma behind.
const trimModelSeparators = value => value.replace(/\s+/g,' ').replace(/[\s|·—–,/-]+$/u,'').trim();
const audienceLabel = "(?:men(?:['’]s|s)?|women(?:['’]s|s)?|unisex|남성(?:용)?|여성(?:용)?|남녀공용)";
function withoutAudienceLabel(value) {
  // Only audience labels at the edges or immediately before a footwear suffix
  // are marketing metadata. Keep editions, materials, widths and generations.
  return trimModelSeparators(value
    .replace(new RegExp(`^${audienceLabel}\\s+`,'i'),'')
    .replace(new RegExp(`\\s+${audienceLabel}$`,'i'),'')
    .replace(new RegExp(`\\s+${audienceLabel}(?=\\s+(?:(?:road|trail|running|training|walking|tennis|basketball|golf)\\s+)*(?:shoes?|sneakers?)$)`,'i'),''));
}
// Same-model colorways share one grid card even when feeds assign separate
// modelKeys to colors or genders. Grouping never mutates source records.
// A style code at the end of a title is the manufacturer's reference, not
// part of the shoe's name: "…메탈릭 트레이너 실버 (FT69K2N512)", "핸드볼
// 스페지알 IF6490". It must contain both a letter and a digit, so "Air Max
// 90" and "SL 72 프로" keep their model numbers. The closing bracket is
// optional because ASH's listings reach the collector with it missing.
const TRAILING_STYLE_CODE=/[([]?\s*\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9][A-Za-z0-9\-_/]{5,}\s*[)\]]?\s*$/;
// What a retailer puts in front of the product's own name: its shop tag
// ("[푸마 공식]"), an exclusivity note ("[29CM 단독]"), an audience ("(여성)"),
// or the style code ("WTRD8100 엘더 플리츠 트레이너"). None of it is the
// shoe's name, and each spelling was becoming its own card.
const LEADING_TAG=/^\s*(?:[([][^)\]]{0,24}[)\]]\s*)+/;
const LEADING_STYLE_CODE=/^\s*(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,}\s+/;
const lettersIn=value=>value.replace(/[^\p{L}\p{N}]+/gu,'').length;
function withoutLeadingNoise(value){
  let out=String(value||'').replace(LEADING_TAG,' ').trim();
  if(lettersIn(out)<3)out=String(value||'').trim();
  const bare=out.replace(LEADING_STYLE_CODE,'').trim();
  return lettersIn(bare)>=3?bare:out;
}
// variantGroupName and variantGroupKey are pure functions of one record and
// are called for every product on every filter, sort, group and render - the
// SNS tab alone asked for them tens of thousands of times and spent fifteen
// seconds doing it. The answer cannot change while the record exists, so it
// is computed once per record and kept on a WeakMap, which releases with the
// record itself.
const NAME_CACHE = new WeakMap(), KEY_CACHE = new WeakMap();
const memo = (cache, p, compute) => {
  if (!p || typeof p !== 'object') return compute(p);
  if (cache.has(p)) return cache.get(p);
  const value = compute(p);
  cache.set(p, value);
  return value;
};
export function variantGroupName(p) { return memo(NAME_CACHE, p, computeVariantGroupName); }
export function variantGroupKey(p) { return memo(KEY_CACHE, p, computeVariantGroupKey); }
function computeVariantGroupName(p) {
  // When the collection step resolved this listing to a model, that name is
  // the card's name. It is the only one that is right for a card standing
  // for four colourways: every listing's own name ends in its own shade.
  if (p?.modelName) return withoutAudienceLabel(trimModelSeparators(p.modelName));
  if (!p?.name) return p?.modelKey || p?.id || '';
  let base = String(p.name);
  const colors = [p.colorway, ...(p.colors || []).map(c => typeof c === 'string' ? c : c?.name)].filter(Boolean)
    .flatMap(value => String(value).split(/[\/,·]+/)).map(value => value.trim())
    // Two letters is noise in a Latin name and a whole colour in Korean:
    // 블랙, 실버, 카키 are all two syllables.
    .filter(value => value.length > 2 || /^[가-힣]{2}$/.test(value)).sort((a,b)=>b.length-a.length);
  for (const color of colors) base = base.replace(new RegExp(`(?:^|[\\s|—–-])${color.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[\\s|—–-])`,'ig'),' ');
  // A declared trailing color can leave "sneaker in" behind (e.g. Gucci).
  if (base !== p.name) base = base.replace(/\s+in\s*$/i,'');
  base = withoutLeadingNoise(base.replace(TRAILING_STYLE_CODE,' '));
  return withoutAudienceLabel(trimModelSeparators(base))||p.name;
}
function computeVariantGroupKey(p) {
  // A newsletter item is an article, not a SKU. Grouping those by model name
  // merged 42 separate Footwear News pieces into one "Michael Jordan" card,
  // because the publisher's tag is the model name. One article, one card.
  if (isOverlay(p) && overlayKind(p) === 'newsletter') return `article|${p.id}`;
  // The collection pipeline resolved this listing to a model by reading the
  // colour out of its name - "OLLA 양털슬립온 실브라운" and "OLLA 양털슬립온
  // 초콜릿" are one shoe. Nothing in the record says 실브라운 is a colour, so
  // that answer cannot be re-derived here; it is used as given.
  if (p.modelGroupId) return `model|${p.modelGroupId}`;
  if (!p?.name) return p?.modelKey || p?.id;
  const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  const name = variantGroupName(p);
  // Strip only generic terminal category wording from the key, not the title.
  // "Trail", "LITE-SHOW", "GTX", "Waterproof", etc. remain model identity.
  const model = trimModelSeparators(name.replace(/\s+(?:running\s+)?(?:shoes?|sneakers?)$/i,''));
  const normalized = normalize(model || name);
  // A listing whose whole name is its brand states no model, so it has
  // nothing to be grouped by: 29CM returns twelve different NEPA shoes all
  // named "네파", and keyed on the name alone they became one card holding
  // twelve unrelated products. Each stands on its own instead.
  if (normalized && [p.brand, p.brandKo, p.brandAsListed].some(b => b && normalize(b) === normalized))
    return `unnamed|${p.id}`;
  return `${normalize(p.brand)}|${normalized || normalize(p.modelKey) || normalize(p.id)}`;
}
// Named colours are an approximate navigation aid; the official photo stays
// the colour reference. Shared by the chips and by the colour-field cleaning
// below, which needs to know whether "BLACK" is a word or a product code.
const COLOR_HEX={black:'#242424',white:'#f7f7f2',ivory:'#eee9d8',cream:'#ece1c6',beige:'#c9b89e',butter:'#eddf9d',brown:'#70472f',chocolate:'#493329',burgundy:'#632a39',oxblood:'#581f2c',red:'#cf303a',navy:'#27374d',blue:'#4479ad',green:'#53745c',sage:'#a5ad8d',silver:'#bac0c5',grey:'#989ba0',gray:'#989ba0',pink:'#e4a9bb',orange:'#e17a31',yellow:'#e6c953',violet:'#a69bb4',purple:'#866799',sand:'#cbbb9d',peanut:'#ac865e',angora:'#e8dfcd',meteorite:'#45474a',pumpernickel:'#504137',bayberry:'#55624c',turtledove:'#c8c4b5',morel:'#988b79',cocoa:'#795e50',walnut:'#796252',cortado:'#a6886b',khaki:'#9b8b5e',taupe:'#8a7968',olive:'#6e7446',charcoal:'#3a3b3c',gold:'#b99746',tan:'#c8a165',camel:'#b08457',rust:'#9a4a29',mint:'#a7d8c4',lilac:'#c7b3d9',coral:'#e8836b',teal:'#2f7d78',maroon:'#5c1a24',multicolor:'#8f8f8f',denim:'#3f5c84',stone:'#b7b2a8',bone:'#e4ded0',sail:'#efeade',gum:'#b98a52',블랙:'#242424',화이트:'#f7f7f2',그레이:'#989ba0',블루:'#4479ad',브라운:'#70472f',베이지:'#c9b89e',실버:'#bac0c5',핑크:'#e4a9bb',네이비:'#27374d',레드:'#cf303a',그린:'#53745c',옐로우:'#e6c953',퍼플:'#866799',오렌지:'#e17a31',골드:'#b99746',크림:'#ece1c6',아이보리:'#eee9d8',카키:'#9b8b5e',버건디:'#632a39',민트:'#a7d8c4',차콜:'#3a3b3c',올리브:'#6e7446',와인:'#632a39',모카:'#795e50',검정:'#242424',검:'#242424',흰색:'#f7f7f2',회색:'#989ba0',파랑:'#4479ad',초록:'#53745c',노랑:'#e6c953',빨강:'#cf303a',보라:'#866799',연청:'#8fb0d6',진청:'#27374d',탄:'#c8a165'};
// The same shade, written in two languages. Musinsa lists OLLA's slip-on as
// 히커리 II and 29CM lists the identical shoe as HICKORY II; without this
// one colourway draws two chips on the one card.
const COLOR_SYNONYM={블랙:'black',검정:'black',검:'black',화이트:'white',흰색:'white',오프화이트:'offwhite',아이보리:'ivory',크림:'cream',그레이:'grey',회색:'grey',차콜:'charcoal',실버:'silver',블루:'blue',파랑:'blue',네이비:'navy',진청:'navy',연청:'denim',데님:'denim',레드:'red',빨강:'red',와인:'wine',버건디:'burgundy',마룬:'maroon',핑크:'pink',코랄:'coral',오렌지:'orange',옐로우:'yellow',노랑:'yellow',그린:'green',초록:'green',올리브:'olive',카키:'khaki',세이지:'sage',민트:'mint',퍼플:'purple',보라:'purple',바이올렛:'violet',라벤더:'lavender',라일락:'lilac',브라운:'brown',실브라운:'sealbrown',초콜릿:'chocolate',초콜렛:'chocolate',모카:'mocha',커피:'coffee',코냑:'cognac',카멜:'camel',탄:'tan',베이지:'beige',샌드:'sand',스톤:'stone',토프:'taupe',그레이지:'greige',누드:'nude',라떼:'latte',오트밀:'oatmeal',머스타드:'mustard',골드:'gold',브론즈:'bronze',퓨터:'pewter',히커리:'hickory',체스트넛:'chestnut',테라코타:'terracotta',브릭:'brick',러스트:'rust',피치:'peach',살구:'apricot',터콰이즈:'turquoise',틸:'teal',멀티컬러:'multicolor',메탈릭:'metallic',펄:'pearl',
// Abbreviations retailers use instead of the word: "에버라스트 다이나믹
// 트레킹화 BLK / BRN / IVY" is one shoe in three colours. Kept apart from
// the model and technology suffixes of the same shape - GTX, OG, DMX, LS.
blk:'black',bwn:'brown',brn:'brown',wht:'white',ivy:'ivory',nvy:'navy',gry:'grey',grn:'green',blu:'blue',pnk:'pink',ylw:'yellow',bge:'beige',crm:'cream',khk:'khaki',olv:'olive',slv:'silver',gld:'gold',chc:'chocolate'};
export function colorHex(word){
  const raw=String(word||'').normalize('NFKC');
  // A token with a digit in it is a product code, not a colour. Without
  // this, stripping the digits turned 29CM's "BLK0" into "blk" and made
  // its internal code list "BGD0,BLK0,WHGY" read as a colour.
  if(/\d/.test(raw))return '';
  const key=raw.toLowerCase().replace(/[^a-z가-힣]/g,'');
  return COLOR_HEX[key]||COLOR_HEX[COLOR_SYNONYM[key]||'']||'';
}
// One colourway's canonical spelling: each recognised word folded to its
// English name, the rest kept as written, so two labels agree only when they
// genuinely name the same colours.
// Words that say "the whole shoe is this colour" rather than qualifying the
// shade: 올 블랙, triple black and 블랙 are one colourway. 라이트 그레이 is
// NOT - a modifier that changes the shade stays in the key.
const WHOLE_SHOE=new Set(['올','전체','풀','트리플','all','full','triple','mono','솔리드','solid']);
export function canonicalColorKey(label){
  const words=String(label||'').normalize('NFKC').toLowerCase().split(/[^a-z0-9가-힣]+/).filter(Boolean)
    // Korean tacks 색 onto a colour: 검정색 is 검정 is black.
    .map(word=>/^[가-힣]{2,}색$/.test(word)&&COLOR_SYNONYM[word.slice(0,-1)]?word.slice(0,-1):word)
    .filter(word=>!WHOLE_SHOE.has(word))
    .map(word=>COLOR_SYNONYM[word]||word);
  // Joined without separators: Korean writes a two-word shade as one token
  // (실브라운) where English spaces it ("Seal Brown"), and the two are the
  // same colour. Order is kept - "black/white" and "white/black" name a
  // different upper and sole, and are not interchangeable.
  return words.join('');
}

// A retailer may answer a required colour field by pointing at the images.
// "상세내용참고" is not a colour and must not reach a chip label.
const COLOR_PLACEHOLDER=/^(?:상세\s*(?:페이지|이미지|내용|정보|설명)?\s*(?:참조|참고|확인)?|상품\s*(?:상세|tag)?\s*참고|설명\s*페이지\s*(?:참조|참고)?|상세피이지\s*(?:참조|참고)?|맨발신발|별도\s*표기|해당\s*없음|없음|기타|n\/?a|-{1,3})$/i;
// The seller's standing notice, pasted in after the answer: 29CM appends
// "(입고 시기에 따라 정보가 상이할 수 있어...)" and Musinsa "(선택되지 않는
// 색상은...)". The colour in front of it is real, so the notice is cut.
const SELLER_NOTICE=/[(\[]\s*[^)\]]*(?:입고\s*시기|색상은|판매하지|품절|라벨을\s*참고|상이할\s*수\s*있)[^)\]]*[)\]]/g;
const AUDIENCE_TAG=/[(\[]\s*(?:남성|여성|남녀|공용|유니섹스)\s*용?\s*[)\]]/g;
// "BGD0,BLK0,WHGY" is the retailer's internal colour codes; "BLACK, WHITE"
// is the same shape and says plenty, so a recognised name decides.
const CODE_LIST=/^[A-Z0-9]{2,6}(?:\s*[,/]\s*[A-Z0-9]{2,6})*$/;
// 29CM pins its own code to each colour name: "CHARCOAL(B02)", "(19)BLACK".
const INLINE_CODE=/[([]\s*[A-Za-z]{0,3}\d{1,4}[A-Za-z]{0,2}\s*[)\]]/g;
export function variantColorLabel(p){
  const color=String(p.colorway||'').replace(SELLER_NOTICE,' ').replace(AUDIENCE_TAG,' ')
    .replace(INLINE_CODE,' ').replace(/\s*,\s*/g,', ')
    .replace(/\s{2,}/g,' ').replace(/^[\s,/|-]+|[\s,/|-]+$/g,'');
  if(!color||COLOR_PLACEHOLDER.test(color))return '';
  if(CODE_LIST.test(color)&&!color.split(/[,/]/).some(part=>colorHex(part.trim())))return '';
  return !/(?:https?:|!\[|^image\s*\d+$|^(?:women|men)\s*\||^sneakers?\s*[·|]|미표기)/i.test(color)?color:'';
}
// Plain RGB distance between two #rrggbb values, or a large number when
// either is missing. Enough to tell one shoe's two angles from two
// genuinely different colourways.
const HEX6=/^#[0-9a-f]{6}$/i;
export function colorDistance(a,b){
  if(!HEX6.test(a||'')||!HEX6.test(b||''))return 999;
  const to=v=>[parseInt(v.slice(1,3),16),parseInt(v.slice(3,5),16),parseInt(v.slice(5,7),16)];
  const [ar,ag,ab]=to(a),[br,bg,bb]=to(b);
  return Math.round(Math.hypot(ar-br,ag-bg,ab-bb));
}
// Two photographs of one shoe from slightly different angles read as almost
// the same body colour; two real colourways do not.
export const SAME_BODY_COLOR = 42;

export function uniqueColorVariants(group,activeId){
  const seen=new Map();
  const unnamed=[];
  for(const p of group){
    // Folded to one spelling first: Musinsa writes 히커리 II where 29CM writes
    // HICKORY II for the identical shoe, and two chips for one colourway is
    // exactly the duplication the card exists to remove.
    const color=canonicalColorKey(variantColorLabel(p));
    if(color){
      const key=`color:${color}`;
      if(!seen.has(key)||p.id===activeId)seen.set(key,p);
      continue;
    }
    // No colour name, but the two listings are word-for-word the same title:
    // Musinsa and 29CM both carry "페이스 로우 미드 브라운" and only one of
    // them fills the colour field. One title is one colourway, whichever
    // retailer happened to describe it.
    const title=String(p.name||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
    if(title){
      const key=`title:${title}`;
      if(!seen.has(key)||p.id===activeId)seen.set(key,p);
      continue;
    }
    // Otherwise the photo decides: the identical cached shot, or a body
    // colour read off the photo that matches one already kept, is the same
    // colourway - that is what stops one shoe shot from two angles becoming
    // two chips.
    const photo=p.presentation?.cachedPath;
    if(/^\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(photo||'')){
      const key=`photo:${photo}`;
      if(!seen.has(key)||p.id===activeId)seen.set(key,p);
      continue;
    }
    const twin=unnamed.find(q=>colorDistance(q.bodyColor,p.bodyColor)<=SAME_BODY_COLOR);
    if(twin){ if(p.id===activeId)seen.set(`body:${twin.id}`,p); continue; }
    unnamed.push(p);
    seen.set(`body:${p.id}`,p);
  }
  return [...seen.values()];
}
export function groupProductVariants(products) {
  const groups = new Map();
  for (const p of products) {
    const key = variantGroupKey(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.values()];
}

export function productAudience(product) {
  const read = value => {
    const text = String(value || '').normalize('NFKC').toLowerCase();
    const women = /(?:^|[^\p{L}\p{N}])(?:women(?:['’ -]?s)?|female|여성(?:용)?)(?=$|[^\p{L}\p{N}])/u.test(text);
    const men = /(?:^|[^\p{L}\p{N}])(?:men(?:['’ -]?s)?|male|남성(?:용)?)(?=$|[^\p{L}\p{N}])/u.test(text);
    if (/\bunisex\b|남녀공용/u.test(text) || women && men) return 'unisex';
    return women ? 'women' : men ? 'men' : '';
  };
  // Use declared metadata and product-specific labels, never image colors,
  // SKU guesses, navigation text, or tracking query parameters.
  // A women's listing can carry a generic Unisex value in older feed metadata.
  for (const value of [product.name, product.gender, product.officialCategory]) {
    const audience = read(value);
    if (audience) return audience;
  }
  try { return read(decodeURIComponent(new URL(product.url).pathname)); }
  catch { return ''; }
}

export function preferWomenVariants(products) {
  const womenModels = new Set(products.filter(p => !isOverlay(p) && productAudience(p) === 'women').map(variantGroupKey));
  // Apply to the eligible catalog BEFORE search/source filters: a male-only
  // color search must not bring a suppressed counterpart back into the grid.
  return products.filter(p => isOverlay(p) || !womenModels.has(variantGroupKey(p)) || productAudience(p) === 'women');
}

// Named colors are an approximate navigation aid; the official photo is the
// color reference. Unknown names use a neutral patterned chip, never a guess.
export function colorSwatch(product) {
  const reviewed=product.colorSwatches?.filter(c=>/^#[0-9a-f]{6}$/i.test(c))||[];
  // Order of trust: a hex the retailer itself declared, then the colour read
  // off the product photo, then a recognised colour word, then nothing -
  // a neutral pattern rather than a guessed colour.
  const named=[...new Set((product.colorway||'').split(/[^a-z가-힣]+/i).map(colorHex).filter(Boolean))].slice(0,3);
  const colors=reviewed.length?reviewed:(named.length?named:(HEX6.test(product.bodyColor||'')?[product.bodyColor]:[]));
  if(!colors.length)return 'repeating-linear-gradient(45deg,#eee 0 4px,#bbb 4px 8px)';
  return colors.length===1?colors[0]:`linear-gradient(135deg,${colors.map((c,i)=>`${c} ${Math.round(i/colors.length*100)}% ${Math.round((i+1)/colors.length*100)}%`).join(',')})`;
}

// --- retail / newsletter overlay -------------------------------------------
// Overlay products come from public/data/monthly-catalog.json: retailer
// listings and press articles, not brand-verified official records. They ride
// in the same grid so that selection, export, the detail panel and the brand
// filter work on them identically, but they never pass the official gates -
// officialProductUrl/officialImageUrl require evidence they do not have, so
// the 브랜드 공식 신상품 tab stays exactly as strict as it was.
export function isOverlay(product) { return product?.overlay === true; }

export function overlayWindowDay(product) {
  // The one date the source actually stated, in priority order: the retailer's
  // listing date, the article's publish date, or - only for a source that
  // publishes no date at all - the run that first saw the item appear.
  const value = product?.listedAt || product?.publishedAt || product?.firstDetectedAsNewAt || '';
  return String(value).slice(0, 10);
}

export function overlayReleaseState(product, today = kstToday()) {
  const day = overlayWindowDay(product);
  if (!validDay(day) || day > today) return null;
  if (day < shiftCalendarMonths(today, -3)) return null;
  // An article may state a release date still in the future; that is a display
  // state, not a reason to hide it - the window is keyed off the stated date.
  return product.releaseStatus === 'upcoming' ? 'upcoming' : 'released';
}

export function overlayKind(product) {
  const source = String(product?.source || '');
  if (source.startsWith('retail-')) return 'retail';
  if (source.startsWith('newsletter-')) return 'newsletter';
  if (source.startsWith('sns-')) return 'sns';
  return '';
}

export function retailerId(product) {
  return isOverlay(product) && overlayKind(product) === 'retail' ? String(product.source) : '';
}

// A trend keyword is a hashtag, so it has no spaces and no punctuation while
// the product names do. Both sides are folded the same way before matching,
// and a keyword only matches on a term long enough to mean something - "온"
// or "og" would otherwise match most of the catalogue.
export function foldTerm(value) {
  // NFKD must not be used here: it decomposes Hangul syllables into Jamo,
  // which then fall outside the syllable range and get stripped, so every
  // Korean keyword folded to the empty string and matched nothing at all.
  // Latin accents are folded by decomposing only those, via NFD on the
  // already-composed string, then keeping letters and digits of any script.
  return String(value || '').toLowerCase().normalize('NFC')
    .replace(/[\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5]/g, 'a').replace(/[\u00e8\u00e9\u00ea\u00eb]/g, 'e').replace(/[\u00ec\u00ed\u00ee\u00ef]/g, 'i')
    .replace(/[\u00f2\u00f3\u00f4\u00f5\u00f6]/g, 'o').replace(/[\u00f9\u00fa\u00fb\u00fc]/g, 'u').replace(/[\u00e7]/g, 'c').replace(/[\u00f1]/g, 'n')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
export function trendTermGroups(keyword) {
  // Alternatives inside a group, requirements across groups. A flat OR-list
  // made "나이키 러닝화" match every Nike shoe and every running shoe at once.
  const groups = keyword?.matchTermGroups;
  if (Array.isArray(groups) && groups.length) {
    return groups.map(g => [...new Set((g || []).map(foldTerm).filter(Boolean))]).filter(g => g.length);
  }
  const flat = trendTerms(keyword);
  return flat.length ? [flat] : [];
}
export function trendTerms(keyword) {
  if (!keyword) return [];
  // The collector publishes matchTerms: the hashtag and its related words
  // already widened across Korean and English (config/shoe-term-synonyms.json
  // and the brand aliases). Keeping that dictionary in one place means a
  // Korean keyword reaches an English listing and the reverse, without a
  // second copy here that could drift.
  if (Array.isArray(keyword.matchTerms) && keyword.matchTerms.length) {
    return [...new Set(keyword.matchTerms.map(foldTerm).filter(term => term.length >= 2))];
  }
  const raw = [keyword.hashtag, ...(keyword.relatedKeywords || [])];
  return [...new Set(raw.map(foldTerm).filter(term => term.length >= 3))];
}
function productHaystack(product) {
  return foldTerm([product.name, product.fullName, product.brand, product.brandAsListed,
    product.colorway, product.officialCategory, ...(product.keywords || []),
    ...(product.keywordTags || [])].filter(Boolean).join(' '));
}
// `terms` is either a flat list (every term an alternative) or a list of
// groups (alternatives within, requirements across).
export function trendKeywordMatches(product, terms) {
  if (!terms?.length) return true;
  const haystack = productHaystack(product);
  if (Array.isArray(terms[0])) return terms.every(group => group.some(term => haystack.includes(term)));
  return terms.some(term => haystack.includes(term));
}
