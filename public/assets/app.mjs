import { EXPORT_COLUMNS, exportRows, csvBytes, xlsxBytes } from './export.mjs';
import { kstToday, releaseState, safeUrl, filterProducts, keywordProductIds, sourceContext, trendKeywords } from './catalog-view.mjs';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceNames = {magazine:'매거진',newsletter:'뉴스레터',sns:'SNS',ecommerce:'이커머스'};
const productTypeNames = {sneaker:'스니커즈',clog:'여름 클로그',sandal:'캐주얼 샌들','platform-sandal':'플랫폼 샌들',hybrid:'혼합형 스니커즈'};
const mandatory = ['Louis Vuitton','Miu Miu','Prada','Gucci','Dior','Balenciaga','Celine','Saint Laurent','Hermès','Moncler','Bottega Veneta','Loewe','On','Cecilie Bahnsen','ASICS','FILA','Mizuno','New Balance','Salomon','adidas','Nike','PUMA','Axel Arigato','PANE','Onitsuka Tiger'];
const PAGE_SIZE = 40;
const state = {search:'',brands:new Set(),fit:'all',category:'all',source:'all',release:'released',sort:'newest',page:1,keywordIds:null,keywordLabel:'',keywordId:''};
let catalog = null, products = [], filtered = [], visible = [], selected = new Set(), today = kstToday(), brandCounts = new Map(), toastTimer, activeDetailId;

function dateText(value, time = false) {
  if (!value) return '미확인';
  const date = new Date(value.length === 10 ? value + 'T00:00:00+09:00' : value);
  if (!Number.isFinite(date.getTime())) return '미확인';
  return new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',...(time ? {hour:'2-digit',minute:'2-digit',hour12:false} : {})}).format(date);
}
function popup(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function fitBadges(p) { return (p.fit || []).map(f => `<span class="fit-badge ${f === 'DISCOVERY' ? 'discovery' : ''}">${esc(f)}</span>`).join(''); }
function imageMarkup(p, eager = false) {
  const url = safeUrl(p.thumbnail || p.image);
  return url ? `<img src="${esc(url)}" alt="${esc(p.brand + ' ' + p.name)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">` : '<span class="image-missing">이미지 준비 중</span>';
}
function bindImageErrors(container) { container.querySelectorAll('img').forEach(img => img.addEventListener('error', () => { const span = document.createElement('span'); span.className = 'image-missing'; span.textContent = '이미지를 표시할 수 없습니다'; img.replaceWith(span); }, {once:true})); }

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
    products = value.products.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.brand === 'string').map(p => ({...p,keywords:[...(p.keywords||[]),...[...value.keywords,...(value.forecastKeywords||[])].filter(k=>k.productIds?.includes(p.id)).flatMap(k=>[k.label,...(k.aliases||[])])]}));
    const collection = value.sourceStatus?.lastSuccessfulCollectionAt;
    $('update-label').textContent = collection ? `${dateText(collection, true)} 수집 완료` : value.publishedAt ? `${dateText(value.publishedAt, true)} 게시` : '첫 검증 완료본 게시 대기';
    const unavailable = value.sourceStatus?.unavailableBrands || [];
    const notice = [];
    if (!products.length) notice.push('출시일·품목·공식 상품 정보를 확인한 신상품을 준비하고 있습니다. 기존 기록은 보존되며, 검증을 마친 상품부터 게시됩니다.');
    if (unavailable.length) notice.push(`이번 수집에서 ${unavailable.length}개 브랜드의 정보 확인이 완료되지 않았습니다. 확인된 상품만 표시합니다.`);
    $('catalog-notice').textContent = notice.join(' '); $('catalog-notice').className = 'notice'; $('catalog-notice').hidden = !notice.length;
    brandCounts = new Map(); products.filter(p => releaseState(p,today)).forEach(p => brandCounts.set(p.brand,(brandCounts.get(p.brand)||0)+1));
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
  const list = brands.filter(b => b.name.toLocaleLowerCase().includes(search)).sort((a,b) => Number(!!b.mandatory)-Number(!!a.mandatory) || a.name.localeCompare(b.name,'en'));
  let previousGroup = '';
  $('brand-list').innerHTML = list.map(b => {
    const group = b.mandatory ? '필수 브랜드' : '참고 브랜드';
    const heading = group !== previousGroup ? `<h3 class="brand-group-label">${group}</h3>` : ''; previousGroup = group;
    return `${heading}<label class="brand-option"><input type="checkbox" data-brand="${esc(b.name)}" ${state.brands.has(b.name)?'checked':''}><span class="brand-name">${esc(b.name)}</span><span class="brand-count">${brandCounts.get(b.name)||0}</span></label>`;
  }).join('') || '<p class="muted">일치하는 브랜드가 없습니다.</p>';
  $('brand-list').querySelectorAll('input').forEach(input => input.addEventListener('change', () => { input.checked ? state.brands.add(input.dataset.brand) : state.brands.delete(input.dataset.brand); state.page=1; render(); }));
}
function renderKeywords() {
  const statuses=[...(catalog?.searchRankStatus||[]),...(catalog?.editorialStatus||[])], current=trendKeywords(catalog?.keywords||[]), forecasts=trendKeywords(catalog?.forecastKeywords||[],{forecast:true});
  const platformName=platform=>[...statuses,...(catalog?.forecastStatus||[])].find(s=>s.platform===platform)?.name||platform;
  const applicabilityNames={'cross-category':'여러 상품군에 적용되는 색상 전망','sports-and-outdoor':'원문에서 스포츠·아웃도어 적용 언급','footwear-explicit':'원문에서 풋웨어 적용을 직접 언급'};
  const kindNames={'search-rank':'검색','search-popular':'인기 검색어','composite-rank':'복합 인기','hashtag-rank':'해시태그','editorial-keyword':'매체 추천','forecast-keyword':'미래 전망'};
  function renderList(target,keywords,forecast=false) {
    $(target).innerHTML=keywords.length?keywords.map((k,i)=>{
      const matched=keywordProductIds(k,products,today).size,originals=[...new Set(k.sourceRanks.map(s=>s.term))].filter(term=>term!==k.label);
      const sources=k.sourceRanks.map(s=>{
        const type=s.kind==='composite-rank'?(/traffic|트래픽|방문|조회/.test([s.metric,s.rankingDefinition].join(' '))?'트래픽':'복합'):s.kind==='forecast-keyword'?'전망':kindNames[s.kind];
        return `<a href="${esc(safeUrl(s.sourceUrl))}" target="_blank" rel="noopener noreferrer" title="원문: ${esc(s.term)}" aria-label="${esc(platformName(s.platform))} 원문 ${esc(s.term)} · ${kindNames[s.kind]} ${s.rank===null?'원순위 미공개':esc(s.rank)+'위'}">${esc(platformName(s.platform))} · ${type}${s.rank===null?(forecast?'':' · 순위 미공개'):' '+esc(s.rank)+'위'} ↗</a>`;
      }).join('');
      const details=k.sourceRanks.map(s=>`<div class="keyword-source-detail"><strong>${esc(platformName(s.platform))} · ${esc(s.term)}</strong><p>${kindNames[s.kind]}${s.rank===null?(forecast?'':' · 원순위 미공개'):' '+esc(s.rank)+'위'} · ${s.country||s.region?esc(s.country||s.region)+' · ':''}${esc(s.forecastPeriod||s.rankingPeriod||'기간 미공개')} · ${esc(dateText(s.capturedAt))} 확인</p>${s.rankingDefinition||s.metric||applicabilityNames[s.applicability]?`<p>${[...new Set([s.rankingDefinition,s.metric,applicabilityNames[s.applicability]].filter(Boolean))].map(esc).join(' · ')}</p>`:''}</div>`).join('');
      return `<article class="keyword search-keyword ${state.keywordId===k.id?'active':''}"><button class="keyword-select" data-keyword="${i}" aria-pressed="${state.keywordId===k.id}" aria-label="${esc(k.label)} 관련 상품 ${matched}개"><span class="rank ${k.rank===null?'unranked':''}" aria-label="${forecast?'미래 전망 참고':k.rank===null?'원순위 미공개':'종합 '+k.rank+'위'}">${forecast?'↗':k.rank??'—'}</span><span class="keyword-copy"><span class="keyword-name">${esc(k.label)}</span>${!forecast&&k.rank===null?'<span class="keyword-evidence">원순위 미공개</span>':''}</span><span class="count"><strong>${matched}</strong><span>상품</span></span></button><div class="keyword-sources" aria-label="${forecast?'전망 원문':'출처별 원순위'}">${sources}</div><details class="keyword-source-details"><summary>출처 상세</summary>${originals.length?`<p class="keyword-originals">다른 원문 표기: ${originals.map(esc).join(' · ')}</p>`:''}${details}</details></article>`;
    }).join(''):`<p class="keyword-empty">${forecast?'확인된 미래 트렌드 원문이 아직 없습니다.':'확인된 신발 관련 인기 키워드가 아직 없습니다. 공개 순위 또는 공식 인기 키워드 원문을 확인한 뒤 표시합니다.'}</p>`;
    $(target).querySelectorAll('.keyword-select').forEach(button=>button.addEventListener('click',()=>{
      const k=keywords[Number(button.dataset.keyword)];clearTimeout(searchTimer);
      Object.assign(state,{search:'',brands:new Set(),fit:'all',category:'all',source:'all',release:'all',page:1,keywordId:k.id,keywordLabel:k.label,keywordIds:keywordProductIds(k,products,today)});
      syncFilterControls();renderBrands();renderKeywords();render();$('results').scrollIntoView({block:'start'});$('results').focus({preventScroll:true});
    }));
  }
  renderList('keyword-list',current);renderList('forecast-list',forecasts,true);
  function renderStatus(target,rows,forecast=false){
    $(target).innerHTML=`<details class="source-status-details"><summary>${forecast?'전망 원문':'인기 키워드 출처'} 확인 상태${rows.length?' · '+rows.length+'개 항목':''}</summary>${rows.length?`<ul>${rows.map(s=>{
      const age=Date.now()-Date.parse(s.checkedAt),fresh=forecast?typeof s.validUntil==='string'&&s.validUntil>=today:age>=0&&age<=7*86400000;
      const retained=forecast&&s.status==='available'&&s.verificationMethod==='reviewed-public-source';
      const previousCurrent=!forecast&&s.status==='unavailable'&&current.some(k=>k.sourceRanks.some(r=>r.platform===s.platform&&(!s.kind||r.kind===s.kind)));
      const status=previousCurrent?'최근 확인 자료 유지':fresh&&retained?'검토한 공개 원문 유지':fresh&&s.status==='available'?'공개 원문 확인':fresh&&s.status==='partial'?'일부 원문 확인':forecast?'공개 전망 원문 확인 불가':'공개 순위 확인 불가';
      const name=s.name||s.platform||'출처',url=safeUrl(s.url);
      return `<li><span>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)} ↗</a>`:esc(name)}</span><span>${s.kind?esc(kindNames[s.kind]||s.kind)+' · ':''}${status}${s.kind==='editorial-keyword'&&s.count===0?' · 조건 일치 0개':''}</span>${s.reason?`<small>${esc(s.reason)}</small>`:''}</li>`;
    }).join('')}</ul>`:`<p>공개 ${forecast?'전망 원문':'인기 키워드'}의 출처 확인을 기다리고 있습니다.</p>`}</details>`;
  }
  renderStatus('search-rank-status',statuses.filter(s=>s.kind!=='forecast-keyword'));renderStatus('forecast-status',catalog?.forecastStatus||[],true);
}
function render() {
  if (!catalog) return;
  filtered = filterProducts(products,state,today);
  state.page = Math.min(state.page,Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)));
  visible = filtered.slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE);
  $('result-count').textContent = filtered.length.toLocaleString();
  renderSourceDescription();
  $('product-grid').innerHTML = visible.map((p,i) => {
    const release = releaseState(p,today), url = safeUrl(p.url), sourceTypes = Object.keys(sourceNames).filter(type => p.popularity?.[type] === true);
    return `<article class="product-card ${selected.has(p.id)?'selected':''}" data-id="${esc(p.id)}"><div class="card-visual"><label class="card-checkbox"><input type="checkbox" data-select="${esc(p.id)}" aria-label="${esc(p.brand+' '+p.name)} 선택" ${selected.has(p.id)?'checked':''}></label><button class="card-open" data-detail="${esc(p.id)}" aria-label="${esc(p.brand+' '+p.name)} 상세정보">${imageMarkup(p,i<4)}</button>${release==='upcoming'?'<span class="release-badge upcoming">발매 예정</span>':''}</div><div class="card-copy"><p class="card-brand">${esc(p.brand)}</p><button class="card-name" data-detail="${esc(p.id)}">${esc(p.name)}</button><div class="card-meta">${fitBadges(p)}<span>${esc(p.releaseDate)}</span></div></div><div class="card-footer">${sourceTypes.map(type=>`<span class="source-badge">${sourceNames[type]}</span>`).join('')}${url?`<a class="official-small" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(p.name)} 공식 상품 보기">공식 상품 ↗</a>`:''}</div></article>`;
  }).join('');
  bindImageErrors($('product-grid'));
  $('product-grid').querySelectorAll('[data-detail]').forEach(button=>button.addEventListener('click',()=>openDetail(button.dataset.detail)));
  $('product-grid').querySelectorAll('[data-select]').forEach(input=>input.addEventListener('change',()=>toggleSelection(input.dataset.select,input.checked)));
  $('empty-state').hidden = filtered.length>0;
  $('empty-reset').textContent='필터 초기화'; delete $('empty-reset').dataset.retry;
  if (!filtered.length) {
    $('empty-title').textContent = state.source==='all' ? '조건에 맞는 상품이 없습니다' : `${sourceNames[state.source]} 인기 기준을 충족한 상품이 없습니다`;
    $('empty-description').textContent = state.source==='sns' ? '최근 14일 동안 독립된 비광고 계정 3개 이상·원본 게시물 5개 이상이 필요합니다. 기준을 충족한 상품만 표시합니다.' : ['magazine','newsletter'].includes(state.source) ? '최근 30일 동안 서로 독립된 편집 출처 2곳 이상에서 소개된 상품이 필요합니다.' : state.source==='ecommerce' ? '국가·카테고리·확인일이 있는 실제 랭킹의 상품이 필요합니다.' : '필터를 줄여 보세요. 출시일이 불명확하거나 3개월이 지난 상품은 최근 신상품에 포함하지 않습니다.';
  }
  $('page-range').textContent = filtered.length ? `${(state.page-1)*PAGE_SIZE+1}–${Math.min(state.page*PAGE_SIZE,filtered.length)} / ${filtered.length.toLocaleString()}` : '0개 상품';
  $('mobile-brand-count').textContent=state.brands.size?String(state.brands.size):'';
  renderChips(); renderPagination(); updateSelection();
}
function renderSourceDescription() {
  if (state.source === 'all') {
    const narrowed=state.brands.size||state.fit!=='all'||state.category!=='all'||state.search||state.release!=='all';
    $('result-description').textContent=state.keywordLabel?`${state.keywordLabel} ${narrowed?'관련 상품 · 선택한 필터 적용':'전체 상품 · 최근 3개월 출시와 발매 예정 포함'}`:'출시일과 품목을 확인한 상품만 표시합니다.';
    return;
  }
  const context=sourceContext(state.source,products,catalog.sourceDirectory||{},today);
  const links=entries=>entries.map(s=>`<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>`).join(' · ');
  const original=context.observed.length?`카탈로그 원문 출처: ${links(context.observed)}`:'확인된 원문 출처가 아직 없습니다.';
  const awaiting=context.configured.length?`<span class="source-context">수집 대상 (원문 확인 전): ${links(context.configured)}</span>`:'';
  const snsTarget=state.source==='sns'?`<span class="source-context">확인 대상: <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer">Instagram 공개 원문 ↗</a>. ${products.some(p=>releaseState(p,today)&&p.popularity?.sns)?'인기 기준을 충족한 게시물의 원문은 상품 상세정보에서 확인하세요.':'현재 인기 기준을 충족한 게시물은 없습니다.'}</span>`:'';
  $('result-description').innerHTML=`${original}${awaiting}${snsTarget}<span class="source-context">${esc(sourceNames[state.source])} 인기 기준을 충족한 상품만 표시합니다. 개별 원문은 상세정보에서 확인하세요.</span>`;
}
function renderChips() {
  $('active-filters').innerHTML = [...state.brands].map(name=>`<button class="filter-chip" data-remove-brand="${esc(name)}" aria-label="${esc(name)} 필터 해제">${esc(name)}<span aria-hidden="true">×</span></button>`).join('')+(state.keywordLabel?`<button class="filter-chip" id="remove-keyword" aria-label="키워드 필터 해제"># ${esc(state.keywordLabel)}<span aria-hidden="true">×</span></button>`:'');
  $('active-filters').querySelectorAll('[data-remove-brand]').forEach(b=>b.addEventListener('click',()=>{state.brands.delete(b.dataset.removeBrand);state.page=1;renderBrands();render();}));
  $('remove-keyword')?.addEventListener('click',()=>{state.keywordIds=null;state.keywordLabel='';state.keywordId='';state.page=1;renderKeywords();render();});
}
function renderPagination() {
  const pages = Math.ceil(filtered.length/PAGE_SIZE);
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
  const url=safeUrl(p.url), evidence=safeUrl(p.dateEvidence?.url);
  const signals=(p.sourceSignals||[]).filter(s=>safeUrl(s.url));
  const data=[['출시일',`${esc(dateText(p.releaseDate))}${releaseState(p,today)==='upcoming'?' (예정)':''}${p.dateEvidence?.region?` · ${esc(p.dateEvidence.region)}`:''}${evidence?`<br><a href="${esc(evidence)}" target="_blank" rel="noopener noreferrer">출시일 근거 ↗</a>`:''}`],['품목',esc(productTypeNames[p.productType||p.category]||p.productType||p.category||'미확인')],['스타일 코드',esc(p.style||'미확인')],['컬러웨이',esc(p.colorway||(p.colors||[]).map(c=>typeof c==='string'?c:c.name).filter(Boolean).join(', ')||'미확인')],['소재',esc(p.material||'미확인')],['가격',esc(p.priceLabel||'공식 상품에서 확인')],['마지막 검증',esc(dateText(p.lastVerifiedAt||p.verifiedAt||p.dateEvidence?.verifiedAt,true))]];
  $('detail-content').innerHTML=`<div class="detail-visual">${imageMarkup(p,true)}</div><p class="card-brand">${esc(p.brand)}</p><h2 id="detail-title">${esc(p.name)}</h2><div class="detail-summary">${fitBadges(p)}</div><div class="detail-actions">${url?`<a class="primary-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">공식 상품 보기 ↗</a>`:''}<button id="detail-select" class="secondary-button" aria-pressed="${selected.has(id)}">${selected.has(id)?'선택 해제':'상품 선택'}</button></div><dl class="detail-data">${data.map(([label,value])=>`<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl><h3>기획 참고 요소</h3>${p.fitReasons?.length?`<ul class="reasons">${p.fitReasons.map(reason=>`<li>${esc(typeof reason==='string'?reason:reason.text||reason.reason||'')}</li>`).join('')}</ul>`:'<p class="muted">확인된 선정 이유가 아직 없습니다.</p>'}<h3>출처와 인기 근거</h3>${signals.length?signals.map(s=>`<div class="evidence"><span class="source-badge">${esc(sourceNames[s.type]||s.type)}${s.sponsored?' · 광고/협찬':''}</span><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title||s.account||'원문 확인')} ↗</a><p>${s.account?esc(s.account)+' · ':''}${s.rank?'순위 '+esc(s.rank)+' · ':''}${s.country?esc(s.country)+' · ':''}${s.rankingCategory||s.category?esc(s.rankingCategory||s.category)+' · ':''}${s.publishedAt?(s.type==='ecommerce'?(s.dateBasis==='platform-updated-at'?'순위 집계일 ':'순위 확인일 '):'발행 ')+esc(dateText(s.publishedAt))+' · ':''}확인 ${esc(dateText(s.checkedAt))}</p>${s.rankingPeriod||s.rankingDefinition?`<p class="ranking-context">${s.rankingPeriod?'집계 기간: '+esc(s.rankingPeriod)+' · ':''}${s.rankingDefinition?esc(s.rankingDefinition):''}</p>`:''}</div>`).join(''):'<p class="muted">확인 가능한 매거진·뉴스레터·SNS·랭킹 근거가 아직 없습니다.</p>'}`;
  bindImageErrors($('detail-content'));$('detail-select').addEventListener('click',()=>toggleSelection(id,!selected.has(id)));
  if(!$('detail-dialog').open)$('detail-dialog').showModal();
}
function syncFilterControls() {
  $('search').value=state.search;$('brand-search').value='';$('fit-filter').value=state.fit;$('category-filter').value=state.category;$('release-filter').value=state.release;$('sort').value=state.sort;
  document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b.dataset.source===state.source);b.setAttribute('aria-pressed',String(b.dataset.source===state.source));});
}
function resetFilters() {
  clearTimeout(searchTimer);
  Object.assign(state,{search:'',brands:new Set(),fit:'all',category:'all',source:'all',release:'released',sort:'newest',page:1,keywordIds:null,keywordLabel:'',keywordId:''});
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
document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>{state.source=button.dataset.source;state.page=1;document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));
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
function refreshDate() { if(!catalog)return;const next=kstToday();if(next===today){renderKeywords();return;}if(next!==today){today=next;brandCounts=new Map();products.filter(p=>releaseState(p,today)).forEach(p=>brandCounts.set(p.brand,(brandCounts.get(p.brand)||0)+1));selected=new Set([...selected].filter(id=>products.some(p=>p.id===id&&releaseState(p,today))));renderBrands();renderKeywords();render();if($('detail-dialog').open&&!products.some(p=>p.id===activeDetailId&&releaseState(p,today)))$('detail-dialog').close();} }
setInterval(refreshDate,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDate();});
renderBrands();loadCatalog();
