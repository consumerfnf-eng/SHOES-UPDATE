import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reviewAdminProducts} from '../scripts/admin-publication-review.mjs';
import {curateCatalog,officialEvidenceFor,kstDay} from '../scripts/curation.mjs';
import {productPresentation} from '../scripts/product-presentation.mjs';
import {koreanNewSectionPage,collectKoreanNewSections,koreanNewSectionSources,spyderThermoReview,resolveKVillagePublicContract,kvillageVisibleNewBadge,classifyKVillageReviewedPhoto,kvillagePhotoReviews,collectKVillageFootwearAudit,blackyakNewSectionPage,collectBlackyakNew} from '../scripts/collect-korean-new-sections.mjs';

const at='2026-11-05T05:00:00.000Z',k2=koreanNewSectionSources.K2.url,spyder=koreanNewSectionSources.spyder.url;
const kcard=(id='FUF26G03E7',name='플라이하이크 스카이 LE(E7) (Brown)')=>`<a class="prd-ele" href="https://www.k-village.co.kr/goods/${id}" data-dtr-track="${id}"><div class="thumb-img"><div class="thumb-over"><img src="https://contents.k-village.co.kr/Prod/2026/K/${id}/${id}_DG_02.JPG"></div><img id="mainImage_${id}" src="https://contents.k-village.co.kr/Prod/2026/K/${id}/${id}_DG_01.JPG"><button data-goodscd="${id}" data-brandnm="K2" data-sellprice="259,000"></button></div><div class="prd-info"><p class="prd-name ellipsis">${name}</p></div></a>`;
const kpage=cards=>`<nav>FW NEW ARRIVAL</nav><div id="trend"><div class="wrap-holder"><div class="section-tit-02">26FW NEW ARRIVAL</div><div class="swiper-wrapper">${cards}</div></div></div>`;
const scard=(id='18601',name='THERMO WEB 써모 웹')=>`<li id="anchorBoxId_${id}" class="swiper-slide"><div class="thumbnail"><div class="prdImg"><a href="/product/thermo-web-써모-웹/${id}/category/1/display/177/"><img src="//www.spyder.co.kr/web/product/medium/202610/f9e628f3a8a098f04ab691c54f0975d4.jpg" alt="PHASER 페이저 - PHASER 페이저 제품 이미지"></a></div></div><div class="description"><strong class="name"><a href="/product/thermo-web-써모-웹/${id}/category/1/display/177/"><span class="title dn">상품명 :</span><span>${name}</span></a></strong><ul class="spec"><li data-title="판매가"><span>159,000원</span></li><li data-title="소비자가">159,000원</li></ul></div></li>`;
const spage=cards=>`<div id="newArrivals" class="section"><div class="wrapper"><div class="ttBox"><h3 class="tt">New Arrivals</h3></div></div><div class="contBox"><ul>${cards}</ul></div></div>`;
const surl=new URL('/product/thermo-web-써모-웹/18601/category/1/display/177/',spyder).href;
const detail=`<h2>THERMO WEB 써모 웹</h2><table><tr data-title="상품코드"><th>상품코드</th><td>SPLFFNLS327U-BLK</td></tr></table><img src="${new URL(spyderThermoReview.imageUrl).pathname}">`;
const opts={brand:'spyder',at,details:new Map([[surl,detail]]),assetHashes:new Map([[spyderThermoReview.imageUrl,spyderThermoReview.contentHash]])};

test('K2 binds only cards inside the actual New-only section; carousel clones deduplicate',()=>{
  const h=kpage(kcard()+kcard())+`<div id="best">${kcard('OTHER','스니커즈')}</div>`;
  const r=koreanNewSectionPage(h,k2,{brand:'K2',at});
  assert.equal(r.candidates.length,1);assert.equal(r.products.length,0);
  assert.equal(r.held[0].sourceProductId,'FUF26G03E7');
  assert.equal(r.coverage.read,1);assert.equal(r.coverage.total,null);
  assert.equal(r.coverage.exhausted,false);assert.equal(r.coverage.exhaustive,false);
  assert.equal(r.coverage.scopedOfficialNew,true);
});
test('explicit sneaker title is eligible without inventing a release date or other variants',()=>{
  const r=koreanNewSectionPage(kpage(kcard('FUF26G03E7','공용 스니커즈')),k2,{brand:'K2',at});
  assert.equal(r.products.length,1);const p=r.products[0];
  assert.equal(p.style,'FUF26G03E7');assert.equal(p.arrivalEvidence.excerpt,'26FW NEW ARRIVAL · 공용 스니커즈');
  assert.equal(p.priceLabel,'KRW 259000');assert.equal(p.firstSeen,at);
  assert.equal(p.releaseDate,undefined);assert.equal(p.arrivalEvidence.date,undefined);
  assert.equal(p.arrivalEvidence.productUrl,p.url);assert.equal(p.officialImageEvidence.url,p.image);
  assert.equal(p.arrivalEvidence.contentHash,p.officialProductEvidence.contentHash);assert.equal(p.arrivalEvidence.contentHash,p.officialImageEvidence.contentHash);
  const curated=curateCatalog([p],{now:new Date(at)});assert.equal(curated.snapshot.products.length,1,JSON.stringify(curated.review.held));assert.ok(productPresentation(curated.snapshot.products[0],{products:[]}));
});
test('navigation, mixed New&Best, hidden headings, hidden sections and truncation are not New proof',()=>{
  for(const h of [
    `<nav>New Arrivals</nav><div id="best">${kcard()}</div>`,
    kpage(kcard()).replace('26FW NEW ARRIVAL','NEW&amp;BEST'),
    kpage(kcard()).replace('class="section-tit-02"','class="section-tit-02" hidden'),
    kpage(kcard()).replace('id="trend"','id="trend" style="display:none"'),
    kpage(kcard()).slice(0,-6),
  ])assert.throws(()=>koreanNewSectionPage(h,k2,{brand:'K2',at}),/section|heading/);
});
test('reject wrong source, shared-store brand mismatch, offsite links and unbound images',()=>{
  assert.throws(()=>koreanNewSectionPage(kpage(kcard()),k2+'?sort=new',{brand:'K2'}),/Exact official/);
  assert.throws(()=>koreanNewSectionPage(kpage(kcard()),'https://www.k-village.co.kr/dynafit',{brand:'K2'}),/Exact official/);
  assert.throws(()=>koreanNewSectionPage(kpage(kcard()).replace('data-brandnm="K2"','data-brandnm="DYNAFIT"'),k2,{brand:'K2'}),/binding/);
  assert.throws(()=>koreanNewSectionPage(kpage(kcard()).replace('href="https://www.k-village.co.kr/','href="https://fake.example/'),k2,{brand:'K2'}),/Cross-brand/);
  const r=koreanNewSectionPage(kpage(kcard('FUF26G03E7','스니커즈')).replaceAll('contents.k-village.co.kr','fake.example'),k2,{brand:'K2'});
  assert.equal(r.products.length,0);assert.match(r.held[0].reason,/unbound/);
});
test('Spyder nested price li stays in card; exact reviewed SKU and fetched graphic hash establish eligibility',()=>{
  const h=spage(scard())+`<div id="best"><ul>${scard('99999','스니커즈')}</ul></div>`;
  const r=koreanNewSectionPage(h,spyder,opts);assert.equal(r.candidates.length,1);assert.equal(r.products.length,1);
  const p=r.products[0];assert.equal(p.style,'SPLFFNLS327U-BLK');assert.equal(p.name,'THERMO WEB 써모 웹');
  assert.equal(p.priceLabel,'KRW 159000');assert.equal(p.sneakerEligibilityEvidence.url,spyderThermoReview.imageUrl);
  assert.match(p.sneakerEligibilityEvidence.excerpt,/윈터 스니커즈/);
  assert.equal(p.arrivalEvidence.kind,'new-arrivals-listing');assert.equal(p.arrivalEvidence.sectionId,'newArrivals');
  assert.equal(p.releaseDate,undefined);assert.equal(p.manufactureDate,undefined);
});
test('homepage listing proofs share one section hash; supplementary PDP hash stays separate and passes curation/presentation',()=>{
  const h=spage(scard()),raw=koreanNewSectionPage(h,spyder,opts).products[0];
  assert.equal(raw.arrivalEvidence.contentHash,raw.officialProductEvidence.contentHash);
  assert.equal(raw.arrivalEvidence.contentHash,raw.officialImageEvidence.contentHash);
  assert.equal(raw.supplementaryProductEvidence.contentHash,createHash('sha256').update(detail).digest('hex'));
  assert.notEqual(raw.supplementaryProductEvidence.contentHash,raw.arrivalEvidence.contentHash);
  assert.ok(officialEvidenceFor(raw,kstDay(at)));assert.ok(productPresentation(raw,{products:[]}));
  const curated=curateCatalog([raw],{now:new Date(at)});assert.equal(curated.snapshot.products.length,1,JSON.stringify(curated.review.held));
  assert.ok(productPresentation(curated.snapshot.products[0],{products:[]}));
  const broken={...raw,officialImageEvidence:{...raw.officialImageEvidence,contentHash:'neighbor-card-hash'}};
  assert.equal(officialEvidenceFor(broken,kstDay(at)),null);assert.equal(productPresentation(broken,{products:[]}),null);
  assert.equal(curateCatalog([broken],{now:new Date(at)}).snapshot.products.length,0);
});
test('a known product ID, misleading alt, absent/changed graphic or wrong color SKU cannot imply eligibility',()=>{
  const h=spage(scard());
  for(const o of [
    {brand:'spyder'},
    {...opts,assetHashes:new Map()},
    {...opts,assetHashes:new Map([[spyderThermoReview.imageUrl,'changed']])},
    {...opts,details:new Map([[surl,detail.replace('-BLK','-KHA')]])},
    {...opts,details:new Map([[surl,detail.replace(new URL(spyderThermoReview.imageUrl).pathname,'/unrelated.jpg')]])},
  ])assert.equal(koreanNewSectionPage(h,spyder,o).products.length,0);
  assert.throws(()=>koreanNewSectionPage(spage('').replace('New Arrivals','Best')+scard(),spyder,opts),/heading/);
});
test('access challenges fail even with HTTP-200 HTML; errors are isolated and coverage never completes',async()=>{
  const challenge='<title>Cafe24</title><p>please check your access</p>';
  assert.throws(()=>koreanNewSectionPage(challenge,spyder,{brand:'spyder'}),/OFFICIAL_ACCESS_CHALLENGE/);
  const r=await collectKoreanNewSections({now:new Date(at),readHtml:async u=>u===k2?kpage(kcard()):challenge});
  assert.equal(r.coverage.length,2);assert.equal(r.coverage[0].status,'partial');assert.equal(r.coverage[1].status,'failed');
  assert.equal(r.errors.length,1);assert.equal(r.products.length,0);
  assert.ok(r.coverage.every(c=>c.exhaustive===false&&c.total===null));
});
test('NEPA actual WHAT\'S NEW section yields held shoe candidates; generic leather name is insufficient',()=>{
  const u=koreanNewSectionSources.NEPA.url;
  const h=`<section id="whatsnewSlide"><h2>WHAT'S NEW</h2><div class="goods"><a href="https://www.nplus.co.kr/product/view.asp?pno=46269"><div><img src="https://assetscdn51.styleship.com/assets/nplus/data/productimages/01/2/7M67656_D22_01.JPG"></div><p class="name">여성 레아 레더</p></a></div></section>`;
  const r=koreanNewSectionPage(h,u,{brand:'NEPA',at});assert.equal(r.candidates.length,1);assert.equal(r.products.length,0);assert.equal(r.held.length,1);
});
test('locally cached actual K2 HTML has bounded New evidence without auto-classifying Flyhike',async t=>{
  let h;try {h=await fs.readFile(new URL('../logs/k2-new.html',import.meta.url),'utf8');}catch(e){if(e.code==='ENOENT'){t.skip('Optional research cache absent');return;}throw e;}
  const r=koreanNewSectionPage(h,k2,{brand:'K2',at});
  assert.equal(r.coverage.read,13);assert.equal(r.products.length,0);
  assert.ok(r.held.some(p=>p.sourceProductId==='FUF26G03E7'));
});

// Minimal copies of the observed production expressions, not evaluated code.
const observedNewRule='function isNewGoods(e){var t=!1;if(isNotEmpty(e)&&/\\d{14}/.test(e)){var n=String(e),o=n.substring(0,4),a=n.substring(4,6)-1,r=n.substring(6,8),i=new Date(o,a,r);(new Date).getTime()-i.getTime()<6048e5&&(t=!0)}return t}';
const scriptBase='https://contents.k-village.co.kr/front/common/js/';
const publicScripts=new Map([
  [scriptBase+'common.js','api_domain=location.protocol+"//"+location.hostname+":"+location.port;a.setRequestHeader("X-CSRF-TOKEN",t);'+observedNewRule+'function isSoldOut(e){var t=!1;return"20"!=e&&(t=!0),t}'],
  [scriptBase+'searchCommon.js','var t="/search/result";t="/search/recommend";data:JSON.stringify(window.searchOption[e]);window.searchOption[e][r]=a'],
  [scriptBase+'searchFilter.js','BRAND_M:"searchBrandMGroup"'],
  [scriptBase+'goodsTemplate.js','{{if isSoldOut(goods.sellStCd)}}SOLD OUT{{else}}{{if isNewGoods(goods.cnsntDtm)}}<span class="list-flag">NEW</span>{{/if}}{{/if}}'],
]);
const publicContext=`<meta name="_csrf" content="anonymous-public-fixture"><script>var curDvsn = 'brandmall';var curLCategoryNo = 1007;var mgnDvsnCd = '10';</script>${[...publicScripts.keys()].map(u=>`<script src="${u}"></script>`).join('')}<a href="/k2?cm=1361&cs=12000"># FW NEW ARRIVAL</a>${['10194','10193','10199'].map(id=>`<a onclick="redirectMainUrl('brandmall','/k2','1033','${id}')">Category</a>`).join('')}`;
function auditFixture({photoChanged=false,mutate}={}) {
  const review=kvillagePhotoReviews.get('FUF26G03E7');
  const make=(id,i)=>({goodsCd:id,brandNm:'K2',pcDspyNm:id==='FUF26G03E7'?'플라이하이크 스카이 LE(E7) (Brown)':'Fixture shoe '+i,cnsntDtm:'20260810115820',sellStCd:'20',sellPrice:259000,imgBaseUrl:'https://contents.k-village.co.kr',listMainImgUrl:id==='FUF26G03E7'?new URL(review.imageUrl).pathname:'/Prod/2026/K/'+id+'/'+id+'_DG_01.JPG'});
  const rows=Array.from({length:51},(_,i)=>make(i===0?'FUF26G03E7':'FIXTURE'+i,i));
  const calls=[];
  const response=(a,total)=>({code:'000',message:'성공하였습니다.',response:{totalSize:total,searchResult:a.map(r=>({...r,totalCnt:total})),groupResult:[]}});
  return {calls,options:{brands:['K2'],now:new Date(at),readHtml:async u=>publicScripts.get(u)||(u.includes('cs=12000')?"groobeeCategory.cateNm = '# FW NEW ARRIVAL'":publicContext),postJson:async(u,b)=>{
    calls.push({url:u,body:b});let d;
    if(b.searchBrandMCode)d=response(rows.slice((b.pageNumber-1)*50,b.pageNumber*50),51);
    else if(['10194','12000'].includes(b.searchBrandSCode))d=response([rows[0]],1);
    else d=response([],0);
    return mutate?mutate(d,b):d;
  },readImageHash:async()=>photoChanged?'changed':review.contentHash}};
}
test('public script contract resolves same-origin API and fails closed on badge/code drift',()=>{
  const c=resolveKVillagePublicContract(publicContext,k2,publicScripts);
  assert.equal(c.apiUrl,'https://www.k-village.co.kr/search/result');assert.equal(c.method,'POST');assert.equal(c.scripts.length,4);
  const changed=new Map(publicScripts);changed.set(scriptBase+'common.js',changed.get(scriptBase+'common.js').replace('6048e5','12096e5'));
  assert.throws(()=>resolveKVillagePublicContract(publicContext,k2,changed),/New badge rule/);
  const wrongLabel=new Map(publicScripts);wrongLabel.set(scriptBase+'goodsTemplate.js',wrongLabel.get(scriptBase+'goodsTemplate.js').replace('>NEW<','>BEST<'));
  assert.throws(()=>resolveKVillagePublicContract(publicContext,k2,wrongLabel),/New badge rule/);
  assert.throws(()=>resolveKVillagePublicContract(publicContext,'https://fake.example/k2',publicScripts),/origin/);
});
test('official New badge uses Seoul midnight, strict seven-day boundary and sellable status; never release date',()=>{
  const row={cnsntDtm:'20261029235959',sellStCd:'20'};
  assert.equal(kvillageVisibleNewBadge(row,new Date('2026-11-04T14:59:59.999Z')),true);
  assert.equal(kvillageVisibleNewBadge(row,new Date('2026-11-04T15:00:00.000Z')),false);
  assert.equal(kvillageVisibleNewBadge({...row,sellStCd:'30'},new Date('2026-10-30T03:00:00Z')),false);
  assert.throws(()=>kvillageVisibleNewBadge({...row,cnsntDtm:'20261106000000'},new Date(at)),/Future approval/);
  assert.throws(()=>kvillageVisibleNewBadge({...row,cnsntDtm:'20260230000000'},new Date(at)),/Invalid approval/);
});
test('reviewed low hiking shoe needs unchanged exact SKU photo AND actual source category membership',()=>{
  const r=kvillagePhotoReviews.get('FUF26G03E7'),row={goodsCd:'FUF26G03E7',imgBaseUrl:'https://contents.k-village.co.kr',listMainImgUrl:new URL(r.imageUrl).pathname};
  assert.equal(classifyKVillageReviewedPhoto(row,{imageHash:r.contentHash,categoryMembership:['10194']}).decision,'eligible');
  assert.equal(classifyKVillageReviewedPhoto(row,{imageHash:'changed',categoryMembership:['10194']}).decision,'held');
  assert.equal(classifyKVillageReviewedPhoto(row,{imageHash:r.contentHash,categoryMembership:[]}).decision,'held');
  assert.equal(classifyKVillageReviewedPhoto({...row,goodsCd:'FUF26G04N4'},{imageHash:r.contentHash,categoryMembership:['10194']}).decision,'held');
});
test('API audit reconciles all pages, retains actual JSON and applies observed New-collection footwear filter',async()=>{
  const f=auditFixture(),r=await collectKVillageFootwearAudit(f.options);
  assert.deepEqual(r.errors,[]);assert.equal(r.products.length,1);assert.equal(r.products[0].style,'FUF26G03E7');
  assert.equal(r.products[0].releaseDate,undefined);assert.equal(r.products[0].arrivalEvidence.kind,'new-arrivals-listing');
  assert.equal(r.coverage[0].footwearRead,51);assert.equal(r.coverage[0].newBadgeRows,0);assert.equal(r.coverage[0].newFootwearEnumerationComplete,true);
  assert.equal(r.coverage[0].exhaustive,false);assert.equal(r.coverage[0].total,null);
  assert.equal(r.sourceCoverage[0].pages,2);assert.equal(r.sourceCoverage[0].read,51);assert.equal(r.sourceCoverage[0].exhausted,true);
  assert.equal(r.evidence[0].json.response.searchResult[0].goodsCd,'FUF26G03E7');assert.equal(r.evidence[0].contentHash.length,64);
  const call=f.calls.find(c=>c.body.searchBrandSCode==='12000');assert.equal(call.body.searchBrandMGroup,'1033');assert.equal(call.url,'https://www.k-village.co.kr/search/result');
  assert.equal(f.calls[0].url,'https://www.k-village.co.kr/search/recommend');assert.equal(f.calls[0].body.mgnDvsnCd,'10');
  assert.ok(!JSON.stringify(r.evidence).includes('anonymous-public-fixture'));
  assert.equal(r.sourceBindings.K2[0].url,'https://www.k-village.co.kr/k2?cm=1361&cs=12000');
  assert.equal(reviewAdminProducts(r.products,r.sourceBindings).products.length,1);
  const curated=curateCatalog(r.products,{now:new Date(at)});assert.equal(curated.snapshot.products.length,1,JSON.stringify(curated.review.held));
  assert.ok(productPresentation(curated.snapshot.products[0],{products:[]}));
});
test('pagination drift, repeated SKU and page bounds cannot produce complete source evidence',async()=>{
  for(const kind of ['drift','repeat','bound']) {
    const f=auditFixture({mutate:(d,b)=>{if(b.searchBrandMCode&&b.pageNumber===2){if(kind==='drift')d.response.totalSize=52;if(kind==='repeat')d.response.searchResult[0].goodsCd='FUF26G03E7';}return d;}});
    const r=await collectKVillageFootwearAudit({...f.options,...(kind==='bound'?{maxPages:1}:{})});
    assert.equal(r.products.length,0);assert.equal(r.coverage[0].newFootwearEnumerationComplete,false);assert.equal(r.coverage[0].exhaustive,false);assert.equal(r.errors.length,1);
  }
});
test('changed reviewed image holds eligibility while retaining completed category enumeration',async()=>{
  const f=auditFixture({photoChanged:true}),r=await collectKVillageFootwearAudit(f.options);
  assert.equal(r.products.length,0);assert.equal(r.held.length,1);assert.equal(r.coverage[0].newFootwearEnumerationComplete,true);
});
const blackyakFixture=`<section id="season_essentials1"><div>GRIFF X</div><div>26 F/W NEW</div><ul>${[['952','BK'],['913','GY'],['912','BR'],['911','TU']].map(([model,color])=>`<li class="se_prd" prd-id="ABYSHXV${model}${color}" prd-name="그리프X GTX"><a href="/blackyak/shop/detail.php?pno=product${model}"><img src="//picweb.blackyak.com/workbook/2026_BY/ABYSHXV${model}_${color}/ABYSHXV${model}_${color}_WMain_view_860_FRONT.jpg"></a></li>`).join('')}</ul></section>`;
test('BLACKYAK explicit route returns four held New cards as partial, independent of source-config selection',async()=>{
  const r=await collectBlackyakNew({readHtml:async()=>blackyakFixture,now:new Date(at)});
  assert.equal(r.brand,'BLACKYAK');assert.deepEqual(r.errors,[]);assert.equal(r.products.length,0);assert.equal(r.held.length,4);assert.equal(r.coverage[0].status,'partial');assert.equal(r.coverage[0].read,4);assert.equal(r.coverage[0].total,null);assert.equal(r.coverage[0].exhaustive,false);
  assert.ok(r.held.every(h=>h.arrivalEvidence.verified===true&&h.sneakerEligibilityVerified===false));
});
test('BLACKYAK season essentials alone or hidden New text cannot claim New, and neighboring images cannot bind',()=>{
  for(const h of [blackyakFixture.replace('26 F/W NEW','BEST'),blackyakFixture.replace('<div>26 F/W NEW','<div hidden>26 F/W NEW')])assert.throws(()=>blackyakNewSectionPage(h),/New heading/);
  assert.throws(()=>blackyakNewSectionPage(blackyakFixture.replaceAll('picweb.blackyak.com','fake.example')),/Unbound/);
});
