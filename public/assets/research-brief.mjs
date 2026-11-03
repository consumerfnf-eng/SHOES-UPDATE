import {csvBytes} from './export.mjs';
import {safeUrl} from './catalog-view.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null?'미확인':Math.round(v/1000).toLocaleString('ko-KR')+'천원';
const link=(url,label)=>safeUrl(url)?`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:'';
export const REVIEW_STAGES=[['idea','기획 가설'],['sample','샘플 진행'],['review','내부 검토'],['test','반응 검증'],['complete','결과 정리']];
const STORAGE='shoes-research-review-v1';
const $=id=>document.getElementById(id);
let snapshot=null,request=null,rendered=false,reviews={},view='brief';
export function validateReviewBoard(value){
 if(value?.schemaVersion!==1||!value.records||typeof value.records!=='object'||Array.isArray(value.records))throw Error('지원하지 않는 검증 보드입니다.');
 const out={};
 for(const [id,row] of Object.entries(value.records)){
  if(!/^style-[a-z0-9-]+:v\d+$/.test(id)||!REVIEW_STAGES.some(([v])=>v===row?.stage))throw Error('유효하지 않은 기획 항목입니다.');
  if(['metric','baseline','result','decision'].some(k=>typeof row[k]!=='string'||row[k].length>5000)||!Number.isFinite(Date.parse(row.updatedAt)))throw Error('검증 기록 형식이 올바르지 않습니다.');
  out[id]={stage:row.stage,metric:row.metric,baseline:row.baseline,result:row.result,decision:row.decision,updatedAt:row.updatedAt};
 }
 return out;
}
export function mergeReviewBoards(current,incoming){const merged={...current};for(const [id,row] of Object.entries(incoming))if(!merged[id]||Date.parse(row.updatedAt)>Date.parse(merged[id].updatedAt))merged[id]=row;return merged;}
const key=idea=>`${idea.id}:v${snapshot.planVersion}`;
const emptyRecord=()=>({stage:'idea',metric:'',baseline:'',result:'',decision:'',updatedAt:new Date().toISOString()});
function readReviews(){try{reviews=validateReviewBoard(JSON.parse(localStorage.getItem(STORAGE)));}catch{reviews={};}}
function save(){try{localStorage.setItem(STORAGE,JSON.stringify({schemaVersion:1,records:reviews}));$('review-save-status').textContent='이 브라우저에 저장했습니다. 다른 기기와 공유하려면 JSON 백업을 이용하세요.';}catch{$('review-save-status').textContent='브라우저 저장에 실패했습니다. JSON 백업으로 기록을 보관하세요.';}}
const changeText=c=>c?.ready?`4주간 구성비 ${c.percentagePoints>=0?'+':''}${c.percentagePoints.toFixed(1)}%p`:`4주 추이: ${c?.weeks||0}/4주 누적 · 증감 미산출`;
export function briefExportHtml(data,records={}){
 const rows=data.ideas.map(i=>{const r=records[`${i.id}:v${data.planVersion}`];return `<tr><td><b>${i.rank}. ${esc(i.label)}</b><br>${i.models}개 모델 · 출처 ${i.independentDomains}곳<br>${esc(changeText(i.change))}<br>${i.sources.slice(0,2).map(s=>link(s.url,s.source)).join(' · ')}</td><td>${esc(i.plan?.interpretation||'해석 작성 대기')}<br><small>${esc(i.plan?.target||'')}</small></td><td><b>MLB</b> ${esc(i.plan?.mlb||'초안 작성 대기')}<br><b>DISCOVERY</b> ${esc(i.plan?.discovery||'초안 작성 대기')}</td><td>${esc(i.plan?.test||'검증 방법 작성 대기')}<br><b>다음 행동</b> ${esc(i.plan?.next||'')}<br>${r?`<b>기록</b> ${esc(r.metric)} / ${esc(r.result)} / ${esc(r.decision)}`:'검증 결과 미기록'}</td></tr>`;}).join('');
 return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>SHOES 주간 기획 브리프 ${esc(data.asOf)}</title><style>@page{size:A4 landscape;margin:9mm}*{box-sizing:border-box}body{font-family:Arial,"Malgun Gothic",sans-serif;margin:18px;color:#14253b;font-size:12px;line-height:1.45}h1{font-size:22px;margin:0 0 4px}p{margin:5px 0}table{border-collapse:collapse;width:100%;margin-top:12px;table-layout:fixed}th,td{border:1px solid #dce3ed;padding:9px;vertical-align:top;overflow-wrap:anywhere}th{background:#eef4fc;text-align:left}td{font-size:11px}a{color:#1556aa}small{color:#627086}@media print{body{margin:0;font-size:10px}td{font-size:9px;padding:6px}h1{font-size:17px}tr{break-inside:avoid}}</style><h1>SHOES 주간 기획 브리프</h1><p>${esc(data.asOf)} · 근거 확인 ${esc(data.evidenceCapturedAt?.slice(0,10)||'미확인')} · 공식 카탈로그 ${data.scope.models}개 모델</p><p>관찰과 기획 가설을 구분합니다. 외부 랭킹은 판매량·시장점유율이 아니며 4주 미만 관측에서 증감을 만들지 않습니다.</p><table><thead><tr><th>TOP 5 · 관찰 근거</th><th>해석 · 타깃 가설</th><th>브랜드별 기획 가설</th><th>검증 · 다음 행동</th></tr></thead><tbody>${rows}</tbody></table><p><small>${esc(data.scope.description)} · 색상 변형 중복 집계 제외</small></p></html>`;
}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function renderBoard(){
 $('review-board').innerHTML=snapshot.ideas.map(i=>{const r=reviews[key(i)]||emptyRecord();return `<article class="review-item" data-review-id="${esc(key(i))}"><header><h3>${esc(i.label)}</h3><label>진행 단계<select data-review-field="stage">${REVIEW_STAGES.map(([v,n])=>`<option value="${v}" ${r.stage===v?'selected':''}>${n}</option>`).join('')}</select></label></header><p>${esc(i.plan?.test||'검증 방법 작성 대기')}</p><div class="review-fields">${[['metric','검증 지표·관측 기간'],['baseline','비교안·동일 노출 조건'],['result','실제 결과'],['decision','판단·후속 행동']].map(([k,label])=>`<label>${label}<textarea data-review-field="${k}" maxlength="5000" rows="2" placeholder="직접 확인한 값을 기록하세요">${esc(r[k])}</textarea></label>`).join('')}</div></article>`;}).join('');
 $('review-board').querySelectorAll('[data-review-field]').forEach(input=>input.addEventListener('change',()=>{const host=input.closest('[data-review-id]'),id=host.dataset.reviewId;const value=reviews[id]||emptyRecord();reviews[id]={...value,[input.dataset.reviewField]:input.value,updatedAt:new Date().toISOString()};save();}));
}
export async function renderResearchBrief(){
 if(rendered)return;
 $('brief-status').textContent='검증된 근거와 기획안을 불러오고 있습니다.';
 request??=fetch('./data/research-brief.json',{cache:'no-cache'}).then(async r=>{if(!r.ok)throw Error(r.status);const data=await r.json();if(data.schemaVersion!==1||!Array.isArray(data.ideas))throw Error('Invalid brief');return data;});
 try{snapshot=await request;}catch{request=null;$('brief-status').textContent='업무 브리프를 불러오지 못했습니다. 새로고침하면 다시 시도합니다.';return;}
 readReviews();
 $('brief-status').textContent=`${snapshot.asOf} 기준 · TOP ${snapshot.ideas.length} · 근거 확인 ${snapshot.evidenceCapturedAt?.slice(0,10)||'미확인'} · 모델 기준`;
 $('brief-scope').textContent=snapshot.scope.description;
 $('brief-ideas').innerHTML=snapshot.ideas.map(i=>`<article class="brief-card"><header><div><span class="brief-rank">TOP ${i.rank}</span><h3>${esc(i.label)}</h3><p class="muted">${esc(i.englishLabel)}</p></div><span class="brief-count">${i.models.toLocaleString()}<small>관측 모델</small></span></header><div class="brief-stats"><span>교차 출처 ${i.independentDomains}곳</span><span>원문 랭킹 참고 ${i.ranking.length}개</span><span>${esc(changeText(i.change))}</span></div><p class="brief-observation"><b>관찰</b> 출처에서 이 스타일을 확인했습니다. 순위·언급은 판매량 증가를 의미하지 않습니다.</p><p><b>해석</b> ${esc(i.plan?.interpretation||'해석 작성 대기')}</p><div class="brief-proposals"><p><b>MLB 가설</b> ${esc(i.plan?.mlb||'초안 작성 대기')}</p><p><b>DISCOVERY 가설</b> ${esc(i.plan?.discovery||'초안 작성 대기')}</p></div><p class="brief-next"><b>다음 행동</b> ${esc(i.plan?.next||'출처 확인 후 초안 작성')}</p><details><summary>근거·기획 사양·검증 방법</summary><p><b>목표 타깃 가설</b> ${esc(i.plan?.target||'미설정')}</p><p><b>검증</b> ${esc(i.plan?.test||'작성 대기')}</p><p><b>가격 참고</b> ${i.prices.models?`${money(i.prices.p25)}–${money(i.prices.p75)} · ${i.prices.models}개 모델`:'가격 근거 미확인'}<br><small>${esc(i.prices.note)} ${esc(i.prices.rateNote||'')}</small></p><div class="brief-links">${i.sources.map(s=>link(s.url,`${s.source} · ${s.kind} · ${(s.capturedAt||'').slice(0,10)}`)).join('')}</div>${i.ranking.length?`<h4>스토어 랭킹 참고 · 판매량 미공개</h4>${i.ranking.map(r=>`<p>${link(r.url,`${r.board} ${r.rank}위 · ${r.name}`)}<br><small>${esc(r.basis)} · ${(r.checkedAt||'').slice(0,10)}</small></p>`).join('')}`:''}<p><b>CATWALK 태그 연결</b> ${i.visuals}장 · 스니커즈 외 풋웨어를 포함한 비주얼 참고</p>${i.future.length?`<h4>Forecast 연결 · 수요 근거와 별도</h4>${i.future.map(f=>link(f.url,`${f.season} · ${f.title}`)).join('<br>')}`:''}</details></article>`).join('');
 renderBoard();rendered=true;
}
export function bindResearchBrief(){
 document.querySelectorAll('[data-brief-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.briefView;$('brief-ideas').hidden=view!=='brief';$('review-panel').hidden=view!=='review';document.querySelectorAll('[data-brief-view]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});}));
 $('brief-html').onclick=()=>{if(snapshot)download(`SHOES-brief-${snapshot.asOf}.html`,briefExportHtml(snapshot,reviews),'text/html;charset=utf-8');};
 $('brief-csv').onclick=()=>{if(snapshot)download(`SHOES-brief-${snapshot.asOf}.csv`,csvBytes([['순위','키워드','관측 모델','출처 수','해석','MLB 가설','DISCOVERY 가설','검증','후속 행동'],...snapshot.ideas.map(i=>[i.rank,i.label,i.models,i.independentDomains,i.plan?.interpretation||'',i.plan?.mlb||'',i.plan?.discovery||'',i.plan?.test||'',i.plan?.next||''])]),'text/csv;charset=utf-8');};
 $('review-export').onclick=()=>download('SHOES-review-backup.json',JSON.stringify({schemaVersion:1,records:reviews},null,2),'application/json');
 $('review-import').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2*1024*1024)throw Error('2MB 이하의 백업을 선택하세요.');const incoming=validateReviewBoard(JSON.parse(await file.text()));reviews=mergeReviewBoards(reviews,incoming);save();renderBoard();}catch(error){$('review-save-status').textContent=error.message;}e.target.value='';});
}
