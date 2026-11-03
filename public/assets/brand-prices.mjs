import {priceKrw,RATE_NOTE} from './analysis.mjs';
import {variantGroupKey,isOverlay,safeUrl} from './catalog-view.mjs';
import {siteBrandGroup} from './site-brand-policy.mjs';
import {csvBytes} from './export.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const PRICE_BRANDS=['FILA','New Balance','ASICS','Adidas Originals','PUMA','Nike','Salomon','Rockfish Weatherwear','Onitsuka Tiger'];
export function comparisonBrand(product){
 const name=String(product.brand||'').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
 const aliases={fila:'FILA',휠라:'FILA',nationalgeographic:'National Geographic',내셔널지오그래픽:'National Geographic',akiiiclassic:'AKIII CLASSIC',아키클래식:'AKIII CLASSIC',newbalance:'New Balance',뉴발란스:'New Balance',asics:'ASICS',아식스:'ASICS',adidasoriginals:'Adidas Originals',puma:'PUMA',푸마:'PUMA',nike:'Nike',나이키:'Nike',salomon:'Salomon',살로몬:'Salomon',rockfishweatherwear:'Rockfish Weatherwear',락피쉬웨더웨어:'Rockfish Weatherwear',onitsukatiger:'Onitsuka Tiger',오니츠카타이거:'Onitsuka Tiger'};
 if(name==='adidas')return /originals|오리지널스/i.test([product.name,product.fullName,product.officialCategory,product.url,product.productEvidenceUrl,...(product.keywords||[])].join(' '))?'Adidas Originals':'';
 return PRICE_BRANDS.includes(aliases[name])?aliases[name]:'';
}
export const median=values=>{const a=[...values].sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null;};
export function mlbBenchmark(data){
 const prices=[...new Map((data?.products||[]).filter(p=>p.listPrice>0&&p.style).map(p=>[p.style,p.listPrice])).values()].sort((a,b)=>a-b);
 return prices.length?{count:prices.length,low:prices[0],high:prices.at(-1),median:median(prices),checkedAt:data.checkedAt,sourceUrls:data.sourceUrls||[],scope:data.scope}:null;
}
export function brandPriceRows(products,benchmark=null){
 const brands=new Map();
 for(const p of products){const name=comparisonBrand(p);if(!name)continue;if(!brands.has(name))brands.set(name,new Map());const groups=brands.get(name),key=variantGroupKey(p);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
 return [...brands].map(([name,models])=>{
  const prices=[...models.values()].map(rows=>{const official=rows.filter(p=>!isOverlay(p)&&priceKrw(p)!=null);return median((official.length?official:rows).map(priceKrw).filter(p=>p!=null));}).filter(p=>p!=null).sort((a,b)=>a-b);
  const middle=median(prices),within=benchmark?prices.filter(p=>p>=benchmark.low&&p<=benchmark.high).length:null;
  return {name,group:siteBrandGroup(name),models:models.size,priced:prices.length,missing:models.size-prices.length,low:prices[0]??null,high:prices.at(-1)??null,median:middle,p25:prices.length?prices[Math.floor((prices.length-1)*.25)]:null,p75:prices.length?prices[Math.floor((prices.length-1)*.75)]:null,index:benchmark&&middle!=null?middle/benchmark.median*100:null,difference:benchmark&&middle!=null?middle-benchmark.median:null,within,withinPercent:prices.length&&within!=null?within/prices.length*100:null};
 }).filter(r=>r.priced>0).sort((a,b)=>PRICE_BRANDS.indexOf(a.name)-PRICE_BRANDS.indexOf(b.name));
}
const won=v=>v==null?'—':(v/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})+'만';
let snapshot=null,request=null,rows=[],input=null;
export function renderBrandPrices(products){
 if(input===products&&document.querySelector('#panel-brand table'))return;
 input=products;rows=brandPriceRows(products,mlbBenchmark(snapshot));paint();
 if(!request)request=fetch('./data/mlb-price-benchmark.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).then(data=>{snapshot=data;rows=brandPriceRows(input,mlbBenchmark(snapshot));paint();}).catch(()=>{document.getElementById('mlb-price-reference').textContent='MLB 공식 가격 기준을 불러오지 못했습니다. 브랜드 가격은 계속 표시합니다.';});
}
function paint(){
 const benchmark=mlbBenchmark(snapshot),host=document.querySelector('#panel-brand .panel-body');
 document.getElementById('mlb-price-reference').innerHTML=benchmark?`<strong>MLB 정상가 ${won(benchmark.low)}–${won(benchmark.high)}원</strong><span>중앙값 <b>${won(benchmark.median)}원 = 지수 100</b> · 공식몰 성인 스니커즈·운동화 ${benchmark.count}개 스타일 표본 · ${(benchmark.checkedAt||'').slice(0,10)} 확인</span><span>${benchmark.sourceUrls.map((url,i)=>`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">공식 ${i?'운동화':'스니커즈'} 목록 ↗</a>`).join(' · ')}</span>`:'MLB 공식 가격 기준을 불러오고 있습니다.';
 host.innerHTML=`<div class="brand-price-scroll" tabindex="0" aria-label="전체 브랜드 가격 비교 표"><table class="dist-table brand-price-table"><thead><tr><th>브랜드</th><th>가격 확인 / 전체 모델</th><th>최저–최고</th><th>중앙값</th><th>MLB 대비</th><th>MLB 가격대 내 모델</th></tr></thead><tbody>${rows.map(r=>`<tr data-price-brand="${esc(r.name)}"><th scope="row">${esc(r.name)}<small>${esc(r.group||'')}</small></th><td>${r.priced} / ${r.models}${r.missing?`<small>미확인 ${r.missing}</small>`:''}</td><td>${r.priced?`${won(r.low)}–${won(r.high)}원`:'가격 미확인'}</td><td><b>${won(r.median)}${r.median!=null?'원':''}</b>${r.priced?`<small>중앙 50% ${won(r.p25)}–${won(r.p75)}</small>`:''}</td><td>${r.index!=null?`<b>${Math.round(r.index).toLocaleString()}</b><small>중앙값 ${r.difference>=0?'+':''}${won(r.difference)}원</small>`:'—'}</td><td>${r.withinPercent!=null?`<span class="price-overlap-track"><i style="width:${r.withinPercent}%"></i></span><b>${r.withinPercent.toFixed(0)}%</b><small>${r.within} / ${r.priced}개 모델</small>`:'—'}</td></tr>`).join('')}</tbody></table></div>`;
 document.querySelector('#panel-brand .panel-note').textContent=`상품 필터와 별도의 고정 비교군 · 지정한 9개 중 가격을 확인한 ${rows.length}개 브랜드만 표시합니다. Adidas는 Originals 표기·판매처 분류가 확인된 기록만 포함합니다. 색상·소재는 한 모델로 묶고 모델별 표시가 중앙값을 사용하며 같은 모델의 공식 가격을 우선합니다. 해외가는 고정 환율 참고값이며 할인·국가·확인일 차이가 있습니다. ${RATE_NOTE}`;
}
export function brandPriceExportRows(){return [['브랜드','그룹','전체 모델','가격 확인 모델','가격 미확인 모델','최저 KRW','중앙값 KRW','최고 KRW','25% KRW','75% KRW','MLB 지수 100 대비','MLB 가격대 내 모델'],...rows.map(r=>[r.name,r.group,r.models,r.priced,r.missing,r.low,r.median,r.high,r.p25,r.p75,r.index,r.within])];}
export function bindBrandPrices(){document.getElementById('download-brand-prices').onclick=()=>{const url=URL.createObjectURL(new Blob([csvBytes(brandPriceExportRows())],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='SHOES-brand-prices-MLB.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};}
