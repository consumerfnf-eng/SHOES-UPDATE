// Calendar transitions are evaluated in Korea, independently of collection time.
export function forecastSeasons(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(new Date(now));
  const year=Number(parts.find(p=>p.type==='year').value),month=Number(parts.find(p=>p.type==='month').value);
  // The initial window was requested in the second half of 2026. Its next
  // January boundary must advance to 27AW, rather than keep 27SS until July.
  const elapsed=Math.max(0,year*2+(month>=7?1:0)-(2026*2+1));
  const start=2027*2+elapsed;
  return [0,1,2].map(offset=>{const n=start+offset;return `${String(Math.floor(n/2)).slice(-2)}${n%2?'AW':'SS'}`;});
}
export function reportSeason(title){const m=String(title).match(/\b(S\s*\/\s*S|A\s*\/\s*W|F\s*\/\s*W)\s*(\d{2})(?:\s*\/\s*\d{2})?/i);return m?`${m[2]}${/^S/i.test(m[1])?'SS':'AW'}`:'';}
export const isSneakerReport=title=>/\bsneakers?\b/i.test(String(title));
export function silhouetteKeywords(headings){return [...new Set(headings.map(h=>String(h).match(/^(?:Fashion silhouette|Core updates)\s*:\s*(.+)$/i)?.[1]?.trim()).filter(Boolean))];}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tag=v=>'#'+String(v).replace(/^the\s+/i,'').trim().replace(/\s+/g,'_');
let selected='',snapshot=null,request=null,active=null,page=0,opener=null;
const $=id=>document.getElementById(id);
export async function renderForecast(){
  const seasons=forecastSeasons();if(!seasons.includes(selected))selected=seasons[0];
  $('forecast-seasons').innerHTML=seasons.map(s=>`<button class="secondary-button ${s===selected?'active':''}" data-season="${s}" aria-pressed="${s===selected}">${s.replace('AW','AW (FW)')}</button>`).join('');
  $('forecast-seasons').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=b.dataset.season;renderForecast();});
  if(!snapshot){
    $('forecast-status').textContent='WGSN 레포트를 불러오고 있습니다.';
    request??=fetch('./data/forecast.json',{cache:'no-cache'}).then(async r=>{if(!r.ok)throw Error(r.status);const s=await r.json();if(s.schemaVersion!==1||!Array.isArray(s.reports))throw Error('Invalid forecast');return s;});
    try{snapshot=await request;}catch{request=null;$('forecast-status').textContent='레포트를 불러오지 못했습니다. 기존 자료는 보존되어 있습니다.';return;}
  }
  const reports=snapshot.reports.filter(r=>isSneakerReport(r.title)&&reportSeason(r.title)===selected);
  const keywords=[...new Set(reports.filter(r=>/Key Silhouettes/i.test(r.title)).flatMap(r=>silhouetteKeywords(r.headings||[])))];
  $('forecast-keywords').innerHTML=keywords.map(k=>`<span class="forecast-keyword">${esc(tag(k))}</span>`).join('');
  $('forecast-keywords').hidden=!keywords.length;
  $('forecast-status').textContent=`${selected} · ${reports.length}개 레포트 · ${snapshot.checkedAt?.slice(0,10)||''} 확인 · 매년 1월·7월 시즌 전환`;
  $('forecast-grid').innerHTML=reports.length?reports.map(r=>`<article class="forecast-card"><button data-report="${esc(r.id)}" aria-label="${esc(r.title)} 크게 보기"><img src="${esc(r.cover)}" alt="${esc(r.title)}" loading="lazy" decoding="async"><h3>${esc(r.title)}</h3><span>고화질 레포트 보기 ↗</span></button><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">WGSN 원문 ↗</a></article>`).join(''):'<p class="muted">이 시즌에서 제목에 Sneaker 또는 Sneakers가 포함된 레포트가 아직 확인되지 않았습니다.</p>';
  $('forecast-grid').querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>{active=reports.find(r=>r.id===b.dataset.report);opener=b;page=0;showPage();$('forecast-viewer').showModal();});
}
function showPage(){if(!active)return;$('forecast-viewer-title').textContent=active.title;$('forecast-page').src=active.pages[page];$('forecast-page').alt=`${active.title} · ${page+1}페이지`;$('forecast-position').textContent=`${page+1} / ${active.pages.length}`;$('forecast-prev').disabled=page===0;$('forecast-next').disabled=page>=active.pages.length-1;$('forecast-original').href=active.url;$('forecast-viewer').scrollTop=0;}
export function bindForecast(){
  $('forecast-close').onclick=()=>$('forecast-viewer').close();
  $('forecast-viewer').addEventListener('close',()=>{opener?.focus();$('forecast-page').removeAttribute('src');});
  $('forecast-prev').onclick=()=>{page--;showPage();};$('forecast-next').onclick=()=>{page++;showPage();};
  $('forecast-viewer').addEventListener('keydown',e=>{if(e.key==='ArrowRight'&&page<active.pages.length-1){page++;showPage();}if(e.key==='ArrowLeft'&&page>0){page--;showPage();}});
}
