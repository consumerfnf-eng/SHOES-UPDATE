import fs from 'node:fs';

export const POLICY = JSON.parse(fs.readFileSync(new URL('../config/brand-policy.json', import.meta.url), 'utf8'));
const key = x => String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
const brandMap = new Map(POLICY.brands.map(b => [key(b.name), b]));
for (const [a, b] of Object.entries(POLICY.aliases)) brandMap.set(key(a), brandMap.get(key(b)));
export function canonicalBrand(name) { return brandMap.get(key(POLICY.collaborations[name] || name))?.name || name; }
export function brandPolicy(name) { return brandMap.get(key(canonicalBrand(name))); }
export function kstDay(now = new Date()) { return new Date(new Date(now).getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function validDay(day) { return /^\d{4}-\d{2}-\d{2}$/.test(day || '') && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day; }
export function shiftMonth(day, delta) {
  const [y, m, d] = day.split('-').map(Number), first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const max = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, max)); return first.toISOString().slice(0, 10);
}
export function httpUrl(x) { try { const u = new URL(x); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
export function canonicalUrl(x) {
  try { const u = new URL(x); u.hash = ''; for(const name of [...u.searchParams.keys()])if(/^(?:utm_|gclid$|fbclid$|ref$|referrer$|campaign$|affiliate$)/i.test(name))u.searchParams.delete(name);u.searchParams.sort();u.hostname = u.hostname.replace(/^www\./, ''); u.pathname = u.pathname.replace(/\/collections\/[^/]+\/products\//, '/products/').replace(/\/$/, ''); return u.href; } catch { return ''; }
}
export function dedupeKey(p) { return `${key(canonicalBrand(p.brand))}|${key(p.style) || canonicalUrl(p.url)}|${key(p.colorway)}`; }
const excluded = /\b(loafers?|oxfords?|derby|derbies|pumps?|stilettos?|high[ -]?heels?|moccasins?|mocassins?|escarpins?|decolletes?|slingbacks?|dress (?:shoes?|sandals?)|ballerina flats?|ballet flats?|chelsea|boots?|snowclog|ski|snowboard|winter|fur[ -]lined|insulated)\b|로퍼|구두|하이힐|펌프스|부츠|방한|발레 플랫/i;
const performance = /\b(?:soccer|football|baseball|track|golf)\s+(?:boots?|cleats?|spikes?|shoes?)|\b(?:racing spikes|competition spikes|basketball shoes)\b|축구화|야구화|스파이크/i;
export function classifyFootwear(p) {
  // Negative gates run first for every record; legacy verification cannot bypass them.
  const title = `${p.name || ''} ${p.officialCategory || ''}`;
  const context = `${title} ${p.description || ''}`;
  if(/goadome/i.test(title)&&!p.hybridReview?.approved)return {reason:'hybrid-review-required'};
  if (excluded.test(title) || performance.test(title) || /\b(?:loafers?|oxford shoes?|derby shoes|ballet flats?|high[ -]heeled|stilettos?|dress sandals?)\b|로퍼|하이힐|정장 구두/i.test(p.description || '')) return { reason: 'excluded-footwear' };
  if (/\b(?:mule|mary jane|ballet)\b|메리제인|뮬/i.test(context)) {
    if (!p.hybridReview?.approved || !httpUrl(p.hybridReview.url)) return { reason: 'hybrid-review-required' };
    return { category: 'hybrid' };
  }
  if (/\b(?:clog|클로그)\b/i.test(title)) {
    if (!/ventilat|croslite|eva|summer|drain|breath|vented|여름|통기|배수/i.test(context)) return { reason: 'summer-structure-unverified' };
    return { category: 'clog' };
  }
  if (/sandal|slide|샌들|슬라이드/i.test(title)) {
    if (!/sport|outdoor|eva|foam|cushion|casual|flat|recovery|스포츠|캐주얼|플랫|쿠셔닝/i.test(context)) return { reason: 'casual-sandal-unverified' };
    return { category: /platform|플랫폼/i.test(context) ? 'platform-sandal' : 'sandal' };
  }
  if (/sneaker|running shoe|trail running|trainers?|court shoe|스니커|운동화|러닝화|트레일화/i.test(context)) return { category: 'sneaker' };
  if(p.productVerifiedAt&&/\b(?:Air Max (?!Phenomena)|Air Force 1|Air Jordan \d|Air Bakin|Dunk Low|Dunk High|Cortez|Vomero|Pegasus|Shox|P-6000)\b/i.test(p.name||''))return {category:'sneaker'};
  return { reason: 'footwear-type-unverified' };
}
export function fitFor(p, category) {
  const text = `${p.name || ''} ${p.description || ''} ${p.officialCategory || ''}`;
  const fit = [], fitReasons = [];
  if (/lifestyle|casual|retro|heritage|court|platform|chunky|street|sportstyle|low.profile|first released in (?:19\d\d|200\d)[\s\S]*returns|스니커즈|레트로|캐주얼|플랫폼/i.test(text)) {
    fit.push('MLB'); fitReasons.push('일상 스포츠 캐주얼·실루엣 참고');
  }
  if (/trail|running|gravel|outdoor|cushion|breath|ventilat|drain|lightweight|recovery|트레일|쿠셔닝|통기|경량|아웃도어/i.test(text)) {
    fit.push('DISCOVERY'); fitReasons.push('활동성·쿠셔닝·통기 또는 아웃도어 구조 참고');
  }
  if (!fit.length && ['sandal','clog','platform-sandal'].includes(category) && /eva|foam|croslite/i.test(text)) { fit.push('DISCOVERY'); fitReasons.push('여름용 경량 몰드 구조 참고'); }
  return { fit, fitReasons };
}
function age(date, today) { return (Date.parse(today) - Date.parse(date?.slice(0, 10))) / 86400000; }
export function validateSignals(signals = [], today) {
  const seen = new Set();
  return signals.filter(s => {
    if (!['magazine','newsletter','sns','ecommerce'].includes(s.type) || !httpUrl(s.url) || !s.title || !s.checkedAt || !s.modelMatched) return false;
    const days = age(s.publishedAt, today), window = s.type === 'sns' ? 14 : 30;
    if (!Number.isFinite(days) || days < 0 || days > window) return false;
    if (s.type === 'sns' && (!s.account || s.sponsored !== false || s.original !== true || s.brandOwned || s.seller)) return false;
    if (s.type === 'ecommerce' && (!(s.rank > 0) || !s.country || !s.rankingCategory || !s.rankVerified)) return false;
    const canonical = canonicalUrl(s.url), k = s.originalId || canonical;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}
export function popularity(signals, today) {
  const independent = type => new Set(signals.filter(s => s.type === type && s.independent === true && !s.sponsored).map(s => s.publisherId || new URL(s.url).hostname.replace(/^www\./, ''))).size;
  const social = signals.filter(s => s.type === 'sns');
  return { magazine: independent('magazine') >= 2, newsletter: independent('newsletter') >= 2,
    sns: social.length >= 5 && new Set(social.map(s => s.account.toLowerCase())).size >= 3 && social.some(s => age(s.publishedAt, today) <= 7),
    ecommerce: signals.some(s => s.type === 'ecommerce') };
}
export function curateProduct(raw, today) {
  const brand = canonicalBrand(raw.brand), policy = brandPolicy(brand);
  if (!policy || !['mandatory','core','conditional'].includes(policy.policy)) return { reason: 'brand-excluded-or-unverified' };
  if (policy.policy === 'conditional' && (!raw.modelReview?.approved || !httpUrl(raw.modelReview.url))) return { reason: 'conditional-model-review-required' };
  const type = classifyFootwear(raw); if (!type.category) return type;
  const fit = fitFor(raw, type.category); if (!fit.fit.length) return { reason: 'brand-fit-unverified' };
  const e = raw.dateEvidence;
  if (!validDay(raw.releaseDate) || !e || e.precision !== 'day' || !httpUrl(e.url) || !Number.isFinite(Date.parse(e.verifiedAt)) || !e.excerpt || e.verified!==true) return { reason: 'release-day-evidence-required' };
  const future = raw.releaseDate > today;
  if (future && (!e.official || raw.releaseDate > shiftMonth(today, 3))) return { reason: 'upcoming-evidence-or-range' };
  if (!httpUrl(raw.url) || !httpUrl(raw.image)) return { reason: 'product-url-or-image-required' };
  if (!Number.isFinite(Date.parse(raw.productVerifiedAt)) || !httpUrl(raw.productEvidenceUrl)) return { reason: 'product-verification-required' };
  const signals = validateSignals(raw.sourceSignals, today), hot = popularity(signals, today);
  // The SNS tab contains only products satisfying the explicit popularity rule.
  const visibleSignals = signals.filter(s => s.type !== 'sns' || hot.sns);
  const product = { id: raw.id, brand, name: raw.name, category: type.category, productType: type.category, ...fit,
    modelKey:raw.modelGroup||`${key(brand)}|${key(String(raw.name).split(/ — | – /)[0])}`,
    releaseDate: raw.releaseDate, releaseStatus: future ? 'upcoming' : 'released', dateEvidence: e,
    url: raw.url, image: raw.image, style: raw.style || '', colorway: raw.colorway || '', colors: raw.colors || [],
    gender: raw.gender || '', material: raw.material || '', priceLabel: raw.priceLabel || '',
    description:[type.category==='sneaker'?'스니커즈':type.category==='clog'?'여름 클로그':type.category==='hybrid'?'검토된 혼합형 스니커즈':'캐주얼 샌들',...fit.fitReasons].join(' · '),
    officialCategory:type.category==='sneaker'?'스니커즈':raw.officialCategory||'',
    hybridReview:raw.hybridReview,modelReview:raw.modelReview,
    sourceSignals: visibleSignals, popularity: hot, archiveGroup: raw.archiveGroup || policy.group,
    country: raw.country || '', lastVerifiedAt: raw.productVerifiedAt, productEvidenceUrl: raw.productEvidenceUrl,
    eligibility: { passed: true, checkedAt: today }, keywordTags: raw.keywordTags || [] };
  return { product, expired: raw.releaseDate < shiftMonth(today, -3) };
}
export function rankKeywords(products, today) {
  const map = new Map(), old = new Map();
  for (const p of products) for (const signal of p.sourceSignals || []) {
    const days=age(signal.publishedAt,today);if(days<0||days>=14)continue;
    for (const label of signal.keywords || []) {
      if (!label || label.length > 60) continue;
      const id=key(label),model=p.modelKey||p.id;if(days>=7){const ids=old.get(id)||new Set();ids.add(model);old.set(id,ids);continue;}
      const r = map.get(id) || { id, label, types: new Set(), products: new Set(),models:new Set() };
      r.types.add(signal.type); r.products.add(p.id);r.models.add(model);map.set(id, r);
    }
  }
  return [...map.values()].map(r => ({ id: r.id, label: r.label, sourceTypes: [...r.types], productIds: [...r.products], productCount: r.models.size, previousProductCount: old.get(r.id)?.size || 0, growth: r.models.size - (old.get(r.id)?.size || 0) }))
    .sort((a,b) => b.sourceTypes.length-a.sourceTypes.length || b.productCount-a.productCount || b.growth-a.growth || a.label.localeCompare(b.label)).map((r,i) => ({ ...r, rank:i+1 }));
}
export function curateCatalog(rawProducts, { now = new Date(), previous = {}, collection = {} } = {}) {
  const today = kstDay(now), products = [], expired = [], held = [], seen = new Set();
  for (const raw of rawProducts) {
    const result = curateProduct(raw, today);
    if (!result.product) { held.push({ id:raw.id, brand:raw.brand, name:raw.name, reason:result.reason }); continue; }
    const k = dedupeKey(result.product); if (seen.has(k)) { held.push({ id:raw.id, reason:'duplicate-product-color' }); continue; } seen.add(k);
    (result.expired ? expired : products).push(result.product);
  }
  const activeBrands = new Set(products.map(p => p.brand));
  const snapshot = { schemaVersion:1, publishedAt:new Date(now).toISOString(), periodStart:shiftMonth(today,-3), asOf:today,
    brands:POLICY.brands.filter(b => b.mandatory || b.policy === 'core' || b.policy === 'conditional' && activeBrands.has(b.name)),
    products:products.sort((a,b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name)),
    keywords:rankKeywords(products,today,previous.keywords), sourceStatus:{ checkedAt:collection.checkedAt || previous.sourceStatus?.checkedAt || null,
      lastSuccessfulCollectionAt:collection.lastSuccessfulCollectionAt || previous.sourceStatus?.lastSuccessfulCollectionAt || null,
      unavailableBrands:collection.unavailableBrands || previous.sourceStatus?.unavailableBrands || [], coverage:collection.coverage || previous.sourceStatus?.coverage || [],
      notes:['출시일·품목·적합성을 확인한 상품만 표시합니다. 확인일을 출시일로 사용하지 않습니다.','SNS 인기는 수집한 공개 게시물 범위에 한합니다.'],
      counts:{ source:rawProducts.length, published:products.length, held:held.length, expired:expired.length } } };
  return { snapshot, queue:{schemaVersion:1,generatedAt:new Date(now).toISOString(),products:expired}, review:{schemaVersion:1,checkedAt:new Date(now).toISOString(),held} };
}
