import {createHash} from 'node:crypto';
import {classifyFootwear} from './curation.mjs';
const decode=s=>s.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&nbsp;',' ');
export const PUMA_KR_NEW='https://kr.puma.com/kr/ko/%EC%8B%A0%EC%83%81%ED%92%88/%EC%8B%A0%EB%B0%9C';
export async function collectPumaKoreaNew({readHtml,at=new Date().toISOString()}={}){
 const pages=[],seen=new Set(),items=new Map();let url=PUMA_KR_NEW,total;
 while(url&&!seen.has(url)&&pages.length<100){seen.add(url);const p=pumaNewPage(await readHtml(url),url,{at});pages.push(p);total??=p.total;for(const r of [...p.products,...p.excluded])items.set(r.style,r);if(total&&items.size>=total)break;url=p.next;}
 if(!total||items.size!==total)throw Error(`PUMA New pagination incomplete: ${items.size}/${total||'unknown'}`);
 return {checkedAt:at,products:[...new Map(pages.flatMap(p=>p.products).map(p=>[p.style,p])).values()],excluded:pages.flatMap(p=>p.excluded),coverage:{total,read:items.size,pages:pages.length,exhaustive:true,urls:pages.map(p=>p.url)}};
}
export function pumaNewPage(html,url,{at=new Date().toISOString()}={}){
 if(new URL(url).hostname!=='kr.puma.com')throw Error('PUMA Korea official source required');
 const hash=createHash('sha256').update(html).digest('hex'),products=[],excluded=[];
 const links=[...html.matchAll(/href="([^"]+)"/g)].map(m=>decode(m[1]));
 const rows=[...html.matchAll(/data-puma-analytics="([^"]*)"/g)].flatMap(m=>{try{return JSON.parse(decode(m[1])).products||[];}catch{return[];}});
 for(const row of rows){
  const style=row.styleID;if(!/^\d{6}_\d{2}$/.test(style||''))continue;
  const [model,colour]=style.split('_'),productUrl=links.find(link=>{try{const u=new URL(link);return u.hostname==='kr.puma.com'&&u.pathname.endsWith('/'+model+'.html')&&u.searchParams.get('dwvar_'+model+'_color')===colour&&!u.searchParams.has('dwvar_'+model+'_size');}catch{return false;}});
  if(!productUrl)throw Error('Official product URL missing for '+style);
  const name=decode(row.productName).split(/<br\s*\/?\s*>/i).at(-1).replace(/<[^>]+>/g,'').trim();
  if(/\b(?:boots?|FG\/AG|\bMG\b|Cage|Tuff Terra)\b/i.test(name)){excluded.push({style,name,reason:'boot-cleat-or-slipper'});continue;}
  const image=`https://images.puma.com/image/upload/f_auto,q_auto,b_rgb:fafafa,w_1000,h_1000/global/${model}/${colour}/sv01/fnd/KOR/fmt/png`;
  if(!html.includes(`/global/${model}/${colour}/`))throw Error('SKU image binding missing '+style);
  const proof={verified:true,brand:'PUMA',style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:hash};
  const p={id:'puma-kr-new-'+style,brand:'PUMA',name,style,manufacturerStyle:style,modelGroup:'puma|'+model,modelGroupId:'puma|'+model,url:productUrl,image,colorway:row.colorName,colors:[row.colorName],country:'KR',gender:row.gender||'Unisex',priceLabel:'KRW '+row.price,officialCategory:'Sneakers',productType:'sneaker',description:`${name}. Official PUMA New shoes: ${row.productCategory}.`,firstSeen:at,productVerifiedAt:at,productEvidenceUrl:url,sourceSignals:[],imageCandidates:[{url:image,alt:name+' '+row.colorName}],arrivalEvidence:{verified:true,brand:'PUMA',style,productUrl,kind:'new-arrivals-listing',url,verifiedAt:at,contentHash:hash,excerpt:'Official PUMA Korea New shoes: '+row.productName},officialProductEvidence:{...proof,url:productUrl},officialImageEvidence:{...proof,url:image,sourceUrl:url}};
  if(!classifyFootwear(p).category){excluded.push({style,name,reason:'footwear-classifier'});continue;}products.push(p);
 }
 const next=html.match(/data-url="([^"]*Search-UpdateGrid[^"]*)"/)?.[1];
 return {products,excluded,listingCount:rows.length,total:Number(html.match(/js-search-results-count-number[^>]*>\s*(\d+)/)?.[1])||null,next:next?decode(next):null,url,hash};
}
