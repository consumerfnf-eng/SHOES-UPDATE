import { EXPORT_COLUMNS, exportRows, csvBytes, xlsxBytes } from './export.mjs';
import { groupedBrands } from './brand-groups.mjs';
import { kstToday, releaseState, releaseDateLabel, safeUrl, filterProducts, keywordProductIds, sourceContext, trendKeywords, officialProductUrl, officialImageUrl, visibleSocialMetrics, sourceMatches, productBrandNames, socialComparisonGroups, groupProductVariants, variantGroupKey, colorSwatch } from './catalog-view.mjs';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceNames = {magazine:'매거진',newsletter:'뉴스레터',media:'매거진·뉴스레터',sns:'SNS',ecommerce:'이커머스 랭킹',brand:'브랜드'};
const productTypeNames = {sneaker:'스니커즈',clog:'여름 클로그',sandal:'캐주얼 샌들','platform-sandal':'플랫폼 샌들',hybrid:'혼합형 스니커즈'};
const mandatory = ['Louis Vuitton','Miu Miu','Prada','Gucci','Dior','Balenciaga','Celine','Saint Laurent','Hermès','Moncler','Bottega Veneta','Loewe','On','Cecilie Bahnsen','ASICS','FILA','Mizuno','New Balance','Salomon','adidas','Nike','PUMA','Axel Arigato','PANE','Onitsuka Tiger'];
const PAGE_SIZE = 40;
const state = {search:'',brands:new Set(),fit:'all',category:'all',source:'all',release:'released',sort:'newest',socialGroup:'',page:1,keywordIds:null,keywordLabel:'',keywordId:''};
let catalog = null, products = [], filtered = [], visible = [], selected = new Set(), today = kstToday(), brandCounts = new Map(), toastTimer, activeDetailId, groupCount = 0;
const activeVariant = new Map();
function groupKey(p){ return variantGroupKey(p); }
function activeOf(group){
  const chosen = activeVariant.get(groupKey(group[0]));
  return group.find(p=>p.id===chosen) || group[0];
}
function colorChipsMarkup(group, activeId){
  if(group.length<2) return '';
  return `<div class="color-chips" role="group" aria-label="색상 선택">${group.map(p=>{
    const swatch = colorSwatch(p);
    const label = p.colorway || `색상 ${p.style || p.id}`;
    return `<button type="button" class="color-chip ${p.id===activeId?'active':''}" data-variant="${esc(p.id)}" aria-pressed="${p.id===activeId}" aria-label="${esc(label)} 색상 선택" title="${esc(label)}"><span class="swatch-fill" style="background:${esc(swatch)}"></span></button>`;
  }).join('')}</div>`;
}

function dateText(value, time = false) {
  if (!value) return '미확인';
  if(/^\d{4}-\d{2}$/.test(value)){const [year,month]=value.split('-');return `${year}년 ${Number(month)}월 (일자 미공개)`;}
  const date = new Date(value.length === 10 ? value + 'T00:00:00+09:00' : value);
  if (!Number.isFinite(date.getTime())) return '미확인';
  return new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',...(time ? {hour:'2-digit',minute:'2-digit',hour12:false} : {})}).format(date);
}
function popup(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function fitBadges(p) { return (p.fit || []).map(f => `<span class="fit-badge ${f === 'DISCOVERY' ? 'discovery' : ''}">${esc(f)}</span>`).join(''); }
function imageMarkup(p, eager = false) {
  const cached=p.presentation?.cachedPath;
  const url = /^\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(cached||'')?cached:safeUrl(p.presentation?.image) || officialImageUrl(p,today) || safeUrl(p.image);
  return url ? `<img style="transform:translateY(${Math.max(-20,Math.min(20,Number(p.presentation?.offsetY)||0))}%) scale(${Math.min(2.7,Math.max(1,Number(p.presentation?.scale)||1))})" src="${esc(url)}" alt="${esc(p.brand + ' ' + p.name)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">` : '<span class="image-missing">공식 이미지 확인 중</span>';
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
    // This view is the sneaker reference set. Other footwear records remain in
    // the internal snapshot/archive but never enter the public product grid.
    products = value.products.filter(p => p && p.category === 'sneaker' && releaseState(p,today)==='released' && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.brand === 'string').map(p => ({...p,keywords:[...(p.keywords||[]),...[...value.keywords,...(value.forecastKeywords||[])].filter(k=>k.productIds?.includes(p.id)).flatMap(k=>[k.label,...(k.aliases||[])])]}));
    const collection = value.sourceStatus?.lastSuccessfulCollectionAt;
    $('update-label').textContent = collection ? `${dateText(collection, true)} 수집 완료` : value.publishedAt ? `${dateText(value.publishedAt, true)} 게시` : '첫 검증 완료본 게시 대기';
    const unavailable = value.sourceStatus?.unavailableBrands || [];
    const notice = [];
    if (!products.length) notice.push('출시일·품목·공식 상품 정보를 확인한 신상품을 준비하고 있습니다. 기존 기록은 보존되며, 검증을 마친 상품부터 게시됩니다.');
    const recheck=value.sourceStatus?.discoveryRecheck;
    if(recheck){const remaining=recheck.brands.filter(b=>b.status==='unavailable').map(b=>b.brand);notice.push(`${dateText(recheck.checkedAt)} 수집 경로 재확인: ${recheck.brands.length-remaining.length}/${recheck.brands.length}개 브랜드의 공개 페이지를 읽었습니다. ${remaining.length?`자동 수집 재확인 필요: ${remaining.join(', ')}. `:''}출시일과 사진 검증을 마친 상품만 표시합니다.`);}
    else if (unavailable.length) notice.push(`최근 전체 수집에서 ${unavailable.length}개 브랜드의 신상품 목록을 읽지 못했습니다. 검색 인증·수집 경로·사이트 응답 문제를 포함하며, 기존에 출시일을 확인한 상품은 표시합니다.`);
    $('catalog-notice').textContent = notice.join(' '); $('catalog-notice').className = 'notice'; $('catalog-notice').hidden = !notice.length;
    brandCounts = new Map(); groupProductVariants(products.filter(p => releaseState(p,today)==='released')).forEach(group => [...new Set(group.flatMap(p=>productBrandNames(p,today)))].forEach(brand=>brandCounts.set(brand,(brandCounts.get(brand)||0)+1)));
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
      const aliases=[...new Set((k.aliases||[]).filter(a=>a!==k.label&&a!==k.englishLabel))].slice(0,4).join(' · ');
      return `<article class="keyword search-keyword ${state.keywordId===k.id?'active':''}"><button class="keyword-select" data-keyword="${i}" aria-pressed="${state.keywordId===k.id}" aria-label="${esc(k.label)} ${esc(k.englishLabel||'')} 관련 상품 ${matched}개"><span class="rank" aria-label="키워드 ${i+1}">${esc(k.rank)}</span><span class="keyword-copy"><span class="keyword-name">${esc(k.label)}</span><span class="keyword-evidence">${esc(k.englishLabel||'')}</span></span><span class="count"><strong>${matched}</strong><span>상품</span></span></button>${aliases?`<p class="keyword-originals">동의어: ${esc(aliases)}</p>`:''}</article>`;
    }).join(''):'<p class="keyword-empty">확인된 Shoes Trend Keyword가 아직 없습니다.</p>';
    $(target).querySelectorAll('.keyword-select').forEach(button=>button.addEventListener('click',()=>{
      const k=list[Number(button.dataset.keyword)];clearTimeout(searchTimer);
      Object.assign(state,{search:'',brands:new Set(),fit:'all',category:'all',source:'all',release:'released',socialGroup:'',sort:'newest',page:1,keywordId:k.id,keywordLabel:k.label,keywordIds:keywordProductIds(k,products,today)});
      syncFilterControls();renderBrands();renderKeywords();render();$('results').scrollIntoView({block:'start'});$('results').focus({preventScroll:true});
    }));
  }
  renderList('keyword-list',keywords);
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
function render() {
  if (!catalog) return;
  renderSocialGroups();
  filtered = filterProducts(products,state,today);
  const groups = groupProductVariants(filtered);
  groupCount = groups.length;
  state.page = Math.min(state.page,Math.max(1,Math.ceil(groups.length/PAGE_SIZE)));
  const pageGroups = groups.slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE);
  visible = pageGroups.map(activeOf);
  $('result-count').textContent = groups.length.toLocaleString();
  renderSourceDescription();
  $('product-grid').innerHTML = pageGroups.map((group,i) => {
    const p = activeOf(group), release = releaseState(p,today), url = officialProductUrl(p,today);
    return `<article class="product-card ${selected.has(p.id)?'selected':''}" data-id="${esc(p.id)}" data-group="${esc(groupKey(p))}"><div class="card-visual"><label class="card-checkbox"><input type="checkbox" data-select="${esc(p.id)}" aria-label="${esc(p.brand+' '+p.name)} 선택" ${selected.has(p.id)?'checked':''}></label><button class="card-open" data-detail="${esc(p.id)}" aria-label="${esc(p.brand+' '+p.name)} 상세정보">${imageMarkup(p,i<4)}</button>${release==='upcoming'?'<span class="release-badge upcoming">발매 예정</span>':''}</div><div class="card-copy"><p class="card-brand">${esc(p.brand)}</p><button class="card-name" data-detail="${esc(p.id)}">${esc(p.name)}</button><div class="card-meta">${fitBadges(p)}<span>${esc(releaseDateLabel(p))}</span></div>${colorChipsMarkup(group,p.id)}</div><div class="card-footer">${url?`<a class="official-small" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(p.name)} 공식 상품 보기">공식 상품 ↗</a>`:''}</div></article>`;
  }).join('');
  bindImageErrors($('product-grid'));
  $('product-grid').querySelectorAll('[data-detail]').forEach(button=>button.addEventListener('click',()=>openDetail(button.dataset.detail)));
  $('product-grid').querySelectorAll('[data-select]').forEach(input=>input.addEventListener('change',()=>toggleSelection(input.dataset.select,input.checked)));
  $('product-grid').querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{activeVariant.set(button.closest('.product-card').dataset.group,button.dataset.variant);render();}));
  $('empty-state').hidden = filtered.length>0;
  $('empty-reset').textContent='필터 초기화'; delete $('empty-reset').dataset.retry;
  if (!filtered.length) {
    $('empty-title').textContent = state.source==='sns'?'공개 SNS 지표를 확인한 상품이 없습니다':state.source==='brand'?'공식 정보 확인을 마친 출시 상품이 없습니다':state.source==='all' ? '조건에 맞는 상품이 없습니다' : `${sourceNames[state.source]} 선정 기준을 충족한 상품이 없습니다`;
    $('empty-description').textContent = state.source==='sns' ? '최근 3개월에 확인한 검색량·해시태그 게시물 수와 공식 상품 정보를 갖춘 상품부터 표시합니다. 공개되지 않은 수치는 미공개로 구분합니다.' : state.source==='media' ? '매거진·뉴스레터를 합쳐 최근 30일 이내 독립된 출처 2곳 이상이 직접 소개한 상품을 보여줍니다.' : state.source==='ecommerce' ? '국가·카테고리·확인일이 있는 실제 랭킹의 상품이 필요합니다.' : state.source==='brand'?'브랜드 탭에는 공식 상품 페이지와 공식 이미지를 확인한 최근 3개월 출시 상품만 표시합니다.':'필터를 줄여 보세요. 출시일이 불명확하거나 3개월이 지난 상품은 최근 신상품에 포함하지 않습니다.';
  }
  $('page-range').textContent = groups.length ? `${(state.page-1)*PAGE_SIZE+1}–${Math.min(state.page*PAGE_SIZE,groups.length)} / ${groups.length.toLocaleString()}` : '0개 상품';
  $('mobile-brand-count').textContent=state.brands.size?String(state.brands.size):'';
  renderChips(); renderPagination(); updateSelection();
}
function renderSourceDescription() {
  if (state.source === 'all') {
    const narrowed=state.brands.size||state.fit!=='all'||state.category!=='all'||state.search||state.release!=='all';
    $('result-description').textContent=state.keywordLabel?`${state.keywordLabel} ${narrowed?'관련 상품 · 선택한 필터 적용':'전체 상품 · 최근 3개월 출시'}`:'출시일과 품목을 확인한 상품만 표시합니다.';
    return;
  }
  if(state.source==='brand'){
    $('result-description').textContent='공식 상품 페이지와 공식 이미지를 확인한 최근 3개월 출시 상품입니다. 브랜드 필터로 원하는 브랜드를 고를 수 있습니다.';
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
function renderChips() {
  $('active-filters').innerHTML = [...state.brands].map(name=>`<button class="filter-chip" data-remove-brand="${esc(name)}" aria-label="${esc(name)} 필터 해제">${esc(name)}<span aria-hidden="true">×</span></button>`).join('')+(state.keywordLabel?`<button class="filter-chip" id="remove-keyword" aria-label="키워드 필터 해제"># ${esc(state.keywordLabel)}<span aria-hidden="true">×</span></button>`:'');
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
}
function toggleSelection(id,checked) { checked?selected.add(id):selected.delete(id);updateSelection(); }
function openDetail(id) {
  const p=products.find(p=>p.id===id); if(!p)return;activeDetailId=id;
  const group=groupProductVariants(filtered).find(g=>g.some(v=>v.id===id))||[p];
  if(group.length>1)activeVariant.set(groupKey(p),id);
  const url=officialProductUrl(p,today), evidence=safeUrl(p.dateEvidence?.url);
  const signals=(p.sourceSignals||[]).filter(s=>safeUrl(s.url));
  const data=[['출시일',`${esc(dateText(p.releaseDate))}${releaseState(p,today)==='upcoming'?' (예정)':''}${p.dateEvidence?.region?` · ${esc(p.dateEvidence.region)}`:''}${evidence?`<br><a href="${esc(evidence)}" target="_blank" rel="noopener noreferrer">출시일 근거 ↗</a>`:''}`],['품목',esc(productTypeNames[p.productType||p.category]||p.productType||p.category||'미확인')],['스타일 코드',esc(p.style||'미확인')],['컬러웨이',esc(p.colorway||(p.colors||[]).map(c=>typeof c==='string'?c:c.name).filter(Boolean).join(', ')||'미확인')],['소재',esc(p.material||'미확인')],['가격',esc(p.priceLabel||'공식 상품에서 확인')],['마지막 검증',esc(dateText(p.lastVerifiedAt||p.verifiedAt||p.dateEvidence?.verifiedAt,true))]];
  $('detail-content').innerHTML=`<div class="detail-visual">${imageMarkup(p,true)}</div><p class="card-brand">${esc(p.brand)}</p><h2 id="detail-title">${esc(p.name)}</h2><div class="detail-summary">${fitBadges(p)}</div>${colorChipsMarkup(group,p.id)}<div class="detail-actions">${url?`<a class="primary-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">공식 상품 보기 ↗</a>`:''}<button id="detail-select" class="secondary-button" aria-pressed="${selected.has(id)}">${selected.has(id)?'선택 해제':'상품 선택'}</button></div><dl class="detail-data">${data.map(([label,value])=>`<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl><h3>기획 참고 요소</h3>${p.fitReasons?.length?`<ul class="reasons">${p.fitReasons.map(reason=>`<li>${esc(typeof reason==='string'?reason:reason.text||reason.reason||'')}</li>`).join('')}</ul>`:'<p class="muted">확인된 선정 이유가 아직 없습니다.</p>'}<h3>출처와 검증 근거</h3>${signals.length?signals.map(s=>`<div class="evidence"><span class="source-badge">${esc(sourceNames[s.type]||s.type)}${s.sponsored?' · 광고/협찬':''}</span><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title||s.account||'원문 확인')} ↗</a><p>${s.account?esc(s.account)+' · ':''}${s.rank?'순위 '+esc(s.rank)+' · ':''}${s.country?esc(s.country)+' · ':''}${s.rankingCategory||s.category?esc(s.rankingCategory||s.category)+' · ':''}${s.publishedAt?(s.type==='ecommerce'?(s.dateBasis==='platform-updated-at'?'순위 집계일 ':'순위 확인일 '):'발행 ')+esc(dateText(s.publishedAt))+' · ':''}확인 ${esc(dateText(s.checkedAt))}</p>${s.rankingPeriod||s.rankingDefinition?`<p class="ranking-context">${s.rankingPeriod?'집계 기간: '+esc(s.rankingPeriod)+' · ':''}${s.rankingDefinition?esc(s.rankingDefinition):''}</p>`:''}</div>`).join(''):'<p class="muted">확인 가능한 공식 상품·출시·이미지 근거가 아직 없습니다.</p>'}`;
  bindImageErrors($('detail-content'));$('detail-select').addEventListener('click',()=>toggleSelection(id,!selected.has(id)));
  $('detail-content').querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{openDetail(button.dataset.variant);render();}));
  if(!$('detail-dialog').open)$('detail-dialog').showModal();
}
function syncFilterControls() {
  $('search').value=state.search;$('brand-search').value='';$('fit-filter').value=state.fit;$('category-filter').value=state.category;$('release-filter').value=state.release;$('sort').value=state.sort;
  document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b.dataset.source===state.source);b.setAttribute('aria-pressed',String(b.dataset.source===state.source));});
}
function resetFilters() {
  clearTimeout(searchTimer);
  Object.assign(state,{search:'',brands:new Set(),fit:'all',category:'all',source:'all',release:'released',sort:'newest',socialGroup:'',page:1,keywordIds:null,keywordLabel:'',keywordId:''});
  syncFilterControls();renderBrands();renderKeywords();render();
}
function openExport() {
  $('export-description').textContent=`선택한 ${selected.size}개 상품에서 필요한 정보를 고르세요.`;
  $('export-columns').innerHTML=EXPORT_COLUMNS.map(([key,label])=>`<label class="export-column"><input type="checkbox" value="${key}" checked><span>${label}<small>${key}</small></span></label>`).join('');
  $('export-error').textContent='';$('export-dialog').showModal();
}
function download(format) {
  try {
    const chosen=products.filter(p=>selected.has(p.id)&&releaseState(p,today));
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
for(const [id,key] of [['fit-filter','fit'],['category-filter','category'],['release-filter','release'],['sort','sort']])$(id).addEventListener('change',()=>{state[key]=$(id).value;state.page=1;render();});
document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>{state.source=button.dataset.source;state.page=1;state.socialGroup=state.source==='sns'?(socialComparisonGroups(products,today)[0]?.key||''):'';if(state.socialGroup)state.sort='social';else if(state.sort==='social')state.sort='newest';if(state.source==='brand'){state.release='released';$('release-filter').value='released';}document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));
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
function refreshDate() { if(!catalog)return;const next=kstToday();if(next===today){renderKeywords();return;}if(next!==today){today=next;brandCounts=new Map();products.filter(p=>releaseState(p,today)).forEach(p=>productBrandNames(p,today).forEach(brand=>brandCounts.set(brand,(brandCounts.get(brand)||0)+1)));selected=new Set([...selected].filter(id=>products.some(p=>p.id===id&&releaseState(p,today))));renderBrands();renderKeywords();render();if($('detail-dialog').open&&!products.some(p=>p.id===activeDetailId&&releaseState(p,today)))$('detail-dialog').close();} }
setInterval(refreshDate,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDate();});
renderBrands();loadCatalog();
