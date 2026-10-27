import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
async function patch(path,transform){const url=new URL(path,root),before=await fs.readFile(url,'utf8');if(before.includes('MONTHLY_SNEAKERS_V1'))return;const after=transform(before);if(after===before)throw Error(`No integration changes: ${path}`);await fs.writeFile(url,after);}
function replace(text,from,to){if(!text.includes(from))throw Error(`Integration anchor missing: ${from.slice(0,100)}`);return text.replace(from,to);}
await patch('public/assets/release-window.mjs',text=>{
 text="import {retailerReleaseState} from './monthly-sneakers.mjs'; // MONTHLY_SNEAKERS_V1\n"+text;
 return replace(text,'export function releaseState(product,asOf){','export function releaseState(product,asOf){\n  const retailer=retailerReleaseState(product,asOf);if(retailer!==null)return retailer;');
});
await patch('public/assets/catalog-view.mjs',text=>{
 text="import {monthlySourceMatches,retailerProductUrl,retailerDateLabel,monthlySort} from './monthly-sneakers.mjs'; // MONTHLY_SNEAKERS_V1\n"+text;
 text=replace(text,'export function releaseDateLabel(product){','export function releaseDateLabel(product){if(product.retailerEvidence)return retailerDateLabel(product);');
 text=replace(text,'export function reviewedProductPageUrl(product, today = kstToday()) {','export function reviewedProductPageUrl(product, today = kstToday()) {\n  const retailer=retailerProductUrl(product,today);if(retailer)return retailer;');
 text=replace(text,'export function sourceMatches(product, type, today = kstToday()) {','export function sourceMatches(product, type, today = kstToday()) {\n  const monthly=monthlySourceMatches(product,type,today);if(monthly!==null)return monthly;');
 text=replace(text,'}).sort((a,b)=>{',"}).sort((a,b)=>{\n    if(['monthly-mentions','monthly-likes','media-mentions'].includes(state.sort))return monthlySort(a,b,state.sort,today);");
 return text;
});
await patch('public/assets/app.mjs',text=>{
 text="import {withMonthlyCatalog,monthlyMetricsMarkup,monthlyDetailsMarkup,monthlyDescription,productLinkLabel} from './monthly-sneakers.mjs'; // MONTHLY_SNEAKERS_V1\n"+text;
 text=replace(text,'catalog = value;','catalog = await withMonthlyCatalog(value,today);');
 text=replace(text,'products = preferWomenVariants(eligible).map(', 'products = [...preferWomenVariants(eligible.filter(p=>!p.retailerEvidence)),...eligible.filter(p=>p.retailerEvidence)].map(');
 text=replace(text,"const sourceNames = {magazine:","const sourceNames = {farfetch:'FARFETCH 스니커즈',mytheresa:'MYTHERESA NEW',magazine:");
 text=replace(text,'function renderSourceDescription() {','function renderSourceDescription() {\n  const monthly=monthlyDescription(catalog,state.source);if(monthly){$(\'result-description\').textContent=monthly;return;}');
 text=replace(text,'공식 New·New Arrivals와 품목을 확인한 상품입니다.','브랜드 공식 신상품과 리테일러 스니커즈를 함께 표시합니다. 판매처 NEW 표시는 실제 발매일과 구분합니다.');
 text=replace(text,'${colorChipsMarkup(group,p.id)}</div><div class="card-footer">','${colorChipsMarkup(group,p.id)}${monthlyMetricsMarkup(p,today)}</div><div class="card-footer">');
 text=replace(text,'공식 상품 보기">공식 상품 ↗','${esc(productLinkLabel(p))} 보기">${esc(productLinkLabel(p))} ↗');
 text=replace(text,'>공식 상품 보기 ↗</a>', '>${esc(productLinkLabel(p))} 보기 ↗</a>');
 text=replace(text,"[p.styleType==='official-product-id'?'상품 ID':'스타일 코드'", "[['official-product-id','retailer-product-id'].includes(p.styleType)?'상품 ID':'스타일 코드'");
 text=replace(text,'<h3>출처와 검증 근거</h3>','${monthlyMetricsMarkup(p,today)}<h3>출처와 검증 근거</h3>${monthlyDetailsMarkup(p,today)}');
 text=replace(text,"state.socialGroup=state.source==='sns'?(socialComparisonGroups(products,today)[0]?.key||''):'';", "state.socialGroup='';if(state.source==='sns')state.sort='monthly-mentions';else if(state.source==='media')state.sort='media-mentions';else if(['monthly-mentions','monthly-likes','media-mentions'].includes(state.sort))state.sort='newest';");
 text=text.replace('최근 30일 이내 독립된 출처 2곳 이상','최근 3개월 이내 독립된 출처 2곳 이상');
 text=text.replace('공개 SNS 지표를 확인한 상품이 없습니다','조건을 충족하는 SNS 신상품 표본이 없습니다');
 return text;
});
await patch('public/assets/brand-groups.mjs',text=>{
 text='// MONTHLY_SNEAKERS_V1\n'+text;
 text=replace(text,"{name:'SPORTS', priority:","{name:'RETAIL', priority:[]},\n  {name:'SPORTS', priority:");
 text=replace(text,'const sports = new Set(BRAND_GROUPS[1].priority.map(key));',"const sports = new Set(BRAND_GROUPS.find(g=>g.name==='SPORTS').priority.map(key));");
 text=replace(text,'export function displayBrandGroup(brand) {',"export function displayBrandGroup(brand) {\n  if(brand.group==='retailer'&&!sports.has(key(brand.name))&&!luxury.has(key(brand.name)))return 'RETAIL';");
 text=replace(text,'return BRAND_GROUPS.map(group => {',"return [...BRAND_GROUPS].sort((a,b)=>['LUX','SPORTS','RETAIL'].indexOf(a.name)-['LUX','SPORTS','RETAIL'].indexOf(b.name)).map(group => {");
 return text;
});
await patch('public/index.html',text=>{
 text=replace(text,'</head>','<!-- MONTHLY_SNEAKERS_V1 -->\n<style>.monthly-metrics{margin-top:10px;font-size:12px;line-height:1.6;color:#566780}.monthly-metric{margin:6px 0}.monthly-metric strong{color:#273b56}.source-tabs{flex-wrap:wrap}</style>\n</head>');
 const anchor=text.match(/<button[^>]*data-source="sns"[\s\S]*?<\/button>/)?.[0];if(!anchor)throw Error('SNS tab anchor missing');
 text=replace(text,anchor,anchor+'\n<button type="button" class="source-tab" data-source="farfetch" aria-pressed="false">FARFETCH 스니커즈</button>\n<button type="button" class="source-tab" data-source="mytheresa" aria-pressed="false">MYTHERESA NEW</button>\n<button type="button" class="source-tab" data-source="media" aria-pressed="false">미디어 인기 신상</button>');
 const newest=text.match(/<option value="newest"[^>]*>[\s\S]*?<\/option>/)?.[0];if(!newest)throw Error('Sort anchor missing');
 text=replace(text,newest,newest+'<option value="monthly-mentions">SNS 표본 언급순</option><option value="monthly-likes">SNS 표본 평균 좋아요순</option><option value="media-mentions">3개월 미디어 언급순</option>');
 text=text.replace('매주 일요일 오전 8시 수집 · 한국시간','공식몰: 매주 일요일 · 리테일러·SNS·미디어: 매월 1일 오전 8시 · 한국시간');
 text=text.replace('숫자는 공식 신상품 · 게시 후 3개월 모델 수입니다.','숫자는 현재 표시 가능한 모델 수입니다.');
 text=text.replace('공식 신상품 · 게시 후 3개월</option>','확인된 상품</option>');
 text=text.replaceAll('v=hybrid-collection-20261006','v=monthly-sneakers-20261027');
 return text;
});
console.log('Monthly data adapter integrated; original catalog and official evidence rules preserved.');
