// Monthly retail/media/SNS overlay. Deliberately independent of app.mjs's
// catalog pipeline (variant grouping, release-state gates, brand filters) —
// it only ever reads public/data/monthly-catalog.json and never touches
// public/data/catalog.json or any state app.mjs owns. If this file breaks,
// the main catalog and its tests are unaffected.
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const PAGE_SIZE = 40;

let allProducts = [], shown = 0, activeFilter = 'all', query = '';

function matches(p) {
  if (activeFilter === 'media' && !p.popularity?.media) return false;
  if (activeFilter === 'sns' && !p.popularity?.sns) return false;
  if (!query) return true;
  const haystack = `${p.brand} ${p.name}`.toLowerCase();
  return haystack.includes(query);
}

function cardMarkup(p) {
  const img = safeUrl(p.image);
  const visual = img
    ? `<img src="${esc(img)}" alt="${esc(p.brand + ' ' + p.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '<span class="image-missing">이미지 확인 중</span>';
  const badges = [
    p.popularity?.media ? `<span class="source-badge">미디어 언급 ${p.popularity.mediaMentions.length}건</span>` : '',
    p.popularity?.sns ? `<span class="source-badge">SNS 인기 · 평균 ❤ ${p.popularity.snsAverageLikes ?? '—'}</span>` : '',
    p.newThisRun ? '<span class="source-badge">이번 달 신규</span>' : '',
  ].filter(Boolean).join('');
  return `<article class="product-card monthly-card">
    <div class="card-visual"><a class="card-open" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${visual}</a></div>
    <div class="card-copy">
      <p class="card-brand">${esc(p.brand)} · SSENSE</p>
      <a class="card-name" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>
      <p class="card-meta">${esc(p.priceLabel || '가격 미확인')} · ${p.gender === 'women' ? '여성' : '남성'}</p>
    </div>
    <div class="card-footer">${badges || '<span class="source-badge">리테일 신상</span>'}</div>
  </article>`;
}

function render() {
  const list = allProducts.filter(matches);
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
    $('monthly-asof').textContent = `SSENSE 신상 스니커즈 · ${value.periodStart} 이후 확인 · ${value.asOf} 기준`;
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
