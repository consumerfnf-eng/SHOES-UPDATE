// Monthly retail/media/SNS overlay. Deliberately independent of app.mjs's
// catalog pipeline (variant grouping, release-state gates, brand filters) —
// it only ever reads public/data/monthly-catalog.json and never touches
// public/data/catalog.json or any state app.mjs owns. If this file breaks,
// the main catalog and its tests are unaffected.
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const PAGE_SIZE = 40;

// SSENSE names start with the colorway (e.g. "Black Cloudtilt Moon Sneakers").
// Stripping that leading color word and grouping by brand+gender+remainder is
// how the same model's colorways are recognized as one product. This mirrors
// the main catalog's own color-chip UX, kept local here rather than importing
// from catalog-view.mjs (which assumes the official-brand evidence schema).
const COLOR_WORDS = ['black','white','red','blue','green','grey','gray','tan','brown','pink','navy',
  'beige','cream','yellow','orange','purple','silver','gold','multicolor','burgundy','khaki','ivory',
  'olive','maroon','charcoal','taupe','rust','mint','lilac','coral','teal','camel'];
const COLOR_RE = new RegExp('^(?:' + COLOR_WORDS.join('|') + ')(?:\\s*(?:&|,|/)\\s*(?:' + COLOR_WORDS.join('|') + '))*\\s+', 'i');

function splitColorFromName(name) {
  const m = COLOR_RE.exec(name || '');
  return m ? { color: m[0].trim(), rest: name.slice(m[0].length).trim() } : { color: '', rest: name || '' };
}
function groupKey(p) {
  const { rest } = splitColorFromName(p.name);
  return `${p.brand}|${p.gender}|${rest.toLowerCase()}`;
}
const COLOR_SWATCHES = {black:'#1b1b1b',white:'#f4f4f4',red:'#c0392b',blue:'#2f5ea8',green:'#3f7a4e',
  grey:'#9aa0a6',gray:'#9aa0a6',tan:'#c8a165',brown:'#6b4a33',pink:'#e5a3b3',navy:'#1f2d4d',
  beige:'#d8c7ad',cream:'#efe6d2',yellow:'#e0c23b',orange:'#d4702f',purple:'#6a4c8c',silver:'#c6c9cc',
  gold:'#b99746',multicolor:'linear-gradient(135deg,#e74c3c,#f1c40f,#2ecc71,#3498db)',burgundy:'#6f2232',
  khaki:'#9b8b5e',ivory:'#f1ece0',olive:'#6e7446',maroon:'#5c1a24',charcoal:'#3a3b3c',taupe:'#8a7968',
  rust:'#9a4a29',mint:'#a7d8c4',lilac:'#c7b3d9',coral:'#e8836b',teal:'#2f7d78',camel:'#b08457'};

let allProducts = [], groups = [], shown = 0, activeFilter = 'all', query = '';
const activeVariant = new Map();

function buildGroups() {
  const map = new Map();
  for (const p of allProducts) {
    const key = groupKey(p);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  groups = [...map.values()];
}
function activeOf(group) {
  const chosen = activeVariant.get(groupKey(group[0]));
  return group.find(p => p.id === chosen) || group[0];
}
function groupMatches(group) {
  if (activeFilter === 'media' && !group.some(p => p.popularity?.media)) return false;
  if (activeFilter === 'sns' && !group.some(p => p.popularity?.sns)) return false;
  if (!query) return true;
  return group.some(p => `${p.brand} ${p.name}`.toLowerCase().includes(query));
}

function colorChipsMarkup(group, activeId) {
  if (group.length < 2) return '';
  const seen = new Map();
  for (const p of group) {
    const { color } = splitColorFromName(p.name);
    const label = color || '색상 미확인';
    if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), { ...p, colorLabel: label });
  }
  const choices = [...seen.values()];
  return `<div class="color-chips" role="group" aria-label="색상 선택">${choices.map(p => {
    const swatch = COLOR_SWATCHES[p.colorLabel.toLowerCase()] || '#cfd4da';
    return `<button type="button" class="color-chip ${p.id === activeId ? 'active' : ''}" data-variant="${esc(p.id)}" aria-pressed="${p.id === activeId}" title="${esc(p.colorLabel)}"><span class="swatch-fill" style="background:${swatch}"></span></button>`;
  }).join('')}</div>`;
}

function sourceLabel(p) {
  return p.retailerEvidence?.retailer || (p.source === 'retail-lyst' ? 'Lyst' : p.source === 'retail-ssense' ? 'SSENSE' : p.source || '');
}
function cardMarkup(group) {
  const p = activeOf(group);
  const img = safeUrl(p.image);
  const visual = img
    ? `<img src="${esc(img)}" alt="${esc(p.brand + ' ' + p.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '<span class="image-missing">이미지 확인 중</span>';
  const anyNew = group.some(v => v.newThisRun);
  const mediaCount = group.reduce((n, v) => n + (v.popularity?.mediaMentions?.length || 0), 0);
  const snsLikes = group.flatMap(v => v.popularity?.snsPosts || []).map(m => m.likeCount).filter(Number.isFinite);
  const badges = [
    mediaCount ? `<span class="source-badge">미디어 언급 ${mediaCount}건</span>` : '',
    snsLikes.length ? `<span class="source-badge">SNS 인기 · 평균 ❤ ${Math.round(snsLikes.reduce((a, b) => a + b, 0) / snsLikes.length)}</span>` : '',
    anyNew ? '<span class="source-badge">이번 달 신규</span>' : '',
  ].filter(Boolean).join('');
  const { rest } = splitColorFromName(p.name);
  return `<article class="product-card monthly-card" data-group="${esc(groupKey(p))}">
    <div class="card-visual"><a class="card-open" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${visual}</a></div>
    <div class="card-copy">
      <p class="card-brand">${esc(p.brand)} · ${esc(sourceLabel(p))}</p>
      <a class="card-name" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${esc(rest || p.name)}</a>
      <p class="card-meta">${esc(p.priceLabel || '가격 미확인')} · ${p.gender === 'women' ? '여성' : '남성'}${group.length > 1 ? ` · ${group.length}개 색상` : ''}</p>
      ${colorChipsMarkup(group, p.id)}
    </div>
    <div class="card-footer">${badges || '<span class="source-badge">리테일 신상</span>'}</div>
  </article>`;
}

function render() {
  buildGroups();
  const list = groups.filter(groupMatches);
  const grid = $('monthly-grid'), empty = $('monthly-empty'), more = $('monthly-more');
  if (!list.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    more.hidden = true;
    $('monthly-count').textContent = '0';
    return;
  }
  empty.hidden = true;
  shown = Math.min(shown || PAGE_SIZE, list.length);
  grid.innerHTML = list.slice(0, shown).map(cardMarkup).join('');
  grid.querySelectorAll('[data-variant]').forEach(btn => btn.addEventListener('click', () => {
    const group = groups.find(g => groupKey(g[0]) === btn.closest('[data-group]').dataset.group);
    if (group) { activeVariant.set(groupKey(group[0]), btn.dataset.variant); render(); }
  }));
  more.hidden = shown >= list.length;
  $('monthly-count').textContent = String(list.length);
}

function hashtagMarkup(h) {
  return `<span class="keyword" title="${esc((h.relatedKeywords || []).slice(0, 6).join(' · '))}">
    <span>#${esc(h.hashtag)}</span><span class="count">${esc(h.totalMediaCount)} 게시물</span>
  </span>`;
}

async function load() {
  const grid = $('monthly-grid');
  grid.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch('./data/monthly-catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const value = await res.json();
    if (value.schemaVersion !== 1 || !Array.isArray(value.products)) throw new Error('Invalid monthly snapshot');
    allProducts = value.products;
    const baselineNote = value.isBaselineRun ? ' · 첫 수집(기준선) — 다음 달부터 신규 변동분만 게시' : '';
    $('monthly-asof').textContent = `리테일 신상 스니커즈 · ${value.periodStart} 이후 확인 · ${value.asOf} 기준${baselineNote}`;
    const hashtags = Array.isArray(value.hashtagTrends) ? value.hashtagTrends : [];
    $('monthly-hashtags').innerHTML = hashtags.length
      ? hashtags.map(hashtagMarkup).join('')
      : '<p class="muted">Instagram 해시태그 볼륨 데이터 없음(비로그인 집계 · 로그인 필요 항목은 SNS 인기 탭에서 별도 확인)</p>';
    shown = PAGE_SIZE;
    render();
  } catch (e) {
    grid.innerHTML = '';
    $('monthly-empty').hidden = false;
    $('monthly-empty-title').textContent = '월간 리테일 데이터를 불러오지 못했습니다';
    $('monthly-asof').textContent = String(e.message || e);
  } finally {
    grid.removeAttribute('aria-busy');
  }
}

export function initMonthlyView() {
  if (!$('monthly-section')) return;
  document.querySelectorAll('.monthly-tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.monthly-tab').forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    activeFilter = btn.dataset.filter;
    shown = PAGE_SIZE;
    render();
  }));
  $('monthly-search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); shown = PAGE_SIZE; render(); });
  $('monthly-more').addEventListener('click', () => { shown += PAGE_SIZE; render(); });
  load();
}
