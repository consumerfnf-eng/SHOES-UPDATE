import {listBoards,newBoard,saveBoard,getBoardAsset,snapshotSource,boardPages,boardBackup,importBoardBackup,safeSourceUrl} from './board-store.mjs';
import {drawBoardPage,exportBoardPages,sourceCredit} from './board-export.mjs';
import {suggestBoardTags} from './board-tags.mjs';
import {loadSeasonProposalData} from './research-brief.mjs';
import {zipStored} from './export.mjs';
import {autoCropAsset} from './board-crop.mjs';
import {bindPhotoEditor,openPhotoEditor} from './board-photo-editor.mjs';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let boards=[],active='',season='all',search='',page=0,ready=null,queue=Promise.resolve(),pending=[],assets=new Map(),urls=new Map(),history=new Map(),previewTimer,previewToken=0,dragged='',navigate=()=>{},busy=false,saveFailed=false,saveCount=0;
let research=null,tagContext=()=>({}),notify=()=>{},templateSeason='27SS';
const tagsFor=project=>suggestBoardTags(project,{...tagContext(),ideas:research?.ideas||[]}).join(' ');
function applyAutoTags(b){b.tagsMode='auto';b.tags=tagsFor(b.project);}
const current=()=>boards.find(b=>b.id===active);
const selectedProjects=new Set();let deletingProjects=false;
function message(text,error=false){$('board-message').textContent=text;$('board-message').classList.toggle('error',error);}
function status(text,error=false){$('board-save-status').textContent=text;$('board-save-status').classList.toggle('error',error);}
async function init(){if(!ready)ready=Promise.all([listBoards(),loadSeasonProposalData().catch(()=>null)]).then(([rows,data])=>{boards=rows;research=data;}).catch(e=>{ready=null;throw e;});await ready;}
function remember(b){const rows=history.get(b.id)||[];rows.push(structuredClone(b));history.set(b.id,rows.slice(-20));}
function persist(b,newAssets=[]){
 const snapshot=structuredClone(b);saveCount++;status('저장 중…');queue=queue.catch(()=>{}).then(async()=>{snapshot.revision=b.revision;const saved=await saveBoard(snapshot,newAssets);b.revision=saved.revision;b.updatedAt=saved.updatedAt;saveFailed=false;renderLibrary();}).catch(e=>{saveFailed=true;status('저장 실패 · 백업 파일을 먼저 저장하세요',true);message(e.message||'저장 공간을 확인해 주세요.',true);}).finally(()=>{saveCount--;if(!saveCount&&!saveFailed)status('자동 저장 완료 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));});return queue;
}
export async function flushReferenceBoards(){await queue;if(saveFailed)throw Error('보드를 저장하지 못했습니다. 백업을 먼저 저장해 주세요.');}
async function loadAssets(b){for(const id of new Set(b.entries.map(e=>e.assetId))){if(!assets.has(id)){const a=await getBoardAsset(id);if(!a)throw Error('보드 사진을 찾지 못했습니다. 백업 파일을 가져와 주세요.');assets.set(id,a);}if(!urls.has(id))urls.set(id,URL.createObjectURL(assets.get(id).blob));}let changed=false;for(const entry of b.entries)if(!entry.crop){entry.crop=await autoCropAsset(assets.get(entry.assetId),entry.kind);entry.autoCropVersion=1;changed=true;}if(changed)void persist(b);}
function renderLibrary(){
 const rows=boards.filter(b=>!b.archivedAt&&!b.deletedAt&&(season==='all'||b.season===season)&&[b.project,b.title].join(' ').toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const checkbox=b=>`<input type="checkbox" data-board-project-select="${esc(b.id)}" aria-label="${esc(b.project)} 프로젝트 선택" ${selectedProjects.has(b.id)?'checked':''}>`;
 $('board-list').innerHTML=rows.map(b=>`<div class="rb-project-row">${checkbox(b)}<button class="rb-project ${b.id===active?'active':''}" data-board-open="${esc(b.id)}" aria-pressed="${b.id===active}"><span>${esc(b.season)}</span><strong>${esc(b.project)}</strong><small>${b.entries.length}장 · ${boardPages(b).length}페이지</small></button></div>`).join('')||'<p class="rb-muted">이 시즌에 만든 보드가 없습니다.</p>';
 $('board-trash-list').innerHTML=boards.filter(b=>b.archivedAt&&!b.deletedAt).map(b=>`<div class="rb-archived-project">${checkbox(b)}<div><strong>${esc(b.season+' · '+b.project)}</strong><button type="button" data-board-restore="${esc(b.id)}">프로젝트 복원</button></div></div>`).join('')||'<p class="rb-muted">보관한 보드가 없습니다.</p>';
 $('board-deleted-list').innerHTML=boards.filter(b=>b.deletedAt).map(b=>`<div class="rb-deleted-project"><strong>${esc(b.season+' · '+b.project)}</strong><button type="button" data-board-undelete="${esc(b.id)}">삭제 취소 · 복원</button></div>`).join('')||'<p class="rb-muted">삭제한 프로젝트가 없습니다.</p>';
 const visible=[...document.querySelectorAll('[data-board-project-select]')].map(el=>el.dataset.boardProjectSelect);$('board-select-all').disabled=!visible.length;$('board-select-all').checked=!!visible.length&&visible.every(id=>selectedProjects.has(id));$('board-select-all').indeterminate=visible.some(id=>selectedProjects.has(id))&&!$('board-select-all').checked;$('board-selected-count').textContent=selectedProjects.size;$('board-delete-selected').disabled=!selectedProjects.size||deletingProjects;
}
function field(label,key,value,{area=false,max=280,placeholder=''}={}){return `<label>${label}${area?`<textarea data-board-field="${key}" rows="4" maxlength="${max}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`:`<input data-board-field="${key}" maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</label>`;}
async function renderEditor(){
 const b=current();$('board-empty').hidden=!!b;$('board-editor').hidden=!b;if(!b)return;
 await loadAssets(b);if(current()!==b)return;page=Math.min(page,boardPages(b).length-1);
 $('board-edit-name').textContent=b.project;$('board-page-status').textContent=`사진 ${b.entries.length}장 · 6장씩 자동 배치`;
 $('board-fields').innerHTML=`${field('프로젝트명','project',b.project,{max:60})}<label>기획 시즌<select data-board-field="season">${['27SS','27FW','28SS','28FW','29SS'].map(s=>`<option${s===b.season?' selected':''}>${s}</option>`).join('')}</select></label>${field('트렌드명 / 제안서 제목','title',b.title,{max:60})}${field('스타일 해시태그','tags',b.tags,{max:160,placeholder:'#SlimRetro #TeamColor'})}<div class="rb-tag-help"><span>프로젝트명과 사이트 데이터로 추천 · 직접 수정 가능</span><button type="button" id="board-tags-refresh">추천 다시 적용</button></div>${field('핵심 인사이트','insight',b.insight,{area:true,max:400,placeholder:'어떤 신호를 확인했고, 왜 주목하는지'})}${field('MLB 적용 아이템','application',b.application,{area:true,max:400,placeholder:'실루엣·소재·컬러·팀 로고 적용 방향'})}${field('기획 메모','memo',b.memo,{area:true,max:300,placeholder:'목표가, 샘플 검증 항목, 팀 의견'})}`;
 $('board-tray').innerHTML=b.entries.map((e,i)=>`<article class="rb-reference" draggable="true" data-board-entry="${esc(e.id)}"><div class="rb-ref-top"><img src="${esc(urls.get(e.assetId))}" width="120" height="85" alt="${esc(e.brand+' '+e.name)}" loading="lazy"><div><span>${i+1} · ${e.kind==='show'?'쇼':'상품'}</span><strong>${esc(e.brand)}</strong><label class="rb-photo-memo">사진 메모<input maxlength="45" data-board-entry-memo="${esc(e.id)}" value="${esc(e.memo)}" placeholder="예: 토캡 비율 · 팀 컬러 참고"></label><p>${esc(e.name)}</p></div></div><p class="rb-source">${esc(sourceCredit(e))}${e.style?' · '+esc(e.style):''}</p>${safeSourceUrl(e.sourceUrl)?`<a class="rb-source" href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">원문 출처 ↗</a>`:''}<div class="rb-ref-actions"><button data-board-crop="${esc(e.id)}">크롭·확대</button><button data-board-up="${esc(e.id)}" ${i===0?'disabled':''} aria-label="${i+1}번 사진 위로">↑</button><button data-board-down="${esc(e.id)}" ${i===b.entries.length-1?'disabled':''} aria-label="${i+1}번 사진 아래로">↓</button><button data-board-remove="${esc(e.id)}">빼기</button></div></article>`).join('')||'<p class="rb-muted">상품·CATWALK에서 ‘보드에 담기’를 눌러 사진을 모으세요.</p>';
 $('board-page-tabs').innerHTML=boardPages(b).map((_,i)=>`<button data-board-page="${i}" aria-pressed="${i===page}" class="${i===page?'active':''}">${i+1}페이지</button>`).join('');
 $('board-undo').disabled=!(history.get(b.id)||[]).length;void preview();
}
async function preview(){
 const b=current();if(!b)return;const token=++previewToken;try{const groups=boardPages(b),canvas=await drawBoardPage(b,groups[page]||[],assets,{page:page+1,pages:groups.length});if(token!==previewToken||current()!==b)return;canvas.id='board-preview-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${b.season} ${b.title} 제안서 ${page+1}페이지 · 사진 6장 자동 배치`);$('board-preview').replaceChildren(canvas);$('board-preview-error').textContent='';}catch(e){if(token===previewToken)$('board-preview-error').textContent=e.message;}
}
function schedulePreview(){clearTimeout(previewTimer);previewTimer=setTimeout(()=>void preview(),150);}
export async function renderReferenceBoards(){try{await init();renderLibrary();await renderEditor();}catch(e){message('이 브라우저에서 보드를 열지 못했습니다. '+e.message,true);}}
export async function openBoardPicker(sources){
 if(!sources.length){message('담을 사진을 먼저 선택해 주세요.');return;}
 try{await init();pending=sources;$('board-picker-count').textContent=`사진 ${sources.length}장 담기`;$('board-picker-select').innerHTML=boards.filter(b=>!b.archivedAt&&!b.deletedAt).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(b=>`<option value="${esc(b.id)}" ${b.id===active?'selected':''}>${esc(b.season+' · '+b.project)}</option>`).join('')+'<option value="new">＋ 새 프로젝트 만들기</option>';$('board-picker-new').hidden=$('board-picker-select').value!=='new';$('board-picker-status').textContent='';$('board-picker-submit').disabled=false;$('board-picker').showModal();}catch(e){alert('보드 저장소를 열지 못했습니다. '+e.message);}
}
async function addPending(){
 if(busy)return;busy=true;$('board-picker-submit').disabled=true;const existing=$('board-picker-select').value;let b;
 try{b=existing==='new'?newBoard($('board-picker-project').value,$('board-picker-season').value):boards.find(b=>b.id===existing);if(existing==='new')applyAutoTags(b);if(!b?.project.trim())throw Error('프로젝트명을 입력해 주세요.');const snapshots=[],added=[];let duplicate=0;
  for(const [i,source] of pending.entries()){$('board-picker-status').textContent=`사진 보존 중 ${i+1} / ${pending.length}`;if(b.entries.some(e=>e.sourceKey===source.sourceKey)||added.some(e=>e.sourceKey===source.sourceKey)){duplicate++;continue;}const {entry,asset}=await snapshotSource(source);added.push(entry);snapshots.push(asset);}
  if(existing==='new')boards.push(b);remember(b);b.entries.push(...added);for(const asset of snapshots){assets.set(asset.id,asset);urls.set(asset.id,URL.createObjectURL(asset.blob));}active=b.id;season='all';$('board-season-filter').value='all';page=0;await persist(b,snapshots);if(saveFailed)throw Error('자동 저장을 완료하지 못했습니다. 보드 화면에서 백업을 저장해 주세요.');$('board-picker').close();navigate();await renderReferenceBoards();message(`${added.length}장 담았습니다.${duplicate?' 같은 사진 '+duplicate+'장은 이미 담겨 있습니다.':''}`);
 }catch(e){$('board-picker-status').textContent=e.message;}finally{busy=false;$('board-picker-submit').disabled=false;}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
const fileName=b=>`MLB-${b.season}-${b.project}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-');
async function output(type){const b=current();if(!b||busy)return;busy=true;document.querySelectorAll('[data-board-export]').forEach(x=>x.disabled=true);
 try{await flushReferenceBoards();if(!b.entries.length)throw Error('사진을 한 장 이상 담아 주세요.');await loadAssets(b);const result=await exportBoardPages(structuredClone(b),assets,type,(i,n)=>message(`${type.toUpperCase()} 만드는 중 ${i} / ${n}페이지`));if(type==='pdf')download(result,fileName(b)+'.pdf');else if(result.length===1)download(result[0],fileName(b)+'-4800.png');else{const files={};for(const [i,blob] of result.entries())files[`${fileName(b)}-${String(i+1).padStart(2,'0')}-4800.png`]=await blob.arrayBuffer();download(new Blob([zipStored(files)],{type:'application/zip'}),fileName(b)+'-PNG.zip');}message(type==='pdf'?'PDF 저장 완료 · 360dpi · 출처 링크 포함':'PNG 저장 완료 · 4800×2700'+(result.length>1?' · '+result.length+'페이지 ZIP':''));}catch(e){message(e.message,true);}finally{busy=false;document.querySelectorAll('[data-board-export]').forEach(x=>x.disabled=false);}
}
function renderTemplates(){
 $('board-template-seasons').innerHTML=(research?.seasons||[]).map(s=>`<button class="secondary-button" data-template-season="${esc(s)}" aria-pressed="${s===templateSeason}">${esc(s)}</button>`).join('');
 $('board-template-list').innerHTML=(research?.ideas||[]).filter(i=>i.season===templateSeason).map(i=>`<article><img src="${esc(i.preview)}" width="480" height="270" loading="lazy" alt="${esc(i.title)}"><h3>${esc(i.title)}</h3><p>${esc(i.subtitle)}</p><button class="secondary-button" data-board-template="${esc(i.id)}">내 보드로 가져오기 ＋</button></article>`).join('');
}
async function copySeasonProposal(id){
 if(busy)return;busy=true;
 const report=text=>{$('board-template-status').textContent=text;notify(text);};
 try{await init();research=await loadSeasonProposalData();const idea=research.ideas.find(i=>i.id===id);if(!idea)throw Error('제안서를 찾지 못했습니다.');
 const b=newBoard(`MLB ${idea.season} · ${idea.title}`,idea.season);b.title=idea.title+' · '+idea.subtitle;b.tags=idea.tags.map(t=>'#'+t).join(' ');b.tagsMode='manual';b.insight=idea.insight;b.application=idea.strategies.filter(t=>!t.startsWith('검증')).join('\n');b.memo=`목표가 가설 · ${Number(idea.targetPrice).toLocaleString('ko-KR')}원\n`+idea.strategies.filter(t=>t.startsWith('검증')).join('\n');
 const snapshots=[];for(const [i,r] of idea.references.entries()){report(`제안서 사진·출처 복사 ${i+1} / ${idea.references.length}`);const product=(tagContext().products||[]).find(p=>p.id===r.id),kind=r.kind==='product'?'product':'show';const result=await snapshotSource({sourceKey:(kind==='show'?'show:':'product:')+r.id,kind,name:r.name,brand:r.brand,sourceSeason:r.season,sourceUrl:r.url,imageUrl:r.original||r.image,color:product?.colorway,style:product?.style,frame:product?.presentation?.frame});b.entries.push(result.entry);snapshots.push(result.asset);}
 boards.push(b);for(const a of snapshots){assets.set(a.id,a);urls.set(a.id,URL.createObjectURL(a.blob));}active=b.id;season='all';$('board-season-filter').value='all';page=0;await persist(b,snapshots);if(saveFailed)throw Error('복사한 보드를 저장하지 못했습니다. 백업을 먼저 저장하세요.');$('board-template-dialog').close();navigate();await renderReferenceBoards();message('시즌 제안서를 편집 가능한 보드로 가져왔습니다. 원본은 보존됩니다.');notify('제안서 복사 완료 · 사진·메모·크롭을 자유롭게 수정하세요.');
 }catch(e){report(e.message);message(e.message,true);}finally{busy=false;}
}
export function bindReferenceBoards({onNavigate,getTagContext=()=>({}),onStatus=()=>{}}){
 navigate=onNavigate;tagContext=getTagContext;notify=onStatus;bindPhotoEditor();
 $('board-template-open').onclick=async()=>{try{await init();research=await loadSeasonProposalData();renderTemplates();$('board-template-dialog').showModal();}catch(e){message(e.message,true);}};
 $('board-template-dialog').addEventListener('click',e=>{const tab=e.target.closest('[data-template-season]');if(tab){templateSeason=tab.dataset.templateSeason;renderTemplates();}const copy=e.target.closest('[data-board-template]');if(copy)void copySeasonProposal(copy.dataset.boardTemplate);});
 document.addEventListener('shoes:proposal-board',e=>void copySeasonProposal(e.detail.id));
 $('board-enlarge').onclick=async()=>{try{const b=current();if(!b)return;const groups=boardPages(b),canvas=await drawBoardPage(b,groups[page],assets,{page:page+1,pages:groups.length});$('board-large-preview').replaceChildren(canvas);$('board-preview-dialog').showModal();}catch(e){message(e.message,true);}};
 $('board-new').onclick=()=>{$('board-create-project').value='';$('board-create-dialog').showModal();};$('board-create-form').onsubmit=async e=>{e.preventDefault();await init();const b=newBoard($('board-create-project').value,$('board-create-season').value);if(!b.project)return;applyAutoTags(b);boards.push(b);active=b.id;page=0;await persist(b);$('board-create-dialog').close();await renderReferenceBoards();};
 $('board-picker-select').onchange=()=>$('board-picker-new').hidden=$('board-picker-select').value!=='new';$('board-picker-submit').onclick=()=>void addPending();
 $('board-search').oninput=e=>{search=e.target.value;selectedProjects.clear();renderLibrary();};$('board-season-filter').onchange=e=>{season=e.target.value;selectedProjects.clear();renderLibrary();};
 $('reference-boards').addEventListener('input',e=>{const b=current();if(!b)return;const key=e.target.dataset.boardField,id=e.target.dataset.boardEntryMemo;if(key){remember(b);b[key]=e.target.value;if(key==='tags')b.tagsMode='manual';if(key==='project'){$('board-edit-name').textContent=b.project;if(b.tagsMode==='auto'||(!b.tagsMode&&!b.tags)){applyAutoTags(b);document.querySelector('[data-board-field="tags"]').value=b.tags;}}}else if(id){remember(b);b.entries.find(row=>row.id===id).memo=e.target.value;}else return;void persist(b);schedulePreview();$('board-undo').disabled=false;});
 $('reference-boards').addEventListener('click',async e=>{const b=current(),target=e.target.closest('button');if(!target)return;const d=target.dataset;
  if(target.id==='board-tags-refresh'&&b){remember(b);applyAutoTags(b);await persist(b);await renderEditor();return;}
  if(d.boardCrop){const entry=b?.entries.find(row=>row.id===d.boardCrop);if(entry)await openPhotoEditor(entry,assets.get(entry.assetId),async crop=>{remember(b);entry.crop=crop;entry.autoCropVersion=1;await persist(b);await preview();message('사진 크롭·확대를 저장했습니다. PNG·PDF에도 같은 범위로 적용됩니다.');});return;}
  if(d.boardUndelete){const restore=boards.find(row=>row.id===d.boardUndelete);delete restore.deletedAt;await persist(restore);renderLibrary();return;}
  if(d.boardOpen){await queue;active=d.boardOpen;page=0;await renderEditor();renderLibrary();return;}
  if(d.boardRestore){const restore=boards.find(b=>b.id===d.boardRestore);delete restore.archivedAt;await persist(restore);renderLibrary();return;}
  if(d.boardPage!=null){page=Number(d.boardPage);await renderEditor();return;}
  if(d.boardExport){void output(d.boardExport);return;}
  if(!b)return;
  if(d.boardRemove||d.boardUp||d.boardDown){remember(b);const id=d.boardRemove||d.boardUp||d.boardDown,index=b.entries.findIndex(row=>row.id===id);if(d.boardRemove)b.entries.splice(index,1);else{const other=index+(d.boardUp?-1:1);if(other>=0&&other<b.entries.length)[b.entries[index],b.entries[other]]=[b.entries[other],b.entries[index]];}void persist(b);await renderEditor();return;}
  if(target.id==='board-undo'){const previous=history.get(b.id)?.pop();if(previous){Object.assign(b,{...previous,revision:b.revision});await persist(b);await renderEditor();}return;}
  if(target.id==='board-archive'){b.archivedAt=new Date().toISOString();await persist(b);active='';await renderReferenceBoards();message('보드를 보관했습니다. 보관함에서 복원할 수 있습니다.');return;}
  if(target.id==='board-duplicate'){await queue;const copy={...structuredClone(b),id:crypto.randomUUID(),revision:0,project:(b.project+' 복사').slice(0,60)};boards.push(copy);await persist(copy);active=copy.id;await renderReferenceBoards();return;}
  if(target.id==='board-backup'){try{await queue;download(new Blob([JSON.stringify(await boardBackup(structuredClone(b),assets))],{type:'application/json'}),fileName(b)+'.shoes-board.json');message('사진과 출처를 포함한 백업을 저장했습니다.');}catch(error){message(error.message,true);}}
 });
 $('reference-boards').addEventListener('change',e=>{const id=e.target.dataset.boardProjectSelect;if(id){e.target.checked?selectedProjects.add(id):selectedProjects.delete(id);renderLibrary();}});
 $('board-select-all').onchange=e=>{for(const input of document.querySelectorAll('[data-board-project-select]'))e.target.checked?selectedProjects.add(input.dataset.boardProjectSelect):selectedProjects.delete(input.dataset.boardProjectSelect);renderLibrary();};
 $('board-delete-selected').onclick=async()=>{if(deletingProjects)return;deletingProjects=true;let count=0;for(const id of [...selectedProjects]){const b=boards.find(row=>row.id===id);if(!b)continue;b.deletedAt=new Date().toISOString();await persist(b);if(saveFailed){delete b.deletedAt;break;}count++;selectedProjects.delete(id);if(active===id)active='';}deletingProjects=false;await renderReferenceBoards();message(`${count}개 프로젝트를 삭제했습니다. 휴지통에서 복원할 수 있습니다.`);};
 $('board-backup-import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>150*1024*1024)throw Error('백업 파일이 너무 큽니다.');await init();const b=await importBoardBackup(JSON.parse(await file.text()));boards.push(b);active=b.id;page=0;await renderReferenceBoards();message('백업을 새 보드로 가져왔습니다.');}catch(error){message(error.message,true);}e.target.value='';};
 $('board-tray').addEventListener('dragstart',e=>{if(e.target.matches('input'))return;dragged=e.target.closest('[data-board-entry]')?.dataset.boardEntry||'';});$('board-tray').addEventListener('dragover',e=>e.preventDefault());$('board-tray').addEventListener('drop',async e=>{e.preventDefault();const b=current(),target=e.target.closest('[data-board-entry]')?.dataset.boardEntry;if(!b||!dragged||!target||target===dragged)return;remember(b);const from=b.entries.findIndex(row=>row.id===dragged),to=b.entries.findIndex(row=>row.id===target);b.entries.splice(to,0,b.entries.splice(from,1)[0]);dragged='';void persist(b);await renderEditor();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&current())void persist(current());});
}
