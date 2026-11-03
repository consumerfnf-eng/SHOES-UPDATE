import {renderReferenceBoards,bindReferenceBoards,openBoardPicker} from './reference-boards.mjs';
import {renderBrandPrices,bindBrandPrices} from './brand-prices.mjs';
import {adoptPreparedVariantCaches} from './catalog-view.mjs';
import {prepareCatalog} from './catalog-runtime.mjs';
import {isAllowedFeedLook,runwayFirst} from './research-policy.mjs';
import {renderForecast,bindForecast} from './forecast.mjs';
import {renderResearchBrief,bindResearchBrief} from './research-brief.mjs';
import {renderWeeklyInsights} from './weekly-insights.mjs';
import { EXPORT_COLUMNS, exportRows, csvBytes, xlsxBytes, zipStored, catwalkFileName, catwalkManifestRows } from './export.mjs';
import {decodeCatalog} from './catalog-wire.mjs';
import {isExcludedBrand} from './brand-exclusions.mjs';
import { groupedBrands } from './brand-groups.mjs';
import { sortSeasons } from './catwalk-seasons.mjs';
import { analysisCsv, analysisRows, priceDistribution, materialDistribution, colourDistribution,
         priceKrw, priceBand, colourFamily, materialsOf, RATE_NOTE,categoryDistribution,useModelCategories} from './analysis.mjs';
import {isPublishedFootwear} from './footwear-policy.mjs';
import {preferOfficialVariants} from './product-identity.mjs';
import {variantChipLabel} from './catalog-view.mjs';
import {siteBrandGroup,isSiteBrandAllowed,canonicalSiteBrand} from './site-brand-policy.mjs';
import { hasVisual, productImageUrl, kstToday, releaseState, releaseDateLabel, safeUrl, filterProducts, keywordProductIds, sourceContext, trendKeywords, reviewedProductPageUrl, officialImageUrl, visibleSocialMetrics, sourceMatches, productBrandNames, socialComparisonGroups, groupProductVariants, preferWomenVariants, unifyVariantGroups, variantGroupKey, variantGroupName, variantColorLabel, uniqueColorVariants, colorSwatch, isOverlay, overlayKind, overlayReleaseState, overlayWindowDay, retailerId, trendTerms, trendTermGroups, trendKeywordMatches } from './catalog-view.mjs';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceNames = {magazine:'매거진',newsletter:'뉴스레터',media:'매거진·뉴스레터',sns:'SNS',ecommerce:'이커머스 랭킹',brand:'브랜드'};
const productTypeNames = {sneaker:'스니커즈',clog:'여름 클로그',sandal:'캐주얼 샌들','platform-sandal':'플랫폼 샌들','platform-shoe':'플랫폼 슈즈',jelly:'젤리 슈즈',hybrid:'혼합형 스니커즈'};
const mandatory = ['Louis Vuitton','Miu Miu','Prada','Gucci','Dior','Balenciaga','Celine','Saint Laurent','Hermès','Moncler','Bottega Veneta','Loewe','On','Cecilie Bahnsen','ASICS','FILA','Mizuno','New Balance','Salomon','adidas','Nike','PUMA','Axel Arigato','PANE','Onitsuka Tiger'];
const PAGE_SIZE = 40;
const state = {freshOnly:false,savedOnly:false,search:'',brands:new Set(),brandGroup:'all',category:'all',source:'all',catwalkShow:'all',catwalkCollection:'all',catwalkSeason:'',catwalkCity:'',catwalkFind:'',release:'released',sort:'group',socialGroup:'',retailer:'all',trendTerms:null,trendHashtag:'',page:1,keywordIds:null,keywordLabel:'',keywordId:''};
const RETAILER_TABS = [['all','전체'],['retail-29cm','29CM'],['retail-ssense','SSENSE'],['retail-musinsa','무신사'],['retail-wconcept','W컨셉'],['retail-lyst','Lyst'],['retail-farfetch','Farfetch'],['retail-mytheresa','Mytheresa'],['retail-netaporter','Net-a-Porter'],['retail-mrporter','MR PORTER'],['retail-kith','Kith']];
const OVERLAY_SOURCE_LABELS = {'retail-ssense':'SSENSE','retail-musinsa':'무신사','retail-29cm':'29CM','retail-wconcept':'W컨셉','retail-lyst':'Lyst','retail-farfetch':'Farfetch','retail-mytheresa':'Mytheresa','retail-netaporter':'Net-a-Porter','retail-mrporter':'MR PORTER','retail-kith':'Kith'};
let catalog = null, overlay = null, trends = null, rankBoards = null, catwalk = null, catwalkShown = 0, catwalkPicked = new Set(), catwalkAnchor = '', catwalkShowsOpen = false, products = [], filtered = [], visible = [], selected = new Set(), today = kstToday(), brandCounts = new Map(), toastTimer, activeDetailId, groupCount = 0;
const activeVariant = new Map();
let productGroups = new Map();
let filteredViewCache=null,savedRevision=0;
function groupKey(p){ return variantGroupKey(p); }
function colorGroupOf(p){
  const key=groupKey(p);
  const published=v=>isOverlay(v)?!!overlayReleaseState(v,today):releaseState(v,today)==='released';
  return (productGroups.get(key)||[]).filter(v=>published(v)&&sourceMatches(v,state.source,today));
}
function activeOf(group){
  const chosen = activeVariant.get(groupKey(group[0]));
  return group.find(p=>p.id===chosen) || group[0];
}
function colorChipsMarkup(group, activeId){
  const choices=uniqueColorVariants(group,activeId);
  if(choices.length===1&&!variantColorLabel(choices[0])&&!choices[0].colorSwatches?.length&&!choices[0].bodyColor)return '';
  const active=group.find(p=>p.id===activeId)||group[0];
  return `<div class="color-chips" role="group" aria-label="색상 선택">${choices.map(p=>{
    const swatch = colorSwatch(p);
    const label = variantChipLabel(p,choices) || `색상명 미확인 · ${p.style || p.id}`;
    return `<button type="button" class="color-chip ${p.id===activeId?'active':''}" data-variant="${esc(p.id)}" aria-pressed="${p.id===activeId}" aria-label="${esc(label)} 색상 선택" title="${esc(label)}"><span class="swatch-fill" style="background:${esc(swatch)}"></span></button>`;
  }).join('')}</div><p class="selected-color" aria-live="polite">${esc(variantChipLabel(active,choices)||'색상명 미확인')}</p>`;
}

function outboundUrl(p){ return isOverlay(p)?safeUrl(p.url):reviewedProductPageUrl(p,today); }
function overlayDateLabel(p){
  if(overlayKind(p)==='retail'){
    if(p.retailRestoration){const day=String(p.listedAt||p.firstDetectedAsNewAt||'').slice(0,10);return `${day?dateText(day)+' 목록 확인 · ':''}기존 리테일`;}
    return p.releaseEvidence?.date?`${dateText(p.releaseEvidence.date)} 최초 발매`:'';
  }
  const day=overlayWindowDay(p);
  if(!day)return '등록일 미확인';
  if(overlayKind(p)==='newsletter')return `${dateText(day)} 기사`;
  return `${dateText(day)} 등록`;
}
function sourceLabelOf(p){ return p.retailerLabel||OVERLAY_SOURCE_LABELS[p.source]||p.publisher||p.source||''; }
function dateText(value, time = false) {
  if (!value) return '미확인';
  if(/^\d{4}-\d{2}$/.test(value)){const [year,month]=value.split('-');return `${year}년 ${Number(month)}월 (일자 미공개)`;}
  const date = new Date(value.length === 10 ? value + 'T00:00:00+09:00' : value);
  if (!Number.isFinite(date.getTime())) return '미확인';
  return new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',...(time ? {hour:'2-digit',minute:'2-digit',hour12:false} : {})}).format(date);
}
function popup(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
// Saving a card's photograph.
//
// The picture on the card is a cached, web-sized copy; the brand's own CDN
// holds the full-resolution original and serves it with a permissive CORS
// header, so the page can fetch it, re-encode it once if it is not already a
// JPEG, and hand it over. Each candidate is tried in turn and the local copy
// is the last of them, so a save always produces a file.
const RESOLUTION_PARAMS=['width','wid','w','sw','height'];
function highestResolution(url){
  try{
    const u=new URL(url,location.href);
    // Kering's DAM names its renditions in the path; Original is the largest.
    u.pathname=u.pathname.replace(/\/(?:Thumbnail|Small|Medium|Large)\/(?=[^/]+$)/,'/Original/');
    // Shopify writes the rendition into the filename as _750x or _750x750.
    u.pathname=u.pathname.replace(/_\d{2,4}x(?:\d{2,4})?(?=\.(?:jpe?g|png|webp)$)/i,'');
    for(const name of RESOLUTION_PARAMS)if(u.searchParams.has(name))u.searchParams.set(name,'2048');
    return u.href===url?'':u.href;
  }catch{return '';}
}
async function asJpeg(blob){
  if(blob.type==='image/jpeg')return blob;
  const bitmap=await createImageBitmap(blob);
  const canvas=document.createElement('canvas');
  canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d');
  // JPEG has no transparency, and an unpainted canvas would come out black.
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(bitmap,0,0);bitmap.close?.();
  return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.95));
}
async function photoAsJpeg(product){
  const original=safeUrl(product.presentation?.image)||officialImageUrl(product,today)||safeUrl(product.image);
  const cached=product.presentation?.cachedPath;
  const candidates=[highestResolution(original),original,/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(cached||'')?cached:''].filter(Boolean);
  for(const candidate of candidates){
    try{
      const response=await fetch(candidate,{mode:'cors',referrerPolicy:'no-referrer'});
      if(!response.ok)continue;
      const blob=await response.blob();
      if(!blob.type.startsWith('image/')||!blob.size)continue;
      return await asJpeg(blob);
    }catch{}
  }
  return null;
}
const fileSafe=value=>String(value||'').replace(/[\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,70);
function photoFileName(product,taken){
  const parts=[product.brand,variantGroupName(product),variantColorLabel(product)||product.colorway,product.style].map(fileSafe).filter(Boolean);
  let name=parts.join('_')||product.id;
  if(taken.has(name)){let n=2;while(taken.has(`${name}_${n}`))n++;name=`${name}_${n}`;}
  taken.add(name);return `${name}.jpg`;
}
let saving=false;
async function downloadPhotos(list){
  if(saving)return;
  const items=list.filter(Boolean);
  if(!items.length){popup('사진을 저장할 상품을 먼저 선택해 주세요.');return;}
  saving=true;
  const bar=$('download-photos');if(bar)bar.disabled=true;
  const taken=new Set();let saved=0,failed=0;
  for(const [index,product] of items.entries()){
    if(items.length>1&&bar)bar.textContent=`사진 저장 중 ${index+1}/${items.length}`;
    const blob=await photoAsJpeg(product);
    if(!blob){failed++;continue;}
    const href=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=href;link.download=photoFileName(product,taken);
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(href),10000);
    saved++;
    // A browser drops downloads fired in the same tick as one another.
    if(index<items.length-1)await new Promise(resolve=>setTimeout(resolve,400));
  }
  if(bar){bar.disabled=false;bar.textContent='사진 JPG 저장 ↓';}
  saving=false;
  popup(failed?`사진 ${saved}장을 저장했습니다. ${failed}장은 원본을 받지 못했습니다.`:`사진 ${saved}장을 JPG로 저장했습니다.`);
}
function imageMarkup(p, eager = false, fullSize = false) {
  const thumbnail=fullSize?null:p.presentation?.thumbnail;
  const transform=`transform:translateY(${Math.max(-45,Math.min(45,Number(p.presentation?.offsetY)||0))}%) scale(${Math.min(2.7,Math.max(1,Number(p.presentation?.scale)||1))})`;
  if(/^\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(thumbnail?.path||''))return `<img class="card-thumbnail" style="${(p.presentation?.frame||thumbnail?.cropped)?'':transform}" src="${esc(thumbnail.path)}" width="${thumbnail.width}" height="${thumbnail.height}" alt="${esc(p.brand+' '+p.name)}" loading="${eager?'eager':'lazy'}" fetchpriority="${eager?'high':'auto'}" decoding="async">`;
  const cached=p.presentation?.cachedPath;
  const url = /^\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(cached||'')?cached:safeUrl(p.presentation?.image) || officialImageUrl(p,today) || safeUrl(p.image);
  const frame=p.presentation?.frame;
  if(url&&frame&&[frame.x,frame.y,frame.width,frame.height,frame.imageWidth,frame.imageHeight].every(Number.isFinite)&&frame.width>0&&frame.height>0){
    const w=frame.imageWidth,h=frame.imageHeight;
    return `<svg class="product-frame" viewBox="${frame.x*w} ${frame.y*h} ${frame.width*w} ${frame.height*h}" role="img" aria-label="${esc(p.brand+' '+p.name)}" preserveAspectRatio="xMidYMid meet"><image href="${esc(url)}" width="${w}" height="${h}"/></svg>`;
  }
  return url ? `<img style="transform:translateY(${Math.max(-45,Math.min(45,Number(p.presentation?.offsetY)||0))}%) scale(${Math.min(2.7,Math.max(1,Number(p.presentation?.scale)||1))})" src="${esc(url)}" alt="${esc(p.brand + ' ' + p.name)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">` : '<span class="image-missing">공식 이미지 확인 중</span>';
}
function bindImageErrors(container) { container.querySelectorAll('img').forEach(img => img.addEventListener('error', () => { const span = document.createElement('span'); span.className = 'image-missing'; span.textContent = '이미지를 표시할 수 없습니다'; img.replaceWith(span); }, {once:true})); }
function socialMetricsMarkup(product,compact=false) {
  const metrics=visibleSocialMetrics(product,today),names={'search-count':'검색량','hashtag-post-count':'해시태그 게시물','view-count':'조회수'},units={searches:'건',posts:'개',views:'회'},platforms={instagram:'Instagram',tiktok:'TikTok',youtube:'YouTube',xiaohongshu:'Xiaohongshu'};
  if(!metrics.length)return '<p class="social-metrics-empty">검색량·해시태그 게시물 수 미공개</p>';
  const present=new Set(metrics.map(m=>m.metric)),missing=[!present.has('search-count')?'검색량 미공개':'',!present.has('hashtag-post-count')?'해시태그 게시물 수 미공개':''].filter(Boolean);
  return `<div class="social-metrics ${compact?'compact':''}">${metrics.map(metric=>{
    const value=metric.value===null?'미공개':new Intl.NumberFormat('ko-KR').format(metric.value)+units[metric.unit];
    const period=metric.scope==='cumulative'?'누적':`${metric.periodStart} ~ ${metric.periodEnd}`;
    const comparison=metric.comparison,level=metric.identity?.level||'variant',rank=comparison?.verified===true&&comparison.identityLevel===level&&comparison.population==='items'&&['published-ranking','observed-sample'].includes(comparison.coverage)&&Number.isInteger(comparison.rank)&&comparison.rank>0&&Number.isInteger(comparison.itemCount)&&comparison.itemCount>=comparison.rank?`${comparison.coverage==='observed-sample'?'수집 '+(level==='model'?'모델':'상품')+' 내':'공개 '+(level==='model'?'모델':'상품')} ${comparison.rank}위 / ${comparison.itemCount}개`:'';
    return `<div class="social-metric"><p><span>${esc(platforms[metric.platform]||metric.platform)} · ${names[metric.metric]}</span><strong>${esc(value)}</strong></p><small>${esc(period)}${metric.country?' · '+esc(metric.country):''}${metric.identity?.level==='model'?' · 모델 기준':''}${rank?' · '+esc(rank):''}</small>${compact?'':`<small>검색어: ${esc(metric.query||'미공개')} · ${esc(dateText(metric.capturedAt,true))} 확인</small><a href="${esc(safeUrl(metric.sourceUrl))}" target="_blank" rel="noopener noreferrer">지표 원문 ↗</a>`}</div>`;
  }).join('')}${missing.length?`<p class="social-metrics-empty">${missing.map(esc).join(' · ')}</p>`:''}</div>`;
}

// A retailer listing or a press article arrives in its own shape; this is the
// one place it is translated into the shape every other part of this view
// already understands, so selection, export, the detail panel and the brand
// filter need no special cases. Nothing is invented: a field the source did
// not provide stays absent.
let keywordViews=new Map(),catalogWorker=null,workerReady=false;
function applyPrepared(prepared){
 ({products,brandCounts,productGroups,keywordViews}=prepared);
 adoptPreparedVariantCaches(productGroups,prepared.variantNames);
 const ids=new Set(products.map(p=>p.id));
 selected=new Set([...selected].filter(id=>ids.has(id)));
 if($('detail-dialog').open&&!ids.has(activeDetailId))$('detail-dialog').close();
}
function rebuildProducts(){
 if(workerReady){catalogWorker.postMessage({type:'refresh',today});return;}
 applyPrepared(prepareCatalog(catalog,overlay,trends,today));
}
// Additive snapshots, fetched after the first paint. A failure here leaves the
// official catalogue exactly as it rendered.
const supplementalRequests=new Map();
async function supplement(key,url,assign){
 if(supplementalRequests.has(key))return supplementalRequests.get(key);
 const job=fetch(url,{cache:'no-cache'}).then(async response=>{if(!response.ok)throw Error(response.status);assign(await response.json());if(['monthly','trends'].includes(key)){rebuildProducts();renderBrands();renderKeywords();}render();}).catch(()=>{supplementalRequests.delete(key);});
 supplementalRequests.set(key,job);return job;
}
function loadSupplements(){
 void supplement('monthly','./data/monthly-catalog.json',s=>{if(s.schemaVersion===2&&Array.isArray(s.retail))overlay=s;});
 void supplement('trends','./data/trend-keywords.json',s=>{if(s.schemaVersion===1&&Array.isArray(s.keywords))trends=s;});
 void ensureSourceData();
}
async function ensureSourceData(){
 if(state.source==='catwalk')return supplement('catwalk','./data/catwalk.json',s=>{if([1,2].includes(s.schemaVersion)&&Array.isArray(s.looks))catwalk=s;});
 if(state.source==='analysis')return supplement('ranks','./data/rank-boards.json',s=>{if(s.schemaVersion===1&&Array.isArray(s.boards))rankBoards=s;});
}
async function loadCatalog() {
  $('product-grid').setAttribute('aria-busy','true'); $('product-grid').innerHTML = Array.from({length:8}, () => '<div class="skeleton" aria-hidden="true"></div>').join('');
  $('empty-state').hidden = true;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  // The model dictionary is a convenience, not a requirement: if it does not
  // load, the category panel simply places fewer records and says so.
  // Started, not awaited: a 0.2MB dictionary that only annotates categories
  // was holding the 4.8MB catalogue - and the first card on screen - behind it.
  const dictionary = fetch('./data/model-categories.json',{cache:'no-cache'})
    .then(r=>r.ok?r.json():null).catch(()=>null);
  try {
    let response = await fetch('./data/catalog-index.json', {signal:controller.signal,cache:'no-cache'});
    if(response.status===404)response=await fetch('./data/catalog-ui.json',{signal:controller.signal,cache:'no-cache'});
    if(response.status===404)response=await fetch('./data/catalog.json',{signal:controller.signal,cache:'no-cache'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    const manifest=payload.schemaVersion===1&&Array.isArray(payload.chunks)&&payload.base?payload:null;
    const value=decodeCatalog(manifest?manifest.base:payload);
    if(manifest?.chunks.length){const first=await fetch(manifest.chunks[0].url,{signal:controller.signal});if(!first.ok)throw Error(first.status);value.products=decodeCatalog(await first.json()).products;}
    if (value.schemaVersion !== 1 || !Array.isArray(value.products) || !Array.isArray(value.brands) || !Array.isArray(value.keywords)) throw new Error('Invalid snapshot');
    catalog = value;
    // The grid's LUX-first ordering needs each brand's policy group, and the
    // grid only ever sees a product's brand name. Carry the lookup on state so
    // a luxury house nobody named in the LUX list still sorts with LUX.
    state.brandGroups = new Map(value.brands.map(b => [b.name, b.group]));
    // Category annotations are optional and must not delay the first cards.
    // This view is the sneaker reference set. Other footwear records remain in
    // the internal snapshot/archive but never enter the public product grid.
    rebuildProducts();
    const collection = [value.sourceStatus?.lastSuccessfulCollectionAt,value.sourceStatus?.lastVerifiedAdditionAt].filter(x=>Number.isFinite(Date.parse(x))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
    $('update-label').textContent = collection ? `${dateText(collection, true)} 상품 정보 확인` : value.publishedAt ? `${dateText(value.publishedAt, true)} 게시` : '첫 검증 완료본 게시 대기';
    const notice = [];
    if(!products.length)notice.push('확인된 스니커즈 정보를 준비하고 있습니다.');
    $('catalog-notice').textContent = notice.join(' '); $('catalog-notice').className = 'notice'; $('catalog-notice').hidden = !notice.length;
    renderBrands(); renderKeywords(); render();
    if(manifest)startCatalogWorker(manifest);
    void dictionary.then(value=>{if(value?.entries){useModelCategories(value.entries,p=>`${p.brand}|${variantGroupKey(p)}`);categoryRevision++;if(state.source==='analysis')render();}});
    // The retail overlay and the trend board are 4 MB between them, more than
    // the catalogue itself, and both add to this view rather than define it.
    // Waiting for them before the first paint spent four seconds showing a
    // skeleton for content most readers never scroll to, so they now arrive
    // after it and the view is rebuilt when they do.
    if(!manifest)loadSupplements();else void ensureSourceData();
  } catch (error) {
    $('product-grid').innerHTML = ''; $('result-count').textContent = '—'; $('empty-state').hidden = false;
    $('empty-title').textContent = '게시된 정보를 불러오지 못했습니다';
    $('empty-description').textContent = '연결 상태를 확인하고 다시 시도해 주세요. 수집 중인 상품은 표시하지 않습니다.';
    $('empty-reset').textContent = '다시 불러오기'; $('empty-reset').dataset.retry = 'true';
    $('update-label').textContent = '게시 정보 확인 불가';
  } finally { clearTimeout(timeout); $('product-grid').setAttribute('aria-busy','false'); }
}

function startCatalogWorker(manifest){
 try{
  catalogWorker=new Worker(new URL('./catalog-worker.mjs',import.meta.url),{type:'module'});
  let finished=false;
  catalogWorker.onmessage=event=>{
   const message=event.data;
   if(message.type==='progress'){$('catalog-notice').hidden=false;$('catalog-notice').textContent=`공식 상품 ${message.count.toLocaleString()} / ${manifest.total.toLocaleString()}건 불러오는 중`;return;}
   if(message.type==='ready'){
    finished=true;workerReady=true;trends=message.trends;
    applyPrepared(message.prepared);
    if(state.keywordId)state.keywordIds=keywordViews.get(state.keywordId)?.ids||new Set();
    renderBrands();renderKeywords();render();
    $('catalog-notice').hidden=!message.failed;$('catalog-notice').textContent=message.failed?'일부 자료를 불러오지 못했습니다. 새로고침하면 다시 시도합니다.':'';
   }
   if(message.type==='error'&&!finished){catalogWorker.terminate();catalogWorker=null;void loadRemainingBrands(manifest);loadSupplements();}
  };
  catalogWorker.onerror=()=>{if(!finished){catalogWorker.terminate();catalogWorker=null;void loadRemainingBrands(manifest);loadSupplements();}};
  catalogWorker.postMessage({type:'load',catalog,manifest,today});
 }catch{void loadRemainingBrands(manifest);loadSupplements();}
}
async function loadRemainingBrands(manifest){
 const chunks=manifest.chunks.slice(1);let failed=false;
 for(let at=0;at<chunks.length;at+=6){
  const batch=await Promise.allSettled(chunks.slice(at,at+6).map(async chunk=>{const r=await fetch(chunk.url,{cache:'force-cache'});if(!r.ok)throw Error(r.status);const rows=decodeCatalog(await r.json()).products;if(rows.length!==chunk.count)throw Error('Incomplete brand chunk');return rows;}));
  for(const result of batch){if(result.status==='fulfilled')catalog.products.push(...result.value);else failed=true;}
  $('catalog-notice').hidden=false;$('catalog-notice').textContent=`공식 상품 ${catalog.products.length.toLocaleString()} / ${manifest.total.toLocaleString()}건 불러오는 중`;
 }
 rebuildProducts();renderBrands();renderKeywords();render();
 $('catalog-notice').hidden=!failed;$('catalog-notice').textContent=failed?'일부 브랜드 자료를 불러오지 못했습니다. 새로고침하면 다시 시도합니다.':'';
}
function renderBrands() {
  let scopeCounts=brandCounts;
  if(!['all','analysis','catwalk','forecast','brief','boards'].includes(state.source)){
    scopeCounts=new Map();
    for(const group of productGroups.values()){const matching=group.filter(p=>sourceMatches(p,state.source,today));for(const brand of new Set(matching.flatMap(p=>productBrandNames(p,today))))scopeCounts.set(brand,(scopeCounts.get(brand)||0)+1);}
  }
  const byName=new Map((catalog?.brands||[]).map(b=>[b.name,b]));
  for(const name of scopeCounts.keys())if(!byName.has(name))byName.set(name,{name,group:state.brandGroups.get(name)||''});
  const search=$('brand-search').value.toLocaleLowerCase();
  const groups=groupedBrands([...byName.values()].filter(b=>!isExcludedBrand(b.name)&&isSiteBrandAllowed(b.name)&&(state.brandGroup==='all'||siteBrandGroup(b.name)===state.brandGroup)&&(scopeCounts.get(b.name)||0)>0&&b.name.toLocaleLowerCase().includes(search)));
  $('brand-list').innerHTML=groups.filter(g=>g.brands.length).map(group=>`<section class="brand-group" aria-label="${group.name}"><h3 class="brand-group-label">${group.name}</h3>${group.brands.map(b=>`<label class="brand-option"><input type="checkbox" data-brand="${esc(b.name)}" ${state.brands.has(b.name)?'checked':''}><span class="brand-name">${esc(b.name)}</span><span class="brand-count">${scopeCounts.get(b.name)}</span></label>`).join('')}</section>`).join('')||'<p class="muted">일치하는 브랜드가 없습니다.</p>';
  $('brand-list').querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{input.checked?state.brands.add(input.dataset.brand):state.brands.delete(input.dataset.brand);state.page=1;render();}));
}
function renderBrandGroupTabs(){
 const bar=$('brand-group-tabs');if(!bar)return;bar.hidden=['catwalk','forecast','brief','boards'].includes(state.source);
 bar.querySelectorAll('[data-brand-group]').forEach(button=>{const chosen=button.dataset.brandGroup===state.brandGroup;button.classList.toggle('active',chosen);button.setAttribute('aria-pressed',String(chosen));button.disabled=state.source==='brand'&&button.dataset.brandGroup!=='LUX';});
}
const ECOMMERCE_PLATFORMS=new Set(['musinsa','29cm','eql','wconcept']);
function renderKeywords() {
  const snapshot=catalog?.styleTrendKeywords;
  const keywords=(snapshot?.items||trendKeywords(catalog?.keywords||[])).slice(0,15);
  function renderList(target,list) {
    $(target).innerHTML=list.length?list.map((k,i)=>{
      const cached=keywordViews.get(k.id),ids=cached?.ids||keywordProductIds(k,products,today),matched=cached?.count??new Set(products.filter(p=>ids.has(p.id)).map(groupKey)).size;
      return `<article class="keyword search-keyword trend-row ${state.keywordId===k.id?'active':''}"><button class="keyword-select" data-keyword="${i}" aria-pressed="${state.keywordId===k.id}" aria-label="${esc(k.label)} ${esc(k.englishLabel||'')} 관련 상품 ${matched}개"><span class="rank" aria-label="종합순 ${i+1}">${String(i+1).padStart(2,'0')}</span><span class="keyword-copy"><span class="keyword-name">#${esc(k.label)}</span><span class="keyword-evidence">${esc(k.englishLabel||'')}</span></span><span class="count"><strong>${matched}</strong><span>상품</span></span></button></article>`;
    }).join(''):'<p class="keyword-empty">확인된 Shoes Trend Keyword가 아직 없습니다.</p>';
    $(target).querySelectorAll('.keyword-select').forEach(button=>button.addEventListener('click',()=>{
      const k=list[Number(button.dataset.keyword)];clearTimeout(searchTimer);
      Object.assign(state,{search:'',brands:new Set(),brandGroup:'all',category:'all',source:'all',catwalkShow:'all',catwalkCollection:'all',catwalkSeason:'',catwalkCity:'',catwalkFind:'',release:'released',socialGroup:'',sort:'newest',retailer:'all',trendTerms:null,trendHashtag:'',page:1,keywordId:k.id,keywordLabel:k.label,keywordIds:keywordViews.get(k.id)?.ids||keywordProductIds(k,products,today)});
      syncFilterControls();renderBrands();renderKeywords();render();$('results').scrollIntoView({block:'start'});$('results').focus({preventScroll:true});
    }));
  }
  renderList('keyword-list',keywords);
  if($('keyword-total'))$('keyword-total').textContent=`${keywords.length} KEYWORDS`;
  const status=$('style-status');
  if(status)status.textContent=snapshot?.updated?`${dateText(snapshot.updated,true)} 키워드 확인 · 매주 일요일 오전 8시 업데이트 예약`:'';
}
function renderSocialGroups(){
  const groups=state.source==='sns'?socialComparisonGroups(products,today):[];
  if(state.socialGroup&&!groups.some(g=>g.key===state.socialGroup)){state.socialGroup='';if(state.sort==='social')state.sort='newest';}
  $('social-group-label').hidden=state.source!=='sns'||!groups.length;
  const names={instagram:'Instagram',tiktok:'TikTok',youtube:'YouTube',xiaohongshu:'Xiaohongshu'};
  $('social-group').innerHTML='<option value="">전체 지표 · 출시순</option>'+groups.map(g=>`<option value="${esc(g.key)}">${esc(names[g.platform]||g.platform)} · ${g.metric==='search-count'?'검색량':'해시태그 게시물'} · ${g.scope==='cumulative'?'누적':esc(g.periodStart+' ~ '+g.periodEnd)}${g.country?' · '+esc(g.country):''} · ${g.matchedItemCount}개 ${g.identity?.level==='model'?'모델':'품번'}</option>`).join('');
  $('social-group').value=state.socialGroup;
  const available=state.source==='sns'&&!!state.socialGroup;$('social-sort-option').hidden=!available;$('social-sort-option').disabled=!available;$('sort').value=state.sort;
}

// --- saved items -----------------------------------------------------------
// A bookmark and a note, kept in this browser. Nothing is sent anywhere: it is
// one person's working shortlist, not shared state, and it survives a reload
// so a week's reading is not lost on refresh.
const SAVED_KEY = 'shoes-research:saved:v1';
let saved = {};
function loadSaved(){
  try{ saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') || {}; }
  catch{ saved = {}; }                       // private window, blocked storage
}
function persistSaved(){
  savedRevision++;
  try{ localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); }catch{ /* read-only is fine */ }
  const n=Object.keys(saved).length;
  const label=$('saved-count'); if(label)label.textContent=n?`(${n})`:'';
}
function isSaved(p){ return !!saved[p?.id]; }
function toggleSaved(id,name){
  if(saved[id])delete saved[id]; else saved[id]={at:new Date().toISOString(),name:name||'',memo:''};
  persistSaved();
  popup(saved[id]?'저장함에 담았습니다':'저장함에서 뺐습니다');
  render();
}
function setMemo(id,memo){ if(saved[id]){saved[id].memo=memo;persistSaved();} }

// --- what is new this week -------------------------------------------------
// The date a record states for itself: when a retailer listed it, when an
// article ran, or when we first published an official arrival.
function recordDay(p){
  return String(p?.listedAt || p?.publishedAt || p?.firstPublishedAt || '').slice(0,10);
}
function isFresh(p, asOf = today){
  const day = recordDay(p);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
  return (Date.parse(asOf) - Date.parse(day)) / 86400000 <= 7;
}

// --- downloads --------------------------------------------------------------
function downloadBlob(name, parts, type, revokeAfter=1000){
  const url=URL.createObjectURL(new Blob(parts,{type}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);
  a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),revokeAfter);
}
function downloadText(name, text, type='text/csv;charset=utf-8'){ downloadBlob(name,[text],type); }
const scopeState=()=>({...state,isFresh,isSaved,
  source:state.source==='analysis'?'all':state.source});
const analysisScope=()=>filterProducts(products,scopeState(),today);

// --- the analysis tab -------------------------------------------------------
const bar=(label,count,total,swatch)=>{
  const pct=total?Math.round(count/total*1000)/10:0;
  return `<div class="dist-row"><span class="dist-label">${swatch?`<i class="dist-swatch" style="background:${esc(swatch)}"></i>`:''}${esc(label)}</span>`
    +`<span class="dist-track"><span class="dist-fill" style="width:${Math.max(1.5,pct)}%"></span></span>`
    +`<span class="dist-value">${count.toLocaleString()}<small>${pct.toFixed(1)}%</small></span></div>`;
};
// Two boards read from the shops themselves: what Musinsa's own sales ranking
// says is selling, and what SSENSE puts first when its sneakers page is left
// in the order it arrives in - which the site labels TRENDING.
//
// A rank on its own says little; what moved is the point. Each reading is
// compared with the one before it, so a card can say it climbed four places,
// arrived this week, or slipped two - and the board says which shoes dropped
// out of it entirely.
const MOVEMENT={
  up:{mark:'▲',label:'상승'},
  down:{mark:'▼',label:'하락'},
  new:{mark:'NEW',label:'신규 진입'},
  same:{mark:'–',label:'변동 없음'},
  first:{mark:'·',label:'첫 집계'},
};
function movementMarkup(item){
  const move=MOVEMENT[item.movement]||MOVEMENT.first;
  const amount=item.movement==='up'||item.movement==='down'?String(item.change||0):'';
  const title=item.previousRank?`지난 집계 ${item.previousRank}위`:move.label;
  return `<span class="rank-move ${esc(item.movement||'first')}" title="${esc(title)}">${esc(move.mark)}${amount?' '+esc(amount):''}</span>`;
}
let renderedRankBoards=null,renderedAnalysis=null,categoryRevision=0;
function renderRankBoards(){
  const host=$('rank-boards');
  if(!host)return;
  const boards=(rankBoards?.boards||[]).filter(board=>board.items?.length);
  host.hidden=!boards.length;
  if(!boards.length)return;
  if(renderedRankBoards===rankBoards)return;
  renderedRankBoards=rankBoards;
  host.innerHTML=boards.map(board=>{
    const moved=board.items.filter(i=>i.movement==='up'||i.movement==='down').length;
    const fresh=board.items.filter(i=>i.movement==='new').length;
    const is29cm=board.id==='29cm-sneakers-best';
    const concise=is29cm||board.id==='ssense-sneakers-trending';
    const basis=is29cm?String(board.basis||'').replace(/\s*·\s*원문 URL[\s\S]*$/,''):board.basis;
    const summary=board.comparedWith
      ? `${dateText(board.comparedWith)} 집계 대비 · 신규 ${fresh}개 · 순위 변동 ${moved}개${board.departed?.length?` · 이탈 ${board.departed.length}개`:''}`
      : is29cm?'':'첫 집계입니다. 다음 주부터 순위 변동을 표시합니다.';
    return `<article class="rank-board">
      <header class="rank-board-head">
        <div><h3>${esc(board.label)} <span class="rank-size">원문 1–${board.items.length}위 · 브랜드 필터와 별도</span></h3>
        <p class="muted">${esc(basis)}${concise?'':` · ${esc(dateText(board.checkedAt,true))} 확인${board.staleSince?' · 이번 회차 수집 실패, 직전 집계를 표시합니다':''}`}</p>
        ${summary?`<p class="muted">${esc(summary)}</p>`:''}</div>
        <a class="text-button" href="${esc(safeUrl(board.sourceUrl))}" target="_blank" rel="noopener noreferrer">원본 랭킹 ↗</a>
      </header>
      <ol class="rank-list">${board.items.map(item=>`<li class="rank-item">
        <a class="rank-photo" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${
          (item.thumbnail||safeUrl(item.image))?`<img width="320" height="240" src="${esc(item.thumbnail||item.image)}" alt="${esc(item.brand+' '+item.name)}" loading="${item.rank<=3?'eager':'lazy'}" fetchpriority="${item.rank<=3?'high':'auto'}" decoding="async" referrerpolicy="no-referrer">`:'<span class="image-missing">사진 없음</span>'}
          <span class="rank-number">${item.rank}</span>${movementMarkup(item)}</a>
        <span class="rank-copy"><span class="rank-brand">${esc(item.brand||'브랜드 미표기')}</span>
          <a class="rank-name" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${esc(item.name)}</a>
          <span class="rank-price">${esc(item.priceLabel||'가격 미표기')}${item.discountRatio?` <small>${item.discountRatio}%</small>`:''}${item.soldOut?' <small>품절</small>':''}</span></span>
      </li>`).join('')}</ol>
      ${board.departed?.length?`<p class="rank-departed">이번 집계에서 빠짐: ${board.departed.map(d=>`${d.rank}위 ${esc(d.name||d.key)}`).join(' · ')}</p>`:''}
    </article>`;
  }).join('');
  bindImageErrors(host);
}
// The catwalk tab. One card per photograph, captioned the way WGSN captions
// it: the brand, the season, the city. A look is not a product - no price, no
// colourway, nothing to compare - so it gets its own grid rather than being
// forced through the product card. What it does share with a product is being
// worth taking away in bulk: tick the looks you want and they come down as
// one archive, each file named for the show it walked in.
// The whole season at once. 247 cards of about 180KB is a page the browser
// handles comfortably with lazy loading, and paging them split the viewer's
// own range - it walked 1/120 of a 247-look season.
const CATWALK_PAGE = 400;
// The seasons the snapshot holds, newest first. A v2 snapshot lists them
// itself; a v1 one held a single season, named on the file or on its looks, so
// the list is derived rather than demanded - the page keeps working against a
// snapshot built before seasons were kept side by side.
function catwalkSeasons(){
  const listed=(catwalk?.seasons||[]).filter(s=>s&&s.season);
  if(listed.length)return listed.map(s=>({season:s.season,looks:s.looks??0,shows:s.shows??0}));
  const all=catwalk?.looks||[];
  const of=look=>look.season||catwalk?.season||'';
  return sortSeasons([...all.map(of),catwalk?.season]).map(season=>({
    season,looks:all.filter(l=>of(l)===season).length,
    shows:new Set(all.filter(l=>of(l)===season).map(l=>l.brand)).size}));
}
// The current season until somebody picks another, and never a season the
// snapshot no longer carries - the oldest falls off every third collection.
function activeSeason(){
  const seasons=catwalkSeasons();
  return seasons.find(s=>s.season===state.catwalkSeason)?.season||seasons[0]?.season||'';
}
function seasonLooks(){
  const all=(catwalk?.looks||[]).filter(l=>isAllowedFeedLook(l,catwalk?.publicationPolicy?.excludedFeedHashtags,catwalk?.publicationPolicy?.excludedCatwalkHashtags)).filter(l=>state.catwalkCollection==='all'||(l.collection||'runway')===state.catwalkCollection), season=activeSeason();
  if(!season)return all;
  return runwayFirst(all.filter(l=>(l.season||catwalk?.season||'')===season));
}
// A season's four fashion weeks are the axis this board is read along - Paris
// against New York - so the city narrows before the show does, and the show
// chips below it count only what the chosen city actually holds.
function cityLooks(){
  const looks=seasonLooks();
  return state.catwalkCity?looks.filter(l=>(l.city||'')===state.catwalkCity):looks;
}
const findText=()=>state.catwalkFind.trim().toLocaleLowerCase();
function catwalkLooks(){
  const looks=cityLooks();
  // Typing narrows the grid as well as the chips: 70 shows is too many to find
  // one by eye, and a search that only hid chips would leave the photographs
  // below it unchanged, which reads as the search having done nothing.
  const find=findText();
  if(find&&(!state.catwalkShow||state.catwalkShow==='all'))
    return looks.filter(l=>`${l.brand} ${l.city||''} ${(l.hashtags||[]).join(' ')}`.toLocaleLowerCase().includes(find));
  if(state.catwalkShow==='footwear'){
    const shelf=(catwalk.shelves||[]).find(s=>s.footwearShelf)?.id;
    return looks.filter(l=>l.shelf===shelf);
  }
  if(state.catwalkShow&&state.catwalkShow!=='all')return looks.filter(l=>l.brand===state.catwalkShow);
  return looks;
}
const CHIPS_COLLAPSED = 12;
const shelfUrl=id=>(catwalk?.shelves||[]).find(s=>s.id===id)?.searchUrl||'';
// The cities of one season, in the order the week actually ran them.
function renderCatwalkCities(){
  const host=$('catwalk-cities');
  if(!host)return;
  const within=seasonLooks();
  const order=['New York','London','Milan','Paris'];
  const cities=[...new Set(within.map(l=>l.city).filter(Boolean))]
    .sort((a,b)=>(order.indexOf(a)+1||99)-(order.indexOf(b)+1||99)||a.localeCompare(b));
  host.hidden=cities.length<2;
  if(host.hidden){host.innerHTML='';return;}
  const chip=(id,label,count)=>`<button class="catwalk-chip${state.catwalkCity===id?' active':''}" data-catwalk-city="${esc(id)}" aria-pressed="${state.catwalkCity===id}">${esc(label)} <span>${count.toLocaleString()}</span></button>`;
  host.innerHTML=chip('','전체 도시',within.length)
    +cities.map(c=>chip(c,c,within.filter(l=>l.city===c).length)).join('');
}
function renderCatwalkFilters(looks){
  const host=$('catwalk-filters');
  if(!host)return;
  const within=cityLooks();
  const find=findText();
  // Busiest show first. Alphabetical order put the twelve visible chips in the
  // A's; what a viewer wants to see without expanding is where the season's
  // footwear actually is.
  const brands=[...new Set(within.map(l=>l.brand))]
    .map(name=>({name,count:within.filter(l=>l.brand===name).length}))
    .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name))
    .filter(b=>!find||b.name.toLocaleLowerCase().includes(find));
  const footwear=(catwalk?.shelves||[]).find(s=>s.footwearShelf);
  const chip=(id,label,count)=>`<button class="catwalk-chip${state.catwalkShow===id?' active':''}" data-catwalk="${esc(id)}" aria-pressed="${state.catwalkShow===id}">${esc(label)}${count!=null?` <span>${count.toLocaleString()}</span>`:''}</button>`;
  const shelfId=footwear?.id;
  // The shelf chip earns its place only when there is another shelf to filter
  // against: the library search returns footwear and nothing else.
  const several=(catwalk?.shelves||[]).length>1;
  // Seventy chips pushed the first photograph 2,000px down a phone. A dozen
  // are shown; the rest are a button away, and the search finds any of them.
  const shown=catwalkShowsOpen?brands:brands.slice(0,CHIPS_COLLAPSED);
  const hidden=brands.length-shown.length;
  host.innerHTML=chip('all','전체',within.length)
    +(footwear&&several?chip('footwear',footwear.label.replace(/\s*\(.*$/,''),within.filter(l=>l.shelf===shelfId).length):'')
    +shown.map(b=>chip(b.name,b.name,b.count)).join('')
    +(hidden>0?`<button class="catwalk-chip catwalk-chip-more" data-catwalk-more="open">+${hidden.toLocaleString()}개 쇼 더보기</button>`:'')
    +(catwalkShowsOpen&&brands.length>CHIPS_COLLAPSED?'<button class="catwalk-chip catwalk-chip-more" data-catwalk-more="close">접기</button>':'')
    +(find&&!brands.length?'<span class="muted">일치하는 쇼가 없습니다.</span>':'');
  const box=$('catwalk-find');
  if(box&&box.value!==state.catwalkFind)box.value=state.catwalkFind;
}
// Past seasons stay on the site, each behind its own tab, until the third
// collection after them pushes one off. The row hides itself while there is
// only one season to be in, so nothing is offered that cannot be chosen.
function renderCatwalkSeasonTabs(){
  const host=$('catwalk-seasons');
  if(!host)return;
  const seasons=catwalkSeasons(), current=activeSeason();
  host.hidden=seasons.length<2;
  if(host.hidden){host.innerHTML='';return;}
  host.innerHTML=seasons.map((s,i)=>`<button class="catwalk-season-tab${s.season===current?' active':''}" data-catwalk-season="${esc(s.season)}" aria-pressed="${s.season===current}">${esc(s.season)}${i===0?'<em>최신</em>':''} <span>${(s.looks||0).toLocaleString()}</span></button>`).join('');
}
function renderCatwalk(){
  const section=$('catwalk');
  if(!section||!catwalk)return;
  const looks=catwalkLooks();
  const collections=[['all','전체'],['runway','런웨이'],['fashion-feed','Fashion Feed']];
  $('catwalk-collections').innerHTML=collections.map(([key,label])=>`<button class="secondary-button ${state.catwalkCollection===key?'active':''}" data-collection="${key}" aria-pressed="${state.catwalkCollection===key}">${label} (${(catwalk?.looks||[]).filter(l=>key==='all'||(l.collection||'runway')===key).length})</button>`).join('');
  $('catwalk-collections').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.catwalkCollection=b.dataset.collection;state.catwalkShow='all';state.catwalkCity='';state.catwalkFind='';$('catwalk-find').value='';renderCatwalk();});
  const shown=Math.min(catwalkShown||CATWALK_PAGE,looks.length);
  const cities=[...new Set(looks.map(l=>l.city).filter(Boolean))];
  $('catwalk-scope').textContent=`${activeSeason()||catwalk.season||''} · ${new Set(looks.map(l=>l.brand)).size}${state.catwalkCollection==='runway'?'개 쇼':'개 브랜드·출처'} · ${looks.length.toLocaleString()}장`
    +(cities.length?` · ${cities.sort().join(' · ')}`:'')
    +(state.catwalkCity||findText()?' · 필터 적용 중':'');
  $('catwalk-note').textContent='신발만 클로즈업된 컷입니다. 카드를 누르면 크게 보고 고화질로 저장할 수 있습니다. '
    +'WGSN 구독 자료이므로 내부 참고용으로만 사용하세요.';
  if(state.catwalkCollection!=='runway')$('catwalk-note').textContent='런웨이와 Fashion Feed를 구분해 볼 수 있습니다. Fashion Feed 설명은 원문의 해시태그만 표시합니다.';
  renderCatwalkSeasonTabs();
  renderCatwalkCities();
  renderCatwalkFilters(looks);
  $('catwalk-grid').innerHTML=looks.slice(0,shown).map((look,i)=>`<article class="catwalk-card${catwalkPicked.has(look.id)?' picked':''}">
      <label class="catwalk-check"><input type="checkbox" data-look-select="${esc(look.id)}"
        ${catwalkPicked.has(look.id)?'checked':''}
        aria-label="${esc(look.brand)} ${esc(look.season)} 선택"></label>
      <button class="catwalk-photo" data-look="${esc(look.id)}"
         aria-label="${esc(look.brand)} ${esc(look.season)} 크게 보기">
        <img src="${esc(look.thumbnail||look.image)}" alt="${esc(look.brand+' '+look.season+(look.city?' '+look.city:''))}"
             width="${look.width}" height="${look.height}"
             loading="${i<12?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer">
      </button>
      <div class="catwalk-copy">
        ${look.collection==='fashion-feed'?`<p class="catwalk-hashtags">${(look.hashtags||[]).map(esc).join(' ')}</p>`:`<p class="catwalk-brand">${esc(look.brand)}</p>`}
        ${look.collection==='fashion-feed'?'':`<p class="catwalk-season">${esc(look.season)}</p>`}
        ${look.city&&look.collection!=='fashion-feed'?`<p class="catwalk-city">${esc(look.city)}</p>`:''}
        <button class="rb-add-source" data-board-show="${esc(look.id)}">보드에 담기 ＋</button>
      </div>
    </article>`).join('');
  const more=$('catwalk-more');
  more.hidden=shown>=looks.length;
  more.innerHTML=more.hidden?'':`<button class="secondary-button" id="catwalk-more-button">${(looks.length-shown).toLocaleString()}장 더 보기</button>`;
  bindImageErrors($('catwalk-grid'));
  renderCatwalkPicks();
}
// --- picking looks to take away ---------------------------------------------
// The looks on screen, in the order they are on screen: that is what "select
// all" means and what a Shift-click spans. A filter chip or an unexpanded
// page narrows it, so a tick never reaches a card the viewer cannot see.
function catwalkOnScreen(){
  const looks=catwalkLooks();
  return looks.slice(0,Math.min(catwalkShown||CATWALK_PAGE,looks.length));
}
function pickCatwalk(id,checked,extend){
  const looks=catwalkOnScreen();
  // Shift-click fills in from the last card touched, the way a file list does:
  // picking forty out of 247 runway shots one tick at a time is not a feature.
  const from=extend?looks.findIndex(l=>l.id===catwalkAnchor):-1, to=looks.findIndex(l=>l.id===id);
  if(from>=0&&to>=0)for(const look of looks.slice(Math.min(from,to),Math.max(from,to)+1))
    checked?catwalkPicked.add(look.id):catwalkPicked.delete(look.id);
  checked?catwalkPicked.add(id):catwalkPicked.delete(id);
  catwalkAnchor=id;
  renderCatwalkPicks();
}
function renderCatwalkPicks(){
  if(!$('catwalk-grid'))return;
  const looks=catwalkOnScreen(), count=catwalkPicked.size;
  const bar=$('catwalk-selection-bar');
  if(bar)bar.hidden=state.source!=='catwalk'||!count;
  const label=$('catwalk-selection-count');
  if(label)label.textContent=`${count.toLocaleString()}장 선택`;
  const all=$('catwalk-select-all');
  if(all){
    all.disabled=!looks.length;
    all.checked=!!looks.length&&looks.every(l=>catwalkPicked.has(l.id));
    all.indeterminate=!all.checked&&looks.some(l=>catwalkPicked.has(l.id));
  }
  const hint=$('catwalk-picked-hint');
  if(hint)hint.textContent=count
    ?`${count.toLocaleString()}장 선택 · Shift를 누른 채 클릭하면 사이 구간이 한 번에 선택됩니다.`
    :'사진을 골라 한 번에 내려받을 수 있습니다. Shift를 누른 채 클릭하면 사이 구간이 모두 선택됩니다.';
  for(const input of $('catwalk-grid').querySelectorAll('[data-look-select]')){
    input.checked=catwalkPicked.has(input.dataset.lookSelect);
    input.closest('.catwalk-card')?.classList.toggle('picked',input.checked);
  }
}
// The renditions are this site's own files, so they come back byte for byte -
// no canvas, no re-encode, nothing that would cost the picture the quality it
// is being downloaded for.
async function lookBytes(look){
  try{
    const response=await fetch(look.image,{cache:'force-cache'});
    if(!response.ok)return null;
    const buffer=await response.arrayBuffer();
    return buffer.byteLength?new Uint8Array(buffer):null;
  }catch{return null;}
}
// Several looks leave as one archive rather than as several downloads: a
// browser throttles - and then asks about - a run of separate saves, and a
// folder of loose files loses the show each photograph came from. The archive
// carries 목록.csv so the captions travel with the pictures.
async function downloadCatwalkPicks(){
  if(saving)return;
  const picked=(catwalk?.looks||[]).filter(l=>catwalkPicked.has(l.id));
  if(!picked.length){popup('저장할 사진을 먼저 선택해 주세요.');return;}
  saving=true;
  const button=$('catwalk-download'), label=button?.innerHTML;
  if(button)button.disabled=true;
  const taken=new Set(), files={}, entries=[];
  let failed=0;
  try{
    for(const [index,look] of picked.entries()){
      if(button)button.textContent=`사진 모으는 중 ${index+1}/${picked.length}`;
      const bytes=await lookBytes(look);
      if(!bytes){failed++;continue;}
      const name=catwalkFileName(look,taken);
      files[name]=bytes;entries.push({name,look});
    }
    if(!entries.length){popup('사진을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');return;}
    if(entries.length===1){
      downloadBlob(entries[0].name,[files[entries[0].name]],'image/jpeg',10000);
    }else{
      if(button)button.textContent='압축하는 중…';
      files['목록.csv']=csvBytes(catwalkManifestRows(entries));
      // Named for the season when every look in it walked the same one; a
      // deliberate mix of seasons is named for nothing but its size.
      const seasons=new Set(entries.map(e=>e.look.season||catwalk?.season||''));
      const season=seasons.size===1?fileSafe([...seasons][0]):'';
      downloadBlob(`CATWALK_${season?season+'_':''}${entries.length}장.zip`,
        [zipStored(files)],'application/zip',30000);
    }
    popup(failed
      ?`사진 ${entries.length}장을 저장했습니다. ${failed}장은 받지 못했습니다.`
      :`사진 ${entries.length}장을 저장했습니다.`);
  }finally{
    if(button){button.disabled=false;button.innerHTML=label;}
    saving=false;
  }
}
// Click a card to see the look large, with its caption beside it. The picture
// on the page is the 1,400px rendition the collection downsized from WGSN's
// own 2,574px original - that original is only served to a signed-in session,
// so "WGSN 원본" is a link into WGSN rather than a file this site holds.
let viewerIndex = -1;
function viewerList(){ return catwalkLooks().slice(0, Math.max(catwalkShown || CATWALK_PAGE, 0)); }
function openViewer(id){
  const list = viewerList();
  const at = list.findIndex(l => l.id === id);
  if (at < 0) return;
  viewerIndex = at;
  showViewer();
}
function showViewer(){
  const list = viewerList(), look = list[viewerIndex];
  if (!look) return;
  const box = $('catwalk-viewer');
  $('catwalk-viewer-img').src = look.image;
  $('catwalk-viewer-img').alt = `${look.brand} ${look.season}${look.city ? ' ' + look.city : ''}`;
  $('catwalk-viewer-brand').textContent = look.brand;
  // "WGSN 원본" used to read as the better file to go and get. It is not:
  // that URL answers a WGSN session with 2,574px and everyone else with a
  // 508px stand-in, which is smaller than what this page already holds. So the
  // row says which copy is the best one actually available here.
  const rows = [['시즌', look.season], ['도시', look.city || '미확인'], ['품목', look.imageType || ''],
                ['이 사이트 (최고 화질)', `${look.width}×${look.height}`],
                ['WGSN 보유 원본', look.originalWidth ? `${look.originalWidth}×${look.originalHeight} · 구독 계정 필요` : '']];
  $('catwalk-viewer-meta').innerHTML = rows.filter(([, v]) => v)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join('');
  const save = $('catwalk-viewer-save');
  save.href = look.image;
  save.setAttribute('download', `${look.brand.replace(/[^\p{L}\p{N}]+/gu, '-')}-${look.id}.jpg`);
  const origin = $('catwalk-viewer-origin');
  const originUrl = safeUrl(look.sourceFeedUrl) || safeUrl(look.originalUrl) || safeUrl(shelfUrl(look.shelf));
  origin.href = originUrl;
  origin.hidden = !originUrl;
  $('catwalk-position').textContent = `${viewerIndex + 1} / ${list.length}`;
  $('catwalk-prev').disabled = viewerIndex <= 0;
  $('catwalk-next').disabled = viewerIndex >= list.length - 1;
  box.hidden = false;
  document.body.classList.add('viewer-open');
  $('catwalk-viewer-close').focus();
}
function closeViewer(){
  $('catwalk-viewer').hidden = true;
  document.body.classList.remove('viewer-open');
  const card = document.querySelector(`[data-look="${viewerList()[viewerIndex]?.id}"]`);
  card?.focus();
}
function stepViewer(delta){
  const list = viewerList();
  const next = viewerIndex + delta;
  if (next < 0 || next >= list.length) return;
  viewerIndex = next;
  showViewer();
}
function renderAnalysis(){
  const section=$('analysis');
  if(!section)return;
  const on=state.source==='analysis',walk=state.source==='catwalk',forecast=state.source==='forecast',brief=state.source==='brief',boardsOn=state.source==='boards';
  $('reference-boards').hidden=!boardsOn;
  $('search-form').hidden=boardsOn;
  if(boardsOn)void renderReferenceBoards();
  $('forecast').hidden=!forecast;
  $('research-brief').hidden=!brief;
  document.body.classList.toggle('research-wide',walk||forecast||brief||boardsOn);
  $('search').disabled=walk||forecast||brief||boardsOn;
  if(forecast)void renderForecast();
  if(brief)void renderResearchBrief();
  section.hidden=!on;
  // The tab offers itself only when there are looks behind it. Without this
  // the button was there with an empty page under it whenever the snapshot
  // had not been published.
  const walkTab=document.querySelector('[data-source="catwalk"]');
  if(walkTab)walkTab.hidden=false;
  $('catwalk').hidden=!walk||!(catwalk?.looks||[]).length;
  // The grid's own chrome - count, sort, page selection, pagination -
  // belongs to the grid, not to a distribution or to a wall of runway looks.
  for(const sel of ['#product-grid','.results-bar','.selection-row','#pagination','#selection-bar','#empty-state'])
    document.querySelector(sel)?.classList.toggle('hidden-by-analysis',on||walk||forecast||brief||boardsOn);
  // The product chrome above the grid does nothing on the catwalk: the keyword
  // board filters products and switches tab when touched, and 품목/출시 상태
  // never applied to a runway photograph. Left in place they pushed the first
  // photograph 2,600px down a phone - two and a half screens of controls that
  // could not be used where they stood.
  for(const sel of ['.trends','.filters','#active-filters'])
    document.querySelector(sel)?.classList.toggle('hidden-by-analysis',walk||forecast||brief||boardsOn);
  if(walk)renderCatwalk();
  $('rank-boards').hidden=!on||!(rankBoards?.boards||[]).some(b=>b.items?.length);
  if(!on)return;
  void renderWeeklyInsights();
  renderRankBoards();
  const rows=analysisScope(),stamp=rows.map(p=>p.id).join('|');
  if(renderedAnalysis?.products===products&&renderedAnalysis.stamp===stamp&&renderedAnalysis.revision===categoryRevision)return;
  renderedAnalysis={products,stamp,revision:categoryRevision};
  $('analysis-scope').textContent=`현재 필터 기준 ${rows.length.toLocaleString()}개 상품 · ${RATE_NOTE}`;

  const category=categoryDistribution(rows);
  document.querySelector('#panel-category .panel-body').innerHTML=
    category.rows.map(r=>bar(r.name,r.count,category.placed)).join('')||'<p class="muted">분류된 상품이 없습니다.</p>';
  document.querySelector('#panel-category .panel-note').textContent=
    `상점 분류 · 같은 모델의 다른 기록 · 상품명에서 읽은 ${category.placed.toLocaleString()}건 기준`;

  const price=priceDistribution(rows,{includeGroups:false});
  document.querySelector('#panel-price .panel-body').innerHTML=
    price.bands.map(b=>bar(b.label,b.count,price.priced)).join('')||'<p class="muted">가격 정보가 없습니다.</p>';
  document.querySelector('#panel-price .panel-note').textContent=
    `가격 확인 ${price.priced.toLocaleString()}건 · 기사 금액·미지원 통화 제외`;

  const colour=colourDistribution(rows);
  document.querySelector('#panel-colour .panel-body').innerHTML=
    colour.rows.map(r=>bar(r.name,r.count,colour.read,r.hex)).join('')||'<p class="muted">색상 정보가 없습니다.</p>';
  document.querySelector('#panel-colour .panel-note').textContent=
    `상품 사진에서 판독 ${colour.read.toLocaleString()}건`;

  const material=materialDistribution(rows);
  document.querySelector('#panel-material .panel-body').innerHTML=
    material.rows.slice(0,12).map(r=>bar(r.name,r.count,material.stated)).join('')||'<p class="muted">소재 정보가 없습니다.</p>';
  document.querySelector('#panel-material .panel-note').textContent=
    `소재 기재 ${material.stated.toLocaleString()}건 · 한 상품이 여러 소재에 포함될 수 있습니다`;

  renderBrandPrices(products);
}

// --- compare ----------------------------------------------------------------
function openCompare(){
  const picked=products.filter(p=>selected.has(p.id)).slice(0,5);
  if(picked.length<2){popup('비교하려면 상품을 2개 이상 선택하세요');return;}
  const rows=[['브랜드',p=>p.brand],['상품명',p=>variantGroupName(p)],
    ['색상',p=>variantColorLabel(p)||colourFamily(p.bodyColor)||'—'],
    ['가격',p=>priceKrw(p)?`${priceKrw(p).toLocaleString()}원`:(p.priceLabel||'—')],
    ['가격대',p=>priceBand(priceKrw(p))||'—'],
    ['소재',p=>materialsOf(p).join(' / ')||'—'],
    ['품목',p=>p.category||'—'],['등록일',p=>recordDay(p)||'—'],
    ['출처',p=>isOverlay(p)?sourceLabelOf(p):'브랜드 공식']];
  $('compare-body').innerHTML=`<table class="compare-table"><tr><th></th>${picked.map(p=>
    `<th><span class="compare-shot">${imageMarkup(p,true)}</span></th>`).join('')}</tr>`
    +rows.map(([label,read])=>`<tr><th>${esc(label)}</th>${picked.map(p=>`<td>${esc(String(read(p)))}</td>`).join('')}</tr>`).join('')
    +`<tr><th></th>${picked.map(p=>{const u=outboundUrl(p);return `<td>${u?`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">원본 ↗</a>`:''}</td>`;}).join('')}</tr></table>`;
  bindImageErrors($('compare-body'));
  $('compare-dialog').showModal();
}

function render() {
  if (!catalog) return;
  renderBrandGroupTabs();
  renderSocialGroups();
  renderAnalysis();
  if(['analysis','catwalk','forecast','brief','boards'].includes(state.source)){
    // Controls from a previous retailer/SNS tab must not follow a reader into
    // research views, whose render ends before the product-grid controls run.
    for(const id of ['retailer-tabs','sns-trends','source-note'])$(id).hidden=true;
    return;
  }
  const filterKey=JSON.stringify([today,state.search,[...state.brands].sort(),state.brandGroup,state.category,state.source,state.release,state.sort,state.socialGroup,state.retailer,state.trendTerms,state.freshOnly,state.savedOnly,savedRevision]);
  if(filteredViewCache?.products!==products||filteredViewCache.key!==filterKey||filteredViewCache.keywordIds!==state.keywordIds){
    let rows=filterProducts(products,{...state,isFresh,isSaved},today);
    if(state.source==='sns'&&state.sort==='newest')rows=[...rows].sort((a,b)=>(b.snsTrendMatches||0)-(a.snsTrendMatches||0));
    filteredViewCache={products,key:filterKey,keywordIds:state.keywordIds,rows,groups:groupProductVariants(rows)};
  }
  filtered=filteredViewCache.rows;
  const groups=filteredViewCache.groups;
  groupCount = groups.length;
  state.page = Math.min(state.page,Math.max(1,Math.ceil(groups.length/PAGE_SIZE)));
  const pageGroups = groups.slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE).map(matches=>[matches[0],...colorGroupOf(matches[0]).filter(p=>p.id!==matches[0].id)]);
  visible = pageGroups.map(activeOf);
  $('result-count').textContent = groups.length.toLocaleString();
  renderSourceDescription();
  $('product-grid').innerHTML = pageGroups.map((group,i) => {
    const p = activeOf(group), release = isOverlay(p)?overlayReleaseState(p,today):releaseState(p,today), url = outboundUrl(p);
    const over=isOverlay(p);
    const brandLine=over?`${esc(p.brand)} · ${esc(sourceLabelOf(p))}`:esc(p.brand);
    const meta=over?`<span>${esc(overlayDateLabel(p))}</span>${p.priceLabel?`<span>${esc(p.priceLabel)}</span>`:''}`:`<span>${esc(releaseDateLabel(p))}</span>`;
    const link=over?(url?`<a class="official-small" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(p.name)} ${esc(sourceLabelOf(p))}에서 보기">${esc(sourceLabelOf(p))} ↗</a>`:'')
                   :(url?`<a class="official-small" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(p.name)} 공식 상품 보기">공식 상품 ↗</a>`:'');
    return `<article class="product-card ${selected.has(p.id)?'selected':''}" data-id="${esc(p.id)}" data-brand="${esc(p.brand)}" data-group="${esc(groupKey(p))}"><div class="card-visual"><label class="card-checkbox"><input type="checkbox" data-select="${esc(p.id)}" aria-label="${esc(p.brand+' '+p.name)} 선택" ${selected.has(p.id)?'checked':''}></label><button class="card-photo" data-photo="${esc(p.id)}" aria-label="${esc(p.brand+' '+p.name)} 사진 JPG 저장" title="사진 JPG 저장">↓</button><button class="card-save ${isSaved(p)?'on':''}" data-save="${esc(p.id)}" aria-pressed="${isSaved(p)}" aria-label="${esc(p.name)} 저장"${isSaved(p)?' title="저장함에 있음"':''}>★</button><button class="card-open" data-detail="${esc(p.id)}" aria-label="${esc(p.brand+' '+p.name)} 상세정보">${imageMarkup(p,i<4)}</button>${release==='upcoming'?'<span class="release-badge upcoming">발매 예정</span>':''}</div><div class="card-copy"><p class="card-brand">${brandLine}</p><button class="card-name" data-detail="${esc(p.id)}">${esc(variantGroupName(p))}</button><div class="card-meta">${meta}</div>${colorChipsMarkup(group,p.id)}</div><div class="card-footer">${link}<button class="rb-add-source" data-board-product="${esc(p.id)}">보드에 담기 ＋</button></div></article>`;
  }).join('');
  bindImageErrors($('product-grid'));
  $('product-grid').querySelectorAll('[data-detail]').forEach(button=>button.addEventListener('click',()=>openDetail(button.dataset.detail)));
  $('product-grid').querySelectorAll('[data-select]').forEach(input=>input.addEventListener('change',()=>toggleSelection(input.dataset.select,input.checked)));
  $('product-grid').querySelectorAll('[data-save]').forEach(button=>button.addEventListener('click',()=>{
    const p=products.find(x=>x.id===button.dataset.save);toggleSaved(button.dataset.save,p?variantGroupName(p):'');}));
  $('product-grid').querySelectorAll('[data-photo]').forEach(button=>button.addEventListener('click',()=>{const p=products.find(x=>x.id===button.dataset.photo);downloadPhotos([p]);}));
  $('product-grid').querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{activeVariant.set(button.closest('.product-card').dataset.group,button.dataset.variant);render();}));
  $('empty-state').hidden = filtered.length>0;
  $('empty-reset').textContent='필터 초기화'; delete $('empty-reset').dataset.retry;
  if (!filtered.length) {
    $('empty-title').textContent = state.source==='sns'?'공개 SNS 지표를 확인한 상품이 없습니다':state.source==='brand'?'공식 정보 확인을 마친 출시 상품이 없습니다':state.source==='retail'?'조건에 맞는 리테일 신상이 없습니다':state.source==='newsletter'?'조건에 맞는 뉴스레터 신상이 없습니다':state.source==='all' ? '조건에 맞는 상품이 없습니다' : `${sourceNames[state.source]} 선정 기준을 충족한 상품이 없습니다`;
    $('empty-description').textContent = state.source==='retail' ? '기존 브랜드 범위에 맞는 리테일 목록을 복원했습니다. 브랜드·검색 필터를 줄여 보세요.' : state.source==='newsletter' ? '최근 3개월 기사 중 브랜드가 확인된 신상 신발만 표시합니다. 필터를 줄여 보세요.' : state.source==='sns' ? '최근 3개월에 확인한 검색량·해시태그 게시물 수와 공식 상품 정보를 갖춘 상품부터 표시합니다. 공개되지 않은 수치는 미공개로 구분합니다.' : state.source==='media' ? '매거진·뉴스레터를 합쳐 최근 30일 이내 독립된 출처 2곳 이상이 직접 소개한 상품을 보여줍니다.' : state.source==='ecommerce' ? '국가·카테고리·확인일이 있는 실제 랭킹의 상품이 필요합니다.' : state.source==='brand'?'브랜드 공식 상품 탭은 LUX 공식 홈페이지의 스니커즈만 표시합니다.':'필터를 줄여 보세요. 공식 New·New Arrivals 근거가 없거나 게시 후 3개월이 지난 상품은 표시하지 않습니다.';
  }
  $('page-range').textContent = groups.length ? `${(state.page-1)*PAGE_SIZE+1}–${Math.min(state.page*PAGE_SIZE,groups.length)} / ${groups.length.toLocaleString()}` : '0개 상품';
  $('mobile-brand-count').textContent=state.brands.size?String(state.brands.size):'';
  renderRetailers(); renderTrendKeywords(); renderSourceNote(); renderChips(); renderPagination(); updateSelection();
}
function renderSourceDescription() {
  if (state.source === 'all') {
    const narrowed=state.brands.size||state.category!=='all'||state.search||state.release!=='all';
    $('result-description').textContent=state.keywordLabel?`${state.keywordLabel} ${narrowed?'관련 상품 · 선택한 필터 적용':'전체 상품 · 선택한 브랜드 그룹'}`:'LUX 공식 상품과 리테일·뉴스레터 목록입니다. 브랜드 그룹별로 확인할 수 있습니다.';
    return;
  }
  if(state.source==='brand'){
    $('result-description').textContent='LUX 각 브랜드의 공식 상품 페이지와 공식 이미지를 확인한 스니커즈입니다. 브랜드 필터로 원하는 브랜드를 고를 수 있습니다.';
    return;
  }
  if(state.source==='retail'||state.source==='newsletter'){
    const kind=state.source;
    const rows=products.filter(p=>isOverlay(p)&&overlayKind(p)===kind&&overlayReleaseState(p,today));
    const labels=[...new Set(rows.map(sourceLabelOf).filter(Boolean))].sort();
    $('result-description').innerHTML=labels.length
      ?`확인된 출처: ${labels.map(esc).join(' · ')}<span class="source-context">${kind==='retail'?'기존 리테일 목록을 복원했습니다. 목록 확인일과 실제 출시일은 다르며, 같은 모델의 색상·소재는 한 카드에 표시합니다.':'기사에서 브랜드가 확인된 신상 신발입니다. 원문은 카드를 눌러 확인하세요.'}</span>`
      :'아직 게시된 상품이 없습니다.';
    return;
  }
  if(state.source==='sns'){
    const rows=products.filter(p=>releaseState(p,today)).flatMap(p=>visibleSocialMetrics(p,today)),platforms=[...new Set(rows.map(m=>m.platform))],names={instagram:'Instagram',tiktok:'TikTok',youtube:'YouTube',xiaohongshu:'Xiaohongshu'};
    $('result-description').innerHTML=`${platforms.length?'확인된 플랫폼: '+platforms.map(p=>esc(names[p]||p)).join(' · '):'확인된 공개 검색량·해시태그 게시물 수가 아직 없습니다.'}<span class="source-context">최근 3개월에 확인한 상품별 지표입니다. 실제 측정 기간과 누적 수치를 구분하며, 미공개 수치는 0으로 표시하지 않습니다. 사진은 공식 상품 이미지입니다. ${state.socialGroup?'선택한 비교군 안에서 지표가 높은 순으로 표시합니다.':'전체 지표는 출시일순으로 표시합니다.'}</span>`;
    return;
  }
  const context=sourceContext(state.source,products,catalog.sourceDirectory||{},today);
  const links=entries=>entries.map(s=>`<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>`).join(' · ');
  const original=context.observed.length?`카탈로그 원문 출처: ${links(context.observed)}`:'확인된 원문 출처가 아직 없습니다.';
  const awaiting=context.configured.length?`<span class="source-context">수집 대상 (원문 확인 전): ${links(context.configured)}</span>`:'';
  $('result-description').innerHTML=`${original}${awaiting}<span class="source-context">${state.source==='media'?'매거진·뉴스레터를 합쳐 독립된 출처 2곳 이상이 소개한 상품입니다.':esc(sourceNames[state.source])+' 선정 기준을 충족한 상품만 표시합니다.'} 개별 원문은 상세정보에서 확인하세요.</span>`;
}
function renderRetailers() {
  const row=$('retailer-tabs');
  if(!row)return;
  const show=state.source==='retail';
  row.hidden=!show;
  if(!show)return;
  const counts=new Map();
  for(const p of products){
    if(!isOverlay(p)||overlayKind(p)!=='retail')continue;
    if(!overlayReleaseState(p,today))continue;
    counts.set(p.source,(counts.get(p.source)||0)+1);
  }
  const total=[...counts.values()].reduce((n,v)=>n+v,0);
  row.innerHTML=RETAILER_TABS.filter(([id])=>id==='all'||counts.get(id)).map(([id,label])=>{
    const n=id==='all'?total:counts.get(id)||0;
    const active=state.retailer===id;
    return `<button type="button" class="retailer-tab ${active?'active':''}" data-retailer="${esc(id)}" aria-pressed="${active}">${esc(label)}<span class="count">${n.toLocaleString()}</span></button>`;
  }).join('');
  row.querySelectorAll('[data-retailer]').forEach(button=>button.addEventListener('click',()=>{
    state.retailer=button.dataset.retailer;state.page=1;render();
  }));
}
// A name that is only a manufacturer's reference tells a reader nothing:
// New Balance's Korean listings are called "NBPFGF701Y" and no more.
const CODE_ONLY_NAME=/^(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9-]{6,}$/;
const TREND_ITEMS_SHOWN=12;
const TREND_ITEMS_PER_BRAND=2;

// The keywords name a subject; this names the shoes. One row per model,
// ranked by how many of the week's keywords reach it - a model several
// hashtags point at outranks one carried by the single biggest tag - and
// then by how many listings of it the week actually found, because the
// keyword count alone ties almost everything.
function renderTrendItems(keywords,products){
  const box=$('sns-trend-items'),list=$('sns-trend-item-list');
  if(!box||!list)return;
  // One pass to count listings per model. Asking `products.filter` for each
  // match instead made this quadratic: the SNS tab took fifteen seconds.
  const listings=new Map();
  for(const p of products){
    const key=variantGroupKey(p);
    listings.set(key,(listings.get(key)||0)+1);
  }
  const models=new Map();
  for(const k of keywords){
    const seen=new Set();
    for(const p of products){
      // An article about a shoe is not the shoe. Newsletter records are
      // headlines, and they were filling this list with sentences.
      if(isOverlay(p)&&overlayKind(p)==='newsletter')continue;
      if(!trendKeywordMatches(p,k._terms))continue;
      const key=variantGroupKey(p);
      if(seen.has(key))continue;
      seen.add(key);
      const row=models.get(key)||{name:variantGroupName(p),brand:p.brand||'',
                                  tags:new Set(),listings:listings.get(key)||1,id:p.id};
      row.tags.add(k.hashtag);
      models.set(key,row);
    }
  }
  const ranked=[...models.values()]
    .filter(row=>row.name&&!CODE_ONLY_NAME.test(row.name.trim()))
    .sort((a,b)=>b.tags.size-a.tags.size||b.listings-a.listings||a.name.localeCompare(b.name));
  // No single brand may fill the row: New Balance alone matched twelve.
  const perBrand=new Map(),top=[];
  for(const row of ranked){
    const used=perBrand.get(row.brand)||0;
    if(used>=TREND_ITEMS_PER_BRAND)continue;
    perBrand.set(row.brand,used+1);
    top.push(row);
    if(top.length>=TREND_ITEMS_SHOWN)break;
  }
  box.hidden=!top.length;
  if(!top.length)return;
  list.innerHTML=top.map(row=>
    `<button type="button" class="trend-item" data-trend-item="${esc(row.id)}" title="${esc([...row.tags].map(t=>'#'+t).join(' · '))}">`
    +`<span class="trend-item-brand">${esc(row.brand)}</span>`
    +`<span class="trend-item-name">${esc(row.name)}</span>`
    +`<span class="trend-item-count">${row.tags.size}</span></button>`).join('');
  list.querySelectorAll('[data-trend-item]').forEach(button =>
    button.addEventListener('click', () => openDetail(button.dataset.trendItem)));
}

function renderTrendKeywords() {
  const section=$('sns-trends');
  if(!section)return;
  section.hidden=state.source!=='sns';
  if(section.hidden)return;
  const list=$('sns-trend-list');
  // Only keywords that actually reach at least one published item are shown,
  // so every chip returns something when it is pressed. The collector
  // publishes more than the display count for exactly this reason.
  const limit=trends?.displayCount||20;
  // Counted in one pass over the products rather than one pass per keyword.
  const prepared=(trends?.keywords||[]).map(k=>({...k,_terms:trendTerms(k),_matches:0}));
  for(const p of products)for(const k of prepared)if(trendKeywordMatches(p,k._terms))k._matches++;
  const keywords=prepared.filter(k=>k._matches>0).slice(0,limit);
  if(!keywords.length){
    list.innerHTML='<p class="keyword-empty">주간 성장률을 계산할 SNS 키워드가 아직 없습니다. 첫 수집 이후 다음 주부터 증감이 표시됩니다.</p>';
    $('sns-trend-total').textContent='';
    $('sns-trend-status').textContent=trends?`${dateText(trends.generatedAt,true)} 확인`:'';
    return;
  }
  list.innerHTML=keywords.map((k,i)=>{
    const active=state.trendHashtag===k.hashtag;
    const growth=k.growthPercent===null||k.growthPercent===undefined
      ? '<span class="platform">신규</span>'
      : `<span class="growth ${k.growthPercent<0?'down':''}">${k.growthPercent>0?'+':''}${k.growthPercent.toLocaleString()}%</span>`;
    return `<button type="button" class="keyword trend-chip ${active?'active':''}" data-trend="${i}" aria-pressed="${active}" title="${esc((k.relatedKeywords||[]).join(' · '))}"><span class="rank">${String(i+1).padStart(2,'0')}</span><span>#${esc(k.hashtag)}</span><span class="platform">${k._matches.toLocaleString()}개</span>${growth}</button>`;
  }).join('');
  renderTrendItems(keywords,products);
  $('sns-trend-total').textContent=`${keywords.length} KEYWORDS`;
  const dropped=(trends?.keywords||[]).length-keywords.length;
  const measured=keywords.filter(k=>k.growthPercent!==null&&k.growthPercent!==undefined).length;
  const platforms=trends?.sourceStatus||{};
  const blocked=Object.entries(platforms).filter(([,v])=>v&&v.status&&v.status!=='ok').map(([name,v])=>`${name}: ${v.status}`);
  $('sns-trend-status').textContent=[
    trends?.generatedAt?`${dateText(trends.generatedAt,true)} 확인`:'',
    `주간 증감 산출 ${measured}개 / ${keywords.length}개`,
    dropped>0?`일치 상품 없는 ${dropped}개 키워드 제외`:'',
    (trends?.excludedAsGeneric||[]).length?`트렌드 신호 없는 일반 태그 제외: ${(trends.excludedAsGeneric||[]).slice(0,4).map(t=>'#'+t).join(' ')}`:'',
    blocked.length?`수집 불가 — ${blocked.join(', ')}`:'',
  ].filter(Boolean).join(' · ');
  list.querySelectorAll('[data-trend]').forEach(button=>button.addEventListener('click',()=>{
    const k=keywords[Number(button.dataset.trend)];
    const same=state.trendHashtag===k.hashtag;
    state.trendHashtag=same?'':k.hashtag;
    state.trendTerms=same?null:k._terms;
    state.page=1;render();
  }));
}
const SOURCE_NOTES={
  retail:'기존 리테일 원본 중 허용 브랜드 목록을 복원했습니다. 목록 확인일은 출시일이 아닙니다. 공식 상품과 동일한 변형은 공식 출처를 우선하며, 이후 신규 수집에는 최초 출시 검증 기준을 적용합니다.',
  newsletter:'Sneaker News·Highsnobiety·Sneaker Freaker·Hypebeast·Hypebeast Korea·Concept Kicks·Footwear News의 최근 3개월 기사 중 브랜드가 확인된 신상 신발입니다. 기사에 적힌 발매일이 아직 오지 않은 아이템은 발매 예정으로 표시합니다.',
};
function renderSourceNote(){
  const note=$('source-note');
  if(!note)return;
  const text=SOURCE_NOTES[state.source]||'';
  note.textContent=text;note.hidden=!text;
}
function renderChips() {
  $('active-filters').innerHTML = [...state.brands].map(name=>`<button class="filter-chip" data-remove-brand="${esc(name)}" aria-label="${esc(name)} 필터 해제">${esc(name)}<span aria-hidden="true">×</span></button>`).join('')+(state.keywordLabel?`<button class="filter-chip" id="remove-keyword" aria-label="키워드 필터 해제"># ${esc(state.keywordLabel)}<span aria-hidden="true">×</span></button>`:'')+(state.trendHashtag?`<button class="filter-chip" id="remove-trend" aria-label="SNS 트렌드 키워드 필터 해제"># ${esc(state.trendHashtag)}<span aria-hidden="true">×</span></button>`:'');
  $('remove-trend')?.addEventListener('click',()=>{state.trendHashtag='';state.trendTerms=null;state.page=1;render();});
  $('active-filters').querySelectorAll('[data-remove-brand]').forEach(b=>b.addEventListener('click',()=>{state.brands.delete(b.dataset.removeBrand);state.page=1;renderBrands();render();}));
  $('remove-keyword')?.addEventListener('click',()=>{state.keywordIds=null;state.keywordLabel='';state.keywordId='';state.page=1;renderKeywords();render();});
}
function renderPagination() {
  const pages = Math.ceil(groupCount/PAGE_SIZE);
  if (pages<2) { $('pagination').innerHTML='';return; }
  const numbers = [...new Set([1,...Array.from({length:5},(_,i)=>state.page+i-2).filter(n=>n>0&&n<=pages),pages])].sort((a,b)=>a-b);
  let last=0;
  $('pagination').innerHTML=`<button data-page="${state.page-1}" ${state.page===1?'disabled':''} aria-label="이전 페이지">‹</button>`+numbers.map(n=>{const gap=last&&n-last>1?'<span aria-hidden="true">…</span>':'';last=n;return `${gap}<button data-page="${n}" ${n===state.page?'class="active" aria-current="page"':''} aria-label="${n}페이지">${n}</button>`;}).join('')+`<button data-page="${state.page+1}" ${state.page===pages?'disabled':''} aria-label="다음 페이지">›</button>`;
  $('pagination').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{state.page=Number(b.dataset.page);render();$('results').scrollIntoView({block:'start'});$('results').focus({preventScroll:true});}));
}
function updateSelection() {
  const selectedCount=selected.size;
  $('selection-bar').hidden=!selectedCount; $('selection-count').textContent=`${selectedCount}개 선택`;
  $('select-page').disabled=!visible.length; $('select-page').checked=!!visible.length&&visible.every(p=>selected.has(p.id));
  $('select-page').indeterminate=visible.some(p=>selected.has(p.id))&&!$('select-page').checked;
  $('product-grid').querySelectorAll('[data-select]').forEach(input=>{input.checked=selected.has(input.dataset.select);input.closest('.product-card').classList.toggle('selected',input.checked);});
  const button=$('detail-select'); if(button) {button.textContent=selected.has(activeDetailId)?'선택 해제':'상품 선택';button.setAttribute('aria-pressed',String(selected.has(activeDetailId)));}
  $('detail-save')?.addEventListener('click',()=>{const p=products.find(x=>x.id===id);toggleSaved(id,p?variantGroupName(p):'');openDetail(id);});
  $('detail-memo')?.addEventListener('input',e=>setMemo(id,e.target.value));
}
function toggleSelection(id,checked) { checked?selected.add(id):selected.delete(id);updateSelection(); }
function overlayDetailMarkup(p,id,group){
  const url=safeUrl(p.url);
  const kind=overlayKind(p);
  const label=sourceLabelOf(p);
  // One click on the card opens this panel; a second click on the photo goes
  // to the retailer's or the publisher's own page.
  const visual=url
    ? `<a class="detail-photo-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)} 페이지로 이동">${imageMarkup(p,true,true)}<span class="detail-photo-hint">사진을 누르면 ${esc(label)} 페이지로 이동 ↗</span></a>`
    : imageMarkup(p,true,true);
  const types=(p.footwearTypes||['sneaker']).map(t=>productTypeNames[{'ballet-sneaker':'hybrid','mary-jane-sneaker':'hybrid','mule-sneaker':'hybrid',platform:'platform-shoe'}[t]||t]||t).join(' · ');
  const mentions=p.popularity?.mediaMentions||[];
  const rows=[
    ['품목',esc(types||'스니커즈')],
    ['컬러',esc(variantColorLabel(p)||'색상명 미확인')],
    ['소재',esc(p.material||'리테일러 미표기 · 상품 페이지에서 확인')],
    ...(p.countryOrigin?[['제조국',esc(p.countryOrigin)]]:[]),
    [kind==='newsletter'?'기사 출처':'판매처',esc(label)],
    ['제품 코드',esc(p.manufacturerStyle||p.style||'미확인')],
    ['가격',esc(p.priceLabel||'상품 페이지에서 확인')],
    ['성별',esc(p.gender==='women'?'여성':p.gender==='men'?'남성':'미표기')],
    [kind==='newsletter'?'발행':'등록',esc(overlayDateLabel(p))],
    ...(p.releaseDate?[['출시',`${esc(dateText(p.releaseDate))}${p.releaseStatus==='upcoming'?' (예정)':''}`]]:[]),
    ...(p.basis?[['수집 근거',esc(p.basis)]]:[]),
    ...(p.checkedAt?[['확인일',esc(dateText(p.checkedAt,true))]]:[]),
    ...(mentions.length?[['뉴스레터 언급',mentions.slice(0,5).map(m=>`<a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener noreferrer">${esc(m.publisher)} ↗</a>`).join(' · ')]]:[]),
  ];
  const others=group.filter(v=>v.id!==p.id&&v.source!==p.source);
  return `<div class="detail-visual">${visual}</div>
    <p class="card-brand">${esc(p.brand)}${p.brandAsListed&&p.brandAsListed!==p.brand?` · ${esc(p.brandAsListed)}`:''} · ${esc(label)}</p>
    <h2 id="detail-title">${esc(variantGroupName(p))}</h2>
    ${p.fullName&&p.fullName!==p.name?`<p class="muted">${esc(p.fullName)}</p>`:''}
    ${colorChipsMarkup(group,p.id)}
    <div class="detail-actions">${url?`<a class="primary-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}에서 보기 ↗</a>`:''}<button class="secondary-button" data-board-product="${esc(id)}">보드에 담기 ＋</button><button id="detail-select" class="secondary-button" aria-pressed="${selected.has(id)}">${selected.has(id)?'선택 해제':'상품 선택'}</button></div>
    <dl class="detail-data">${rows.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    ${p.excerpt?`<h3>기사 요약</h3><p>${esc(p.excerpt)}</p>`:''}
    ${others.length?`<h3>같은 모델을 파는 다른 곳</h3><div class="evidence">${others.map(v=>`<a href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener noreferrer">${esc(sourceLabelOf(v))}${v.priceLabel?` · ${esc(v.priceLabel)}`:''} ↗</a>`).join('')}</div>`:''}
    <h3>출처</h3>
    <div class="evidence"><span class="source-badge">${esc(kind==='newsletter'?'뉴스레터':'리테일')}</span>
      ${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(p.fullName||p.name)} ↗</a>`:''}
      <p>${esc(label)}${p.officialCategory?` · ${esc(p.officialCategory)}`:''}</p>
      ${safeUrl(p.listingUrl)?`<p><a href="${esc(safeUrl(p.listingUrl))}" target="_blank" rel="noopener noreferrer">수집한 목록 페이지 ↗</a></p>`:''}
    </div>`;
}

function openDetail(id) {
  const p=products.find(p=>p.id===id); if(!p)return;activeDetailId=id;
  const group=colorGroupOf(p);
  if(group.length>1)activeVariant.set(groupKey(p),id);
  if(isOverlay(p)){
    $('detail-content').innerHTML=overlayDetailMarkup(p,id,group);
    bindImageErrors($('detail-content'));
    $('detail-select').addEventListener('click',()=>toggleSelection(id,!selected.has(id)));
    $('detail-content').querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{openDetail(button.dataset.variant);render();}));
    if(!$('detail-dialog').open)$('detail-dialog').showModal();
    return;
  }
  const url=reviewedProductPageUrl(p,today), evidence=safeUrl(p.dateEvidence?.url);
  const signals=(p.sourceSignals||[]).filter(s=>safeUrl(s.url));
  const data=[...(p.arrivalEvidence?[[p.arrivalEvidence.kind==='catalogue-listing'?'목록 근거':'신상품 근거',`<a href="${esc(safeUrl(p.arrivalEvidence.url))}" target="_blank" rel="noopener noreferrer">${p.arrivalEvidence.kind==='catalogue-listing'?'공식 상품 목록 ↗':'공식 New·New Arrivals ↗'}</a> · ${esc(dateText(p.arrivalEvidence.verifiedAt,true))} 확인`]]:[]),...(p.firstPublishedAt?[['사이트 최초 게시',esc(dateText(p.firstPublishedAt,true))]]:[]),...(p.releaseDate?[["출시일",`${esc(dateText(p.releaseDate))}${releaseState(p,today)==='upcoming'?' (예정)':''}${p.dateEvidence?.region?` · ${esc(p.dateEvidence.region)}`:''}${evidence?`<br><a href="${esc(evidence)}" target="_blank" rel="noopener noreferrer">출시일 근거 ↗</a>`:''}`]]:[]),['품목',esc(productTypeNames[p.productType||p.category]||p.productType||p.category||'미확인')],[p.manufacturerStyle?'제품 코드':p.styleType==='official-product-id'?'상품 ID':'스타일 코드',esc(p.manufacturerStyle||p.style||'미확인')],['컬러웨이',esc(p.colorway||(p.colors||[]).map(c=>typeof c==='string'?c:c.name).filter(Boolean).join(', ')||'미확인')],['소재',esc(p.material||'미확인')],['가격',esc(p.priceLabel||'공식 상품에서 확인')],['마지막 검증',esc(dateText(p.lastVerifiedAt||p.verifiedAt||p.dateEvidence?.verifiedAt,true))]];
  $('detail-content').innerHTML=`<div class="detail-visual">${imageMarkup(p,true,true)}</div><p class="card-brand">${esc(p.brand)}</p><h2 id="detail-title">${esc(variantGroupName(p))}</h2>${colorChipsMarkup(group,p.id)}<div class="detail-actions">${url?`<a class="primary-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">공식 상품 보기 ↗</a>`:''}<button class="secondary-button" data-board-product="${esc(id)}">보드에 담기 ＋</button><button id="detail-select" class="secondary-button" aria-pressed="${selected.has(id)}">${selected.has(id)?'선택 해제':'상품 선택'}</button><button id="detail-save" class="secondary-button" aria-pressed="${isSaved(p)}">${isSaved(p)?'★ 저장됨':'☆ 저장'}</button><button id="detail-photo" class="secondary-button">사진 JPG 저장 ↓</button></div><div class="memo-box"><label for="detail-memo">메모</label><textarea id="detail-memo" rows="2" placeholder="${isSaved(p)?'이 상품에 대한 메모를 남겨 두세요':'저장하면 메모를 남길 수 있습니다'}" ${isSaved(p)?'':'disabled'}>${esc(saved[id]?.memo||'')}</textarea></div><dl class="detail-data">${data.map(([label,value])=>`<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl><h3>기획 참고 요소</h3>${p.fitReasons?.length?`<ul class="reasons">${p.fitReasons.map(reason=>`<li>${esc(typeof reason==='string'?reason:reason.text||reason.reason||'')}</li>`).join('')}</ul>`:'<p class="muted">확인된 선정 이유가 아직 없습니다.</p>'}<h3>출처와 검증 근거</h3>${signals.length?signals.map(s=>`<div class="evidence"><span class="source-badge">${esc(sourceNames[s.type]||s.type)}${s.sponsored?' · 광고/협찬':''}</span><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title||s.account||'원문 확인')} ↗</a><p>${s.account?esc(s.account)+' · ':''}${s.rank?'순위 '+esc(s.rank)+' · ':''}${s.country?esc(s.country)+' · ':''}${s.rankingCategory||s.category?esc(s.rankingCategory||s.category)+' · ':''}${s.publishedAt?(s.type==='ecommerce'?(s.dateBasis==='platform-updated-at'?'순위 집계일 ':'순위 확인일 '):'발행 ')+esc(dateText(s.publishedAt))+' · ':''}확인 ${esc(dateText(s.checkedAt))}</p>${s.rankingPeriod||s.rankingDefinition?`<p class="ranking-context">${s.rankingPeriod?'집계 기간: '+esc(s.rankingPeriod)+' · ':''}${s.rankingDefinition?esc(s.rankingDefinition):''}</p>`:''}</div>`).join(''):'<p class="muted">확인 가능한 공식 상품·출시·이미지 근거가 아직 없습니다.</p>'}`;
  bindImageErrors($('detail-content'));$('detail-select').addEventListener('click',()=>toggleSelection(id,!selected.has(id)));$('detail-photo')?.addEventListener('click',()=>downloadPhotos([p]));
  $('detail-content').querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{openDetail(button.dataset.variant);render();}));
  if(!$('detail-dialog').open)$('detail-dialog').showModal();
}
function syncFilterControls() {
  $('search').value=state.search;$('brand-search').value='';$('category-filter').value=state.category;$('release-filter').value=state.release;$('sort').value=state.sort;
  document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b.dataset.source===state.source);b.setAttribute('aria-pressed',String(b.dataset.source===state.source));});
  renderBrandGroupTabs();
}
function resetFilters() {
  clearTimeout(searchTimer);
  Object.assign(state,{search:'',brands:new Set(),brandGroup:'all',category:'all',source:'all',catwalkShow:'all',catwalkCollection:'all',catwalkSeason:'',catwalkCity:'',catwalkFind:'',release:'released',sort:'newest',socialGroup:'',retailer:'all',trendTerms:null,trendHashtag:'',page:1,keywordIds:null,keywordLabel:'',keywordId:''});
  syncFilterControls();renderBrands();renderKeywords();render();
}
function openExport() {
  $('export-description').textContent=`선택한 ${selected.size}개 상품에서 필요한 정보를 고르세요.`;
  $('export-columns').innerHTML=EXPORT_COLUMNS.map(([key,label])=>`<label class="export-column"><input type="checkbox" value="${key}" checked><span>${label}<small>${key}</small></span></label>`).join('');
  $('export-error').textContent='';$('export-dialog').showModal();
}
function download(format) {
  try {
    const chosen=products.filter(p=>selected.has(p.id)&&(isOverlay(p)?overlayReleaseState(p,today):releaseState(p,today)));
    if(!chosen.length)throw new Error('다운로드할 상품을 선택해 주세요.');
    const columns=[...$('export-columns').querySelectorAll('input:checked')].map(input=>input.value), rows=exportRows(chosen,columns);
    const bytes=format==='csv'?csvBytes(rows):xlsxBytes(rows);
    const blob=new Blob([bytes],{type:format==='csv'?'text/csv;charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob), anchor=document.createElement('a');anchor.href=url;anchor.download=`shoes_${today}_${chosen.length}.${format}`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    $('export-dialog').close();popup(`${chosen.length}개 상품 · ${columns.length}개 정보 다운로드`);
  } catch(error) { $('export-error').textContent=error.message; }
}

$('search-form').addEventListener('submit',event=>event.preventDefault());
let searchTimer;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.search=$('search').value;state.page=1;render();},100);});
$('brand-search').addEventListener('input',renderBrands);
$('clear-brands').addEventListener('click',()=>{state.brands.clear();state.page=1;renderBrands();render();});
loadSaved();persistSaved();
$('fresh-only')?.addEventListener('change',e=>{state.freshOnly=e.target.checked;state.page=1;render();});
$('saved-only')?.addEventListener('change',e=>{state.savedOnly=e.target.checked;state.page=1;render();});
$('compare-close')?.addEventListener('click',()=>$('compare-dialog').close());
$('compare-open')?.addEventListener('click',openCompare);
$('download-photos')?.addEventListener('click',()=>downloadPhotos(products.filter(p=>selected.has(p.id))));
$('dl-analysis-all')?.addEventListener('click',()=>downloadText(`shoes-analysis-${today}.csv`,analysisCsv(analysisScope(),'all')));
$('dl-analysis-xlsx')?.addEventListener('click',()=>{
  downloadText(`shoes-analysis-${today}.xlsx`,xlsxBytes(analysisRows(analysisScope(),'all').map(r=>r.map(String))),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
document.querySelectorAll('[data-dl]').forEach(button=>button.addEventListener('click',()=>
  downloadText(`shoes-${button.dataset.dl}-${today}.csv`,analysisCsv(analysisScope(),button.dataset.dl))));
for(const [id,key] of [['category-filter','category'],['release-filter','release'],['sort','sort']])$(id).addEventListener('change',()=>{state[key]=$(id).value;state.page=1;render();});
document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>{state.source=button.dataset.source;state.page=1;if(state.source!=='retail')state.retailer='all';void ensureSourceData();if(state.source!=='catwalk'){state.catwalkCollection='all';state.catwalkShow='all';state.catwalkSeason='';state.catwalkCity='';state.catwalkFind='';catwalkShown=0;catwalkPicked.clear();catwalkAnchor='';$('catwalk-selection-bar').hidden=true;}if(state.source!=='sns'){state.trendHashtag='';state.trendTerms=null;}state.socialGroup=state.source==='sns'?(socialComparisonGroups(products,today)[0]?.key||''):'';if(state.socialGroup)state.sort='social';else if(state.sort==='social')state.sort='newest';if(state.source==='brand'){state.brandGroup='LUX';state.brands=new Set([...state.brands].filter(b=>siteBrandGroup(b)==='LUX'));state.release='released';$('release-filter').value='released';}document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});renderBrands();render();}));
$('social-group').addEventListener('change',()=>{state.socialGroup=$('social-group').value;state.sort=state.socialGroup?'social':'newest';state.page=1;render();});
$('reset-filters').addEventListener('click',resetFilters);$('empty-reset').addEventListener('click',()=> $('empty-reset').dataset.retry?loadCatalog():resetFilters());
$('catwalk-find')?.addEventListener('input',event=>{
  state.catwalkFind=event.target.value;state.catwalkShow='all';catwalkShown=0;catwalkAnchor='';catwalkShowsOpen=false;
  renderCatwalk();
});
$('select-page').addEventListener('change',()=>{visible.forEach(p=>$('select-page').checked?selected.add(p.id):selected.delete(p.id));updateSelection();});
$('clear-selection').addEventListener('click',()=>{selected.clear();updateSelection();});$('export-open').addEventListener('click',openExport);
$('all-columns').addEventListener('click',()=> $('export-columns').querySelectorAll('input').forEach(i=>i.checked=true));$('no-columns').addEventListener('click',()=> $('export-columns').querySelectorAll('input').forEach(i=>i.checked=false));
$('download-csv').addEventListener('click',()=>download('csv'));$('download-xlsx').addEventListener('click',()=>download('xlsx'));
$('keyword-info').addEventListener('click',()=> $('criteria-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
$('mobile-brands').addEventListener('click',()=>{const sidebar=document.querySelector('.sidebar');sidebar.classList.toggle('open');$('mobile-brands').setAttribute('aria-expanded',String(sidebar.classList.contains('open')));});
document.addEventListener('click',event=>{if(!event.target.closest('.sidebar')&&!event.target.closest('#mobile-brands')){document.querySelector('.sidebar').classList.remove('open');$('mobile-brands').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.matches('input,textarea,select')&&!document.querySelector('dialog[open]')){event.preventDefault();$('search').focus();}if(event.key==='Escape'){document.querySelector('.sidebar').classList.remove('open');$('mobile-brands').setAttribute('aria-expanded','false');}});
// A tab left open overnight must not retain an expired product or selection.
function refreshDate() { if(!catalog)return;const next=kstToday();if(next===today)return;today=next;rebuildProducts();selected=new Set([...selected].filter(id=>products.some(p=>p.id===id)));renderBrands();renderKeywords();render();if($('detail-dialog').open&&!products.some(p=>p.id===activeDetailId))$('detail-dialog').close(); }
setInterval(refreshDate,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDate();});
renderBrands();loadCatalog();
// The catwalk's own controls. Delegated, because the chips and the button are
// rebuilt on every render.
document.addEventListener('click',event=>{
  const cityChip=event.target.closest('[data-catwalk-city]');
  if(cityChip){
    state.catwalkCity=cityChip.dataset.catwalkCity;state.catwalkShow='all';catwalkShown=0;catwalkAnchor='';
    catwalkShowsOpen=false;renderCatwalk();return;
  }
  const more=event.target.closest('[data-catwalk-more]');
  if(more){catwalkShowsOpen=more.dataset.catwalkMore==='open';renderCatwalk();return;}
  const seasonTab=event.target.closest('[data-catwalk-season]');
  if(seasonTab){
    state.catwalkSeason=seasonTab.dataset.catwalkSeason;state.catwalkShow='all';state.catwalkCity='';catwalkShown=0;catwalkAnchor='';catwalkShowsOpen=false;
    renderCatwalk();window.scrollTo({top:$('catwalk').offsetTop-80,behavior:'smooth'});return;
  }
  const chip=event.target.closest('[data-catwalk]');
  if(chip){state.catwalkShow=chip.dataset.catwalk;catwalkShown=0;renderCatwalk();window.scrollTo({top:$('catwalk').offsetTop-80,behavior:'smooth'});return;}
  const tick=event.target.closest('[data-look-select]');
  if(tick){pickCatwalk(tick.dataset.lookSelect,tick.checked,event.shiftKey);return;}
  if(event.target.id==='catwalk-select-all'){
    for(const look of catwalkOnScreen())
      event.target.checked?catwalkPicked.add(look.id):catwalkPicked.delete(look.id);
    catwalkAnchor='';renderCatwalk();return;
  }
  if(event.target.closest('#catwalk-clear-picks')){catwalkPicked.clear();catwalkAnchor='';renderCatwalk();return;}
  if(event.target.closest('#catwalk-download'))return void downloadCatwalkPicks();
  const photo=event.target.closest('[data-look]');
  if(photo){openViewer(photo.dataset.look);return;}
  if(event.target.closest('#catwalk-viewer-close'))return closeViewer();
  if(event.target.closest('#catwalk-prev'))return stepViewer(-1);
  if(event.target.closest('#catwalk-next'))return stepViewer(1);
  if(event.target.id==='catwalk-viewer')return closeViewer();
  if(event.target.closest('#catwalk-more-button')){
    const looks=catwalkLooks();
    catwalkShown=Math.min((catwalkShown||CATWALK_PAGE)+CATWALK_PAGE,looks.length);
    renderCatwalk();
  }
});
// Esc closes the viewer; the arrows walk the shelf.
document.addEventListener('keydown',event=>{
  if($('catwalk-viewer')?.hidden!==false)return;
  if(event.key==='Escape'){event.preventDefault();closeViewer();}
  if(event.key==='ArrowLeft'){event.preventDefault();stepViewer(-1);}
  if(event.key==='ArrowRight'){event.preventDefault();stepViewer(1);}
});

// Independent group scope, shared by product tabs and their analysis.
document.querySelectorAll('[data-brand-group]').forEach(button=>button.addEventListener('click',()=>{state.brandGroup=button.dataset.brandGroup;state.brands=new Set([...state.brands].filter(name=>state.brandGroup==='all'||siteBrandGroup(name)===state.brandGroup));state.page=1;renderBrands();render();}));

bindForecast();
bindResearchBrief();
bindBrandPrices();

function boardProduct(p){return {sourceKey:'product:'+p.id,kind:'product',name:variantGroupName(p),brand:p.brand,color:variantColorLabel(p),style:p.manufacturerStyle||p.style,sourceUrl:outboundUrl(p)||safeUrl(p.url),imageUrl:productImageUrl(p,today),frame:p.presentation?.frame};}
function boardShow(look){return {sourceKey:'show:'+look.id,kind:'show',name:look.brand+(look.collection==='fashion-feed'?' · Fashion Feed':''),brand:look.brand,sourceSeason:look.season,sourceUrl:look.sourceUrl||look.originalUrl,imageUrl:look.image};}
bindReferenceBoards({onNavigate:()=>{if($('detail-dialog').open)$('detail-dialog').close();if($('catwalk-viewer')?.hidden===false)closeViewer();document.querySelector('[data-source="boards"]').click();}});
document.querySelector('[data-source="boards"]').addEventListener('click',()=>requestAnimationFrame(()=>$('reference-boards').scrollIntoView({block:'start'})));
document.addEventListener('click',event=>{
 const product=event.target.closest('[data-board-product]'),show=event.target.closest('[data-board-show]');
 if(product){const p=products.find(p=>p.id===product.dataset.boardProduct);if(p)void openBoardPicker([boardProduct(p)]);return;}
 if(show){const look=(catwalk?.looks||[]).find(l=>l.id===show.dataset.boardShow);if(look)void openBoardPicker([boardShow(look)]);return;}
 if(event.target.closest('#board-add-selection'))void openBoardPicker(products.filter(p=>selected.has(p.id)).map(boardProduct));
 if(event.target.closest('#board-add-catwalk-selection'))void openBoardPicker((catwalk?.looks||[]).filter(l=>catwalkPicked.has(l.id)).map(boardShow));
});
