import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {calendarShift} from '../public/assets/release-window.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
export function jsonAssignment(html,name){
 const match=new RegExp('\\bvar\\s+'+name+'\\s*=\\s*').exec(html);if(!match)throw Error('Missing public product JSON: '+name);
 const start=match.index+match[0].length;let depth=0,quoted=false,escaped=false;
 for(let i=start;i<html.length;i++){const c=html[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"')quoted=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){depth--;if(!depth)return JSON.parse(html.slice(start,i+1));}}
 throw Error('Incomplete public product JSON');
}
const colorNames=[['奶油','Cream'],['古白','Off White'],['米','Beige'],['杏','Beige'],['银','Silver'],['金','Gold'],['黑','Black'],['白','White'],['灰','Grey'],['棕','Brown'],['褐','Brown'],['粉','Pink'],['蓝','Blue'],['绿','Green'],['黄','Yellow'],['紫','Purple'],['红','Red'],['橙','Orange']];
export const filaColor=text=>String(text||'').split('/').map(part=>colorNames.find(([cn])=>part.includes(cn))?.[1]||'').filter(Boolean).join(' / ');
const modelNames=[['硬糖','Hard Candy'],['软糖','Gummy'],['回旋','Pivot'],['熊爪','Bear Claw'],['山脉','Mountain'],['旋律','Melody'],['漫游','Roam'],['蕨草','Fern'],['旋点','Pivot'],['猫爪','Cat Paw'],['珊瑚','Coral'],['冷杉','Fir'],['几何','Geometry'],['甜筒','Cone'],['萃飒','Crescent']];
export function filaRows(product,{url,listingUrl,at,today,contentHash}){
 const title=String(product.pro_title||product.pro_name||'');
 if(!/(?:运动鞋|板鞋|老爹鞋|跑鞋|篮球鞋|网球鞋)/.test(title)||/童|凉鞋|拖鞋|乐福|高跟|靴|皮鞋|足球鞋/.test(title))return[];
 const sale=Number(product.market_time);if(!Number.isFinite(sale)||sale<=0||Number(product.onsell)!==1)return[];
 const day=new Date(sale*1000+8*3600000).toISOString().slice(0,10);if(day<calendarShift(today,-3)||day>today)return[];
 const code=String(product.id_alias||'');if(!/^[A-Z0-9-]{6,}$/.test(code))return[];
 const family=modelNames.find(([cn])=>title.includes(cn))?.[1]||title.replace(/【[^】]*】/g,'').match(/\b[A-Z][A-Z0-9 ]{2,}\b/)?.[0]?.trim()||code;
 const version=title.match(/(\d+)代/)?.[1]||'',type=/老爹鞋/.test(title)?'Chunky Sneakers':/板鞋/.test(title)?'Court Sneakers':'Sneakers';
 const name=`${family}${version?' '+version:''} ${type}`,rows=[];
 for(const color of Object.values(product.color||{})){const style=String(color.attr_alias||''),id=color.id_pa,image=color.image_url;
  if(!style.startsWith(code)||!id||!/^https:\/\/(?:img\.fishfay\.com|img\d*\.fila\.cn)\//.test(image||''))continue;
  const productUrl=url+'?id_pa='+id,colorway=filaColor(color.attr_name);if(!colorway)continue;
  const imageCandidates=Object.values(product.image?.master?.[id]||{}).filter(row=>String(row.id_pa)===String(id)&&row.path?.includes('/'+style+'/')).sort((a,b)=>a.order_id-b.order_id).map(row=>row.path);
  const proof={verified:true,brand:'FILA China',style,verifiedAt:at,verificationMethod:'official-fila-china-product-json',contentHash};
  rows.push({id:'filachina-'+style.toLowerCase(),brand:'FILA China',name,modelGroup:'filachina|'+code,style,manufacturerStyle:style,productVariantId:String(product.id_goods)+':'+id,productType:'sneaker',officialCategory:'Adult sneakers',gender:/女士/.test(title)?'Women':/男士/.test(title)?'Men':'Unisex',country:'CN',url:productUrl,image,imageCandidates,colorway,colors:colorway.split(' / '),priceLabel:'CNY '+product.price,releaseDate:day,dateEvidence:{verified:true,official:true,precision:'day',url:productUrl,verifiedAt:at,field:'market_time',kind:'official-sale-start',sourceTimezone:'Asia/Shanghai',excerpt:`${code}: official market_time ${sale}; sale start ${day}. Not add_time, up_time or updated_at.`},productVerifiedAt:at,productEvidenceUrl:productUrl,officialProductEvidence:{...proof,url:productUrl},officialImageEvidence:{...proof,url:image,sourceUrl:productUrl},sourceSignals:[],sourceName:title,sourceColor:color.attr_name,sourceListing:listingUrl,firstSeen:at});
 }return rows;
}
const filaListings=['https://www.fila.com.cn/list/j2_4_22-e1','https://www.fila.com.cn/list/j1_4_22-e1'];
const MAX_IDS=20000,MAX_CHECKPOINT_BYTES=32*1024*1024;
const clone=value=>JSON.parse(JSON.stringify(value));

/**
 * Default: scan every official New listing and PDP, with the original strict filaRows filter.
 * Opt-in bounds: maxListingPages/maxProductPages per invocation, maxDurationMs wall time.
 * Persist progress.checkpoint (or onCheckpoint's argument) and pass it as resume next time.
 * Checkpoints are same-KST-day only; they contain evidence, never a publication instruction.
 * State ceilings: 100 pages per listing, 20,000 unique goods IDs, 32 MiB serialized checkpoint.
 * pendingIds includes in-flight and failed IDs; listing cursors also determine completeness.
 * read(url, {signal}) may honor cancellation; a deadline also bounds readers that ignore it.
 * Callbacks are awaited outside read error handling: persistence failures reject the run.
 */
export async function collectFilaChina({now=new Date(),read=async (url,{signal}={})=>{
 const r=await fetch(url,{signal:signal||AbortSignal.timeout(22000),headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36','Accept':'text/html'}});
 if(!r.ok)throw Error('HTTP '+r.status);return r.text();
},onProgress=()=>{},onCheckpoint,resume,maxListingPages=Infinity,maxProductPages=Infinity,maxDurationMs=Infinity}={}){
 for(const [name,value] of Object.entries({maxListingPages,maxProductPages,maxDurationMs})){
  if(value!==Infinity&&(!Number.isSafeInteger(value)||value<0))throw Error('Invalid '+name);
 }
 const at=now.toISOString(),today=new Date(now.getTime()+9*3600000).toISOString().slice(0,10),cutoff=calendarShift(today,-3);
 const deadline=Date.now()+maxDurationMs;
 let state={schemaVersion:1,brand:'FILA China',today,cutoff,
  listings:filaListings.map(url=>({url,nextPage:1,totalPages:null,totalProducts:null,seen:[],complete:false})),
  ids:[],attemptedIds:[],completedIds:[],validatedProducts:[],pages:[],errors:[]};
 if(resume){
  if(Buffer.byteLength(JSON.stringify(resume))>MAX_CHECKPOINT_BYTES)throw Error('Checkpoint too large');
  state=clone(resume);
  if(state.schemaVersion!==1||state.brand!=='FILA China'||state.today!==today||state.cutoff!==cutoff||
   !Array.isArray(state.listings)||state.listings.length!==2||
   !['ids','attemptedIds','completedIds','validatedProducts','pages','errors','pendingIds'].every(key=>Array.isArray(state[key]))||
   state.ids.length>MAX_IDS||state.pages.length>200||state.validatedProducts.length>MAX_IDS||
   state.listings.some((l,i)=>l.url!==filaListings[i]||!Array.isArray(l.seen)||!Number.isInteger(l.nextPage)||l.nextPage<1||l.nextPage>101)||
   state.ids.some(entry=>!/^\d+$/.test(entry.id)||!filaListings.includes(entry.listingUrl))||
   new Set(state.ids.map(entry=>entry.id)).size!==state.ids.length||
   new Set(state.completedIds).size!==state.completedIds.length||
   new Set(state.attemptedIds).size!==state.attemptedIds.length||
   state.attemptedIds.some(id=>!state.ids.some(entry=>entry.id===id))||
   state.completedIds.some(id=>!state.attemptedIds.includes(id))||
   state.listings.some(l=>new Set(l.seen).size!==l.seen.length||l.seen.some(id=>!state.ids.some(entry=>entry.id===id))||
    typeof l.complete!=='boolean'||(l.totalPages!==null&&(!Number.isInteger(l.totalPages)||l.totalPages<1||l.totalPages>100))||
    (l.complete&&(l.nextPage!==l.totalPages+1||l.seen.length!==l.totalProducts)))||
   state.pendingIds.join()!==state.ids.filter(entry=>!state.completedIds.includes(entry.id)).map(entry=>entry.id).join()||
   state.validatedProducts.some(entry=>!state.completedIds.includes(String(entry.product?.id_goods))||!filaListings.includes(entry.listingUrl)||!entry.contentHash||!entry.at))throw Error('Invalid or stale FILA China checkpoint');
 }
 const ids=new Map(state.ids.map(entry=>[entry.id,entry.listingUrl])),completed=new Set(state.completedIds),attemptedIds=new Set(state.attemptedIds);
 const products=state.validatedProducts.flatMap(entry=>filaRows(entry.product,{...entry,url:`https://www.fila.com.cn/goods-${entry.product.id_goods}.html`,today}));
 let listingReads=0,productReads=0,attempted=0,stopped=false;
 const remaining=()=>state.ids.filter(entry=>!completed.has(entry.id)).map(entry=>entry.id);
 const coverage=()=>state.listings.map(l=>({url:l.url,pages:state.pages.filter(p=>p.url.split('?')[0]===l.url).length,
  total:l.seen.length,exhaustive:l.complete&&l.seen.every(id=>completed.has(id)),status:l.complete&&l.seen.every(id=>completed.has(id))?'checked':'partial'}));
 const result=()=>({schemaVersion:1,brand:'FILA China',checkedAt:at,cutoff,
  basis:'Official New sort; market_time sale-start inside three calendar months; colors collapsed over sizes',
  pages:state.pages,checkedProducts:attemptedIds.size,completedProducts:completed.size,products,errors:state.errors,pendingIds:remaining(),
  exhaustive:state.listings.every(l=>l.complete)&&remaining().length===0,coverage:coverage()});
 // Serialize snapshots so concurrent workers cannot overwrite a newer durable checkpoint.
 let publishing=Promise.resolve();
 const emit=(phase)=>{
  state.completedIds=[...completed];state.attemptedIds=[...attemptedIds];state.pendingIds=remaining();
  const checkpoint=clone(state);
  if(Buffer.byteLength(JSON.stringify(checkpoint))>MAX_CHECKPOINT_BYTES)throw Error('Checkpoint too large');
  const progress=clone({...result(),phase,checked:completed.size,attempted,discovered:ids.size,total:ids.size,variants:products.length,checkpoint});
  publishing=publishing.then(async()=>{if(onCheckpoint)await onCheckpoint(checkpoint);await onProgress(progress);});
  return publishing;
 };
 const readPage=async url=>{
  const ms=Math.min(22000,deadline-Date.now());if(ms<=0)throw Error('Collection time budget reached');
  const controller=new AbortController();let timer;
  try{return await Promise.race([Promise.resolve().then(()=>read(url,{signal:controller.signal})),new Promise((_,reject)=>{
   timer=setTimeout(()=>{controller.abort();reject(Error('Read timed out'));},ms);
  })]);}finally{clearTimeout(timer);}
 };
 const error=(url,message,page)=>{state.errors=state.errors.filter(e=>e.url!==url||e.page!==page);state.errors.push({url,...(page?{page}:{}),error:String(message).slice(0,500)});};
 await emit('start');
 for(const listing of state.listings){
  while(!listing.complete){
   if(listingReads>=maxListingPages||Date.now()>=deadline){stopped=true;break;}
   const page=listing.nextPage,url=listing.url+(page===1?'':'?p='+page);listingReads++;
   try{
    const text=await readPage(url),data=jsonAssignment(text,'listData'),max=Number(data.info?._page),total=Number(data.info?._total);
    if(Number(data.info?._p)!==page)throw Error('Pagination not advanced');
    if(!Number.isInteger(max)||max<1||max>100||max<page||!Number.isInteger(total)||total<0)throw Error('Invalid page count or product total');
    if(listing.totalPages!==null&&(max!==listing.totalPages||total!==listing.totalProducts))throw Error('Listing totals changed; restart scan');
    const pageIds=Object.values(data.id_goods||{}).map(String),seen=new Set(listing.seen);
    if(pageIds.some(id=>!/^\d+$/.test(id)||seen.has(id))||new Set(pageIds).size!==pageIds.length)throw Error('Repeated or invalid listing product');
    if(!pageIds.length&&total>0)throw Error('Empty listing page');
    if(seen.size+pageIds.length>total||(page===max&&seen.size+pageIds.length!==total))throw Error('Listing product total mismatch');
    if(new Set([...ids.keys(),...pageIds]).size>MAX_IDS)throw Error('Checkpoint ID limit exceeded');
    for(const id of pageIds)if(!ids.has(id)){ids.set(id,listing.url);state.ids.push({id,listingUrl:listing.url});}
    listing.seen.push(...pageIds);listing.totalPages=max;listing.totalProducts=total;listing.nextPage=page+1;listing.complete=page===max;
    state.pages.push({url,hash:digest(text),page,totalPages:max,totalProducts:total,products:pageIds.length});
    state.errors=state.errors.filter(e=>e.url!==listing.url||e.page!==page);
   }catch(e){error(listing.url,e.message,page);await emit('listings');break;}
   await emit('listings');
  }
 }
 const queue=state.ids.filter(entry=>!completed.has(entry.id));let cursor=0;
 const workers=await Promise.allSettled(Array.from({length:3},async()=>{
  while(cursor<queue.length){
   if(productReads>=maxProductPages||Date.now()>=deadline){stopped=true;break;}
   const {id,listingUrl}=queue[cursor++],url=`https://www.fila.com.cn/goods-${id}.html`;productReads++;
   try{
    const text=await readPage(url),product=jsonAssignment(text,'proData');
    if(String(product.id_goods)!==id)throw Error('Product identity mismatch');
    const contentHash=digest(text),rows=filaRows(product,{url,listingUrl,at,today,contentHash});
    if(rows.length){state.validatedProducts.push({product,listingUrl,at,contentHash});products.push(...rows);}
    completed.add(id);state.errors=state.errors.filter(e=>e.url!==url);
   }catch(e){error(url,e.message);}
   attemptedIds.add(id);attempted++;await emit('products');
  }
 }));
 const failure=workers.find(worker=>worker.status==='rejected');if(failure)throw failure.reason;
 await emit(stopped?'bounded':result().exhaustive?'complete':'partial');
 return clone({...result(),checkpoint:state});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const run=await collectFilaChina({onProgress:p=>console.log(JSON.stringify(p))});await fs.writeFile('data/fila-china-new.json',JSON.stringify(run,null,2)+'\n');console.log(JSON.stringify({variants:run.products.length,models:new Set(run.products.map(p=>p.modelGroup)).size,errors:run.errors.length}));}
