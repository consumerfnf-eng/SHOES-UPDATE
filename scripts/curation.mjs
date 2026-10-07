import fs from 'node:fs';
import {productKeywordIds,productSearchConceptIds,productCollaborationBrands} from './keyword-taxonomy.mjs';
import {buildKeywordCatalog} from './search-keywords.mjs';
import {validateSocialMetrics,qualifyingSocialMetric,withSocialComparisons} from './social-metrics.mjs';
import {hasArrivalEvidence} from '../public/assets/publication-window.mjs';
import {validCalendarDay as validDay,calendarShift as shiftMonth,releaseWindow,releaseState,releaseSortKey} from '../public/assets/release-window.mjs';
export {validDay,shiftMonth};

export const POLICY = JSON.parse(fs.readFileSync(new URL('../config/brand-policy.json', import.meta.url), 'utf8'));
const key = x => String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
const brandMap = new Map(POLICY.brands.map(b => [key(b.name), b]));
for (const [a, b] of Object.entries(POLICY.aliases)) brandMap.set(key(a), brandMap.get(key(b)));
export function canonicalBrand(name) { return brandMap.get(key(POLICY.collaborations[name] || name))?.name || name; }
export function brandPolicy(name) { return brandMap.get(key(canonicalBrand(name))); }
export function kstDay(now = new Date()) { return new Date(new Date(now).getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function httpUrl(x) { try { const u = new URL(x); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
export function canonicalUrl(x) {
  try { const u = new URL(x); u.hash = ''; for(const name of [...u.searchParams.keys()])if(/^(?:utm_|gclid$|fbclid$|ref$|referrer$|campaign$|affiliate$)/i.test(name))u.searchParams.delete(name);u.searchParams.sort();u.hostname = u.hostname.replace(/^www\./, ''); u.pathname = u.pathname.replace(/\/collections\/[^/]+\/products\//, '/products/').replace(/\/$/, ''); return u.href; } catch { return ''; }
}
export function dedupeKey(p) { return `${key(canonicalBrand(p.brand))}|${key(p.style) || canonicalUrl(p.url)}|${key(p.colorway)}`; }
const officialSources=JSON.parse(fs.readFileSync(new URL('../config/daily_sources.json',import.meta.url),'utf8'));
const socialSources=JSON.parse(fs.readFileSync(new URL('../config/social-metric-sources.json',import.meta.url),'utf8'));
const officialDomainOverrides={'Nike':['nike.com'],'Jordan':['nike.com'],'PUMA':['puma.com'],'adidas':['adidas.com','adidas.ae','adidas.jp','adidas.fr','adidas.co.uk'],'Converse':['converse.com','palmes.co']};
export function isOfficialProductUrl(brand,url){
  if(!httpUrl(url))return false;const host=new URL(url).hostname.replace(/^www\./,'');
  const domains=[...(officialDomainOverrides[canonicalBrand(brand)]||[]),...Object.entries(officialSources).filter(([name])=>canonicalBrand(name)===canonicalBrand(brand)).flatMap(([,sources])=>sources.map(s=>new URL(s.url).hostname.replace(/^www\./,'')))];
  return domains.some(domain=>host===domain||host.endsWith('.'+domain));
}
export function officialEvidenceFor(p,today){
  const product=p.officialProductEvidence,image=p.officialImageEvidence;
  const identifierMatches=e=>p.styleType==='official-product-id'?e?.identifierType==='official-product-id':e?.identifierType!=='official-product-id';
  const identity=e=>e?.verified===true&&identifierMatches(e)&&canonicalBrand(e.brand)===canonicalBrand(p.brand)&&key(p.style)&&key(e.style)===key(p.style)&&Number.isFinite(Date.parse(e.verifiedAt))&&kstDay(e.verifiedAt)<=today;
  const partner=canonicalBrand(p.brand)==='ASICS'&&httpUrl(p.url)&&/^(?:www\.)?ceciliebahnsen\.com$/.test(new URL(p.url).hostname)&&productCollaborationBrands(p).includes('Cecilie Bahnsen')&&product?.styleEvidence?.verified===true&&key(product.styleEvidence.style)===key(p.style)&&isOfficialProductUrl('ASICS',product.styleEvidence.url);
  const listing=product?.verificationMethod==='official-new-listing-sku-image'&&image?.verificationMethod===product.verificationMethod&&hasArrivalEvidence(p,today)&&isOfficialProductUrl(p.brand,p.arrivalEvidence.url)&&image.sourceUrl===p.arrivalEvidence.url&&product.contentHash===p.arrivalEvidence.contentHash&&image.contentHash===p.arrivalEvidence.contentHash&&p.productEvidenceUrl===p.arrivalEvidence.url;
  if(!identity(product)||!identity(image)||!isOfficialProductUrl(p.brand,p.url)&&!partner||product.url!==p.url||image.url!==p.image||(!listing&&image.sourceUrl!==p.url)||!httpUrl(p.image))return null;
  const clean=(e,fields)=>Object.fromEntries(fields.filter(k=>e[k]!==undefined).map(k=>[k,e[k]]));
  const verifiedProduct=clean(product,['verified','url','verifiedAt','brand','style','identifierType','verificationMethod','contentHash']);
  if(product.verificationMethod==='official-partner-exact-name-color-image-with-reviewed-style'){
    const external=product.externalStyleEvidence;
    if(key(product.matchedName)!==key(p.name)||!product.publisherStyle||external?.verified!==true||key(external.style)!==key(p.style)||!httpUrl(external.url)||!Number.isFinite(Date.parse(external.verifiedAt)))return null;
    Object.assign(verifiedProduct,{matchedName:product.matchedName,publisherStyle:product.publisherStyle,externalStyleEvidence:{verified:true,url:external.url,style:external.style,verifiedAt:external.verifiedAt}});
  }
  if(partner)verifiedProduct.styleEvidence={verified:true,url:product.styleEvidence.url,style:product.styleEvidence.style};
  const model=product.modelIdentity;
  if(model?.verified===true&&model.id&&model.name&&key(model.name)===key(String(p.name).split(/\s[—–]\s/)[0]))verifiedProduct.modelIdentity={id:model.id,name:model.name,verified:true};
  return {officialProductEvidence:verifiedProduct,officialImageEvidence:clean(image,['verified','url','sourceUrl','verifiedAt','brand','style','identifierType','verificationMethod','contentHash'])};
}
const excluded = /\b(loafers?|oxfords?|derby|derbies|pumps?|stilettos?|wedge|heels|(?:high|kitten|block|wedge)[ -]?heels?|heeled|moccasins?|mocassins?|escarpins?|decolletes?|slingbacks?|dress (?:shoes?|sandals?)|ballerina flats?|ballet flats?|chelsea|boots?|snowclog)\b|로퍼|구두|슬링백|(?:하이|키튼|블록|웨지)힐|펌프스|부츠|방한|발레 플랫/i;
const performance = /\b(?:soccer|football|baseball|track|golf)\s+(?:boots?|cleats?|spikes?|shoes?)|\b(?:racing spikes|competition spikes|basketball shoes)\b|축구화|야구화|스파이크/i;
const sneakerStructure = /\b(?:sneakers?|sneakerina|running (?:shoes?|heritage)|trainers?|sneaker (?:sole|midsole|outsole|construction))\b|스니커|운동화|러닝화|スニーカ(?:ー|リーナ)|运动鞋|運動鞋|跑鞋/i;
const namedHybrid = /\b(?:mules?|mary[ -]?jane|ballet|ballerinas?|sneakerina)\b|메리제인|발레리나|발레|뮬|バレエ|バレリーナ|スニーカリーナ|メリージェーン|ミュール|芭蕾|玛丽珍|瑪麗珍|穆勒/i;
const otherHybrid = /\b(?:clogs?|sandals?|slides?|espadrilles?|fisherman|hybrids?)\b|클로그|샌들|슬라이드|에스파드리유|피셔맨|혼합|하이브리드|クロッグ|サンダル|エスパドリーユ|ハイブリッド|凉鞋|涼鞋|混合/i;
export function sneakerHybridCandidate(p) {
  const title = `${p.name || ''} ${p.officialCategory || ''} ${p.hybridReview?.approved ? p.hybridReview.type || '' : ''}`;
  return namedHybrid.test(title) || otherHybrid.test(title) || p.category === 'hybrid' || p.hybridReview?.approved === true && p.hybridReview.sneakerSole === true;
}
export function officialHybridReview(p, description, checkedAt) {
  if (!isOfficialProductUrl(p.brand,p.url) || !sneakerHybridCandidate(p) || !sneakerStructure.test(description || '')) return null;
  // A comparison with running shoes does not establish a sneaker base. Either
  // the verified product name declares one, or the description names its base.
  const construction=/\b(?:sneaker|trainer|running shoe)[ -](?:sole|midsole|outsole|construction|base)|\b(?:sole|midsole|outsole|base)\b[^.!?]{0,45}\b(?:sneaker|trainer|running shoe)|(?:스니커|운동화|러닝화)[^.!?]{0,15}(?:솔|밑창|미드솔)|(?:スニーカー|运动鞋|運動鞋|跑鞋)[^.!?]{0,15}(?:ソール|底)/i;
  if(!sneakerStructure.test(`${p.name||''} ${p.officialCategory||''}`)&&!construction.test(description||''))return null;
  return {approved:true,url:p.url,type:'hybrid',sneakerSole:true,checkedAt,method:'official-product-sneaker-description'};
}
export function classifyFootwear(p) {
  // Negative gates run first for every record; legacy verification cannot bypass them.
  // Include the normalized source category/type. Several official product feeds
  // describe a shoe as `category: casual` while declaring `productType: sneaker`;
  // omitting those fields silently held otherwise verified sneaker releases.
  const typeHint = p.category ? (p.productType || '') : '';
  const title = `${p.name || ''} ${p.officialCategory || ''} ${typeHint}`;
  const structure=p.footwearStructure?.category===p.category?p.footwearStructure:null;
  const context = `${title} ${p.description || ''} ${p.category || ''} ${structure?.description||''} ${structure?.officialCategory||''}`;
  const review=p.footwearReview;
  if(/ローファー|パンプス|スリングバック|ハイヒール|革靴|高跟|乐福|樂福|皮鞋|(?:^|[\s/])힐(?:[\s/]|$)/.test(title))return {reason:'excluded-footwear'};
  const reviewedPlatform=review?.approved===true&&review.type==='platform'&&review.flatSole===true&&review.brand===canonicalBrand(p.brand)&&review.style===p.style&&review.url===p.url&&isOfficialProductUrl(p.brand,p.url);
  const reviewedJelly=review?.approved===true&&review.type==='jelly'&&review.brand===canonicalBrand(p.brand)&&review.style===p.style&&review.url===p.url&&isOfficialProductUrl(p.brand,p.url)&&review.flatSole===true;
  const approvedDrip=canonicalBrand(p.brand)==='Gucci'&&p.style==='A00A2SFAGMQ9656'&&review?.approved===true&&review.type==='sneaker'&&review.brand==='Gucci'&&review.style===p.style&&review.url===p.url&&isOfficialProductUrl(p.brand,p.url)&&/sneaker/i.test(title)&&/slip.on ease of (?:a )?loafer/i.test(p.description||'');
  if(/goadome/i.test(title)&&!p.hybridReview?.approved)return {reason:'hybrid-review-required'};
  if (excluded.test(`${title} ${p.category||''} ${p.productType||''}`) || performance.test(title) || /\b(?:loafers?|oxford shoes?|derby shoes|ballet flats?|high[ -]heeled|stilettos?|slingbacks?|(?:kitten|block|wedge) heels?|dress sandals?)\b|로퍼|슬링백|하이힐|정장 구두/i.test(approvedDrip?(p.description||'').replace(/slip.on ease of (?:a )?loafer/gi,''):(p.description || ''))) return { reason: 'excluded-footwear' };
  // Jelly names alone (for example Jellyfish) are not proof of jelly construction.
  if (/\bjelly\b|젤리/i.test(title)||reviewedJelly) {
    if (!reviewedJelly&&!/\b(?:pvc|tpu|melflex|jelly upper|jelly material|jelly construction)\b|젤리 소재/i.test(context))return {reason:'jelly-structure-unverified'};
    if (!reviewedJelly&&!/\b(?:flat|low.profile|sneakers?|trainers?|flexible sole)\b|플랫|스니커|평평한/i.test(context))return {reason:'flat-structure-unverified'};
    return {category:'jelly'};
  }
  // Inspiration mentioned in a description does not change a conventional runner
  // into a hybrid. Use its actual product type or a reviewed construction.
  // All reviewed sneaker hybrids are eligible, including sandal/clog and new
  // mixed forms. Plain summer sandals/clogs keep their own separate gates.
  const hybridTitle=`${title} ${p.hybridReview?.approved?p.hybridReview.type||'':''}`;
  const reviewedSneakerBase=p.hybridReview?.approved===true&&p.hybridReview.sneakerSole===true&&p.hybridReview.url===p.url&&isOfficialProductUrl(p.brand,p.url);
  if (namedHybrid.test(hybridTitle) || sneakerHybridCandidate(p) && (sneakerStructure.test(p.name||'') || reviewedSneakerBase || /\bhybrids?\b|하이브리드|혼합|ハイブリッド|混合/i.test(hybridTitle) || p.category==='hybrid')) {
    if (!p.hybridReview?.approved || !httpUrl(p.hybridReview.url)) return { reason: 'hybrid-review-required' };
    if (!sneakerStructure.test(context) && !reviewedSneakerBase)return {reason:'sneaker-structure-unverified'};
    return { category: 'hybrid' };
  }
  if (/\b(?:clog|클로그)\b/i.test(title)) {
    if (!/ventilat|croslite|eva|summer|drain|breath|vented|여름|통기|배수/i.test(context)) return { reason: 'summer-structure-unverified' };
    return { category: 'clog' };
  }
  if (/sandal|slide|샌들|슬라이드/i.test(title)) {
    if (!/sport|outdoor|eva|foam|cushion|casual|flat|recovery|스포츠|캐주얼|플랫|쿠셔닝/i.test(context)) return { reason: 'casual-sandal-unverified' };
    if(/platform|플랫폼/i.test(context)&&!reviewedPlatform&&!/\bflat\b|level sole|통굽|평평한|플랫/i.test(context))return {reason:'flat-platform-unverified'};
    return { category: /platform|플랫폼/i.test(context) ? 'platform-sandal' : 'sandal' };
  }
  if (/sneaker|running shoe|trail running|training shoes?|trainers?|court(?:-type)? shoe|tennis shoes?|스니커|운동화|러닝화|트레이닝화|트레일화/i.test(context)||/\btraining\b[^.!?]{0,45}\bshoes?\b/i.test(title)) return { category: 'sneaker' };
  if (/\bplatform\b|플랫폼/i.test(title)&&(reviewedPlatform||/\bflat\b|level sole|플랫|통굽|평평한/i.test(context))&&/casual|street|sport|캐주얼/i.test(context))return {category:'platform-shoe'};
  if(p.productVerifiedAt&&/\b(?:Air Max (?!Phenomena)|Air Force 1|Air Jordan \d|Air Bakin|Dunk Low|Dunk High|Cortez|Vomero|Pegasus|Shox|P-6000)\b/i.test(p.name||''))return {category:'sneaker'};
  return { reason: 'footwear-type-unverified' };
}
export function fitFor(p, category, today=kstDay()) {
  const text = `${p.name || ''} ${p.description || ''} ${p.officialCategory || ''}`;
  const fit = [], fitReasons = [];
  if (/lifestyle|casual|retro|heritage|court|platform|chunky|street|sportstyle|low.profile|first released in (?:19\d\d|200\d)[\s\S]*returns|스니커즈|레트로|캐주얼|플랫폼/i.test(text)) {
    fit.push('MLB'); fitReasons.push('일상 스포츠 캐주얼·실루엣 참고');
  }
  if (/trail|running|training|fitness|gravel|outdoor|cushion|breath|ventilat|drain|lightweight|recovery|트레이닝|피트니스|트레일|쿠셔닝|통기|경량|아웃도어/i.test(text)) {
    fit.push('DISCOVERY'); fitReasons.push('활동성·쿠셔닝·통기 또는 아웃도어 구조 참고');
  }
  if (!fit.length && ['sandal','clog','platform-sandal'].includes(category) && /eva|foam|croslite/i.test(text)) { fit.push('DISCOVERY'); fitReasons.push('여름용 경량 몰드 구조 참고'); }
  // A verified sneaker without an explicit performance/lifestyle descriptor is
  // still a valid MLB reference item. Keep this fallback gated by the exact
  // official product/image proof so unverified generic records never surface.
  if(['sneaker','hybrid','jelly','platform-shoe','platform-sandal'].includes(category)&&!fit.length&&officialEvidenceFor(p,today)){
    fit.push('MLB'); fitReasons.push('공식 스니커즈 실루엣·컬러 참고');
  }
  const policy=brandPolicy(p.brand);
  if(category==='sneaker'&&policy?.mandatory&&policy.group==='luxury'&&officialEvidenceFor(p,today)){
    if(!fit.includes('MLB'))fit.push('MLB');fitReasons.push('럭셔리 스니커즈 디자인 참고');
  }
  return { fit, fitReasons };
}
function age(date, today) { return (Date.parse(today) - Date.parse(date?.slice(0, 10))) / 86400000; }
export function validateSignals(signals = [], today) {
  const seen = new Set();
  return signals.filter(s => {
    if (!['magazine','newsletter','sns','ecommerce'].includes(s.type) || !httpUrl(s.url) || !s.title || !s.checkedAt || !s.modelMatched) return false;
    const days = age(s.publishedAt, today);
    if (!Number.isFinite(days) || days < 0 || (s.type==='sns'?s.publishedAt.slice(0,10)<shiftMonth(today,-3):days>30)) return false;
    if (s.type === 'sns' && (!s.account || s.sponsored !== false || s.original !== true || s.brandOwned || s.seller)) return false;
    if (s.type === 'ecommerce' && (!(s.rank > 0) || !s.country || !s.rankingCategory || !s.rankVerified)) return false;
    const canonical = canonicalUrl(s.url), k = s.originalId || canonical;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}
export function popularity(signals, today, {product,socialMetrics=[],officialEligible=false}={}) {
  const independent = type => new Set(signals.filter(s => s.type === type && s.independent === true && !s.sponsored).map(s => s.publisherId || new URL(s.url).hostname.replace(/^www\./, ''))).size;
  const magazine=independent('magazine')>=2,newsletter=independent('newsletter')>=2;
  const media=new Set(signals.filter(s=>['magazine','newsletter'].includes(s.type)&&s.independent===true&&!s.sponsored).map(s=>s.publisherId||new URL(s.url).hostname.replace(/^www\./,''))).size>=2;
  return {magazine,newsletter,media,
    sns:officialEligible&&socialMetrics.some(qualifyingSocialMetric),
    brand:officialEligible&&!!product&&releaseState(product,today)==='released',
    ecommerce: signals.some(s => s.type === 'ecommerce') };
}
export function curateProduct(raw, today, now=new Date(today+'T23:59:59.999+09:00')) {
  const brand = canonicalBrand(raw.brand), policy = brandPolicy(brand);
  if (!policy || !['mandatory','core','conditional'].includes(policy.policy)) return { reason: 'brand-excluded-or-unverified' };
  if (policy.policy === 'conditional' && (!raw.modelReview?.approved || !httpUrl(raw.modelReview.url))) return { reason: 'conditional-model-review-required' };
  const type = classifyFootwear(raw); if (!type.category) return type;
  const fit = fitFor(raw, type.category,today); if (!fit.fit.length) return { reason: 'brand-fit-unverified' };
  const e = raw.dateEvidence;
  const release=releaseWindow(raw);
  const arrival=hasArrivalEvidence(raw,today)&&isOfficialProductUrl(brand,raw.arrivalEvidence.url)&&!!officialEvidenceFor(raw,today);
  if (!arrival&&(!release || !e || !['day','month'].includes(e.precision) || !httpUrl(e.url) || !Number.isFinite(Date.parse(e.verifiedAt)) || !e.excerpt || e.verified!==true)) return { reason: 'release-day-evidence-required' };
  const state=releaseState(raw,today),future=state==='upcoming';
  if(state==='uncertain'||state==='invalid')return {reason:release?.precision==='month'?'release-month-window-uncertain':'upcoming-evidence-or-range'};
  if (!httpUrl(raw.url) || !httpUrl(raw.image)) return { reason: 'product-url-or-image-required' };
  if (!Number.isFinite(Date.parse(raw.productVerifiedAt)) || !httpUrl(raw.productEvidenceUrl)) return { reason: 'product-verification-required' };
  const official=officialEvidenceFor(raw,today);
  if(raw.styleType==='official-product-id'&&!official)return {reason:'official-product-id-evidence-required'};
  const socialMetrics=validateSocialMetrics({...raw,...(official||{}),brand},today,{officialEligible:!!official,now});
  const visibleSignals = validateSignals(raw.sourceSignals, today), hot = popularity(visibleSignals, today,{product:raw,socialMetrics,officialEligible:!!official});
  const product = { id: raw.id, brand, name: raw.name, category: type.category, productType: type.category, ...fit,
    modelKey:raw.modelGroup||`${key(brand)}|${key(String(raw.name).split(/ — | – /)[0])}`,
    releaseDate: raw.releaseDate||'', releaseStatus: future ? 'upcoming' : 'released', dateEvidence: e,...(release?.precision==='month'?{verifiedReleaseWindow:{start:release.start,end:release.end}}:{}),
    ...(arrival?{arrivalEvidence:raw.arrivalEvidence}:{}),...(raw.firstPublishedAt?{firstPublishedAt:raw.firstPublishedAt}:{}),
    url: raw.url, image: raw.image, style: raw.style || '',...(raw.styleType==='official-product-id'?{styleType:raw.styleType}:{}),colorway: raw.colorway || '', colors: raw.colors || [],
    gender: raw.gender || '', material: raw.material || '', priceLabel: raw.priceLabel || '',
    description:[type.category==='sneaker'?'스니커즈':type.category==='clog'?'여름 클로그':type.category==='hybrid'?'검토된 혼합형 스니커즈':type.category==='jelly'?'플랫 젤리 슈즈':type.category==='platform-shoe'?'캐주얼 플랫폼 슈즈':'캐주얼 샌들',...fit.fitReasons].join(' · '),
    footwearStructure:raw.footwearStructure||(['jelly','platform-shoe','platform-sandal'].includes(type.category)?{category:type.category,description:raw.description,officialCategory:raw.officialCategory}:undefined),
    officialCategory:type.category==='sneaker'?'스니커즈':raw.officialCategory||'',
    hybridReview:raw.hybridReview,modelReview:raw.modelReview,footwearReview:raw.footwearReview,
    sourceSignals: visibleSignals, socialMetrics,...(official||{}),collaborationBrands:official?productCollaborationBrands(raw):[],popularity: hot, archiveGroup: raw.archiveGroup || policy.group,
    country: raw.country || '', lastVerifiedAt: raw.productVerifiedAt, productEvidenceUrl: raw.productEvidenceUrl,
    eligibility: { passed: true, checkedAt: today }, keywordTags: productKeywordIds({...raw,sourceSignals:visibleSignals}) };
  product.searchConceptIds=productSearchConceptIds({...raw,category:type.category,keywordTags:product.keywordTags});
  return { product, expired: state==='expired' };
}
export function rankKeywords(products, now, sourceRanks=[]) {return buildKeywordCatalog(products,sourceRanks,{now}).keywords;}
export function curateCatalog(rawProducts, { now = new Date(), previous = {}, collection = {} } = {}) {
  const today = kstDay(now), products = [], expired = [], held = [], seen = new Set();
  for (const raw of rawProducts) {
    const result = curateProduct(raw, today,now);
    if (!result.product) { held.push({ id:raw.id, brand:raw.brand, name:raw.name, reason:result.reason }); continue; }
    const k = dedupeKey(result.product); if (seen.has(k)) { held.push({ id:raw.id, reason:'duplicate-product-color' }); continue; } seen.add(k);
    (result.expired ? expired : products).push(result.product);
  }
  const rankedSocial=withSocialComparisons(products);products.splice(0,products.length,...rankedSocial);
  const activeBrands = new Set(products.map(p => p.brand));
  const configuredDirectory=collection.sourceDirectory||previous.sourceDirectory||{};
  const sourceDirectory=Object.fromEntries(['magazine','newsletter','sns','ecommerce'].map(type=>{
    const sources=new Map();
    for(const p of products)for(const s of p.sourceSignals.filter(x=>x.type===type)){
      const host=new URL(s.url).hostname.replace(/^www\./,''),rawId=s.publisherId||s.accountId||s.account||host,known=configuredDirectory[type]?.configured?.find(x=>x.id===rawId||new URL(x.url).hostname.replace(/^www\./,'')===host),id=known?.id||rawId;
      const item=sources.get(id)||{id,name:s.publisherName||s.platformName||s.account||known?.name||host,url:known?.url||`https://${host}/`,ids:new Set()};item.ids.add(p.id);sources.set(id,item);
    }
    return [type,{configured:configuredDirectory[type]?.configured||[],observed:[...sources.values()].map(({ids,...s})=>({...s,itemCount:ids.size})),checkedAt:configuredDirectory[type]?.checkedAt||collection.checkedAt||previous.sourceStatus?.checkedAt||null,checks:configuredDirectory[type]?.checks||[]}];
  }));
  const keywordState=buildKeywordCatalog(products,[...(previous.sourceRanks||[]),...(collection.sourceRanks||[])],{now});
  const snapshot = { schemaVersion:1, publishedAt:new Date(now).toISOString(), periodStart:shiftMonth(today,-3), asOf:today,
    brands:POLICY.brands.filter(b => b.mandatory || b.policy === 'core' || b.policy === 'conditional' && activeBrands.has(b.name)),
    products:products.sort((a,b) => releaseSortKey(b).localeCompare(releaseSortKey(a)) || a.name.localeCompare(b.name)),
    ...keywordState,searchRankStatus:collection.searchRankStatus||previous.searchRankStatus||[],forecastStatus:collection.forecastStatus||previous.forecastStatus||[],editorialStatus:collection.editorialStatus||previous.editorialStatus||[],socialMetricStatus:collection.socialMetricStatus||previous.socialMetricStatus||socialSources.sources,sourceDirectory, sourceStatus:{ checkedAt:collection.checkedAt || previous.sourceStatus?.checkedAt || null,
      lastSuccessfulCollectionAt:collection.lastSuccessfulCollectionAt || previous.sourceStatus?.lastSuccessfulCollectionAt || null,
      unavailableBrands:collection.unavailableBrands || previous.sourceStatus?.unavailableBrands || [], coverage:collection.coverage || previous.sourceStatus?.coverage || [],
      notes:['출시일·품목·적합성을 확인한 상품만 표시합니다. 확인일을 출시일로 사용하지 않습니다.','SNS는 확인된 검색량·해시태그 게시물량을 지표와 기간별로 구분합니다. 미공개 수치는 0으로 대체하지 않습니다.'],
      counts:{ source:rawProducts.length, published:products.length, held:held.length, expired:expired.length } } };
  return { snapshot, queue:{schemaVersion:1,generatedAt:new Date(now).toISOString(),products:expired}, review:{schemaVersion:1,checkedAt:new Date(now).toISOString(),held} };
}
