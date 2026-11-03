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
export const COMPARISON_BANDS=[[0,100000,'10만원 미만'],[100000,150000,'10–15만원'],[150000,200000,'15–20만원'],[200000,300000,'20–30만원'],[300000,Infinity,'30만원 이상']];
export const priceCounts=prices=>COMPARISON_BANDS.map(([low,high])=>prices.filter(price=>price>=low&&price<high).length);
export function mlbBenchmark(data){
 const prices=[...new Map((data?.products||[]).filter(p=>p.listPrice>0&&p.style).map(p=>[p.style,p.listPrice])).values()].sort((a,b)=>a-b);
 return prices.length?{count:prices.length,low:prices[0],high:prices.at(-1),median:median(prices),bands:priceCounts(prices),checkedAt:data.checkedAt,sourceUrls:data.sourceUrls||[],scope:data.scope}:null;
}
export function brandPriceRows(products,benchmark=null){
 const brands=new Map();
 for(const p of products){const name=comparisonBrand(p);if(!name||String(p.source||'').startsWith('newsletter-'))continue;if(!brands.has(name))brands.set(name,new Map());const groups=brands.get(name),key=variantGroupKey(p);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
 return [...brands].map(([name,models])=>{
  const krw=p=>/₩|원|\bKRW\b/i.test(p.priceLabel||'');
  const domestic=[...models.values()].some(rows=>rows.some(p=>krw(p)&&priceKrw(p)!=null));
  const prices=[...models.values()].map(rows=>{const eligible=rows.filter(p=>priceKrw(p)!=null&&(!domestic||krw(p)));const official=eligible.filter(p=>!isOverlay(p));return median((official.length?official:eligible).map(priceKrw));}).filter(p=>p!=null).sort((a,b)=>a-b);
  const middle=median(prices);
  return {name,group:siteBrandGroup(name),basis:domestic?'한국 원화 표시가':'해외 환산 참고',models:models.size,priced:prices.length,low:prices[0]??null,high:prices.at(-1)??null,median:middle,bands:priceCounts(prices),difference:benchmark&&middle!=null?middle-benchmark.median:null};
 }).filter(r=>r.priced>0).sort((a,b)=>PRICE_BRANDS.indexOf(a.name)-PRICE_BRANDS.indexOf(b.name));
}
const won=v=>v==null?'—':Math.round(v).toLocaleString('ko-KR')+'원';
export function priceComparisonMarkup(rows,benchmark){
 const maximum=Math.ceil(Math.max(benchmark?.median||0,...rows.map(r=>r.median||0),100000)/100000)*100000;
 const percent=value=>(value/maximum*100).toFixed(3);
 const reference=benchmark?percent(benchmark.median):null;
 const all=benchmark?[{...benchmark,name:'MLB',basis:'한국 공식몰 정상가',difference:0},...rows]:rows;
 const bar=r=>{
  const mlb=r.name==='MLB',difference=benchmark?r.median-benchmark.median:null;
  const direction=difference==null?'':difference<0?'lower':difference>0?'higher':'equal';
  const delta=mlb?'비교 기준':difference==null?'':difference===0?'MLB와 동일':`MLB보다 ${won(Math.abs(difference))} ${difference<0?'저렴':'높음'}`;
  return `<div class="price-comparison-row ${mlb?'is-mlb':''}" ${mlb?'data-price-reference="MLB"':`data-price-brand="${esc(r.name)}"`}><div class="price-brand-label"><strong>${esc(r.name)}</strong><small>${esc(r.basis)}</small></div><div class="price-bar-cell"><div class="price-bar-track" role="img" aria-label="${esc(r.name)} 중앙값 ${won(r.median)}${delta?' · '+esc(delta):''}"><span class="price-median-bar ${direction}" style="width:${percent(r.median)}%"></span>${reference!=null?`<i class="price-mlb-line" style="left:${reference}%" aria-hidden="true"></i>`:''}</div><div class="price-range-label">최저 ${won(r.low)} <span>·</span> 최고 ${won(r.high)}</div></div><div class="price-comparison-value"><b>${won(r.median)}</b><span class="${direction}">${esc(delta)}</span></div></div>`;
 };
 const largest=Math.max(1,...all.flatMap(r=>r.bands));
 return `<div class="price-chart-key"><span><i></i> 막대 길이 = 브랜드 중앙값</span><span><i class="dashed"></i> 점선 = MLB 중앙값${benchmark?' '+won(benchmark.median):''}</span></div><div class="price-axis" aria-hidden="true"><span>0원</span><span>${won(maximum/2)}</span><span>${won(maximum)}</span></div><div class="price-comparison-chart">${all.map(bar).join('')}</div><h4 class="price-count-title">가격대별 상품 개수</h4><p class="price-count-note">같은 디자인의 컬러·소재는 하나로 묶어 집계합니다. 10–15만원은 10만원 이상~15만원 미만입니다.</p><div class="brand-price-scroll" tabindex="0" aria-label="브랜드별 가격대 상품 개수"><table class="dist-table brand-price-table price-count-table"><thead><tr><th>브랜드</th>${COMPARISON_BANDS.map(([, ,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${all.map(r=>`<tr${r.name==='MLB'?' class="is-mlb"':''}><th scope="row">${esc(r.name)}</th>${r.bands.map((n,i)=>`<td aria-label="${esc(r.name)} ${COMPARISON_BANDS[i][2]} ${n}개"><span style="--count-fill:${n/largest*100}%"><b>${n}개</b></span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
let snapshot=null,request=null,rows=[],input=null;
export function renderBrandPrices(products){
 if(input===products&&document.querySelector('#panel-brand .price-comparison-chart'))return;
 input=products;rows=brandPriceRows(products,mlbBenchmark(snapshot));paint();
 if(!request)request=fetch('./data/mlb-price-benchmark.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).then(data=>{snapshot=data;rows=brandPriceRows(input,mlbBenchmark(snapshot));paint();}).catch(()=>{document.getElementById('mlb-price-reference').textContent='MLB 공식 가격 기준을 불러오지 못했습니다. 브랜드 가격은 계속 표시합니다.';});
}
function paint(){
 const benchmark=mlbBenchmark(snapshot),host=document.querySelector('#panel-brand .panel-body');
 document.getElementById('mlb-price-reference').innerHTML=benchmark?`<strong>비교 기준 · MLB 중앙값 ${won(benchmark.median)}</strong><span>최저 ${won(benchmark.low)} · 최고 ${won(benchmark.high)} · 한국 공식몰 성인 스니커즈·운동화 정상가 표본 · ${(benchmark.checkedAt||'').slice(0,10)} 확인</span><span>${benchmark.sourceUrls.map((url,i)=>`<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">공식 ${i?'운동화':'스니커즈'} 목록 ↗</a>`).join(' · ')}</span>`:'MLB 공식 가격 기준을 불러오고 있습니다.';
 host.innerHTML=priceComparisonMarkup(rows,benchmark);
 document.querySelector('#panel-brand .panel-note').textContent=`상품 필터와 별도의 고정 비교군 · 지정한 9개 중 가격을 확인한 ${rows.length}개 브랜드만 표시합니다. Adidas는 Originals 표기·판매처 분류가 확인된 기록만 포함합니다. 색상·소재는 한 모델로 묶고 모델별 표시가 중앙값을 사용하며 브랜드별로 한국 원화 표시가를 우선하고 없으면 확인된 해외 통화만 환산합니다. 기사의 금액은 가격에 넣지 않습니다. 같은 모델·같은 통화 범위에서는 공식 가격을 우선합니다. 타 브랜드는 관측 판매가로 할인·확인일 차이가 있으며 MLB는 정상가 표본입니다. ${RATE_NOTE}`;
}
export function brandPriceExportRows(){const benchmark=mlbBenchmark(snapshot),all=benchmark?[{...benchmark,name:'MLB',basis:'한국 공식몰 정상가',difference:0},...rows]:rows;return [['브랜드','가격 기준','최저 KRW','중앙값 KRW','최고 KRW','MLB 중앙값 대비 차액 KRW',...COMPARISON_BANDS.map(([, ,label])=>label+' 상품 개수')],...all.map(r=>[r.name,r.basis,r.low,r.median,r.high,r.difference,...r.bands])];}
export function bindBrandPrices(){document.getElementById('download-brand-prices').onclick=()=>{const url=URL.createObjectURL(new Blob([csvBytes(brandPriceExportRows())],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='SHOES-brand-prices-MLB.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};}
