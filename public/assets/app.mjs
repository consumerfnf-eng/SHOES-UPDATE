import { EXPORT_COLUMNS, exportRows, csvBytes, xlsxBytes } from './export.mjs';
import { groupedBrands } from './brand-groups.mjs';
import { analysisCsv, analysisRows, priceDistribution, materialDistribution, colourDistribution,
         priceKrw, priceBand, colourFamily, materialsOf, RATE_NOTE,categoryDistribution} from './analysis.mjs';
import {isPublishedFootwear} from './footwear-policy.mjs';
import { hasVisual, productImageUrl, kstToday, releaseState, releaseDateLabel, safeUrl, filterProducts, keywordProductIds, sourceContext, trendKeywords, reviewedProductPageUrl, officialImageUrl, visibleSocialMetrics, sourceMatches, productBrandNames, socialComparisonGroups, groupProductVariants, preferWomenVariants, variantGroupKey, variantGroupName, variantColorLabel, uniqueColorVariants, colorSwatch, isOverlay, overlayKind, overlayReleaseState, overlayWindowDay, retailerId, trendTerms, trendTermGroups, trendKeywordMatches } from './catalog-view.mjs';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceNames = {magazine:'매거진',newsletter:'뉴스레터',media:'매거진·뉴스레터',sns:'SNS',ecommerce:'이커머스 랭킹',brand:'브랜드'};
const productTypeNames = {sneaker:'스니커즈',clog:'여름 클로그',sandal:'캐주얼 샌들','platform-sandal':'플랫폼 샌들','platform-shoe':'플랫폼 슈즈',jelly:'젤리 슈즈',hybrid:'혼합형 스니커즈'};
const mandatory = ['Louis Vuitton','Miu Miu','Prada','Gucci','Dior','Balenciaga','Celine','Saint Laurent','Hermès','Moncler','Bottega Veneta','Loewe','On','Cecilie Bahnsen','ASICS','FILA','Mizuno','New Balance','Salomon','adidas','Nike','PUMA','Axel Arigato','PANE','Onitsuka Tiger'];
const PAGE_SIZE = 40;
const state = {freshOnly:false,savedOnly:false,search:'',brands:new Set(),category:'all',source:'all',release:'released',sort:'newest',socialGroup:'',retailer:'all',trendTerms:null,trendHashtag:'',page:1,keywordIds:null,keywordLabel:'',keywordId:''};
const RETAILER_TABS = [['all','전체'],['retail-29cm','29CM'],['retail-ssense','SSENSE'],['retail-musinsa','무신사'],['retail-wconcept','W컨셉'],['retail-lyst','Lyst'],['retail-farfetch','Farfetch'],['retail-mytheresa','Mytheresa'],['retail-netaporter','Net-a-Porter']];
const OVERLAY_SOURCE_LABELS = {'retail-ssense':'SSENSE','retail-musinsa':'무신사','retail-29cm':'29CM','retail-wconcept':'W컨셉','retail-lyst':'Lyst','retail-farfetch':'Farfetch','retail-mytheresa':'Mytheresa','retail-netaporter':'Net-a-Porter'};
let catalog = null, overlay = null, trends = null, products = [], filtered = [], visible = [], selected = new Set(), today = kstToday(), brandCounts = new Map(), toastTimer, activeDetailId, groupCount = 0;
const activeVariant = new Map();
function groupKey(p){ return variantGroupKey(p); }
function colorGroupOf(p){
  const key=groupKey(p);
  const published=v=>isOverlay(v)?!!overlayReleaseState(v,today):releaseState(v,today)==='released';
  return products.filter(v=>groupKey(v)===key&&published(v)&&sourceMatches(v,state.source,today));
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
    const label = variantColorLabel(p) || `색상명 미확인 · ${p.style || p.id}`;
    return `<button type="button" class="color-chip ${p.id===activeId?'active':''}" data-variant="${esc(p.id)}" aria-pressed="${p.id===activeId}" aria-label="${esc(label)} 색상 선택" title="${esc(label)}"><span class="swatch-fill" style="background:${esc(swatch)}"></span></button>`;
  }).join('')}</div><p class="selected-color" aria-live="polite">${esc(variantColorLabel(active)||'색상명 미확인')}</p>`;
}

function outboundUrl(p){ return isOverlay(p)?safeUrl(p.url):reviewedProductPageUrl(p,today); }
function overlayDateLabel(p){
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
function imageMarkup(p, eager = false) {
  const cached=p.presentation?.cachedPath;
  const url = /^\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(cached||'')?cached:safeUrl(p.presentation?.image) || officialImageUrl(p,today) || safeUrl(p.image);
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
    presentation: {image: item.image || ''},
  };
}

function overlayProducts() {
  if (!overlay) return [];
  const sources = overlay.sources || {};
  return [...(overlay.retail || []), ...(overlay.newsletter || [])]
    .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.brand === 'string')
    .map(item => adaptOverlay(item, sources))
    .filter(item => isPublishedFootwear(item) && overlayReleaseState(item, today));
}

function rebuildProducts() {
  const eligible = catalog.products.filter(p => p && isPublishedFootwear(p) && releaseState(p,today)==='released' && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.brand === 'string');
  products = preferWomenVariants(eligible).map(p => ({...p,keywords:[...(p.keywords||[]),...[...catalog.keywords,...(catalog.forecastKeywords||[])].filter(k=>k.productIds?.includes(p.id)).flatMap(k=>[k.label,...(k.aliases||[])])]}));
  products = products.concat(overlayProducts());
  // Mark everything this week's trend keywords actually match, so the SNS tab
  // can show the real items behind a hashtag instead of only the hashtag.
  // How many of this week's trending hashtags name each item. One match puts
  // it on the SNS tab; the count is what orders it there, so the items the
  // most hashtags are talking about come first.
  const keywordTerms=(trends?.keywords||[]).map(k=>trendTermGroups(k)).filter(t=>t.length);
  if(keywordTerms.length)for(const p of products){
    const hits=keywordTerms.filter(terms=>trendKeywordMatches(p,terms)).length;
    if(hits){p.snsTrending=true;p.snsTrendMatches=hits;}
  }
  brandCounts = new Map();
  groupProductVariants(products).forEach(group => [...new Set(group.flatMap(p=>productBrandNames(p,today)))].forEach(brand=>brandCounts.set(brand,(brandCounts.get(brand)||0)+1)));
}
async function loadCatalog() {
  $('product-grid').setAttribute('aria-busy','true'); $('product-grid').innerHTML = Array.from({length:8}, () => '<div class="skeleton" aria-hidden="true"></div>').join('');
  $('empty-state').hidden = true;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('./data/catalog.json', {signal:controller.signal,cache:'no-cache'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    if (value.schemaVersion !== 1 || !Array.isArray(value.products) || !Array.isArray(value.brands) || !Array.isArray(value.keywords)) throw new Error('Invalid snapshot');
    catalog = value;
    // The overlay is additive: if it fails to load the official catalog still
    // renders, which is the whole reason it is a separate file.
    try {
      const extra = await fetch('./data/monthly-catalog.json', {cache:'no-cache'});
      if (extra.ok) {
        const snapshot = await extra.json();
        if (snapshot.schemaVersion === 2 && Array.isArray(snapshot.retail)) overlay = snapshot;
      }
    } catch { overlay = null; }
    try {
      const ranking = await fetch('./data/trend-keywords.json', {cache:'no-cache'});
      if (ranking.ok) {
        const snapshot = await ranking.json();
        if (snapshot.schemaVersion === 1 && Array.isArray(snapshot.keywords)) trends = snapshot;
      }
    } catch { trends = null; }
    // This view is the sneaker reference set. Other footwear records remain in
    // the internal snapshot/archive but never enter the public product grid.
    rebuildProducts();
    const collection = value.sourceStatus?.lastSuccessfulCollectionAt;
    $('update-label').textContent = collection ? `${dateText(collection, true)} 신상품 확인` : value.publishedAt ? `${dateText(value.publishedAt, true)} 게시` : '첫 검증 완료본 게시 대기';
    const unavailable = value.sourceStatus?.unavailableBrands || [];
    const notice = [];
    if(value.sourceStatus?.selectionBasis==='official-new-arrivals'&&value.sourceStatus?.catalogExhaustive===false)notice.push('공식 New·New Arrivals에서 상품과 사진을 확인한 항목을 표시합니다. 일부 브랜드와 다음 페이지는 추가 확인이 필요합니다.');
    if (!products.length) notice.push('공식 New·New Arrivals·품목·상품 정보를 확인한 신상품을 준비하고 있습니다. 기존 기록은 보존되며, 검증을 마친 상품부터 게시됩니다.');
    const recheck=value.sourceStatus?.discoveryRecheck;
    if(recheck){const remaining=recheck.brands.filter(b=>b.status==='unavailable').map(b=>b.brand);notice.push(`${dateText(recheck.checkedAt)} 수집 경로 재확인: ${recheck.brands.length-remaining.length}/${recheck.brands.length}개 브랜드의 공개 페이지를 읽었습니다. ${remaining.length?`자동 수집 재확인 필요: ${remaining.join(', ')}. `:''}공식 신상품 여부와 사진 검증을 마친 상품만 표시합니다.`);}
    else if (unavailable.length) notice.push(`최근 전체 수집에서 ${unavailable.length}개 브랜드의 신상품 목록을 읽지 못했습니다. 검색 인증·수집 경로·사이트 응답 문제를 포함하며, 기존에 확인한 공식 상품은 표시합니다.`);
    $('catalog-notice').textContent = notice.join(' '); $('catalog-notice').className = 'notice'; $('catalog-notice').hidden = !notice.length;
    renderBrands(); renderKeywords(); render();
  } catch (error) {
    $('product-grid').innerHTML = ''; $('result-count').textContent = '—'; $('empty-state').hidden = false;
    $('empty-title').textContent = '게시된 정보를 불러오지 못했습니다';
    $('empty-description').textContent = '연결 상태를 확인하고 다시 시도해 주세요. 수집 중인 상품은 표시하지 않습니다.';
    $('empty-reset').textContent = '다시 불러오기'; $('empty-reset').dataset.retry = 'true';
    $('update-label').textContent = '게시 정보 확인 불가';
  } finally { clearTimeout(timeout); $('product-grid').setAttribute('aria-busy','false'); }
}

function renderBrands() {
  const brands = [...(catalog?.brands || [])];
  const normalized = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  for (const name of mandatory) if (!brands.some(b => normalized(b.name) === normalized(name))) brands.push({name,mandatory:true,group:'',policy:'mandatory'});
  const search = $('brand-search').value.toLocaleLowerCase();
  const groups = groupedBrands(brands.filter(b => b.name.toLocaleLowerCase().includes(search)));
  $('brand-list').innerHTML = groups.filter(g=>g.brands.length).map(group => `<section class="brand-group" aria-label="${group.name}"><h3 class="brand-group-label">${group.name}</h3>${group.brands.map(b =>
    `<label class="brand-option"><input type="checkbox" data-brand="${esc(b.name)}" ${state.brands.has(b.name)?'checked':''}><span class="brand-name">${esc(b.name)}</span><span class="brand-count">${brandCounts.get(b.name)||0}</span></label>`
  ).join('')}</section>`).join('') || '<p class="muted">일치하는 브랜드가 없습니다.</p>';
  $('brand-list').querySelectorAll('input').forEach(input => input.addEventListener('change', () => { input.checked ? state.brands.add(input.dataset.brand) : state.brands.delete(input.dataset.brand); state.page=1; render(); }));
}
const ECOMMERCE_PLATFORMS=new Set(['musinsa','29cm','eql','wconcept']);
function renderKeywords() {
  const snapshot=catalog?.styleTrendKeywords;
  const keywords=snapshot?.items||trendKeywords(catalog?.keywords||[]);
  function renderList(target,list) {
    $(target).innerHTML=list.length?list.map((k,i)=>{
      const ids=keywordProductIds(k,products,today),matched=groupProductVariants(products.filter(p=>ids.has(p.id))).length;
      return `<article class="keyword search-keyword trend-row ${state.keywordId===k.id?'active':''}"><button class="keyword-select" data-keyword="${i}" aria-pressed="${state.keywordId===k.id}" aria-label="${esc(k.label)} ${esc(k.englishLabel||'')} 관련 상품 ${matched}개"><span class="rank" aria-label="종합순 ${i+1}">${String(i+1).padStart(2,'0')}</span><span class="keyword-copy"><span class="keyword-name">#${esc(k.label)}</span><span class="keyword-evidence">${esc(k.englishLabel||'')}</span></span><span class="count"><strong>${matched}</strong><span>상품</span></span></button></article>`;
    }).join(''):'<p class="keyword-empty">확인된 Shoes Trend Keyword가 아직 없습니다.</p>';
    $(target).querySelectorAll('.keyword-select').forEach(button=>button.addEventListener('click',()=>{
      const k=list[Number(button.dataset.keyword)];clearTimeout(searchTimer);
      Object.assign(state,{search:'',brands:new Set(),category:'all',source:'all',release:'released',socialGroup:'',sort:'newest',retailer:'all',trendTerms:null,trendHashtag:'',page:1,keywordId:k.id,keywordLabel:k.label,keywordIds:keywordProductIds(k,products,today)});
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
function downloadText(name, text, type='text/csv;charset=utf-8'){
  const blob=new Blob([text],{type}), url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);
  a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
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
function renderAnalysis(){
  const section=$('analysis');
  if(!section)return;
  const on=state.source==='analysis';
  section.hidden=!on;
  // The grid's own chrome - count, sort, page selection, pagination -
  // belongs to the grid, not to a distribution.
  for(const sel of ['#product-grid','.results-bar','.selection-row','#pagination','#selection-bar','#empty-state'])
    document.querySelector(sel)?.classList.toggle('hidden-by-analysis',on);
  if(!on)return;
  const rows=analysisScope();
  $('analysis-scope').textContent=`현재 필터 기준 ${rows.length.toLocaleString()}개 상품 · ${RATE_NOTE}`;

  const category=categoryDistribution(rows);
  document.querySelector('#panel-category .panel-body').innerHTML=
    category.rows.map(r=>bar(r.name,r.count,category.placed)).join('')||'<p class="muted">분류된 상품이 없습니다.</p>';
  document.querySelector('#panel-category .panel-note').textContent=
    `상점이 적어 둔 분류와 상품명에서 읽은 ${category.placed.toLocaleString()}건 기준 · `
    +`이름만으로는 종류를 알 수 없는 ${category.unplaced.toLocaleString()}건은 제외했습니다`;

  const price=priceDistribution(rows);
  document.querySelector('#panel-price .panel-body').innerHTML=
    price.bands.map(b=>bar(b.label,b.count,price.priced)).join('')||'<p class="muted">가격 정보가 없습니다.</p>';
  document.querySelector('#panel-price .panel-note').textContent=
    `가격 확인 ${price.priced.toLocaleString()}건 · 미기재 ${price.missing.toLocaleString()}건`;

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

  const top=price.groups.slice(0,14);
  const widest=Math.max(1,...top.map(g=>g.high));
  document.querySelector('#panel-brand .panel-body').innerHTML=top.length?
    `<table class="dist-table"><tr><th>브랜드</th><th>건수</th><th>최저</th><th>중앙값</th><th>최고</th><th></th></tr>`
    +top.map(g=>`<tr><td>${esc(g.name)}</td><td class="n">${g.count}</td>`
      +`<td class="n">${Math.round(g.low/10000).toLocaleString()}만</td>`
      +`<td class="n"><b>${Math.round(g.median/10000).toLocaleString()}만</b></td>`
      +`<td class="n">${Math.round(g.high/10000).toLocaleString()}만</td>`
      +`<td><span class="range-track"><span class="range-fill" style="left:${g.low/widest*100}%;width:${Math.max(2,(g.high-g.low)/widest*100)}%"></span>`
      +`<span class="range-dot" style="left:${g.median/widest*100}%"></span></span></td></tr>`).join('')
    +'</table>':'<p class="muted">가격 정보가 없습니다.</p>';
  document.querySelector('#panel-brand .panel-note').textContent='막대는 최저~최고, 점은 중앙값입니다.';
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
  renderSocialGroups();
  renderAnalysis();
  if(state.source==='analysis')return;
  filtered = filterProducts(products,{...state,isFresh,isSaved},today);
  if(state.source==='sns'&&state.sort==='newest')
    filtered=[...filtered].sort((a,b)=>(b.snsTrendMatches||0)-(a.snsTrendMatches||0));
  const groups = groupProductVariants(filtered);
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
    return `<article class="product-card ${selected.has(p.id)?'selected':''}" data-id="${esc(p.id)}" data-group="${esc(groupKey(p))}"><div class="card-visual"><label class="card-checkbox"><input type="checkbox" data-select="${esc(p.id)}" aria-label="${esc(p.brand+' '+p.name)} 선택" ${selected.has(p.id)?'checked':''}></label><button class="card-save ${isSaved(p)?'on':''}" data-save="${esc(p.id)}" aria-pressed="${isSaved(p)}" aria-label="${esc(p.name)} 저장"${isSaved(p)?' title="저장함에 있음"':''}>★</button><button class="card-open" data-detail="${esc(p.id)}" aria-label="${esc(p.brand+' '+p.name)} 상세정보">${imageMarkup(p,i<4)}</button>${release==='upcoming'?'<span class="release-badge upcoming">발매 예정</span>':''}</div><div class="card-copy"><p class="card-brand">${brandLine}</p><button class="card-name" data-detail="${esc(p.id)}">${esc(variantGroupName(p))}</button><div class="card-meta">${meta}</div>${colorChipsMarkup(group,p.id)}</div><div class="card-footer">${link}</div></article>`;
  }).join('');
  bindImageErrors($('product-grid'));
  $('product-grid').querySelectorAll('[data-detail]').forEach(button=>button.addEventListener('click',()=>openDetail(button.dataset.detail)));
  $('product-grid').querySelectorAll('[data-select]').forEach(input=>input.addEventListener('change',()=>toggleSelection(input.dataset.select,input.checked)));
  $('product-grid').querySelectorAll('[data-save]').forEach(button=>button.addEventListener('click',()=>{
    const p=products.find(x=>x.id===button.dataset.save);toggleSaved(button.dataset.save,p?variantGroupName(p):'');}));
  $('product-grid').querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{activeVariant.set(button.closest('.product-card').dataset.group,button.dataset.variant);render();}));
  $('empty-state').hidden = filtered.length>0;
  $('empty-reset').textContent='필터 초기화'; delete $('empty-reset').dataset.retry;
  if (!filtered.length) {
    $('empty-title').textContent = state.source==='sns'?'공개 SNS 지표를 확인한 상품이 없습니다':state.source==='brand'?'공식 정보 확인을 마친 출시 상품이 없습니다':state.source==='retail'?'조건에 맞는 리테일 신상이 없습니다':state.source==='newsletter'?'조건에 맞는 뉴스레터 신상이 없습니다':state.source==='all' ? '조건에 맞는 상품이 없습니다' : `${sourceNames[state.source]} 선정 기준을 충족한 상품이 없습니다`;
    $('empty-description').textContent = state.source==='retail' ? '리테일러가 밝힌 등록일 기준 최근 3개월 상품만 표시합니다. 리테일러·품목·브랜드 필터를 줄여 보세요.' : state.source==='newsletter' ? '최근 3개월 기사 중 브랜드가 확인된 신상 신발만 표시합니다. 필터를 줄여 보세요.' : state.source==='sns' ? '최근 3개월에 확인한 검색량·해시태그 게시물 수와 공식 상품 정보를 갖춘 상품부터 표시합니다. 공개되지 않은 수치는 미공개로 구분합니다.' : state.source==='media' ? '매거진·뉴스레터를 합쳐 최근 30일 이내 독립된 출처 2곳 이상이 직접 소개한 상품을 보여줍니다.' : state.source==='ecommerce' ? '국가·카테고리·확인일이 있는 실제 랭킹의 상품이 필요합니다.' : state.source==='brand'?'브랜드 탭에는 공식 상품 페이지와 공식 이미지를 확인한 공식 신상품 · 게시 후 3개월 상품만 표시합니다.':'필터를 줄여 보세요. 공식 New·New Arrivals 근거가 없거나 게시 후 3개월이 지난 상품은 표시하지 않습니다.';
  }
  $('page-range').textContent = groups.length ? `${(state.page-1)*PAGE_SIZE+1}–${Math.min(state.page*PAGE_SIZE,groups.length)} / ${groups.length.toLocaleString()}` : '0개 상품';
  $('mobile-brand-count').textContent=state.brands.size?String(state.brands.size):'';
  renderRetailers(); renderTrendKeywords(); renderSourceNote(); renderChips(); renderPagination(); updateSelection();
}
function renderSourceDescription() {
  if (state.source === 'all') {
    const narrowed=state.brands.size||state.category!=='all'||state.search||state.release!=='all';
    $('result-description').textContent=state.keywordLabel?`${state.keywordLabel} ${narrowed?'관련 상품 · 선택한 필터 적용':'전체 상품 · 공식 신상품 · 게시 후 3개월'}`:'공식 New·New Arrivals와 품목을 확인한 상품입니다.';
    return;
  }
  if(state.source==='brand'){
    $('result-description').textContent='공식 상품 페이지와 공식 이미지를 확인한 공식 신상품 · 게시 후 3개월 상품입니다. 브랜드 필터로 원하는 브랜드를 고를 수 있습니다.';
    return;
  }
  if(state.source==='retail'||state.source==='newsletter'){
    const kind=state.source;
    const rows=products.filter(p=>isOverlay(p)&&overlayKind(p)===kind&&overlayReleaseState(p,today));
    const labels=[...new Set(rows.map(sourceLabelOf).filter(Boolean))].sort();
    $('result-description').innerHTML=labels.length
      ?`확인된 출처: ${labels.map(esc).join(' · ')}<span class="source-context">${kind==='retail'?'리테일러가 밝힌 등록일 기준 최근 3개월 상품입니다. 개별 상품 페이지는 카드를 눌러 확인하세요.':'기사에서 브랜드가 확인된 신상 신발입니다. 원문은 카드를 눌러 확인하세요.'}</span>`
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
  retail:'SSENSE·Farfetch·Mytheresa·Net-a-Porter·Lyst·무신사·29CM·W컨셉에서 매주 수집합니다. 각 리테일러가 밝힌 등록일 기준 최근 3개월 상품만 표시하고, 날짜를 제공하지 않는 곳은 지난 확인 대비 새로 등장한 상품만 올립니다. 최신순으로 정렬됩니다.',
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
    ? `<a class="detail-photo-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)} 페이지로 이동">${imageMarkup(p,true)}<span class="detail-photo-hint">사진을 누르면 ${esc(label)} 페이지로 이동 ↗</span></a>`
    : imageMarkup(p,true);
  const types=(p.footwearTypes||['sneaker']).map(t=>productTypeNames[{'ballet-sneaker':'hybrid','mary-jane-sneaker':'hybrid','mule-sneaker':'hybrid',platform:'platform-shoe'}[t]||t]||t).join(' · ');
  const mentions=p.popularity?.mediaMentions||[];
  const rows=[
    ['품목',esc(types||'스니커즈')],
    ['컬러',esc(variantColorLabel(p)||'색상명 미확인')],
    ['소재',esc(p.material||'리테일러 미표기 · 상품 페이지에서 확인')],
    ...(p.countryOrigin?[['제조국',esc(p.countryOrigin)]]:[]),
    [kind==='newsletter'?'기사 출처':'판매처',esc(label)],
    ['스타일 코드',esc(p.style||'미확인')],
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
    <div class="detail-actions">${url?`<a class="primary-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}에서 보기 ↗</a>`:''}<button id="detail-select" class="secondary-button" aria-pressed="${selected.has(id)}">${selected.has(id)?'선택 해제':'상품 선택'}</button></div>
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
  const data=[...(p.arrivalEvidence?[['신상품 근거',`<a href="${esc(safeUrl(p.arrivalEvidence.url))}" target="_blank" rel="noopener noreferrer">공식 New·New Arrivals ↗</a> · ${esc(dateText(p.arrivalEvidence.verifiedAt,true))} 확인`]]:[]),...(p.firstPublishedAt?[['사이트 최초 게시',esc(dateText(p.firstPublishedAt,true))]]:[]),['출시일',`${esc(p.releaseDate?dateText(p.releaseDate):'미공개')}${releaseState(p,today)==='upcoming'?' (예정)':''}${p.dateEvidence?.region?` · ${esc(p.dateEvidence.region)}`:''}${evidence?`<br><a href="${esc(evidence)}" target="_blank" rel="noopener noreferrer">출시일 근거 ↗</a>`:''}`],['품목',esc(productTypeNames[p.productType||p.category]||p.productType||p.category||'미확인')],[p.styleType==='official-product-id'?'상품 ID':'스타일 코드',esc(p.style||'미확인')],['컬러웨이',esc(p.colorway||(p.colors||[]).map(c=>typeof c==='string'?c:c.name).filter(Boolean).join(', ')||'미확인')],['소재',esc(p.material||'미확인')],['가격',esc(p.priceLabel||'공식 상품에서 확인')],['마지막 검증',esc(dateText(p.lastVerifiedAt||p.verifiedAt||p.dateEvidence?.verifiedAt,true))]];
  $('detail-content').innerHTML=`<div class="detail-visual">${imageMarkup(p,true)}</div><p class="card-brand">${esc(p.brand)}</p><h2 id="detail-title">${esc(variantGroupName(p))}</h2>${colorChipsMarkup(group,p.id)}<div class="detail-actions">${url?`<a class="primary-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">공식 상품 보기 ↗</a>`:''}<button id="detail-select" class="secondary-button" aria-pressed="${selected.has(id)}">${selected.has(id)?'선택 해제':'상품 선택'}</button><button id="detail-save" class="secondary-button" aria-pressed="${isSaved(p)}">${isSaved(p)?'★ 저장됨':'☆ 저장'}</button></div><div class="memo-box"><label for="detail-memo">메모</label><textarea id="detail-memo" rows="2" placeholder="${isSaved(p)?'이 상품에 대한 메모를 남겨 두세요':'저장하면 메모를 남길 수 있습니다'}" ${isSaved(p)?'':'disabled'}>${esc(saved[id]?.memo||'')}</textarea></div><dl class="detail-data">${data.map(([label,value])=>`<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl><h3>기획 참고 요소</h3>${p.fitReasons?.length?`<ul class="reasons">${p.fitReasons.map(reason=>`<li>${esc(typeof reason==='string'?reason:reason.text||reason.reason||'')}</li>`).join('')}</ul>`:'<p class="muted">확인된 선정 이유가 아직 없습니다.</p>'}<h3>출처와 검증 근거</h3>${signals.length?signals.map(s=>`<div class="evidence"><span class="source-badge">${esc(sourceNames[s.type]||s.type)}${s.sponsored?' · 광고/협찬':''}</span><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title||s.account||'원문 확인')} ↗</a><p>${s.account?esc(s.account)+' · ':''}${s.rank?'순위 '+esc(s.rank)+' · ':''}${s.country?esc(s.country)+' · ':''}${s.rankingCategory||s.category?esc(s.rankingCategory||s.category)+' · ':''}${s.publishedAt?(s.type==='ecommerce'?(s.dateBasis==='platform-updated-at'?'순위 집계일 ':'순위 확인일 '):'발행 ')+esc(dateText(s.publishedAt))+' · ':''}확인 ${esc(dateText(s.checkedAt))}</p>${s.rankingPeriod||s.rankingDefinition?`<p class="ranking-context">${s.rankingPeriod?'집계 기간: '+esc(s.rankingPeriod)+' · ':''}${s.rankingDefinition?esc(s.rankingDefinition):''}</p>`:''}</div>`).join(''):'<p class="muted">확인 가능한 공식 상품·출시·이미지 근거가 아직 없습니다.</p>'}`;
  bindImageErrors($('detail-content'));$('detail-select').addEventListener('click',()=>toggleSelection(id,!selected.has(id)));
  $('detail-content').querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{openDetail(button.dataset.variant);render();}));
  if(!$('detail-dialog').open)$('detail-dialog').showModal();
}
function syncFilterControls() {
  $('search').value=state.search;$('brand-search').value='';$('category-filter').value=state.category;$('release-filter').value=state.release;$('sort').value=state.sort;
  document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b.dataset.source===state.source);b.setAttribute('aria-pressed',String(b.dataset.source===state.source));});
}
function resetFilters() {
  clearTimeout(searchTimer);
  Object.assign(state,{search:'',brands:new Set(),category:'all',source:'all',release:'released',sort:'newest',socialGroup:'',retailer:'all',trendTerms:null,trendHashtag:'',page:1,keywordIds:null,keywordLabel:'',keywordId:''});
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
$('dl-analysis-all')?.addEventListener('click',()=>downloadText(`shoes-analysis-${today}.csv`,analysisCsv(analysisScope(),'all')));
$('dl-analysis-xlsx')?.addEventListener('click',()=>{
  downloadText(`shoes-analysis-${today}.xlsx`,xlsxBytes(analysisRows(analysisScope(),'all').map(r=>r.map(String))),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
document.querySelectorAll('[data-dl]').forEach(button=>button.addEventListener('click',()=>
  downloadText(`shoes-${button.dataset.dl}-${today}.csv`,analysisCsv(analysisScope(),button.dataset.dl))));
for(const [id,key] of [['category-filter','category'],['release-filter','release'],['sort','sort']])$(id).addEventListener('change',()=>{state[key]=$(id).value;state.page=1;render();});
document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>{state.source=button.dataset.source;state.page=1;if(state.source!=='retail')state.retailer='all';if(state.source!=='sns'){state.trendHashtag='';state.trendTerms=null;}state.socialGroup=state.source==='sns'?(socialComparisonGroups(products,today)[0]?.key||''):'';if(state.socialGroup)state.sort='social';else if(state.sort==='social')state.sort='newest';if(state.source==='brand'){state.release='released';$('release-filter').value='released';}document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));
$('social-group').addEventListener('change',()=>{state.socialGroup=$('social-group').value;state.sort=state.socialGroup?'social':'newest';state.page=1;render();});
$('reset-filters').addEventListener('click',resetFilters);$('empty-reset').addEventListener('click',()=> $('empty-reset').dataset.retry?loadCatalog():resetFilters());
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
function refreshDate() { if(!catalog)return;const next=kstToday();if(next===today){renderKeywords();return;}today=next;rebuildProducts();selected=new Set([...selected].filter(id=>products.some(p=>p.id===id)));renderBrands();renderKeywords();render();if($('detail-dialog').open&&!products.some(p=>p.id===activeDetailId))$('detail-dialog').close(); }
setInterval(refreshDate,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDate();});
renderBrands();loadCatalog();
