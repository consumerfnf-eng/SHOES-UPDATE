import {autoCropAsset,normalizeCrop,validCrop} from './board-crop.mjs';
export const BOARD_DB='shoes-reference-boards-v1';
let database;
export function openBoardStore(){
 if(database)return database;
 database=new Promise((resolve,reject)=>{const r=indexedDB.open(BOARD_DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('boards',{keyPath:'id'});r.result.createObjectStore('assets',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>{database=null;reject(r.error);};});return database;
}
async function read(store,key){const db=await openBoardStore();return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store);const q=key==null?r.getAll():r.get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
export const listBoards=()=>read('boards');
export const getBoardAsset=id=>read('assets',id);
export const boardAssetEntries=board=>[...(board.entries||[]),...(board.hero?[board.hero]:[]),...(board.heroOriginal?[board.heroOriginal]:[])];
export async function permanentlyDeleteBoard(id,revision){
 const db=await openBoardStore();return new Promise((resolve,reject)=>{
  const tx=db.transaction(['boards','assets'],'readwrite'),store=tx.objectStore('boards');let reason,removed=[];
  const request=store.getAll();request.onsuccess=()=>{
   const rows=request.result,board=rows.find(b=>b.id===id);
   if((!board?.deletedAt&&!board?.archivedAt)||board.revision!==revision){reason=Error('보드 상태가 변경되었습니다. 새로고침 후 휴지통을 확인하세요.');tx.abort();return;}
   const retained=new Set(rows.filter(b=>b.id!==id).flatMap(b=>boardAssetEntries(b).map(e=>e.assetId)));
   removed=[...new Set(boardAssetEntries(board).map(e=>e.assetId))].filter(asset=>!retained.has(asset));
   store.delete(id);for(const asset of removed)tx.objectStore('assets').delete(asset);
  };
  tx.oncomplete=()=>resolve(removed);tx.onabort=()=>reject(reason||tx.error||Error('영구삭제하지 못했습니다.'));tx.onerror=()=>reject(tx.error);
 });
}
export async function saveBoard(board,assets=[]){
 const db=await openBoardStore();return new Promise((resolve,reject)=>{const tx=db.transaction(['boards','assets'],'readwrite'),store=tx.objectStore('boards');let saved,reason;const old=store.get(board.id);
 old.onsuccess=()=>{if((old.result?.revision||0)!==(board.revision||0)){reason=Error('다른 탭에서 이 보드를 수정했습니다. 백업을 저장한 뒤 새로고침하세요.');tx.abort();return;}saved={...structuredClone(board),revision:(board.revision||0)+1,updatedAt:new Date().toISOString()};for(const asset of assets)tx.objectStore('assets').put(asset);store.put(saved);};
 tx.oncomplete=()=>resolve(saved);tx.onabort=()=>reject(reason||tx.error||Error('보드를 저장하지 못했습니다.'));tx.onerror=()=>reject(tx.error);
 });
}
export function newBoard(project,season){return {id:crypto.randomUUID(),revision:0,project:String(project).trim().slice(0,60),season,title:String(project).trim().slice(0,60),tags:'',tagsMode:'auto',insight:'',application:'',memo:'',entries:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}
export const boardPages=board=>Array.from({length:Math.max(1,Math.ceil(board.entries.length/6))},(_,i)=>board.entries.slice(i*6,i*6+6));
export function safeSourceUrl(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export async function snapshotSource(source){
 const url=new URL(source.imageUrl,location.href);if(url.origin!==location.origin)throw Error('이 사진은 사이트에 저장된 원본이 없습니다. 다른 사진을 선택하세요.');
 const r=await fetch(url.href);if(!r.ok)throw Error('사진을 불러오지 못했습니다.');const blob=await r.blob();if(!/^image\/(png|jpeg|webp|avif)$/.test(blob.type))throw Error('지원하지 않는 사진 형식입니다.');
 const bitmap=await createImageBitmap(blob);let x=0,y=0,w=bitmap.width,h=bitmap.height;
 const scale=Math.min(1,2400/Math.max(w,h)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,x,y,w,h,0,0,canvas.width,canvas.height);bitmap.close();
 const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.96));if(!image)throw Error('사진을 보존하지 못했습니다.');const bytes=await image.arrayBuffer(),id=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const entry={id:crypto.randomUUID(),sourceKey:source.sourceKey,kind:source.kind==='show'?'show':'product',assetId:id,name:String(source.name||'').slice(0,150),brand:String(source.brand||'').slice(0,80),color:String(source.color||'').slice(0,100),style:String(source.style||'').slice(0,80),sourceSeason:String(source.sourceSeason||'').slice(0,100),sourceUrl:safeSourceUrl(source.sourceUrl),imageUrl:url.pathname,capturedAt:new Date().toISOString(),memo:String(source.memo||source.note||'').slice(0,2000)};
 for(const field of ['role','roleLabel','note','credit','sourceDate','seasonRelation','original'])if(source[field]!=null)entry[field]=String(source[field]).slice(0,2000);
 for(const field of ['quality','matchEvidence'])if(source[field]!=null)entry[field]=structuredClone(source[field]);
 const asset={id,blob:image,width:canvas.width,height:canvas.height};entry.crop=await autoCropAsset(asset,entry.kind,source.frame);entry.autoCropVersion=1;return {entry,asset};
}
export async function boardBackup(board,memory=new Map()){
 const assets={};for(const id of new Set(boardAssetEntries(board).map(e=>e.assetId))){const a=memory.get(id)||await getBoardAsset(id);if(!a)throw Error('백업할 사진이 없습니다.');const bytes=new Uint8Array(await a.blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));assets[id]={type:a.blob.type,width:a.width,height:a.height,data:btoa(binary)};}
 return {format:'SHOES-REFERENCE-BOARD',version:1,board,assets};
}
export async function importBoardBackup(value){
 if(value?.format!=='SHOES-REFERENCE-BOARD'||value.version!==1||!Array.isArray(value.board?.entries)||value.board.entries.length>300)throw Error('올바른 보드 백업 파일이 아닙니다.');
 const b=newBoard(value.board.project||'가져온 프로젝트',String(value.board.season||'27SS').slice(0,12)),assets=[];
 for(const field of ['title','tags','insight','application','memo'])b[field]=String(value.board[field]||'').slice(0,2000);
 b.tagsMode=value.board.tagsMode==='auto'?'auto':'manual';
 const importedAssets=new Map();
 async function importEntry(raw){
  const a=value.assets?.[raw.assetId];if(!a||!/^image\/(jpeg|png|webp)$/.test(a.type)||typeof a.data!=='string')throw Error('백업 사진이 없거나 손상됐습니다.');const bytes=Uint8Array.from(atob(a.data),c=>c.charCodeAt(0));const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==raw.assetId)throw Error('백업 사진의 검증값이 다릅니다.');
  if(!importedAssets.has(hash)){const blob=new Blob([bytes],{type:a.type}),bitmap=await createImageBitmap(blob);const asset={id:hash,blob,width:bitmap.width,height:bitmap.height};bitmap.close();importedAssets.set(hash,asset);assets.push(asset);}
  const entry={id:crypto.randomUUID(),assetId:hash};for(const field of ['sourceKey','kind','name','brand','color','style','sourceSeason','memo','capturedAt','role','roleLabel','note','credit','sourceDate','seasonRelation','original'])if(raw[field]!=null)entry[field]=String(raw[field]).slice(0,2000);entry.sourceUrl=safeSourceUrl(raw.sourceUrl);entry.kind=entry.kind==='show'?'show':'product';
  for(const field of ['quality','matchEvidence'])if(raw[field]!=null)entry[field]=structuredClone(raw[field]);
  if(validCrop(raw.crop)){entry.crop=normalizeCrop(raw.crop);entry.autoCropVersion=1;}return entry;
 }
 for(const raw of value.board.entries)b.entries.push(await importEntry(raw));
 if(value.board.hero)b.hero=await importEntry(value.board.hero);
 if(value.board.heroOriginal)b.heroOriginal=await importEntry(value.board.heroOriginal);
 for(const field of ['category','designRole','construction','mlbFit','forecast','proposalId'])if(value.board[field]!=null)b[field]=structuredClone(value.board[field]);
 return saveBoard(b,assets);
}
