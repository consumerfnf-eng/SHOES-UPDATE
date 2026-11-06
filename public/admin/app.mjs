const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={checked:'점검 완료',partial:'부분 점검',blocked:'접근 확인 필요',stale:'수집 지연','check-needed':'점검 필요',queued:'대기',running:'실행 중',completed:'결과 확인',failed:'재시도 필요'};
const date=value=>{const time=Date.parse(value);return Number.isFinite(time)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(time):'—';};
const count=n=>Number(n||0).toLocaleString('ko-KR');
const delta=n=>n==null?'—':n>0?'+'+count(n):String(n);
let data=null,csrf='',loading=false,expiryTimer;
const attention=row=>row.status!=='checked'||row.officialModels===0||row.modelDelta<0;
async function api(path,options={}){const response=await fetch('/api/admin/'+path,{...options,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{}),...options.headers}});if(response.status===401){location.replace('/admin/login');throw Error('관리자 로그인이 필요합니다.');}const result=await response.json();if(!response.ok)throw Error(result.error||'요청을 다시 시도해 주세요.');return result;}
function render(){
 if(!data)return;const rows=data.brands,jobs=data.jobs||[],pending=data.activeJobs||jobs.filter(j=>['queued','running'].includes(j.status));
 $('stat-brands').textContent=count(rows.length);$('stat-attention').textContent=count(rows.filter(attention).length);$('stat-zero').textContent=count(rows.filter(r=>!r.officialModels).length);$('stat-jobs').textContent=count(pending.length);
 $('bulk-open').disabled=false;$('bulk-attention-count').textContent=count(rows.filter(attention).length);$('bulk-all-count').textContent=count(rows.length);
 $('snapshot-date').textContent=`게시 현황 ${date(data.generatedAt)}${data.comparedAt?' · 비교 기준 '+date(data.comparedAt):''}`;$('workflow-link').href=data.workflowUrl;
 const search=$('brand-search').value.trim().toLowerCase(),group=$('group-filter').value,status=$('status-filter').value;
 const filtered=rows.filter(r=>(!search||r.brand.toLowerCase().includes(search))&&(group==='all'||r.group===group)&&(status==='all'||status==='attention'&&attention(r)||status==='zero'&&!r.officialModels||status==='decreased'&&r.modelDelta<0));
 $('brands').innerHTML=filtered.map(r=>{const active=pending.find(j=>j.brand===r.brand);return `<tr><td><strong>${esc(r.brand)}</strong><small>${esc(r.group)}</small>${r.sources?.length?`<details><summary>공식 수집 경로</summary><ul>${r.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a></li>`).join('')}</ul></details>`:''}</td><td>${esc(date(r.lastCheckAt))}${r.lastVerifiedAt?`<small>게시 상품 확인 ${esc(date(r.lastVerifiedAt))}</small>`:''}</td><td><strong>${count(r.officialModels)}</strong> 모델<small>${count(r.officialRecords)} 컬러·소재 기록</small></td><td class="delta ${r.modelDelta<0?'down':r.modelDelta>0?'up':''}">${esc(delta(r.modelDelta))} 모델<small>${esc(delta(r.recordDelta))} 컬러·소재</small></td><td><span class="tag ${esc(r.status)}">${esc(labels[r.status]||r.status)}</span>${r.errors?.length?`<details><summary>점검 내역 ${r.errors.length}건</summary><ul>${r.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></details>`:''}</td><td><button class="quiet" data-recollect="${esc(r.brand)}" ${active?'disabled':''}>${active?esc(labels[active.status]):'재수집 요청'}</button></td></tr>`;}).join('');$('brand-empty').hidden=filtered.length>0;
 const batch=data.batch,progress=$('batch-progress');progress.hidden=!batch;
 if(batch){const c=batch.counts,finished=(c.completed||0)+(c.partial||0)+(c.failed||0);progress.innerHTML=`<div><strong>최근 일괄 재수집 · ${count(batch.target_count)}개 브랜드</strong><span>${esc(date(batch.created_at))}</span></div><progress max="${batch.target_count}" value="${finished}" aria-label="일괄 재수집 진행 상황"></progress><p>점검 완료 ${count(c.completed)} · 부분 점검 ${count(c.partial)} · 재시도 필요 ${count(c.failed)} · 실행 중 ${count(c.running)} · 대기 ${count(c.queued)}</p>`;}
 $('jobs').innerHTML=jobs.length?jobs.slice(0,25).map(j=>`<article class="job"><div class="job-head"><strong>${esc(j.brand)}</strong><span class="tag ${esc(j.status)}">${esc(labels[j.status]||j.status)}</span><small>${esc(date(j.requested_at))} 요청</small>${j.run_url?`<a href="${esc(j.run_url)}" target="_blank" rel="noopener noreferrer">실행 기록 ↗</a>`:''}</div>${j.result?`<p class="hint">${esc(date(j.result.checkedAt))} 점검${j.result.status==='failed'?' · 재수집 내역 확인 필요':` · 목록 ${count(j.result.listingPages)}페이지 · 수집 확인 ${count(j.result.verified)}기록 · 게시 대조 후보 ${count(j.result.candidates.length)}건${j.result.exhaustive?' · 페이지 종료 확인':''}`}</p>${j.result.candidates.length?`<details><summary>게시 대조 후보 보기</summary><ul>${j.result.candidates.map(p=>`<li><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.name||p.style)} ↗</a>${p.style?' · '+esc(p.style):''}</li>`).join('')}</ul></details>`:''}${j.result.errors?.length?`<details><summary>수집 점검 내역</summary><ul>${j.result.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></details>`:''}`:''}</article>`).join(''):'<p class="hint">브랜드 오른쪽의 재수집 요청으로 점검 시작</p>';
}
async function refresh(){if(loading)return;loading=true;$('refresh').disabled=true;try{if(!csrf){const session=await api('session');csrf=session.csrf;clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>location.replace('/admin/login'),Math.max(0,session.expires*1000-Date.now()));}data=await api('status');render();$('message').textContent='관리자 전용 인증 적용 · 수집 7일 경과·게시 0건·게시 수 감소 자동 표시';}catch(error){$('message').textContent=error.message;}finally{loading=false;$('refresh').disabled=false;}}
for(const id of ['brand-search','group-filter','status-filter'])$(id).addEventListener(id==='brand-search'?'input':'change',render);
$('refresh').addEventListener('click',refresh);
$('bulk-open').addEventListener('click',()=>{$('bulk-message').textContent='';$('bulk-dialog').showModal();});
$('bulk-close').addEventListener('click',()=>$('bulk-dialog').close());
$('bulk-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('bulk-submit');if(button.disabled)return;button.disabled=true;try{const scope=new FormData(event.currentTarget).get('bulk-scope'),result=await api('recollect-all',{method:'POST',body:JSON.stringify({scope})});$('bulk-dialog').close();await refresh();$('message').textContent=`전체 ${result.selected}개 브랜드 · 신규 등록 ${result.queued}개 · 기존 대기·실행 ${result.alreadyActive}개`; }catch(error){$('bulk-message').textContent=error.message;}finally{button.disabled=false;}});

$('brands').addEventListener('click',async event=>{const button=event.target.closest('[data-recollect]');if(!button||button.disabled)return;button.disabled=true;try{await api('recollect',{method:'POST',body:JSON.stringify({brand:button.dataset.recollect})});await refresh();$('message').textContent=`${button.dataset.recollect} 재수집 요청 등록 · 예약 작업에서 순차 실행`; }catch(error){$('message').textContent=error.message;button.disabled=false;}});
$('logout').addEventListener('click',async()=>{try{await api('logout',{method:'POST',body:'{}'});location.replace('/admin/login');}catch(error){$('message').textContent=error.message;}});
$('password-open').addEventListener('click',()=>{$('password-form').reset();$('password-message').textContent='';$('password-dialog').showModal();});
$('password-close').addEventListener('click',()=>$('password-dialog').close());
$('password-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=$('password-submit');if(button.disabled)return;
 if($('new-password').value!==$('confirm-password').value){$('password-message').textContent='새 비밀번호와 확인 입력을 동일하게 입력해 주세요.';return;}
 button.disabled=true;try{await api('password',{method:'POST',body:JSON.stringify({currentPassword:$('current-password').value,newPassword:$('new-password').value})});$('password-form').reset();location.replace('/admin/login?changed=1');}catch(error){$('password-message').textContent=error.message;}finally{button.disabled=false;}
});
setInterval(()=>{if(!document.hidden&&(data?.activeJobs||data?.jobs)?.some(j=>['queued','running'].includes(j.status)))void refresh();},30000);
void refresh();

const visualCategories=[['low-profile','로우 프로파일'],['chunky','청키'],['retro-tech-runner','레트로 테크 러너'],['ballet-mary-jane','발레 · 메리제인'],['mule-slipper','뮬 · 슬리퍼'],['court-other','코트 · 기타'],['boot','부츠'],['sandal','샌들'],['performance','퍼포먼스']];
const visualLabel=id=>visualCategories.find(c=>c[0]===id)?.[1]||id;
const visualStatus={auto:'자동 분류','review-needed':'검수 필요',approved:'관리자 승인',excluded:'제외'};
let visualData=null,visualPage=1,visualLoading=false,visualSaving=false;
function renderVisual(){
 const d=visualData;if(!d)return;
 $('visual-model').textContent=d.model?`모델 ${d.model.version} · ${d.model.encoder} · 검증 ${d.model.validated?'완료':'미완료'} · 동기화 ${date(d.updatedAt)} · 모델 점수는 정확도가 아닙니다. 사진 검수 기준 표본과의 일치율과 구분해 해석해 주세요.`:'동기화된 모델이 없습니다.';
 $('visual-stats').textContent=Object.entries(d.stats).map(([key,value])=>`${visualStatus[key]||key} ${count(value)}건`).join(' · ');
 $('visual-page').textContent=`${d.page} / ${Math.max(1,Math.ceil(d.total/20))} 페이지 · 필터 결과 ${count(d.total)}건`;
 $('visual-prev').disabled=d.page<=1;$('visual-next').disabled=d.page*20>=d.total;
 $('visual-cards').innerHTML=d.records.map((r,i)=>{
  const chosen=r.review?.category||r.category,products=r.products||[],name=products.map(p=>`${p.brand} · ${p.name}`).join(' / ');
  return `<article class="visual-card"><img src="/api/admin/visual-image/${esc(r.imageHash)}" alt="${esc(name)}" loading="lazy" decoding="async" width="320" height="220"><div><h3>${esc(products[0]?.brand||'사진 검수')}</h3><p class="visual-product-name">${esc(name)}</p><p><span class="tag">${esc(visualStatus[r.review?.status||r.status])}</span></p><p class="hint">모델 제안: ${esc(visualLabel(r.category))} · 모델 점수 ${(r.confidence*100).toFixed(1)}% · 점수 차이 ${(r.margin*100).toFixed(1)}% (정확도와 다름)</p><p class="hint">다른 후보 점수: ${r.alternatives.map(a=>`${esc(visualLabel(a.category))} ${(a.score*100).toFixed(1)}%`).join(' · ')||'없음'}</p><label for="visual-category-${i}">승인할 분류</label><select id="visual-category-${i}">${visualCategories.map(([id,label])=>`<option value="${id}" ${id===chosen?'selected':''}>${esc(label)}</option>`).join('')}</select><p class="hint">${r.review?`관리자 검수 ${esc(date(r.review.reviewedAt))} · revision ${r.revision}`:'관리자 검수 전'}</p><div class="visual-actions"><button data-visual-index="${i}" data-visual-action="approved" type="button">분류 승인</button><button data-visual-index="${i}" data-visual-action="excluded" type="button">사진 제외</button></div></div></article>`;
 }).join('');
}
async function loadVisual(){
 if(visualLoading||visualSaving)return;visualLoading=true;$('visual-refresh').disabled=true;$('visual-brand').disabled=true;$('visual-status').disabled=true;
 $('visual-prev').disabled=true;$('visual-next').disabled=true;$('visual-cards').replaceChildren();$('visual-message').textContent='사진 검수 목록을 불러오는 중';
 try{
  if(!csrf){const session=await api('session');csrf=session.csrf;}
  const query=new URLSearchParams({page:String(visualPage),brand:$('visual-brand').value,status:$('visual-status').value});
  visualData=await api('visual-classifications?'+query);renderVisual();$('visual-message').textContent=visualData.records.length?'한 페이지에 사진 20건씩 표시합니다.':'조건에 맞는 사진이 없습니다.';
  const brands=new Set([...$('visual-brand').options].map(o=>o.value));
  for(const brand of (data?.brands||[]).map(b=>b.brand).concat(visualData.records.flatMap(r=>r.products.map(p=>p.brand))).sort())if(!brands.has(brand)){const option=document.createElement('option');option.value=brand;option.textContent=brand;$('visual-brand').append(option);brands.add(brand);}
 }catch(error){$('visual-message').textContent=error.message;}finally{visualLoading=false;$('visual-refresh').disabled=false;$('visual-brand').disabled=false;$('visual-status').disabled=false;}
}
$('visual-panel').addEventListener('toggle',()=>{if($('visual-panel').open&&!visualData)void loadVisual();});
for(const id of ['visual-brand','visual-status'])$(id).addEventListener('change',()=>{visualPage=1;void loadVisual();});
$('visual-refresh').addEventListener('click',()=>void loadVisual());
$('visual-prev').addEventListener('click',()=>{visualPage--;void loadVisual();});
$('visual-next').addEventListener('click',()=>{visualPage++;void loadVisual();});
$('visual-cards').addEventListener('click',async event=>{
 const button=event.target.closest('[data-visual-action]');if(!button||visualSaving||visualLoading)return;
 const index=Number(button.dataset.visualIndex),r=visualData.records[index];if(!r)return;
 const status=button.dataset.visualAction,category=status==='approved'?$('visual-category-'+index).value:null;
 visualSaving=true;for(const control of $('visual-panel').querySelectorAll('button,select'))control.disabled=true;
 try{await api('visual-classifications/review',{method:'POST',body:JSON.stringify({imageHash:r.imageHash,category,status,expectedModelVersion:r.modelVersion,expectedRevision:r.revision})});$('visual-message').textContent='검수 결과를 저장했습니다. 직원 화면을 다시 불러오면 반영됩니다.';}
 catch(error){$('visual-message').textContent=error.message;}
 finally{visualSaving=false;for(const control of $('visual-panel').querySelectorAll('button,select'))control.disabled=false;}
 const message=$('visual-message').textContent;await loadVisual();$('visual-message').textContent=message;
});
