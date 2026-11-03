import {safeUrl} from './catalog-view.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
const sourceLink=(url,label)=>safeUrl(url)?`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:esc(label);
export function proposalAsset(value){return /^\/proposals\/[a-z0-9-]+\/(?:board\.png|preview\.webp)$/.test(value||'')?value:'';}
export function proposalsForSeason(snapshot,season){return (snapshot?.ideas||[]).filter(i=>i.season===season);}
let snapshot=null,request=null,season='27SS',renderedSeason='',opener=null;
export async function renderResearchBrief(){
 if(!snapshot){
  $('brief-status').textContent='시즌별 MLB 스니커즈 제안과 원문 근거를 불러오고 있습니다.';
  request??=fetch('./data/season-proposals.json',{cache:'no-cache'}).then(async r=>{if(!r.ok)throw Error(r.status);const d=await r.json();if(d.schemaVersion!==2||!Array.isArray(d.ideas))throw Error('Invalid proposals');return d;});
  try{snapshot=await request;}catch{request=null;$('brief-status').textContent='시즌 제안서를 불러오지 못했습니다. 새로고침 후 다시 확인하세요.';return;}
 }
 if(renderedSeason===season)return;renderedSeason=season;
 const ideas=proposalsForSeason(snapshot,season),c=snapshot.coverage;
 $('brief-status').textContent=`${snapshot.asOf} 분석 · ${season} ${ideas.length}개 제안 · 시즌별 구조·소재·스타일링 구분`;
 $('proposal-seasons').innerHTML=snapshot.seasons.map(s=>`<button type="button" class="secondary-button ${s===season?'active':''}" data-proposal-season="${esc(s)}" aria-pressed="${s===season}">${esc(s==='27FW'?'27FW (AW)':s)}</button>`).join('');
 $('proposal-coverage').textContent=`분석 범위 · 공식 ${c.officialRecords.toLocaleString()}건 / 리테일 ${c.retailRecords.toLocaleString()}건 / 뉴스레터 원본 ${c.newsletterRecords}건(게시 기준 ${c.eligibleNewsletterRecords}건 반영) / 랭킹 ${c.rankItems}위 기록 / 스타일 ${c.styleKeywords}·SNS ${c.socialKeywords}키워드 / CATWALK ${c.catwalkLooks}장 / Forecast ${c.forecastReports}개·${c.forecastPages}페이지`;
 $('proposal-method').textContent=snapshot.method;
 $('proposal-date-note').textContent=`스타일 근거 ${(snapshot.sourceDates.keywords||'').slice(0,10)} · SNS ${(snapshot.sourceDates.social||'').slice(0,10)} · Forecast ${(snapshot.sourceDates.forecast||'').slice(0,10)} 확인. 자료별 확인일은 다르며 미확인 증감·판매량을 생성하지 않습니다.`;
 $('proposal-season-download').href=proposalAsset(snapshot.seasonBoards[season].download);$('proposal-season-download').download=`MLB-${season}-SEASON-4800.png`;
 $('proposal-season-view').dataset.proposalOverview=season;
 $('brief-ideas').innerHTML=ideas.map((idea,i)=>`<article class="season-proposal-card"><header><div><p class="eyebrow">${esc(season)} · 0${i+1} · MLB</p><h3>${esc(idea.title)}</h3><p>${esc(idea.subtitle)}</p></div><a class="secondary-button" href="${esc(proposalAsset(idea.download))}" download="MLB-${esc(season)}-${esc(idea.id)}-4800.png">고화질 PNG ↓</a></header><p class="proposal-tags">${idea.tags.map(t=>'#'+esc(t)).join(' ')}</p><button class="proposal-preview" data-proposal="${esc(idea.id)}" aria-label="${esc(idea.title)} 한 페이지 제안서 크게 보기"><img src="${esc(proposalAsset(idea.preview))}" width="1600" height="900" alt="${esc(idea.title)} · 6개 레퍼런스와 MLB 디자인 전략" loading="${i<2?'eager':'lazy'}" decoding="async"><span>제안서 크게 보기 ↗</span></button><p class="proposal-insight">${esc(idea.insight)}</p><details><summary>사진 출처 · 종합 분석 근거 · 원본 사진 저장</summary><p>공식 ${idea.evidence.officialModels}모델 / 리테일 ${idea.evidence.retailModels}모델 / 뉴스레터 ${idea.evidence.articles}건이 문자 정보로 연결됩니다. 중복 색상은 모델별로 한 번만 집계합니다.</p><div class="proposal-source-list">${idea.references.map(r=>`<div>${sourceLink(r.url,r.credit+' · '+r.name)}<a href="${esc(r.image)}" download="MLB-reference-${esc(r.id)}.jpg">사진 저장 ${r.width}×${r.height} ↓</a><a href="${esc(r.original)}" download="reference-${esc(r.id)}-original">원본 ${r.originalWidth}×${r.originalHeight} ↓</a></div>`).join('')}</div><p><b>시즌 Forecast</b></p>${idea.forecast.map(f=>`<p>${sourceLink(f.url,`${f.title} · PDF p.${f.page}`)}</p>`).join('')}${idea.evidence.ranking.length?`<p><b>스토어 원문 순위 · 판매량 아님</b></p>${idea.evidence.ranking.map(r=>`<p>${sourceLink(r.url,`${r.board} ${r.rank}위 · ${r.name}`)}<small>${esc((r.checkedAt||'').slice(0,10))}${r.staleSince?' · 직전 집계':''} · ${esc(r.basis)}</small></p>`).join('')}`:''}${idea.evidence.articleSources.map(a=>`<p>${sourceLink(a.url,a.title)} <small>${esc((a.publishedAt||'').slice(0,10))}</small></p>`).join('')}<p>SNS 키워드 연결: ${esc(idea.evidence.social.join(', ')||'일치 없음')} · 누적 언급량을 미래 판매로 해석하지 않습니다.</p></details></article>`).join('');
}
function showBoard(id,overview=false){
 const idea=overview?null:snapshot.ideas.find(i=>i.id===id),board=overview?snapshot.seasonBoards[id]:idea;if(!board)return;
 opener=document.activeElement;const title=overview?`MLB ${id} 시즌 한 장 요약`:`MLB ${idea.season} · ${idea.title}`;
 $('proposal-viewer-title').textContent=title;$('proposal-viewer-image').src=proposalAsset(board.download);$('proposal-viewer-image').alt=title;$('proposal-viewer-image').classList.remove('actual-size');$('proposal-zoom').textContent='원본 크기로 확대';$('proposal-viewer-download').href=proposalAsset(board.download);$('proposal-viewer-download').download=`${overview?'MLB-'+id+'-SEASON':'MLB-'+idea.season+'-'+idea.id}-4800.png`;$('proposal-viewer').showModal();
}
export function bindResearchBrief(){
 $('research-brief').addEventListener('click',e=>{const s=e.target.closest('[data-proposal-season]');if(s){season=s.dataset.proposalSeason;void renderResearchBrief();return;}const idea=e.target.closest('[data-proposal]');if(idea)showBoard(idea.dataset.proposal);const overview=e.target.closest('[data-proposal-overview]');if(overview)showBoard(overview.dataset.proposalOverview,true);});
 $('proposal-close').onclick=()=>$('proposal-viewer').close();$('proposal-viewer').addEventListener('close',()=>opener?.focus());$('proposal-zoom').onclick=()=>{const expanded=$('proposal-viewer-image').classList.toggle('actual-size');$('proposal-zoom').textContent=expanded?'화면에 맞춤':'원본 크기로 확대';};
}
