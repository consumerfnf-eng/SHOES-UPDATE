import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {pacedOfficialFetch} from './official-reader.mjs';
export function dkonNewRows(data,{slug,brand,url,at=new Date().toISOString()}){
 const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex'),products=[],excluded=[];
 for(const p of data.products){
  if(p.brndNmEn?.toLowerCase()!==brand.toLowerCase())throw Error('Shared store brand binding mismatch');
  if(String(p.classCd)!=='3'||!['SN','RN','CR'].includes(p.kindCd)){excluded.push({style:p.prodCd,name:p.prodNm,reason:'not-athletic-sneaker-source-type'});continue;}
  if(/키즈|아동|부츠|샌들|슬리퍼|뮬/.test(p.prodNm)){excluded.push({style:p.prodCd,name:p.prodNm,reason:'not-adult-sneaker'});continue;}
  const style=p.prodCd+'-'+p.colorCd,productUrl='https://dk-on.com/'+slug+'/product/'+p.prodCd+'/'+p.colorCd;
  const selected=[p.image1,p.image2,p.image3,p.image4].find(u=>u&&/_N01[.]/i.test(u))||p.image1;
  const image=new URL(selected,'https://dk-on.com').href;if(new URL(image).hostname!=='img.dk-on.com'||!image.includes(p.prodCd+'_'+p.colorCd))throw Error('Unbound DKON product image');
  const name=p.prodNm.replace(/^\[DESCENTE X YOUTH\]\s*/,'').trim(),proof={verified:true,brand,style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:hash};
  products.push({id:'dkon-new-'+style,brand,name,sourceName:p.prodNm,style,manufacturerStyle:style,modelGroupId:'dkon|'+slug+'|'+p.prodCd,url:productUrl,image,colorway:p.colorNm,colors:[p.colorNm],officialCategory:'스니커즈',category:'sneaker',productType:'sneaker',description:name+' · 공식 New 러닝/코트/스니커즈 분류',country:'KR',gender:p.sexCd==='1'?'Men':p.sexCd==='2'?'Women':'Unisex',priceLabel:'KRW '+p.mallSalePrc,firstSeen:at,productVerifiedAt:at,productEvidenceUrl:url,sourceSignals:[],arrivalEvidence:{...proof,kind:'new-arrivals-listing',productUrl,url,excerpt:name+' · 최근 한 달 New'},officialProductEvidence:{...proof,url:productUrl},officialImageEvidence:{...proof,url:image,sourceUrl:url}});
 }return {products,excluded};
}
export async function collectDkonNew({readJson,now=new Date()}={}){
 const read=pacedOfficialFetch();readJson??=async url=>{const r=await read(url,{method:'POST',headers:{'X-Requested-With':'XMLHttpRequest'}});if(!r.ok)throw Error('HTTP '+r.status);return r.json();};
 const products=[],excluded=[],coverage=[];
 for(const [brand,slug] of [['Umbro','UMBRO'],['DESCENTE','DESCENTE'],['Le Coq Sportif','LECOQSPORTIF']]){const ids=new Set();let total,pages;
  for(let page=1;page<=100;page++){const url='https://dk-on.com/'+slug+'/newArrival/productList?page='+page+'&pageSize=100',data=await readJson(url);total??=Number(data.total);pages=Number(data.totalPage);if(!Number.isFinite(total)||!pages||Number(data.pageInfo.currentPage)!==page)throw Error('Invalid official New page');
   for(const p of data.products){const key=p.prodCd+'|'+p.colorCd;if(ids.has(key))throw Error('Repeated DKON New variant');ids.add(key);}
   const rows=dkonNewRows(data,{slug,brand,url,at:now.toISOString()});products.push(...rows.products);excluded.push(...rows.excluded);
   if(page===pages){if(ids.size!==total)throw Error('DKON New source count changed');break;}
  }coverage.push({brand,total,read:ids.size,pages,exhausted:ids.size===total});console.log(brand+' New '+ids.size+'/'+total);
 }return {checkedAt:now.toISOString(),products,excluded,coverage};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await collectDkonNew();await fs.writeFile('data/dkon-new.json',JSON.stringify(r,null,2)+'\n');console.log('DONE '+r.products.length);}
