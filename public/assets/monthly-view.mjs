// Retail + newsletter overlay. Deliberately independent of app.mjs's catalog
// pipeline (variant grouping, release-state gates, brand filters) - it only
// ever reads public/data/monthly-catalog.json and never touches
// public/data/catalog.json or any state app.mjs owns. If this file breaks,
// the main catalog and its tests are unaffected.
//
// It does share app.mjs's #detail-dialog element, so a retail card opens the
// same panel, in the same place, as an official product card. The dialog's
// contents are rewritten on open and this module binds its own handlers, so
// neither view can see the other's listeners.
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const PAGE_SIZE = 40;

// Retail titles from SSENSE/Lyst/Farfetch start with the colorway ("Black
// Cloudtilt Moon Sneakers"). The collectors already split that into its own
// `colorway` field, but older snapshots and manual entries may not have, so
// the same split is kept here as a fallback rather than assumed away.
const COLOR_WORDS = ['black','white','red','blue','green','grey','gray','tan','brown','pink','navy',
  'beige','cream','yellow','orange','purple','silver','gold','multicolor','burgundy','khaki','ivory',
  'olive','maroon','charcoal','taupe','rust','mint','lilac','coral','teal','camel'];
const COLOR_RE = new RegExp('^(?:' + COLOR_WORDS.join('|') + ')(?:\\s*(?:&|,|/)\\s*(?:' + COLOR_WORDS.join('|') + '))*\\s+', 'i');

const COLOR_SWATCHES = {black:'#1b1b1b',white:'#f4f4f4',red:'#c0392b',blue:'#2f5ea8',green:'#3f7a4e',
  grey:'#9aa0a6',gray:'#9aa0a6',tan:'#c8a165',brown:'#6b4a33',pink:'#e5a3b3',navy:'#1f2d4d',
  beige:'#d8c7ad',cream:'#efe6d2',yellow:'#e0c23b',orange:'#d4702f',purple:'#6a4c8c',silver:'#c6c9cc',
  gold:'#b99746',multicolor:'linear-gradient(135deg,#e74c3c,#f1c40f,#2ecc71,#3498db)',burgundy:'#6f2232',
  khaki:'#9b8b5e',ivory:'#f1ece0',olive:'#6e7446',maroon:'#5c1a24',charcoal:'#3a3b3c',taupe:'#8a7968',
  rust:'#9a4a29',mint:'#a7d8c4',lilac:'#c7b3d9',coral:'#e8836b',teal:'#2f7d78',camel:'#b08457',
  블랙:'#1b1b1b',화이트:'#f4f4f4',그레이:'#9aa0a6',블루:'#2f5ea8',브라운:'#6b4a33',베이지:'#d8c7ad',
  네이비:'#1f2d4d',레드:'#c0392b',그린:'#3f7a4e',핑크:'#e5a3b3',옐로우:'#e0c23b',퍼플:'#6a4c8c',
  오렌지:'#d4702f',실버:'#c6c9cc',골드:'#b99746',크림:'#efe6d2',아이보리:'#f1ece0',카키:'#9b8b5e',
  버건디:'#6f2232',민트:'#a7d8c4',차콜:'#3a3b3c',검정:'#1b1b1b',흰색:'#f4f4f4',검:'#1b1b1b'};
const UNKNOWN_SWATCH = 'repeating-linear-gradient(45deg,#eee 0 4px,#bbb 4px 8px)';

const RETAILER_LABELS = {'retail-ssense':'SSENSE','retail-musinsa':'무신사','retail-29cm':'29CM',
  'retail-wconcept':'W컨셉','retail-lyst':'Lyst','retail-farfetch':'Farfetch',
  'retail-mytheresa':'Mytheresa','retail-netaporter':'Net-a-Porter',
  // the collection report groups the three ScrapingBee-only retailers together
  'retail-farfetch-mytheresa-netaporter':'Farfetch · Mytheresa · Net-a-Porter',
  newsletter:'뉴스레터 7곳'};
const TYPE_LABELS = {sneaker:'스니커즈','ballet-sneaker':'발레리나 스니커즈',
  'mary-jane-sneaker':'메리제인 스니커즈','mule-sneaker':'뮬 스니커즈',jelly:'젤리 슈즈',platform:'플랫폼 슈즈'};
const BASIS_LABELS = {dated:'등록일 기준 최근 3개월','new-sort':'사이트 신상품순 상위',
  delta:'지난 확인 대비 신규'};

let retail = [], newsletter = [], sources = {};
let tab = 'retail', shown = PAGE_SIZE, query = '', categoryFilter = 'all';
const activeVariant = new Map();

function splitColorFromName(name) {
  const m = COLOR_RE.exec(name || '');
  return m ? { color: m[0].trim(), rest: name.slice(m[0].length).trim() } : { color: '', rest: name || '' };
}
function colorLabel(p) {
  return (p.colorway || '').trim() || splitColorFromName(p.fullName || p.name).color;
}
function modelName(p) {
  const base = (p.name || '').trim() || splitColorFromName(p.fullName || '').rest;
  return base || p.fullName || '';
}
function swatchFor(p) {
  const hexes = (p.colorSwatches || []).filter(c => /^#[0-9a-f]{6}$/i.test(c));
  if (hexes.length === 1) return hexes[0];
  if (hexes.length > 1) {
    return `linear-gradient(135deg,${hexes.slice(0, 4).map((c, i, a) =>
      `${c} ${Math.round(i / a.length * 100)}% ${Math.round((i + 1) / a.length * 100)}%`).join(',')})`;
  }
  const label = colorLabel(p).toLowerCase();
  for (const word of label.split(/[^a-z가-힣]+/).filter(Boolean)) {
    if (COLOR_SWATCHES[word]) return COLOR_SWATCHES[word];
  }
  return UNKNOWN_SWATCH;
}
// Same model, same retailer-family, different colorway = one card. The key
// drops the colorway and any trailing category wording so "Black Gabe
// Sneakers" and "White Gabe Sneakers" land together, while two genuinely
// different models never merge just because they share a colour.
function groupKey(p) {
  const model = modelName(p)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+(?:running\s+)?(?:shoes?|sneakers?)$/i, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return `${(p.brand || '').toLowerCase()}|${p.source || ''}|${model || p.id}`;
}

function items() { return tab === 'retail' ? retail : newsletter; }

function buildGroups() {
  const map = new Map();
  for (const p of items()) {
    const key = groupKey(p);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return [...map.values()];
}
function activeOf(group) {
  const chosen = activeVariant.get(groupKey(group[0]));
  return group.find(p => p.id === chosen) || group[0];
}
function groupMatches(group) {
  if (categoryFilter !== 'all' && !group.some(p => (p.footwearTypes || ['sneaker']).includes(categoryFilter))) return false;
  if (!query) return true;
  return group.some(p => `${p.brand} ${p.brandKo || ''} ${p.fullName || p.name} ${p.style || ''}`.toLowerCase().includes(query));
}

function uniqueVariants(group) {
  const seen = new Map();
  for (const p of group) {
    const label = colorLabel(p);
    // An unnamed colour is only the same variant as another unnamed one when
    // they are literally the same record - never merged on a guessed colour.
    const key = label ? `c:${label.toLowerCase()}` : `id:${p.id}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}
function colorChipsMarkup(group, activeId) {
  const choices = uniqueVariants(group);
  if (choices.length < 2 && !colorLabel(choices[0] || {})) return '';
  const active = group.find(p => p.id === activeId) || group[0];
  const chips = choices.map(p => {
    const label = colorLabel(p) || '색상명 미확인';
    return `<button type="button" class="color-chip ${p.id === activeId ? 'active' : ''}" data-variant="${esc(p.id)}"
      aria-pressed="${p.id === activeId}" aria-label="${esc(label)} 색상 선택" title="${esc(label)}"
      ><span class="swatch-fill" style="background:${esc(swatchFor(p))}"></span></button>`;
  }).join('');
  return `<div class="color-chips" role="group" aria-label="색상 선택">${chips}</div>
    <p class="selected-color" aria-live="polite">${esc(colorLabel(active) || '색상명 미확인')}</p>`;
}

// Retailer name, listing URL and check time are identical for every item a
// collector returned, so the snapshot publishes them once per source instead
// of repeating them on each record.
function sourceOf(p) { return sources[p.source] || {}; }
function sourceLabel(p) {
  return sourceOf(p).label || RETAILER_LABELS[p.source] || p.source || '';
}
function genderLabel(p) {
  return p.gender === 'women' ? '여성' : p.gender === 'men' ? '남성' : '';
}
function imageMarkup(p) {
  const img = safeUrl(p.image);
  return img
    ? `<img src="${esc(img)}" alt="${esc(`${p.brand} ${modelName(p)}`)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '<span class="image-missing">이미지 확인 중</span>';
}

function cardMarkup(group) {
  const p = activeOf(group);
  const badges = [
    p.releaseStatus === 'upcoming' ? '<span class="source-badge upcoming">발매 예정</span>' : '',
    p.popularity?.media ? `<span class="source-badge">뉴스레터 언급 ${p.popularity.mediaMentions.length}건</span>` : '',
    p.popularity?.snsAverageLikes ? `<span class="source-badge">SNS 평균 ❤ ${p.popularity.snsAverageLikes}</span>` : '',
    p.newThisRun ? '<span class="source-badge">이번 주 신규</span>' : '',
  ].filter(Boolean).join('');
  const meta = [p.priceLabel || '가격 미확인', genderLabel(p),
    group.length > 1 ? `${uniqueVariants(group).length}개 색상` : ''].filter(Boolean).join(' · ');
  return `<article class="product-card monthly-card" data-group="${esc(groupKey(p))}">
    <div class="card-visual"><button class="card-open" data-detail="${esc(p.id)}" aria-label="${esc(`${p.brand} ${modelName(p)}`)} 상세정보">${imageMarkup(p)}</button></div>
    <div class="card-copy">
      <p class="card-brand">${esc(p.brand)} · ${esc(sourceLabel(p))}</p>
      <button class="card-name" data-detail="${esc(p.id)}">${esc(modelName(p))}</button>
      <p class="card-meta">${esc(meta)}</p>
      ${colorChipsMarkup(group, p.id)}
    </div>
    <div class="card-footer">${badges || `<span class="source-badge">${tab === 'retail' ? '리테일 신상' : '뉴스레터 신상'}</span>`}</div>
  </article>`;
}

function dateText(value) {
  if (!value) return '';
  const date = new Date(value.length === 10 ? `${value}T00:00:00+09:00` : value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
}

function detailRows(p) {
  const source = sourceOf(p);
  const types = (p.footwearTypes || ['sneaker']).map(t => TYPE_LABELS[t] || t).join(' · ');
  const mentions = p.popularity?.mediaMentions || [];
  return [
    ['품목', esc(types || '스니커즈')],
    ['컬러', esc(colorLabel(p) || '색상명 미확인')],
    ['소재', esc(p.material || '상품 페이지에서 확인')],
    [p.style ? '스타일 코드' : '상품 코드', esc(p.style || '미확인')],
    ['가격', esc(p.priceLabel || '상품 페이지에서 확인')],
    ['성별', esc(genderLabel(p) || '미표기')],
    ['출시', p.releaseDate
      ? `${esc(dateText(p.releaseDate))}${p.releaseStatus === 'upcoming' ? ' (예정)' : ''}`
      : p.listedAt ? `${esc(dateText(p.listedAt))} 등록` : '미공개'],
    ['수집 근거', esc(p.basis || BASIS_LABELS[source.basis] || '미기록')],
    ['확인일', esc(dateText(source.checkedAt || p.publishedAt) || '미확인')],
    ...(mentions.length ? [['뉴스레터 언급', mentions.slice(0, 5).map(m =>
      `<a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener noreferrer">${esc(m.publisher)} ↗</a>`).join(' · ')]] : []),
  ];
}

function openDetail(id) {
  const p = items().find(x => x.id === id);
  if (!p) return;
  const group = buildGroups().find(g => g.some(x => x.id === id)) || [p];
  activeVariant.set(groupKey(p), id);
  const url = safeUrl(p.url);
  const dialog = $('detail-dialog');
  if (!dialog) return;
  // The photo itself is the link out: one click on the card opens this panel,
  // a second click on the photo goes to the retailer's or publisher's page.
  const visual = url
    ? `<a class="detail-photo-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(sourceLabel(p))} 상품 페이지로 이동">${imageMarkup(p)}<span class="detail-photo-hint">사진을 누르면 ${esc(sourceLabel(p))} 페이지로 이동 ↗</span></a>`
    : imageMarkup(p);
  $('detail-content').innerHTML = `<div class="detail-visual">${visual}</div>
    <p class="card-brand">${esc(p.brand)}${p.brandKo && p.brandKo !== p.brand ? ` · ${esc(p.brandKo)}` : ''} · ${esc(sourceLabel(p))}</p>
    <h2 id="detail-title">${esc(modelName(p))}</h2>
    ${p.fullName && p.fullName !== modelName(p) ? `<p class="muted">${esc(p.fullName)}</p>` : ''}
    ${colorChipsMarkup(group, p.id)}
    <div class="detail-actions">${url ? `<a class="primary-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(sourceLabel(p))}에서 보기 ↗</a>` : ''}</div>
    <dl class="detail-data">${detailRows(p).map(([label, value]) => `<dt>${esc(label)}</dt><dd>${value}</dd>`).join('')}</dl>
    ${p.excerpt ? `<h3>기사 요약</h3><p>${esc(p.excerpt)}</p>` : ''}
    <h3>출처</h3>
    <div class="evidence">
      <span class="source-badge">${esc(tab === 'retail' ? '리테일' : '뉴스레터')}</span>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(p.fullName || modelName(p))} ↗</a>` : ''}
      <p>${esc(sourceLabel(p))}${p.officialCategory ? ` · ${esc(p.officialCategory)}` : ''}${p.publishedAt ? ` · 발행 ${esc(dateText(p.publishedAt))}` : ''}</p>
      ${safeUrl(sourceOf(p).listingUrl) ? `<p><a href="${esc(safeUrl(sourceOf(p).listingUrl))}" target="_blank" rel="noopener noreferrer">수집한 목록 페이지 ↗</a></p>` : ''}
    </div>`;
  $('detail-content').querySelectorAll('[data-variant]').forEach(button =>
    button.addEventListener('click', () => { openDetail(button.dataset.variant); render(); }));
  if (!dialog.open) dialog.showModal();
}

function render() {
  const list = buildGroups().filter(groupMatches);
  const grid = $('monthly-grid'), empty = $('monthly-empty'), more = $('monthly-more');
  $('monthly-count').textContent = list.length.toLocaleString();
  if (!list.length) {
    grid.innerHTML = '';
    $('monthly-empty-title').textContent = items().length
      ? (query ? '검색어와 일치하는 상품이 없습니다' : '조건에 맞는 상품이 없습니다')
      : tab === 'retail' ? '게시된 리테일 신상이 아직 없습니다' : '게시된 뉴스레터 신상이 아직 없습니다';
    empty.hidden = false;
    more.hidden = true;
    return;
  }
  empty.hidden = true;
  shown = Math.min(shown || PAGE_SIZE, list.length);
  grid.innerHTML = list.slice(0, shown).map(cardMarkup).join('');
  grid.querySelectorAll('[data-detail]').forEach(button =>
    button.addEventListener('click', () => openDetail(button.dataset.detail)));
  grid.querySelectorAll('[data-variant]').forEach(button => button.addEventListener('click', () => {
    const key = button.closest('[data-group]').dataset.group;
    const group = buildGroups().find(g => groupKey(g[0]) === key);
    if (group) { activeVariant.set(groupKey(group[0]), button.dataset.variant); render(); }
  }));
  more.hidden = shown >= list.length;
}

function hashtagMarkup(h) {
  return `<span class="keyword" title="${esc((h.relatedKeywords || []).slice(0, 6).join(' · '))}">
    <span>#${esc(h.hashtag)}</span><span class="count">${esc(h.totalMediaCount)} 게시물</span>
  </span>`;
}

function statusMarkup(rows) {
  const labels = {ok: '수집됨', partial: '일부 수집', unavailable: '수집 불가',
    requires_key: 'API 키 필요', error: '오류'};
  return rows.map(row => `<span class="keyword status-${esc(row.status || 'unknown')}">
    <span>${esc(RETAILER_LABELS[row.id] || sources[row.id]?.label || row.id)}</span><span class="count">${esc(labels[row.status] || row.status || '미확인')} · ${row.collected}건</span>
  </span>`).join('');
}

async function load() {
  const grid = $('monthly-grid');
  grid.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch('./data/monthly-catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const value = await res.json();
    if (value.schemaVersion !== 2 || !Array.isArray(value.retail)) throw new Error('Invalid weekly snapshot');
    sources = value.sources && typeof value.sources === 'object' ? value.sources : {};
    retail = value.retail;
    newsletter = Array.isArray(value.newsletter) ? value.newsletter : [];
    const baselineNote = value.isBaselineRun ? ' · 첫 수집(기준선) — 날짜·신상품순이 없는 사이트는 다음 확인부터 게시' : '';
    $('monthly-asof').textContent =
      `${value.periodStart} 이후 확인 · ${value.asOf} 기준 · 리테일 ${retail.length.toLocaleString()}건 · 뉴스레터 ${newsletter.length.toLocaleString()}건${baselineNote}`;
    const hashtags = Array.isArray(value.hashtagTrends) ? value.hashtagTrends : [];
    $('monthly-hashtags').innerHTML = hashtags.length
      ? hashtags.map(hashtagMarkup).join('')
      : '<p class="muted">Instagram 해시태그 볼륨 데이터 없음</p>';
    const status = $('monthly-source-status');
    if (status) status.innerHTML = statusMarkup(value.sourceStatus || []);
    shown = PAGE_SIZE;
    render();
  } catch (e) {
    grid.innerHTML = '';
    $('monthly-empty').hidden = false;
    $('monthly-empty-title').textContent = '리테일·뉴스레터 데이터를 불러오지 못했습니다';
    $('monthly-asof').textContent = String(e.message || e);
  } finally {
    grid.removeAttribute('aria-busy');
  }
}

// Elements owned by app.mjs's official-catalog view, hidden while a monthly
// tab is active and restored when a main source-tab is clicked again.
// #monthly-section has its own .filters/.selection-row too, so these are
// scoped with the direct-child combinator (> ) to never match those nested
// copies - only the ones that are direct children of <section class="catalog">.
const MAIN_CATALOG_SELECTORS = ['#active-filters', '.catalog > .filters', '.catalog > .results-bar',
  '.catalog > .selection-row', '#product-grid', '#empty-state', '#pagination'];

function mainCatalogElements() {
  return MAIN_CATALOG_SELECTORS.flatMap(sel => [...document.querySelectorAll(sel)]);
}

function showMonthly(tabKey) {
  mainCatalogElements().forEach(el => { el.hidden = true; });
  $('monthly-section').hidden = false;
  document.querySelectorAll('[data-source]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
  document.querySelectorAll('.monthly-tab').forEach(b => {
    const active = b.dataset.monthly === tabKey;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  tab = tabKey === 'newsletter' ? 'newsletter' : 'retail';
  $('monthly-kind').textContent = tab === 'retail' ? '리테일 신상' : '뉴스레터 신상';
  shown = PAGE_SIZE;
  render();
}

function showMainCatalog() {
  mainCatalogElements().forEach(el => { el.hidden = false; });
  $('monthly-section').hidden = true;
  document.querySelectorAll('.monthly-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
}

export function initMonthlyView() {
  if (!$('monthly-section')) return;
  document.querySelectorAll('.monthly-tab').forEach(btn => btn.addEventListener('click', () => showMonthly(btn.dataset.monthly)));
  // app.mjs already binds its own click handler to these buttons (by a
  // different attribute, [data-source]) when it loads - this is a second,
  // independent listener on the same elements, purely to restore the main
  // catalog's visibility. It never touches app.mjs's own state.
  document.querySelectorAll('[data-source]').forEach(btn => btn.addEventListener('click', showMainCatalog));
  $('monthly-search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); shown = PAGE_SIZE; render(); });
  $('monthly-category').addEventListener('change', e => { categoryFilter = e.target.value; shown = PAGE_SIZE; render(); });
  $('monthly-more').addEventListener('click', () => { shown += PAGE_SIZE; render(); });
  load();
}

export const __test__ = {groupKey, uniqueVariants, swatchFor, colorLabel, modelName, splitColorFromName};
