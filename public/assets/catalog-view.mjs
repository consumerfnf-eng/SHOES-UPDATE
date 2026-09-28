export function kstToday(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}
export function shiftCalendarMonths(day, months) {
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last)); return target.toISOString().slice(0, 10);
}
export function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function releaseState(product, today = kstToday()) {
  const date = product.releaseDate;
  if (!validDay(date)) return null;
  if (date > today) return date <= shiftCalendarMonths(today, 3) ? 'upcoming' : null;
  return date >= shiftCalendarMonths(today, -3) ? 'released' : null;
}
export function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function categoryMatches(product, key) {
  if (key === 'all') return true;
  const tags = [product.category, product.productType, ...(product.tags || [])].join(' ').toLowerCase();
  return ({sneaker:/sneaker|스니커즈|러닝|트레일|runner|running|court/,clog:/clog|클로그/,sandal:/sandal|샌들/,platform:/platform|플랫폼/,hybrid:/hybrid|혼합|메리제인|발레|mule|뮬/}[key] || /$a/).test(tags);
}
export function keywordProductIds(keyword, products, today = kstToday()) {
  // productIds is the publisher's complete attribute match set. evidenceProductIds
  // is intentionally not used: a ranking mention does not limit product discovery.
  const matched = new Set(keyword.productIds || []);
  return new Set(products.filter(p => matched.has(p.id) && releaseState(p, today)).map(p => p.id));
}
export function trendKeywords(keywords = [], {now = Date.now(), forecast = false} = {}) {
  const rankedKinds=new Set(['search-rank','composite-rank','hashtag-rank']);
  const unrankedKinds=new Set(forecast?['forecast-keyword']:['search-popular','editorial-keyword']);
  return keywords.filter(k => typeof k?.label === 'string' && k.label.trim() && Array.isArray(k.productIds)).flatMap(k => {
    const sourceRanks=(k.sourceRanks||[]).filter(s => {
      const day=kstToday(new Date(now)),age=now-Date.parse(s?.capturedAt),publicationAge=now-Date.parse(s?.publishedAt);
      const extraValid=s?.kind==='composite-rank'?s.latestPeriodVerified===true&&s.reportId&&validDay(s.periodEnd)&&s.validityBasis&&validDay(s.validUntil)&&day<=s.validUntil:s?.kind==='editorial-keyword'?publicationAge>=0&&publicationAge<=7*86400000:true;
      const fresh=forecast?age>=0&&s.validityBasis==='season-end-policy'&&validDay(s?.validUntil)&&kstToday(new Date(now))<=s.validUntil:age>=0&&age<=7*86400000;
      return s?.verified===true && typeof s.term==='string' && s.term.trim() && s.platform && safeUrl(s.sourceUrl) && fresh && extraValid && (
        !forecast && rankedKinds.has(s.kind) && Number.isInteger(s.rank) && s.rank>0 || unrankedKinds.has(s.kind) && s.rank===null
      );
    });
    // Combined ranks are published on the server. Do not retain a rank after a contributor expires.
    if(!sourceRanks.length||sourceRanks.length!==k.sourceRanks.length)return [];
    const rank=!forecast&&Number.isInteger(k.rank)&&k.rank>0&&Number.isFinite(k.score)&&k.score>0&&sourceRanks.some(s=>rankedKinds.has(s.kind))?k.rank:null;
    return [{...k,rank,sourceRanks}];
  }).sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity));
}
export function sourceContext(type, products, directory = {}, today = kstToday()) {
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
      && (!state.brands.size || state.brands.has(p.brand))
      && (state.fit === 'all' || (state.fit === 'common' ? p.fit?.includes('MLB') && p.fit?.includes('DISCOVERY') : p.fit?.includes(state.fit)))
      && categoryMatches(p, state.category)
      && (state.source === 'all' || p.popularity?.[state.source] === true)
      && (!state.keywordIds || state.keywordIds.has(p.id))
      && (!query || [p.name,p.brand,p.style,p.colorway,p.category,p.productType,...(p.keywords || []),...(p.keywordTags || [])].join(' ').toLocaleLowerCase().includes(query));
  }).sort((a, b) => state.sort === 'brand' ? a.brand.localeCompare(b.brand, 'en') || a.name.localeCompare(b.name) : state.sort === 'sources' ? (b.sourceSignals?.length || 0) - (a.sourceSignals?.length || 0) || b.releaseDate.localeCompare(a.releaseDate) : b.releaseDate.localeCompare(a.releaseDate) || a.brand.localeCompare(b.brand));
}
