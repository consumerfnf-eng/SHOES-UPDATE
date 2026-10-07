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
export function filterProducts(products, state, today = kstToday()) {
  const query = state.search.trim().toLocaleLowerCase();
  return products.filter(p => {
    const release = releaseState(p, today);
    return release && (state.release === 'all' || release === state.release)
      && (!state.brands.size || productBrandNames(p,today).some(brand=>state.brands.has(brand)))
      && (state.fit === 'all' || (state.fit === 'common' ? p.fit?.includes('MLB') && p.fit?.includes('DISCOVERY') : p.fit?.includes(state.fit)))
      && categoryMatches(p, state.category)
      && sourceMatches(p,state.source,today)
      && (state.source!=='sns'||!state.socialGroup||visibleSocialMetrics(p,today).some(m=>socialGroupKey(m)===state.socialGroup))
      && (!state.keywordIds || state.keywordIds.has(p.id))
      && (!query || [p.name,p.brand,p.style,p.colorway,p.category,p.productType,...(p.keywords || []),...(p.keywordTags || [])].join(' ').toLocaleLowerCase().includes(query));
  }).sort((a,b)=>{
    if(state.source==='sns'&&state.socialGroup&&state.sort==='social'){
      const metric=p=>visibleSocialMetrics(p,today).find(m=>socialGroupKey(m)===state.socialGroup),aa=metric(a),bb=metric(b);
      if(aa&&bb)return bb.value-aa.value||aa.comparison.rank-bb.comparison.rank||a.id.localeCompare(b.id);
    }
    return state.sort==='brand'?a.brand.localeCompare(b.brand,'en')||a.name.localeCompare(b.name):state.sort==='sources'?(b.sourceSignals?.length||0)-(a.sourceSignals?.length||0)||releaseSortKey(b).localeCompare(releaseSortKey(a)):releaseSortKey(b).localeCompare(releaseSortKey(a))||a.brand.localeCompare(b.brand);
  });
}
import {calendarShift,validCalendarDay,releaseWindow,releaseState as windowState,releaseSortKey} from './release-window.mjs';
export {releaseWindow,releaseSortKey};
// Same-model colorways share one grid card; when a feed gives every color a
// different modelKey, remove the declared colorway tokens from the product name
// before grouping. The raw variant records remain intact for detail/download.
export function variantGroupName(p) {
  if (!p?.name) return p?.modelKey || p?.id || '';
  let base = String(p.name);
  const colors = [p.colorway, ...(p.colors || []).map(c => typeof c === 'string' ? c : c?.name)].filter(Boolean)
    .flatMap(value => String(value).split(/[\/,·]+/)).map(value => value.trim()).filter(value => value.length > 2).sort((a,b)=>b.length-a.length);
  for (const color of colors) base = base.replace(new RegExp(`(?:^|[\\s|—–-])${color.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[\\s|—–-])`,'ig'),' ');
  return base.replace(/\s+/g,' ').replace(/\s*[|—–-]\s*$/,'').trim()||p.name;
}
export function variantGroupKey(p) {
  if (!p?.name) return p?.modelKey || p?.id;
  const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  const normalized = normalize(variantGroupName(p));
  return `${normalize(p.brand)}|${normalized || normalize(p.modelKey) || normalize(p.id)}`;
}
export function variantColorLabel(p){
  const color=String(p.colorway||'').trim();
  return color&&!/(?:https?:|!\[|^image\s*\d+$|^(?:women|men)\s*\||^sneakers?\s*[·|]|미표기)/i.test(color)?color:'';
}
export function uniqueColorVariants(group,activeId){
  const seen=new Map();
  for(const p of group){
    const color=variantColorLabel(p).normalize('NFKC').toLowerCase().replace(/\s*[/|,·]\s*/g,'/').replace(/\s+/g,' ').trim();
    // Official color names identify a colorway; approximate chip hex values do
    // not. For unnamed duplicates, only an identical cached photo is evidence.
    const photo=p.presentation?.cachedPath;
    const key=color?`color:${color}`:/^\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(photo||'')?`photo:${photo}`:`id:${p.id}`;
    if(!seen.has(key)||p.id===activeId)seen.set(key,p);
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

// Named colors are an approximate navigation aid; the official photo is the
// color reference. Unknown names use a neutral patterned chip, never a guess.
export function colorSwatch(product) {
  const reviewed=product.colorSwatches?.filter(c=>/^#[0-9a-f]{6}$/i.test(c))||[];
  const palette={black:'#242424',white:'#f7f7f2',ivory:'#eee9d8',cream:'#ece1c6',beige:'#c9b89e',butter:'#eddf9d',brown:'#70472f',chocolate:'#493329',burgundy:'#632a39',oxblood:'#581f2c',red:'#cf303a',navy:'#27374d',blue:'#4479ad',green:'#53745c',sage:'#a5ad8d',silver:'#bac0c5',grey:'#989ba0',gray:'#989ba0',pink:'#e4a9bb',orange:'#e17a31',yellow:'#e6c953',violet:'#a69bb4',purple:'#866799',sand:'#cbbb9d',peanut:'#ac865e',angora:'#e8dfcd',meteorite:'#45474a',pumpernickel:'#504137',bayberry:'#55624c',turtledove:'#c8c4b5',morel:'#988b79',cocoa:'#795e50',walnut:'#796252',cortado:'#a6886b',블랙:'#242424',화이트:'#f7f7f2',그레이:'#989ba0',블루:'#4479ad',브라운:'#70472f',베이지:'#c9b89e'};
  const colors=reviewed.length?reviewed:[...new Set((product.colorway||'').toLowerCase().split(/[^a-z가-힣]+/).map(word=>palette[word]).filter(Boolean))].slice(0,3);
  if(!colors.length)return 'repeating-linear-gradient(45deg,#eee 0 4px,#bbb 4px 8px)';
  return colors.length===1?colors[0]:`linear-gradient(135deg,${colors.map((c,i)=>`${c} ${Math.round(i/colors.length*100)}% ${Math.round((i+1)/colors.length*100)}%`).join(',')})`;
}
