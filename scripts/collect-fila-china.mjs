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
export async function collectFilaChina({now=new Date(),read=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(22000),headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36','Accept':'text/html'}});if(!r.ok)throw Error('HTTP '+r.status);return r.text();},onProgress=()=>{}}={}){
 const at=now.toISOString(),today=new Date(now.getTime()+9*3600000).toISOString().slice(0,10),listings=['https://www.fila.com.cn/list/j2_4_22-e1','https://www.fila.com.cn/list/j1_4_22-e1'];
 const products=[],pages=[],errors=[],ids=new Map();
 for(const listing of listings){const seen=new Set();let max=1;for(let page=1;page<=max;page++)try{const url=listing+(page===1?'':'?p='+page),text=await read(url),data=jsonAssignment(text,'listData');if(Number(data.info?._p)!==page)throw Error('Pagination not advanced');max=Number(data.info._page);if(!Number.isInteger(max)||max>100)throw Error('Invalid page count');for(const id of Object.values(data.id_goods||{})){if(seen.has(id))throw Error('Repeated listing product');seen.add(id);if(!ids.has(id))ids.set(id,listing);}pages.push({url,hash:digest(text),page,totalPages:max,totalProducts:data.info._total,products:Object.values(data.id_goods||{}).length});await onProgress({phase:'listings',pages:pages.length,discovered:ids.size});}catch(e){errors.push({url:listing,page,error:e.message});break;}}
 let cursor=0,checked=0;const queue=[...ids];await Promise.all(Array.from({length:3},async()=>{while(cursor<queue.length){const [id,listingUrl]=queue[cursor++],url=`https://www.fila.com.cn/goods-${id}.html`;try{const text=await read(url),product=jsonAssignment(text,'proData');if(String(product.id_goods)!==String(id))throw Error('Product identity mismatch');products.push(...filaRows(product,{url,listingUrl,at,today,contentHash:digest(text)}));}catch(e){errors.push({url,error:e.message});}checked++;if(checked%10===0||checked===queue.length)await onProgress({phase:'products',checked,total:queue.length,variants:products.length,errors:errors.length});}}));
 return{schemaVersion:1,brand:'FILA China',checkedAt:at,cutoff:calendarShift(today,-3),basis:'Official New sort; market_time sale-start inside three calendar months; colors collapsed over sizes',pages,checkedProducts:checked,products,errors};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const run=await collectFilaChina({onProgress:p=>console.log(JSON.stringify(p))});await fs.writeFile('data/fila-china-new.json',JSON.stringify(run,null,2)+'\n');console.log(JSON.stringify({variants:run.products.length,models:new Set(run.products.map(p=>p.modelGroup)).size,errors:run.errors.length}));}
