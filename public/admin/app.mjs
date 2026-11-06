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

const visualCategories=[['low-profile','로우 프로파일'],['chunky','청키'],['retro-tech-runner','레트로 테크 러너'],['ballet-mary-jane','발레 · 메리제인'],['mule-slipper','뮬 · 슬리퍼'],['court-other','코트 · 기타'],['boot','부츠'],['sandal','샌들'],['performance','퍼포먼스 · 축구/육상']];
const visualDefinitions={
 'low-profile':'밑창이 얇고 전체적으로 낮고 길게 보이는 형태입니다. 단순히 발목 높이가 낮다는 뜻은 아닙니다.',
 chunky:'두껍고 돌출된 밑창이나 큰 볼륨이 중심인 형태입니다. 하이탑이라는 이유만으로 청키를 고르지 않습니다.',
 'retro-tech-runner':'복고 러너부터 현대적인 메시 러닝화까지 일반 러닝화의 형태를 검토합니다. 실제 운동 성능이 아니라 사진에서 보이는 러닝화 비례·패널 구조가 기준입니다.',
 'ballet-mary-jane':'발레 슈즈처럼 발등이 넓게 드러나거나 발등을 가로지르는 메리제인 스트랩이 중심인 형태입니다.',
 'mule-slipper':'뒤꿈치가 열린 뮬·슬리퍼 형태입니다. 끈이 없어도 뒤꿈치가 닫힌 슬립온은 이 항목으로 단정하지 않습니다.',
 'court-other':'일반적인 코트·테니스·농구화 형태와 다른 항목에 해당하지 않는 신발입니다. 스니커즈 하이탑을 부츠로 단정하지 않습니다.',
 boot:'부츠 특유의 몸통과 발목을 감싸는 구조가 보이는 형태입니다. 농구화·캔버스 하이탑과 구분합니다.',
 sandal:'발가락·발등이 드러나는 스트랩이나 열린 샌들 형태입니다. 뒤꿈치만 열린 뮬과 구분합니다.',
 performance:'축구화의 스터드·육상화의 스파이크 등 전용 경기 구조. 일반 러닝화는 레트로 테크 러너로 검토합니다.'
};
const visualLabel=id=>visualCategories.find(c=>c[0]===id)?.[1]||'분류 전';
const visualStatus={auto:'자동 분류', 'review-needed':'검수 필요',approved:'관리자 승인',excluded:'제외'};
const visualJobLabels={queued:'추가 학습 대기',running:'추가 학습 진행 중',completed:'추가 학습 작업 완료',held:'추가 학습 결과 보류',failed:'추가 학습 작업 실패'};
let visualData=null,visualPage=1,visualBatch='priority',visualPriorityBatch=null,visualLoading=false,visualSaving=false,visualTraining=false,visualJobLoading=false,visualZoom=1;
function validVisualBatch(batch){
 return !!batch&&typeof batch.id==='string'&&batch.id.length>0&&batch.id.length<=160&&['total','reviewed','approved','excluded','remaining'].every(k=>Number.isSafeInteger(batch[k])&&batch[k]>=0)&&batch.total>0&&batch.reviewed===batch.approved+batch.excluded&&batch.reviewed+batch.remaining===batch.total;
}
function visualCanTrain(){
 return visualBatch==='priority'&&validVisualBatch(visualPriorityBatch)&&visualPriorityBatch.remaining===0&&(!visualPriorityBatch.job||visualPriorityBatch.job.status==='failed')&&!visualLoading&&!visualSaving&&!visualTraining;
}
function visualJobSummary(job){
 const result=job?.result||job;if(!result)return '';
 const parts=[];
 if(typeof result.message==='string'&&result.message.trim())parts.push(result.message.slice(0,500));
 if(Array.isArray(result.releasedCategories)){
  const released=[...new Set(result.releasedCategories.filter(id=>visualCategories.some(c=>c[0]===id)))];
  parts.push(released.length?'기준 통과 범주: '+released.map(visualLabel).join(', '):'이번 결과에서 자동 반영할 기준 통과 범주 없음');
 }
 const splits=result.evaluation?.ownerSplitCounts;
 if(splits&&['train','calibration','test'].every(k=>Number.isSafeInteger(splits[k])&&splits[k]>=0))parts.push(`사용한 검수 사진: 학습 ${count(splits.train)} · 기준 조정 ${count(splits.calibration)} · 별도 확인 ${count(splits.test)}`);
 const metric=result.evaluation?.test;
 if(Number.isSafeInteger(metric?.n)&&metric.n>0&&Number.isFinite(metric.accuracy)&&metric.accuracy>=0&&metric.accuracy<=1)parts.push(`별도 확인 사진 ${count(metric.n)}개 · 일치율 ${(metric.accuracy*100).toFixed(1)}%`);
 return parts.join(' · ');
}
function renderVisualBatch(){
 const priority=visualBatch==='priority',batch=visualPriorityBatch,valid=validVisualBatch(batch);
 $('visual-batch-progress').hidden=!priority;$('visual-training').hidden=!priority;
 $('visual-batch-title').textContent=valid?(batch.title||'우선 검수 96개'):'우선 검수 96개';
 $('visual-progress').hidden=!valid;$('visual-progress').max=valid?batch.total:1;$('visual-progress').value=valid?batch.reviewed:0;
 $('visual-remaining').textContent=valid?`남은 검수 ${count(batch.remaining)}개`:'남은 검수 —';
 $('visual-progress-count').textContent=valid?`${count(batch.reviewed)} / ${count(batch.total)}개 저장 완료 · 승인 ${count(batch.approved)} · 제외 ${count(batch.excluded)}`:'우선 검수 진행 정보를 확인하고 있습니다.';
 const jobStatus=valid?batch.job?.status:null;
 $('visual-train-readiness').textContent=!valid?'우선 검수 진행 정보를 확인한 뒤 요청할 수 있습니다.':batch.remaining?`남은 ${count(batch.remaining)}개를 승인 또는 제외로 저장하면 요청할 수 있습니다.`:jobStatus==='completed'?'이 검수 배치의 학습 작업이 완료되었습니다. 중복 요청은 등록하지 않습니다.':jobStatus==='held'?'이 검수 배치의 결과는 보류 상태입니다. 아래 결과를 확인해 주세요.':jobStatus==='failed'?'이전 작업이 실패했습니다. 같은 검수 배치로 다시 요청할 수 있습니다.':['queued','running'].includes(jobStatus)?'이 검수 배치의 작업이 접수되어 있습니다. 완료 결과를 기다려 주세요.':'모든 검수가 저장되었습니다. 추가 학습 요청을 보낼 수 있습니다.';
 const job=valid?batch.job:null;
 const note=job?.status==='completed'?'검증 기준을 통과한 범주만 자동 반영됩니다. 작업 완료가 전체 범주의 반영을 의미하지 않습니다.':job?.status==='held'?'검증 또는 반영 조건을 확인해 주세요. 조건 충족 전에는 반영을 보류합니다.':job?.status==='failed'?'작업 상태를 확인한 뒤 다시 요청할 수 있습니다.':job?.status==='queued'?'PC의 예약 작업이 요청을 확인할 때까지 대기합니다.':job?.status==='running'?'백그라운드 작업이 실행 중입니다. 완료 결과가 도착하면 상태가 바뀝니다.':'';
 $('visual-train-job').textContent=job?`${visualJobLabels[job.status]||'작업 상태 확인 중'}${job.id?' · 작업 '+job.id:''}${note?' · '+note:''}`:'추가 학습 요청 전';
 $('visual-train-summary').textContent=visualJobSummary(job);$('visual-train-summary').hidden=!$('visual-train-summary').textContent;
 $('visual-train-request').disabled=!visualCanTrain();
}
function updateVisualControls(){
 const busy=visualLoading||visualSaving||visualTraining;
 for(const control of $('visual-panel').querySelectorAll('button,select'))control.disabled=busy;
 $('visual-prev').disabled=busy||!visualData||visualData.page<=1;
 $('visual-next').disabled=busy||!visualData||visualData.page*(visualData.pageSize||20)>=visualData.total;
 for(const button of $('visual-cards').querySelectorAll('[data-visual-action="approved"]'))button.disabled=busy||!$('visual-category-'+button.dataset.visualIndex)?.value;
 renderVisualBatch();
}
function visualCardMarkup(r,index){
 const blind=r.blindReview===true||r.reviewRole==='test',products=r.products||[],name=products.map(p=>`${p.brand} · ${p.name}`).join(' / ');
 const knownNonBlind=!blind&&['train','calibration'].includes(r.reviewRole);
 const chosen=r.review?.status==='approved'?r.review.category:'';
 const role=blind?'분류 기준 확인용 사진':r.reviewRole==='calibration'?'분류 기준 조정용 사진':'사진 검수';
 const score=n=>Number.isFinite(n)?(n*100).toFixed(1)+'%':'—';
 const suggestion=knownNonBlind&&r.category?`<details class="visual-suggestion"><summary>모델 제안 참고 · 정답 아님</summary><p>모델 제안: ${esc(visualLabel(r.category))} · 모델 점수 ${esc(score(r.confidence))} · 점수 차이 ${esc(score(r.margin))} (정확도와 다름)</p><p>다른 후보 점수: ${(r.alternatives||[]).map(a=>`${esc(visualLabel(a.category))} ${esc(score(a.score))}`).join(' · ')||'없음'}</p></details>`:'';
 return `<article class="visual-card" data-visual-hash="${esc(r.imageHash)}"><button class="visual-photo-open" type="button" data-visual-photo="${index}" aria-label="${esc(name||'검수 사진')} 크게 보기"><img src="/api/admin/visual-image/${esc(r.imageHash)}" alt="${esc(name||'검수할 신발 사진')}" loading="lazy" decoding="async" width="640" height="400"><span>사진 크게 보기 ↗</span></button><div><p class="visual-role">${esc(role)}</p><h3>${esc(products[0]?.brand||'사진 검수')}</h3><p class="visual-product-name">${esc(name)}</p><p><span class="tag">${esc(visualStatus[r.review?.status||r.status]||'검수 필요')}</span></p>${knownNonBlind&&r.reason?`<p class="hint">${esc(r.reason)}</p>`:''}<label for="visual-category-${index}">승인할 분류 · 직접 선택</label><select id="visual-category-${index}" data-visual-choice="${index}" aria-describedby="visual-category-hint-${index} visual-error-${index}"><option value="" ${chosen?'':'selected'}>분류를 선택하세요</option>${visualCategories.map(([id,label])=>`<option value="${id}" ${id===chosen?'selected':''}>${esc(label)}</option>`).join('')}</select><p id="visual-category-hint-${index}" class="hint">사진을 보고 분류를 선택하세요. 판단하기 어렵거나 사진이 부적절하면 제외할 수 있습니다.</p><p id="visual-error-${index}" class="visual-card-error" role="alert"></p><div class="visual-actions"><button data-visual-index="${index}" data-visual-action="approved" class="primary" type="button" ${chosen?'':'disabled'}>승인 · 저장하고 다음</button><button data-visual-index="${index}" data-visual-action="excluded" type="button">제외 · 저장하고 다음</button></div>${suggestion}<p class="hint">${r.review?`관리자 검수 ${esc(date(r.review.reviewedAt))} · revision ${esc(r.revision)}`:'관리자 검수 전'}</p></div></article>`;
}
function renderVisual(){
 const d=visualData;if(!d)return;
 $('visual-model').textContent=d.model?`모델 ${d.model.version} · ${d.model.encoder||'사진 분류'} · ${d.model.validated?'검증 완료':'자동 반영 보류'} · 동기화 ${date(d.updatedAt)}`:'모델 정보 확인 전';
 $('visual-stats').textContent=Object.entries(d.stats||{}).map(([key,value])=>`${visualStatus[key]||key} ${count(value)}건`).join(' · ');
 $('visual-page').textContent=`${d.page} / ${Math.max(1,Math.ceil(d.total/(d.pageSize||20)))} 페이지 · 필터 결과 ${count(d.total)}건`;
 $('visual-cards').innerHTML=(d.records||[]).map(visualCardMarkup).join('');
 if(visualBatch==='priority')visualPriorityBatch=validVisualBatch(d.batch)?d.batch:null;
 renderVisualBatch();
}
function visualQuery(){
 const query=new URLSearchParams({page:String(visualPage),brand:$('visual-brand').value,status:$('visual-status').value});
 if(visualBatch==='priority')query.set('batch','priority');return query;
}
async function loadVisual({message='',focusNext=false}={}){
 if(visualLoading||visualSaving)return;visualLoading=true;updateVisualControls();
 $('visual-cards').setAttribute('aria-busy','true');$('visual-cards').replaceChildren();$('visual-message').textContent='사진 검수 목록을 불러오는 중';
 try{
  if(!csrf){const session=await api('session');csrf=session.csrf;}
  let value=await api('visual-classifications?'+visualQuery());
  const lastPage=Math.max(1,Math.ceil(value.total/(value.pageSize||20)));
  if(visualPage>lastPage){visualPage=lastPage;value=await api('visual-classifications?'+visualQuery());}
  visualData=value;renderVisual();
  $('visual-message').textContent=message||((value.records||[]).length?'사진을 보고 분류를 선택한 뒤 저장하세요. 기본 보기에서는 저장한 사진이 목록에서 사라집니다.':visualBatch==='priority'&&visualPriorityBatch?.remaining===0?'우선 검수가 모두 저장되었습니다. 아래에서 추가 학습을 요청할 수 있습니다.':'조건에 맞는 미완료 사진이 없습니다. 브랜드·검수 상태 필터를 확인해 주세요.');
  const brands=new Set([...$('visual-brand').options].map(o=>o.value));
  for(const brand of (data?.brands||[]).map(b=>b.brand).concat((value.records||[]).flatMap(r=>(r.products||[]).map(p=>p.brand))).filter(Boolean).sort())if(!brands.has(brand)){const option=document.createElement('option');option.value=brand;option.textContent=brand;$('visual-brand').append(option);brands.add(brand);}
 }catch(error){$('visual-message').textContent=[message,error.message].filter(Boolean).join(' ');}
 finally{visualLoading=false;$('visual-cards').setAttribute('aria-busy','false');updateVisualControls();}
 if(focusNext){const next=$('visual-cards').querySelector('select');if(next){next.focus({preventScroll:true});next.closest('.visual-card')?.scrollIntoView({block:'start'});}else if(visualCanTrain())$('visual-train-request').focus();}
}
async function refreshVisualJob({force=false}={}){
 if(visualJobLoading||visualLoading||visualSaving||!force&&visualTraining)return;
 visualJobLoading=true;
 try{const result=await api('visual-classifications?'+new URLSearchParams({batch:'priority',page:'1',status:'review-needed'}));if(validVisualBatch(result.batch)){visualPriorityBatch=result.batch;renderVisualBatch();}}
 catch(error){$('visual-train-message').textContent='작업 상태를 확인하지 못했습니다. 목록 새로고침으로 다시 확인해 주세요.';}
 finally{visualJobLoading=false;}
}
function setVisualZoom(value){
 visualZoom=Math.max(1,Math.min(3,value));$('visual-photo-image').style.width=`${visualZoom*100}%`;$('visual-photo-image').style.maxHeight=visualZoom>1?'none':'';
 $('visual-zoom-value').textContent=`${Math.round(visualZoom*100)}%`;$('visual-zoom-out').disabled=visualZoom===1;$('visual-zoom-in').disabled=visualZoom===3;
}
function openVisualPhoto(index){
 const record=visualData?.records?.[index];if(!record)return;
 const name=(record.products||[]).map(p=>`${p.brand} · ${p.name}`).join(' / ');
 $('visual-photo-name').textContent=name;$('visual-photo-image').src='/api/admin/visual-image/'+record.imageHash;$('visual-photo-image').alt=name||'검수할 신발 사진';setVisualZoom(1);$('visual-photo-dialog').showModal();
}
// Visual review interactions.
$('visual-definitions').innerHTML=visualCategories.map(([id,label])=>`<div><dt>${esc(label)}</dt><dd>${esc(visualDefinitions[id])}</dd></div>`).join('');
$('visual-review-open').addEventListener('click',()=>{$('visual-panel').open=true;$('visual-panel').scrollIntoView({block:'start',behavior:'smooth'});});
$('visual-panel').addEventListener('toggle',()=>{if($('visual-panel').open&&!visualData)void loadVisual();});
for(const id of ['visual-brand','visual-status'])$(id).addEventListener('change',()=>{visualPage=1;void loadVisual();});
for(const button of document.querySelectorAll('[data-visual-batch]'))button.addEventListener('click',()=>{if(visualLoading||visualSaving||visualTraining)return;visualBatch=button.dataset.visualBatch;visualPage=1;for(const tab of document.querySelectorAll('[data-visual-batch]')){const active=tab.dataset.visualBatch===visualBatch;tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',String(active));}void loadVisual();});
$('visual-refresh').addEventListener('click',()=>void loadVisual());
$('visual-prev').addEventListener('click',()=>{visualPage--;void loadVisual();});
$('visual-next').addEventListener('click',()=>{visualPage++;void loadVisual();});
$('visual-cards').addEventListener('change',event=>{const index=event.target.dataset.visualChoice;if(index!==undefined){$('visual-error-'+index).textContent='';updateVisualControls();}});
$('visual-cards').addEventListener('click',async event=>{
 const photo=event.target.closest('[data-visual-photo]');if(photo){openVisualPhoto(Number(photo.dataset.visualPhoto));return;}
 const button=event.target.closest('[data-visual-action]');if(!button||visualSaving||visualLoading||visualTraining)return;
 const index=Number(button.dataset.visualIndex),record=visualData?.records?.[index];if(!record)return;
 const status=button.dataset.visualAction,category=status==='approved'?$('visual-category-'+index).value:null;
 if(status==='approved'&&!visualCategories.some(c=>c[0]===category)){$('visual-error-'+index).textContent='사진을 보고 승인할 분류를 직접 선택해 주세요.';$('visual-category-'+index).focus();return;}
 visualSaving=true;updateVisualControls();let message,success=false;
 try{await api('visual-classifications/review',{method:'POST',body:JSON.stringify({imageHash:record.imageHash,category,status,expectedModelVersion:record.modelVersion,expectedRevision:record.revision})});message='검수 결과를 저장했습니다. 직원 화면을 다시 불러오면 반영됩니다.';success=true;}
 catch(error){message=error.message;}
 finally{visualSaving=false;}
 if(success&&$('visual-status').value==='review-needed')visualPage=1;
 await loadVisual({message,focusNext:success});
});
$('visual-train-request').addEventListener('click',async()=>{
 if(!visualCanTrain())return;visualTraining=true;updateVisualControls();$('visual-train-message').textContent='추가 학습 요청을 보내는 중입니다.';
 try{
  const result=await api('visual-classifications/train',{method:'POST',body:JSON.stringify({batchId:visualPriorityBatch.id})});
  if(validVisualBatch(result.batch))visualPriorityBatch=result.batch;
  const job=result.job||result.batch?.job||(result.id&&visualJobLabels[result.status]?result:null);
  if(job)visualPriorityBatch={...visualPriorityBatch,job};else await refreshVisualJob({force:true});
  $('visual-train-message').textContent='요청을 접수했습니다. 아래 작업 상태를 확인하세요.';
 }catch(error){$('visual-train-message').textContent=error.message;}
 finally{visualTraining=false;updateVisualControls();}
});
$('visual-photo-close').addEventListener('click',()=>$('visual-photo-dialog').close());
$('visual-zoom-in').addEventListener('click',()=>setVisualZoom(visualZoom+.5));$('visual-zoom-out').addEventListener('click',()=>setVisualZoom(visualZoom-.5));$('visual-zoom-reset').addEventListener('click',()=>setVisualZoom(1));
$('visual-photo-dialog').addEventListener('click',event=>{if(event.target!==event.currentTarget)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.currentTarget.close();});
setInterval(()=>{if(!document.hidden&&$('visual-panel').open&&['queued','running'].includes(visualPriorityBatch?.job?.status))void refreshVisualJob();},30000);
