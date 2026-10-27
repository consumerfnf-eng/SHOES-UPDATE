// Retailer assortment evidence is not brand-official or actual launch-date proof.
const SOURCES={farfetch:'FARFETCH',mytheresa:'MYTHERESA'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const url=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const host=(value,domain)=>{try{const h=new URL(value).hostname;return h===domain||h.endsWith('.'+domain);}catch{return false;}};
function cutoff(today){const [y,m,d]=today.split('-').map(Number),date=new Date(Date.UTC(y,m-4,1));date.setUTCDate(Math.min(d,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));return date.toISOString().slice(0,10);}
function fresh(value,today){const time=Date.parse(value);if(!Number.isFinite(time))return false;const day=new Date(time+9*3600000).toISOString().slice(0,10);return day>=cutoff(today)&&day<=today;}
export function validRetailerEvidence(product,today){
 const e=product?.retailerEvidence;if(!e||!SOURCES[e.retailer]||e.kind!=='retailer-listing-card'||!fresh(e.observedAt,today)||!/^\w{64}$/.test(e.contentHash||''))return false;
 const domain=e.retailer+'.com';
 if(!host(product.url,domain)||!host(e.url,domain)||url(e.productUrl)!==url(product.url)||!url(product.image)||url(e.imageUrl)!==url(product.image)||!product.brand||!product.name)return false;
 const id=e.retailer==='farfetch'?new URL(product.url).pathname.match(/-item-(\d+)\.aspx$/i)?.[1]:new URL(product.url).pathname.match(/-(p\d+)$/i)?.[1]?.toUpperCase();
 return !!id&&id===e.productId&&(e.retailer!=='mytheresa'||e.badge==='NEW');
}
export function retailerReleaseState(product,today){return product?.retailerEvidence?(validRetailerEvidence(product,today)?'released':'invalid'):null;}
export function retailerDateLabel(product){const e=product?.retailerEvidence;return e?`${SOURCES[e.retailer]||'판매처'}${e.badge?' · '+e.badge:' · 스니커즈'}`:'';}
export function productLinkLabel(product){return product?.retailerEvidence?`${SOURCES[product.retailerEvidence.retailer]||'판매처'} 상품`:'공식 상품';}
export function retailerProductUrl(product,today){return validRetailerEvidence(product,today)?url(product.url):'';}
function newAssortment(product){return product.retailerEvidence?['NEW','NEW SEASON'].includes(product.retailerEvidence.badge):!!product.arrivalEvidence||!!product.releaseDate;}
function validMetric(product,type,today){
 const metric=product?.monthlySignals?.[type];
 if(!metric||!newAssortment(product)||metric.identityLevel!=='model'||metric.modelKey!==product.monthlyModelKey||!fresh(metric.observedAt,today)||metric.periodStart<cutoff(new Date(Date.parse(metric.observedAt)+9*3600000).toISOString().slice(0,10))||metric.periodEnd>today||metric.periodStart>metric.periodEnd)return null;
 const sources=metric.sources;if(!Array.isArray(sources)||!sources.length)return null;
 if(sources.some(s=>!url(s.url)||!/^\d{4}-\d{2}-\d{2}$/.test(s.publishedAt||'')||s.publishedAt<metric.periodStart||s.publishedAt>metric.periodEnd))return null;
 if(type==='instagram'){
  if(metric.basis!=='hashtag-top-post-sample'||new Set(sources.map(s=>s.url)).size!==metric.postCount||sources.some(s=>!host(s.url,'instagram.com')))return null;
  const likes=sources.map(s=>s.likes).filter(v=>Number.isInteger(v)&&v>=0),sum=likes.reduce((a,b)=>a+b,0);
  if(likes.length!==metric.likesKnownCount||sum!==metric.likesSum||metric.averageLikes!==(likes.length?Math.round(sum/likes.length*100)/100:null))return null;
  if(!Number.isInteger(metric.accountCount)||metric.accountCount<1||metric.accountCount>metric.postCount)return null;
 }else if(type==='media'){
  if(metric.basis!=='observed-editorial-corpus'||new Set(sources.map(s=>s.url)).size!==metric.articleCount||new Set(sources.map(s=>s.publisher)).size!==metric.publisherCount)return null;
 }
 return metric;
}
export function monthlySourceMatches(product,type,today){
 if(['farfetch','mytheresa'].includes(type))return validRetailerEvidence(product,today)&&product.retailerEvidence.retailer===type||(product.retailerListings||[]).some(p=>validRetailerEvidence(p,today)&&p.retailerEvidence.retailer===type);
 if(type==='sns'){const m=validMetric(product,'instagram',today);if(m&&m.postCount>=2&&m.accountCount>=2)return true;}
 if(type==='media'){const m=validMetric(product,'media',today);if(m&&m.articleCount>=2&&m.publisherCount>=2)return true;}
 return null;
}
export function monthlySort(a,b,sort,today){
 const type=sort==='media-mentions'?'media':'instagram',aa=validMetric(a,type,today),bb=validMetric(b,type,today);
 const key=sort==='media-mentions'?'articleCount':sort==='monthly-likes'?'averageLikes':'postCount',av=aa?.[key],bv=bb?.[key];
 if(av==null||bv==null)return Number(av==null)-Number(bv==null);
 return bv-av||(type==='instagram'?(bb.averageLikes??-1)-(aa.averageLikes??-1):bb.publisherCount-aa.publisherCount)||a.id.localeCompare(b.id);
}
function fmt(value){return value==null?'미공개':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(value);}
export function monthlyMetricsMarkup(product,today){
 const ig=validMetric(product,'instagram',today),media=validMetric(product,'media',today),rows=[];
 if(ig)rows.push(`<p class="monthly-metric"><strong>Instagram 모델 언급 ${fmt(ig.postCount)}건</strong><br>평균 좋아요 ${fmt(ig.averageLikes)}${ig.averageLikes==null?'':'개'} · 공개 수치 ${fmt(ig.likesKnownCount)}/${fmt(ig.postCount)}건<br><small>${esc(ig.observedAt.slice(0,10))} 관측 · 컬러별 지표 아님</small></p>`);
 if(media)rows.push(`<p class="monthly-metric"><strong>미디어 모델 언급 ${fmt(media.articleCount)}건</strong><br>${fmt(media.publisherCount)}개 매체 · ${esc(media.periodStart)}~${esc(media.periodEnd)}</p>`);
 return rows.length?`<div class="monthly-metrics">${rows.join('')}</div>`:'';
}
export function monthlyDetailsMarkup(product,today){
 const rows=[],e=product.retailerEvidence;
 if(e)rows.push(`<div class="evidence"><span class="source-badge">${esc(SOURCES[e.retailer])} · ${esc(e.badge||'스니커즈 카테고리')}</span><a href="${esc(url(e.url))}" target="_blank" rel="noopener noreferrer">수집 목록 ↗</a><p>${esc(e.observedAt.slice(0,10))} 확인 · 판매처 상품 ID ${esc(e.productId)}. NEW·NEW SEASON은 발매일 증거가 아닙니다.</p></div>`);
 for(const type of ['instagram','media']){
  const m=validMetric(product,type,today);if(!m)continue;
  rows.push(`<details class="evidence"><summary>${type==='instagram'?'Instagram 게시물':'매거진·뉴스레터 기사'} 근거 ${m.sources.length}건 · ${esc(m.periodStart)} ~ ${esc(m.periodEnd)}</summary>${m.sources.map(s=>`<p><a href="${esc(url(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title||'원본 게시물')} ↗</a><br><small>${esc(s.publishedAt)}${type==='instagram'?' · 좋아요 '+fmt(s.likes):' · '+esc(s.publisherName||s.publisher)}</small></p>`).join('')}</details>`);
 }
 return rows.join('');
}
const STATUS={'complete':'전체 페이지 확인','partial':'일부 페이지 확인','blocked':'접근 제한 또는 수집 응답 오류','observed-corpus':'수집 기사 기준','partial-feed':'피드 일부 확인','authentication-or-source-unavailable':'로그인 세션 또는 Instagram 접근 확인 필요','observed-sample':'게시물 표본 집계','no-confirmed-matches':'확인된 일치 항목 없음','unavailable':'수집 불가','dependency-missing':'수집 환경 확인 필요'};
export function monthlyDescription(catalog,type){
 const s=catalog?.monthly?.sourceStatus;
 if(['farfetch','mytheresa'].includes(type)){
  const r=s?.retailers?.find(x=>x.source===type),note=type==='farfetch'?'남성 스니커즈 전체 카탈로그 수집 대상입니다. NEW SEASON을 실제 최근 발매로 해석하지 않습니다.':'여성 스니커즈 중 NEW·New Arrival 표시 상품만 포함합니다. NEW SEASON 단독 표시는 제외합니다.';
  return `${note} ${r?`${STATUS[r.status]||r.status} · ${r.pagesRead}페이지 · 이번 확인 ${r.accepted}개. ${r.complete?'':'전체 업로드 완료가 아닙니다. 이전 확인 상품은 유지합니다.'}`:'아직 수집 완료본이 없습니다.'}`;
 }
 if(type==='sns')return `Instagram #신발추천·#고프코어슈즈 등의 인기 게시물에서 모델 언급 수와 공개 좋아요 평균을 집계합니다. 같은 게시물은 한 번만 세며 전체 Instagram 순위나 컬러별 인기도가 아닙니다. ${s?.instagram?`${STATUS[s.instagram.status]||s.instagram.status}.`:''} 기존 공개 검색량 지표와는 별도 집계입니다.`;
 if(type==='media')return `최근 수집일 기준 3개월에 발행된 매거진·뉴스레터 중 수집한 원문에서 모델 언급이 확인된 상품입니다. 최소 2개 매체·2개 기사 조건을 적용하며 전체 인터넷 순위가 아닙니다. ${s?.media?`${STATUS[s.media.status]||s.media.status} · 일치 기사 ${s.media.articlesMatched||0}건.`:''}`;
 return '';
}
export function mergeMonthlyCatalog(base,monthly,today){
 if(monthly?.schemaVersion!==1||!Array.isArray(monthly.products))return {...base,monthly:null};
 const products=base.products.map(p=>({...p})),urls=new Map(products.map(p=>[url(p.url),p])),ids=new Set(products.map(p=>p.id));
 for(const p of monthly.products){
  if(!validRetailerEvidence(p,today))continue;
  const same=urls.get(url(p.url))||products.find(x=>p.manufacturerStyle&&x.style&&x.styleType!=='retailer-product-id'&&normalized(x.brand)===normalized(p.brand)&&normalized(x.style)===normalized(p.manufacturerStyle)&&p.colorway&&normalized(x.colorway)===normalized(p.colorway));
  if(same){same.retailerListings=[...(same.retailerListings||[]),p];continue;}
  if(ids.has(p.id))continue;products.push({...p});ids.add(p.id);urls.set(url(p.url),p);
 }
 const byId=new Map(products.map(p=>[p.id,p]));
 for(const [key,model] of Object.entries(monthly.models||{}))for(const id of model.productIds||[]){const p=byId.get(id);if(!p||normalized(p.brand)!==normalized(model.brand))continue;p.monthlyModelKey=key;p.monthlySignals={instagram:monthly.signals?.instagram?.[key],media:monthly.signals?.media?.[key]};}
 const brands=[...base.brands];for(const p of products)if(!brands.some(b=>normalized(b.name)===normalized(p.brand)))brands.push({name:p.brand,group:'retailer',policy:'retailer-reference'});
 return {...base,products,brands,monthly};
}
export async function withMonthlyCatalog(base,today){
 try{const r=await fetch('./data/monthly-sneakers.json',{cache:'no-cache',signal:AbortSignal.timeout(15000)});if(!r.ok)return {...base,monthly:null};return mergeMonthlyCatalog(base,await r.json(),today);}catch{return {...base,monthly:null};}
}
