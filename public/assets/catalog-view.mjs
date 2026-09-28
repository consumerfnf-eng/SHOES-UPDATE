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
