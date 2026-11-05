import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {decodeText} from './source-feeds.mjs';
import {pacedOfficialFetch} from './official-reader.mjs';

// Editorial homepage selections are scoped official New evidence, never a
// complete brand inventory. Keep total unset: the admin runner treats total ===
// read as exhaustive even when exhaustive:false is supplied.
export const koreanNewSectionSources = Object.freeze({
  K2: {url:'https://www.k-village.co.kr/k2', id:'trend', heading:/^\d{2}(?:FW|SS) NEW ARRIVAL$/i},
  spyder: {url:'https://www.spyder.co.kr/', id:'newArrivals', heading:/^New Arrivals$/i},
  NEPA: {url:'https://www.nplus.co.kr/main/main.asp', id:'whatsnewSlide', heading:/^WHAT'S NEW$/i},
});

// Inspected 2026-11-05: the exact official detail graphic visibly says
// "윈터 스니커즈" and checks walking/lifestyle. This is an eligibility review,
// not arrival proof; the product must independently occur in today's New section.
export const spyderThermoReview = Object.freeze({
  productId:'18601', style:'SPLFFNLS327U-BLK',
  imageUrl:'https://www.spyder.co.kr/web/upload/NNEditor/20261020/EC8DA8EBAAA8-EC9BB9-SPLFFNLS327U.jpg',
  contentHash:'146451938d221e3a3f653464e3e1d1434c51fd50cec50a274364dc2db2ffa2c4',
  excerpt:'윈터 스니커즈 · 추천 용도: 워킹 / 라이프스타일',
});

const hash = s => createHash('sha256').update(s).digest('hex');
const text = s => decodeText(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const attrs = s => Object.fromEntries([...s.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m=>[m[1].toLowerCase(),decodeText(m[2]??m[3]??m[4])]));
const cls = (n,c) => (n.a.class||'').split(/\s+/).includes(c);
const hidden = n => n && (Object.hasOwn(n.a,'hidden') || /(?:^|\s)(?:displaynone|dn)(?:\s|$)/.test(n.a.class||'') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.a.style||'') || n.a['aria-hidden']==='true' || hidden(n.parent));

// Small balanced element index, rather than slicing at the next </div> or
// </li>: both stores nest divs and Cafe24 nests price-list li inside cards.
function elements(html) {
  const nodes=[], stack=[];
  const re=/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  for(const m of html.matchAll(re)) {
    if(!m[2]) continue;
    const tag=m[2].toLowerCase();
    if(m[0][1]==='/') {
      const i=stack.findLastIndex(n=>n.tag===tag);
      if(i>=0) {for(const n of stack.splice(i)) {n.end=m.index+m[0].length;n.closed=n.tag===tag;}}
    } else {
      const a=attrs(m[0]);
      if(/\shidden(?:\s|>|=)/i.test(m[0]))a.hidden='';
      const n={tag,a,start:m.index,inner:m.index+m[0].length,parent:stack.at(-1),end:null,closed:false};nodes.push(n);
      if(!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)&&!m[0].endsWith('/>'))stack.push(n);
      else {n.end=n.inner;n.closed=true;}
    }
  }
  return nodes;
}
const inside = (n,p) => n.start>=p.inner && n.end!==null && n.end<=p.end;
const body = (html,n) => html.slice(n.inner,n.end).replace(/<\/[^>]+>$/,'');
const url = (s,base) => {try {const u=new URL(s,base);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};

function readable(html) {
  if(/veritas-hub\.cafe24\.com\/challenge|please check your access|verify (?:that )?you are human|<title[^>]*>\s*(?:Cafe24|Just a moment|Access Denied)/i.test(html))throw Error('OFFICIAL_ACCESS_CHALLENGE');
}
function source(brand,input) {
  const spec=koreanNewSectionSources[brand];if(!spec)throw Error('Unsupported Korean New section brand: '+brand);
  const u=new URL(input);u.hash='';
  if(u.href!==spec.url)throw Error('Exact official New section source required');
  return spec;
}
const excludedName = name => /키즈|아동|유아|주니어|부츠|샌들|슬리퍼|슬라이드|뮬|백팩|가방|팬츠|다운|베스트|맨투맨|자켓|재킷|양말|깔창|티셔츠|후드티|장갑|\b(?:kids?|boots?|sandals?|slides?|mules?|socks?)\b/i.test(name);
function eligibleName(name) {
  if(excludedName(name))return false;
  // "hike", "leather", or a generic shoe name is not sneaker classification.
  return /스니커|운동화|러닝화|\b(?:sneakers?|trainers?|running shoes)\b/i.test(name);
}

/** Pure extraction. details entries must be supplied by the collector's official
 * reader; assetHashes are SHA256 of fetched bytes, not source-supplied claims. */
export function koreanNewSectionPage(html,input,{brand,at=new Date().toISOString(),details=new Map(),assetHashes=new Map()}={}) {
  const spec=source(brand,input);readable(html);
  const nodes=elements(html),sections=nodes.filter(n=>n.a.id===spec.id&&!hidden(n)&&n.closed);
  if(sections.length!==1)throw Error('Official New section missing or ambiguous');
  const section=sections[0];
  const headings=nodes.filter(n=>inside(n,section)&&!hidden(n)&&( /^h[1-6]$/.test(n.tag)||cls(n,'section-tit-02')));
  const heading=headings.find(n=>spec.heading.test(text(body(html,n))));
  if(!heading)throw Error('Explicit New-only heading missing');
  const listingHash=hash(html.slice(section.start,section.end));
  const candidates=[],held=[],excluded=[],products=[],seen=new Set();
  const cards=nodes.filter(n=>inside(n,section)&&!hidden(n)&&n.closed&&(brand==='K2'?n.tag==='a'&&cls(n,'prd-ele'):brand==='spyder'?n.tag==='li'&&/^anchorBoxId_\d+$/.test(n.a.id||''):cls(n,'goods')));
  for(const card of cards) {
    const children=nodes.filter(n=>inside(n,card)),raw=html.slice(card.start,card.end);
    const anchor=brand==='K2'?card:children.find(n=>n.tag==='a'&&n.a.href);
    const productUrl=url(anchor?.a.href,input);if(!productUrl)continue;
    const u=new URL(productUrl),root=new URL(input);
    if(u.origin!==root.origin)throw Error('Cross-brand product URL');
    const id=brand==='K2'?u.pathname.match(/^\/goods\/([A-Z0-9]+)$/)?.[1]:brand==='spyder'?u.pathname.match(/^\/product\/[^/]+\/(\d+)\//)?.[1]:u.pathname==='/product/view.asp'?u.searchParams.get('pno'):null;
    if(!id)continue;
    if(seen.has(id))continue;seen.add(id);
    const nameNode=children.find(n=>brand==='K2'?cls(n,'prd-name'):cls(n,'name'));
    const name=nameNode?text(body(html,nameNode)).replace(/^상품명\s*:\s*/,''):'';
    const button=children.find(n=>n.a['data-goodscd']);
    if(brand==='K2'&&(button?.a['data-brandnm']!=='K2'||button?.a['data-goodscd']!==id))throw Error('K2 card brand/SKU binding mismatch');
    const imageNode=children.find(n=>n.tag==='img'&&(brand!=='K2'||n.a.id==='mainImage_'+id));
    const image=url(imageNode?.a.src||imageNode?.a['data-src'],input);
    const imageHost=image&&new URL(image).hostname;
    const imageBound=brand==='K2'?imageHost==='contents.k-village.co.kr'&&image.includes('/'+id+'/'+id+'_'):brand==='spyder'?imageHost==='www.spyder.co.kr'&&new URL(image).pathname.startsWith('/web/product/'):imageHost==='assetscdn51.styleship.com'&&image.includes('/nplus/data/productimages/');
    const candidate={brand,name,sourceProductId:id,url:productUrl,image,sectionUrl:input+'#'+spec.id};candidates.push(candidate);
    if(!name||!imageBound) {held.push({...candidate,reason:'missing-or-unbound-card-fields'});continue;}
    if(excludedName(name)) {excluded.push({...candidate,reason:'not-adult-sneaker'});continue;}
    let style=brand==='K2'?id:null,classification=eligibleName(name)?{url:input,excerpt:name,contentHash:hash(raw)}:null;
    const detail=details.get(productUrl);
    if(brand==='spyder'&&detail) {
      readable(detail);
      const rows=elements(detail).filter(n=>n.tag==='tr'&&n.a['data-title']==='상품코드'&&n.closed);
      const codes=rows.map(n=>text(body(detail,n)).replace(/^상품코드\s*/,''));
      style=codes.find(s=>/^[A-Z0-9]+-[A-Z0-9]+$/.test(s));
      const review=spyderThermoReview;
      if(id===review.productId&&style===review.style&&detail.includes(new URL(review.imageUrl).pathname)&&assetHashes.get(review.imageUrl)===review.contentHash)classification={url:review.imageUrl,excerpt:review.excerpt,contentHash:review.contentHash};
    }
    if(!classification||!style) {held.push({...candidate,style,reason:'sneaker-eligibility-or-manufacturer-SKU-unverified'});continue;}
    const proof={verified:true,brand,style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:listingHash};
    const priceNode=children.find(n=>n.a['data-title']==='판매가'||cls(n,'prd-price')||cls(n,'sale'));
    const price=(button?.a['data-sellprice']|| (priceNode&&text(body(html,priceNode)))||'').match(/[\d,]+/)?.[0]?.replaceAll(',','');
    products.push({id:'korean-new-'+brand.toLowerCase()+'-'+style,brand,name,style,manufacturerStyle:style,url:productUrl,image,country:'KR',category:'sneaker',productType:'sneaker',officialCategory:classification.excerpt,description:name,colors:[],colorway:'',priceLabel:price?'KRW '+price:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:input,sourceSignals:[],
      arrivalEvidence:{...proof,kind:'new-arrivals-listing',url:input,productUrl,sectionId:spec.id,excerpt:text(body(html,heading))+' · '+name},
      officialProductEvidence:{...proof,url:productUrl},officialImageEvidence:{...proof,url:image,sourceUrl:input},
      ...(detail?{supplementaryProductEvidence:{verified:true,brand,style,url:productUrl,verifiedAt:at,verificationMethod:'official-product-detail-sku',contentHash:hash(detail)}}:{}),
      sneakerEligibilityEvidence:{...classification,verified:true,brand,style,verifiedAt:at},
    });
  }
  if(!candidates.length)throw Error('Official New section has no readable product cards');
  return {products,candidates,held,excluded,coverage:{brand,url:input,scope:'homepage-new-section',sectionId:spec.id,scopedOfficialNew:true,status:'partial',pages:1,listingPages:1,read:candidates.length,sectionRead:candidates.length,verified:products.length,total:null,exhausted:false,exhaustive:false,errors:[],note:'Only this visible New section was inspected; brand-wide New coverage remains incomplete.'}};
}

export async function collectKoreanNewSections({brands=['K2','spyder'],readHtml,readBytes,now=new Date()}={}) {
  const read=pacedOfficialFetch();
  const response=async u=>{const r=await read(u,{redirect:'error',headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,image/*'}});if(!r.ok)throw Error('Official source HTTP '+r.status);return r;};
  readHtml??=async u=>(await response(u)).text();readBytes??=async u=>Buffer.from(await(await response(u)).arrayBuffer());
  const result={checkedAt:now.toISOString(),products:[],candidates:[],held:[],excluded:[],coverage:[],errors:[]};
  for(const brand of brands) {
    const spec=koreanNewSectionSources[brand];if(!spec)throw Error('Unsupported Korean New section brand: '+brand);
    try {
      const html=await readHtml(spec.url),opts={brand,at:result.checkedAt},first=koreanNewSectionPage(html,spec.url,opts),details=new Map(),assetHashes=new Map();
      if(brand==='spyder')for(const c of first.candidates.filter(c=>c.sourceProductId===spyderThermoReview.productId||eligibleName(c.name))) {
        try {
          const d=await readHtml(c.url);readable(d);details.set(c.url,d);
          if(c.sourceProductId===spyderThermoReview.productId&&d.includes(new URL(spyderThermoReview.imageUrl).pathname))assetHashes.set(spyderThermoReview.imageUrl,hash(await readBytes(spyderThermoReview.imageUrl)));
        } catch(e) {result.errors.push({brand,url:c.url,error:e.message});}
      }
      const page=koreanNewSectionPage(html,spec.url,{...opts,details,assetHashes});
      for(const k of ['products','candidates','held','excluded'])result[k].push(...page[k]);result.coverage.push(page.coverage);
    } catch(e) {const error={brand,url:spec.url,error:e.message};result.errors.push(error);result.coverage.push({brand,url:spec.url,status:'failed',pages:0,total:null,read:0,exhausted:false,exhaustive:false,errors:[e.message]});}
  }
  return result;
}

export const BLACKYAK_NEW_URL='https://www.byn.kr/blackyak';
/** Explicit New section membership only; the four technical hiking forms
 * remain held until exact type/visual eligibility review is complete. */
export function blackyakNewSectionPage(html,input=BLACKYAK_NEW_URL,{at=new Date().toISOString()}={}) {
  if(input!==BLACKYAK_NEW_URL)throw Error('Exact official BLACKYAK section source required');readable(html);
  const nodes=elements(html),sections=nodes.filter(n=>n.a.id==='season_essentials1'&&n.closed&&!hidden(n));
  if(sections.length!==1)throw Error('Official BLACKYAK New section missing or ambiguous');
  const section=sections[0],children=nodes.filter(n=>inside(n,section)&&n.closed&&!hidden(n));
  const newHeading=children.find(n=>/^\d{2}\s+F\/W NEW$/.test(text(body(html,n))));
  if(!children.some(n=>text(body(html,n))==='GRIFF X')||!newHeading)throw Error('Explicit visible GRIFF X New heading missing');
  const listingHash=hash(html.slice(section.start,section.end)),held=[],seen=new Set();
  for(const card of children.filter(n=>n.tag==='li'&&cls(n,'se_prd'))) {
    const style=card.a['prd-id'],name=card.a['prd-name'],own=children.filter(n=>inside(n,card));
    const productUrl=url(own.find(n=>n.tag==='a')?.a.href,input),image=url(own.find(n=>n.tag==='img')?.a.src,input);
    if(!style||!name||!productUrl||!image||seen.has(style))throw Error('Invalid or repeated BLACKYAK New card');
    const p=new URL(productUrl),i=new URL(image);
    if(p.origin!=='https://www.byn.kr'||p.pathname!=='/blackyak/shop/detail.php'||!p.searchParams.get('pno')||i.hostname!=='picweb.blackyak.com'||!i.pathname.replaceAll('_','').includes(style))throw Error('Unbound BLACKYAK SKU/product/image');
    seen.add(style);held.push({brand:'BLACKYAK',style,name,url:productUrl,image,reason:'sneaker-type-unverified-technical-mountain-footwear',sneakerEligibilityVerified:false,arrivalEvidence:{verified:true,brand:'BLACKYAK',style,kind:'new-arrivals-listing',url:input,productUrl,sectionId:'season_essentials1',excerpt:'GRIFF X · '+text(body(html,newHeading)),contentHash:listingHash,verifiedAt:at}});
  }
  if(!held.length)throw Error('Official BLACKYAK New section has no readable cards');
  return {brand:'BLACKYAK',checkedAt:at,products:[],candidates:held,held,excluded:[],errors:[],coverage:[{brand:'BLACKYAK',url:input,status:'partial',scope:'homepage-season-essentials-new-section',sectionId:'season_essentials1',scopedOfficialNew:true,newFootwearEnumerationComplete:false,pages:1,listingPages:1,read:held.length,sectionRead:held.length,total:null,verified:0,held:held.length,exhaustive:false,exhausted:false,errors:[],note:'Actual New section cards read; technical mountain-footwear eligibility remains held. No brand-wide completeness claim.'}]};
}
export async function collectBlackyakNew({readHtml,now=new Date()}={}) {
  const read=pacedOfficialFetch();readHtml??=async u=>{const r=await read(u,{redirect:'error',headers:{'Accept-Language':'ko-KR,ko;q=0.9','User-Agent':'Mozilla/5.0'}});if(!r.ok)throw Error('Official BLACKYAK HTTP '+r.status);return r.text();};
  try{return blackyakNewSectionPage(await readHtml(BLACKYAK_NEW_URL),BLACKYAK_NEW_URL,{at:now.toISOString()});}
  catch(e){return {brand:'BLACKYAK',checkedAt:now.toISOString(),products:[],held:[],excluded:[],errors:[{brand:'BLACKYAK',error:e.message}],coverage:[{brand:'BLACKYAK',status:'failed',scope:'homepage-season-essentials-new-section',read:0,total:null,exhaustive:false,exhausted:false,errors:[e.message]}]};}
}

// Reviewed 2026-11-05 against the exact API-bound photos. Hiking category
// membership alone does not approve a boot. Every eligible entry below was
// visually reviewed as low-cut athletic footwear and requires current category
// membership plus an unchanged photo digest on each collection run.
export const kvillagePhotoReviews = new Map([
  [
    "KUF26G05N4",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KUF26G05N4/KUF26G05N4_DG_01.JPG",
      "contentHash": "5afbaa5ed82e82f523f248b64d4d0bae6de94942edfb6439fac407797a2bb421",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": "10193"
    }
  ],
  [
    "KUF26G07E7",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KUF26G07E7/KUF26G07E7_DM_01.jpg",
      "contentHash": "96eede671cf997f760bd1d996875c5e829a699fcf541d31103135c1c1c89e888",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": "10193"
    }
  ],
  [
    "FUF26G06Z1",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUF26G06Z1/FUF26G06Z1_DG_01.JPG",
      "contentHash": "64440bd1a46f4f19da44ed010f656d40f5e6493bae5190b4de7c2929ec8b07e9",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10194"
    }
  ],
  [
    "FUF26G04N4",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUF26G04N4/FUF26G04N4_DG_01.JPG",
      "contentHash": "e0f4d7e1e61c33863b6159fdbe0133d7a0cd2d2f0d8298f7ddc81c6b06ef22d4",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10194"
    }
  ],
  [
    "KUF26G08K6",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KUF26G08K6/KUF26G08K6_DG_01.JPG",
      "contentHash": "92e7995bd869188fd613232f0e41939d77db0a8f64920c868c9d2816230f7bc5",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": "10193"
    }
  ],
  [
    "KUF26G02C2",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KUF26G02C2/KUF26G02C2_DG_01.JPG",
      "contentHash": "9f1e4cbed99f3b1d2caa88cf6f5c74435088d0cb3ec962e0f402ea7a26183fc9",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10193"
    }
  ],
  [
    "FUF26G03E7",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUF26G03E7/FUF26G03E7_DG_01.JPG",
      "contentHash": "521030bcfaefd53e367fd75c4362b6ae1a83583024364e8f5dc44f1aea3ed5fe",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10194"
    }
  ],
  [
    "KMF26G09Z1",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KMF26G09Z1/KMF26G09Z1_DG_01.JPG",
      "contentHash": "3e7cac74a108d17111da23af3a51c7d68d1b4bac80daf87e7e28387f0899788a",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": "10193"
    }
  ],
  [
    "KUF26G06E6",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KUF26G06E6/KUF26G06E6_DG_01.JPG",
      "contentHash": "8b036540f1acc24fad2de78d6335406979d92f69de7d4c2d62851c305206beb5",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": "10193"
    }
  ],
  [
    "FUW26N60Z1",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUW26N60Z1/FUW26N60Z1_DG_01.JPG",
      "contentHash": "0510dca1cee5e5a38c4237eca711da2cf190cc64bd24c0648d812b596791d94b",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": null
    }
  ],
  [
    "KUF26G03Z1",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KUF26G03Z1/KUF26G03Z1_DG_01.JPG",
      "contentHash": "d143910a494b94cc6c82b0b2e343dea863e116fc9e20b2e86f11805bd7da4b86",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10193"
    }
  ],
  [
    "FUW26N64Z1",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUW26N64Z1/FUW26N64Z1_DG_01.JPG",
      "contentHash": "4f5b76342d107675425e12daa57daec3e0aa2da61fbd35c6667c8f36b7126dbd",
      "decision": "held",
      "type": "winter-slip-on-needs-sneaker-classification",
      "categoryId": null
    }
  ],
  [
    "FWF26G07P4",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FWF26G07P4/FWF26G07P4_DG_01.JPG",
      "contentHash": "1cd786c6fa9c233aef4fa1f5397bdbd53e74b5e36178d85a2971d488250629d3",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10194"
    }
  ],
  [
    "KUF26G01E7",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KUF26G01E7/KUF26G01E7_DG_01.JPG",
      "contentHash": "8ecc8dda3be4ab5644a112601167fae702e8228ad4edf3a9ee1bb508751e5102",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10193"
    }
  ],
  [
    "FWF26G53P1",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FWF26G53P1/FWF26G53P1_DG_01.JPG",
      "contentHash": "744a477e0227291a545aa2b28d7174d3dec6400b2dc5f7090e4b45b510ac1ab1",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10199"
    }
  ],
  [
    "FMF26G52C2",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FMF26G52C2/FMF26G52C2_DG_01.JPG",
      "contentHash": "3097d7720feb7c2dcdfed8f9fa7f4f994c99093d7f922b7a01071780412528ba",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10199"
    }
  ],
  [
    "FUW26N65C6",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUW26N65C6/FUW26N65C6_DG_01.JPG",
      "contentHash": "ff2f134ba5f69976da053a3484759fb150590307c6dad1996466e61d3856deea",
      "decision": "held",
      "type": "winter-slip-on-needs-sneaker-classification",
      "categoryId": null
    }
  ],
  [
    "FWF26N54E9",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FWF26N54E9/FWF26N54E9_DG_01.JPG",
      "contentHash": "b7c35728433ca1da50a94d406c0305a27de2d777c27a6a80a71c16e74747c24a",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10199"
    }
  ],
  [
    "KWF26G10E1",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KWF26G10E1/KWF26G10E1_DG_01.JPG",
      "contentHash": "a3a3d5ea87d6a24eaef1c43723434dbd31e06f46f00c8768055144ca7b2a1034",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": "10193"
    }
  ],
  [
    "FUF26G05C5",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUF26G05C5/FUF26G05C5_DG_01.JPG",
      "contentHash": "27f754d7cecfb2bbb9e76f97f0f9dd4234a6e38c0213a2fea066f32128f8203c",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10194"
    }
  ],
  [
    "FWF26N55Z1",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FWF26N55Z1/FWF26N55Z1_DG_01.JPG",
      "contentHash": "0b380eb9fa68f1e49a2bd5c5fd19ba6dca0877c7e44d4c07ab9af2e23bc676a3",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10199"
    }
  ],
  [
    "FWW26N70Z1",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FWW26N70Z1/FWW26N70Z1_DG_01.JPG",
      "contentHash": "5eb19e82537093c4b3abdb83fbb6e8ad61a486b4ca708a45117befcafdb497f6",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": null
    }
  ],
  [
    "FUW26N67C6",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUW26N67C6/FUW26N67C6_DG_01.JPG",
      "contentHash": "9e1a9cc747d5b86e553670e4e671176abb77d9470a4be2612675dd75744684da",
      "decision": "excluded",
      "type": "official-winter-mule",
      "categoryId": null
    }
  ],
  [
    "FUF26G02W3",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUF26G02W3/FUF26G02W3_DG_01.JPG",
      "contentHash": "8bd00b1e77e851f5f1f60ee56d8c5bdf87415166ddb11c525211af57844ce9e9",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10194"
    }
  ],
  [
    "FWW26N69C6",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FWW26N69C6/FWW26N69C6_DG_01.JPG",
      "contentHash": "5a19259ebb3b9f228a21e30936cf08c7ea668c38b656db34aa9171c16b8dfe1f",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": null
    }
  ],
  [
    "KUF26G04Y6",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/KUF26G04Y6/KUF26G04Y6_DG_01.JPG",
      "contentHash": "379c456fbfc98d0cbad6b888e25bde0f65ac9a5caac9a4f03b0e7e28fa17a0a3",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10193"
    }
  ],
  [
    "FWW26N71E7",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FWW26N71E7/FWW26N71E7_DG_01.JPG",
      "contentHash": "47d10b88e7b8c077f8ebd0829a69ea4c34551836fb68862518bf8e86b317daab",
      "decision": "excluded",
      "type": "reviewed-boot",
      "categoryId": null
    }
  ],
  [
    "FUF26G01C5",
    {
      "imageUrl": "https://contents.k-village.co.kr/Prod/2026/K/FUF26G01C5/FUF26G01C5_DG_01.JPG",
      "contentHash": "d5dc85cc917927a9b0dea7bc06296ae16136764635da4af373de96722d9b8189",
      "decision": "eligible",
      "type": "reviewed-low-athletic-shoe",
      "categoryId": "10194"
    }
  ]
]);

// Exact DYNAFIT photos reviewed in the same bounded audit: boots and slides.
for(const [sku,file,digest,categoryId,type] of [
  ['YUW26N33Z1','/Prod/2026/Y/YUW26N33Z1/YUW26N33Z1_DG_01.JPG','148610ba61651561ab8fa0f3de3349dd44222701efd11da8e01d8842c1f9d629','11223','reviewed-winter-boot'],
  ['YUW26N33W3','/Prod/2026/Y/YUW26N33W3/YUW26N33W3_DM_01.jpg','88913ac9cc6bb840aff017a2243591571ad6973e7976f1569ec88e928f77324d','11223','reviewed-winter-boot'],
  ['YUS27N51Z1','/Prod/2027/Y/YUS27N51Z1/YUS27N51Z1_DG_01.JPG','69601ec956090f0d7bad0674afb46b8193349a06791a5f17eddd061a51eff4d6','10458','reviewed-slide'],
  ['YUS27N51W2','/Prod/2027/Y/YUS27N51W2/YUS27N51W2_DG_01.JPG','4b9d47d406936eede1cee7bcb6580629ceeb7d84495b97cd4ee4b969c152acf6','10458','reviewed-slide'],
])kvillagePhotoReviews.set(sku,{imageUrl:'https://contents.k-village.co.kr'+file,contentHash:digest,categoryId,type,decision:'excluded'});

const kvOrigin='https://www.k-village.co.kr';
export const kvillageFootwearSources=Object.freeze({
  K2:{path:'k2',root:'1007',mid:'1033',subcategories:[['10194','하이킹화'],['10193','트레킹화'],['10199','워킹화']]},
  DYNAFIT:{path:'dynafit',root:'1011',mid:'1069',subcategories:[['11223','방한화'],['10458','슬리퍼/샌들']]},
});
export const kvillageNewRuleHash='5e4879f6cb4cbc3dbf8aacd5e14f9c1337be55673c293ec97399b91de843a6de';

/** Validate observed public code without evaluating scripts fetched from a site. */
export function resolveKVillagePublicContract(pageHtml,pageUrl,scripts) {
  if(new URL(pageUrl).origin!==kvOrigin)throw Error('Official K-Village origin required');
  const get=name=>{const entry=[...scripts].find(([u])=>new URL(u).hostname==='contents.k-village.co.kr'&&new URL(u).pathname==='/front/common/js/'+name);if(!entry)throw Error('Missing observed script '+name);return {url:entry[0],source:entry[1],contentHash:hash(entry[1])};};
  const common=get('common.js'),search=get('searchCommon.js'),filter=get('searchFilter.js'),template=get('goodsTemplate.js');
  if(!common.source.includes('api_domain=location.protocol+"//"+location.hostname+":"+location.port')||!common.source.includes('a.setRequestHeader("X-CSRF-TOKEN",t)'))throw Error('Unverified API origin/header contract');
  if(!search.source.includes('var t="/search/result"')||!search.source.includes('t="/search/recommend"')||!search.source.includes('data:JSON.stringify(window.searchOption[e])')||!search.source.includes('window.searchOption[e][r]=a')||!filter.source.includes('BRAND_M:"searchBrandMGroup"'))throw Error('Unverified category request contract');
  const newRule=common.source.match(/function isNewGoods\(e\)\{[\s\S]*?return t\}/)?.[0];
  if(!newRule||hash(newRule)!==kvillageNewRuleHash||!common.source.includes('function isSoldOut(e){var t=!1;return"20"!=e&&(t=!0),t}')||!/{{if isNewGoods\(goods.cnsntDtm\)}}\s*<span class="(?:icon_sold|list-flag)">NEW<\/span>/.test(template.source)||!template.source.includes('{{if isSoldOut(goods.sellStCd)}}'))throw Error('Unverified official New badge rule');
  if(!pageHtml.match(/<meta name="_csrf" content="[^"]+"/))throw Error('Public category CSRF context missing');
  return {apiUrl:kvOrigin+'/search/result',recommendUrl:kvOrigin+'/search/recommend',method:'POST',contentType:'application/json; charset=utf-8',badgeTimezone:'Asia/Seoul',newRule,newRuleHash:hash(newRule),scripts:[common,search,filter,template].map(({url,contentHash})=>({url,contentHash}))};
}

/** Seoul-browser rendering of the verified rule, NOT a release-date parser.
 * The site's function discards the time-of-day and checks < 604800000 ms.
 * Malformed/future approval dates are held rather than propagating its future-
 * date quirk into verified evidence. SOLD OUT suppresses the New badge. */
export function kvillageVisibleNewBadge(row,now=new Date()) {
  const s=String(row.cnsntDtm||'');if(!/^\d{14}$/.test(s))throw Error('Malformed approval timestamp');
  const day=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8),midnight=Date.parse(day+'T00:00:00+09:00');
  if(!Number.isFinite(midnight)||new Date(midnight+9*3600000).toISOString().slice(0,10)!==day)throw Error('Invalid approval day');
  const age=new Date(now).getTime()-midnight;
  if(!Number.isFinite(age)||age<0)throw Error('Future approval day or invalid observation time');
  return String(row.sellStCd)==='20'&&age<604800000;
}

export function classifyKVillageReviewedPhoto(row,{imageHash,categoryMembership=[]}={}) {
  const review=kvillagePhotoReviews.get(row.goodsCd),imageUrl=new URL(row.listMainImgUrl,row.imgBaseUrl).href;
  if(!review||review.imageUrl!==imageUrl||imageHash!==review.contentHash)return {decision:'held',reason:'unreviewed-or-changed-SKU-photo'};
  if(review.categoryId&&!categoryMembership.includes(review.categoryId))return {decision:'held',reason:'reviewed-category-membership-missing'};
  return {decision:review.decision,reason:review.type,imageUrl,contentHash:imageHash,categoryId:review.categoryId};
}

/** Read-only current JSON audit. Returns actual responses + request bodies for
 * replay, exact pagination counts, derived badge proof and reviewed candidates.
 * Only the observed regular footwear categories and linked K2 FW New source
 * are covered; no brand-wide completion or outlet coverage is asserted. */
export async function collectKVillageFootwearAudit({brands=['K2','DYNAFIT'],readHtml,postJson,readImageHash,now=new Date(),maxPages=10,onProgress=()=>{}}={}) {
  const read=pacedOfficialFetch(),cookies=new Map();
  const get=async(u,options={})=>{const own=new URL(u).origin===kvOrigin;const r=await read(u,{redirect:'error',...options,headers:{'User-Agent':'Mozilla/5.0',...(own&&cookies.size?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),...options.headers}});if(!r.ok)throw Error('Official source HTTP '+r.status);if(own)for(const c of r.headers.getSetCookie?.()||[]){const pair=c.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}return r;};
  readHtml??=async u=>(await get(u)).text();
  postJson??=async(u,body,{csrf})=>(await get(u,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8','X-CSRF-TOKEN':csrf},body:JSON.stringify(body)})).json();
  readImageHash??=async u=>hash(Buffer.from(await(await get(u)).arrayBuffer()));
  const out={checkedAt:now.toISOString(),products:[],candidates:[],held:[],excluded:[],coverage:[],sourceCoverage:[],sourceBindings:{},evidence:[],contracts:[],errors:[]};
  const base={searchType:'search',searchTerm:'',displaySize:50,pageNumber:1,searchLine:'N'};
  for(const brand of brands) {
    const spec=kvillageFootwearSources[brand];if(!spec)throw Error('Unsupported K-Village audit brand');
    try {
      const pageUrl=kvOrigin+'/'+spec.path+'?cm='+spec.mid,html=await readHtml(pageUrl);readable(html);
      if(!html.includes("var curDvsn = 'brandmall'")||!html.includes('var curLCategoryNo = '+spec.root+';')||!html.includes("var mgnDvsnCd = '10'"))throw Error('Category page brand root or regular-store context mismatch');
      const scriptUrls=[...html.matchAll(/<script[^>]+src=["']([^"']+)/g)].map(m=>decodeText(m[1])).filter(u=>{try{return new URL(u).hostname==='contents.k-village.co.kr'&&/^\/front\/common\/js\/(?:common|searchCommon|searchFilter|goodsTemplate)\.js$/.test(new URL(u).pathname);}catch{return false;}});
      const scripts=new Map();for(const u of new Set(scriptUrls))scripts.set(u,await readHtml(u));
      const contract=resolveKVillagePublicContract(html,pageUrl,scripts);out.contracts.push({brand,...contract,categoryPageHash:hash(html)});
      const csrf=html.match(/<meta name="_csrf" content="([^"]+)"/)[1];
      const enumerate=async(label,url,body)=>{
        const rows=[],ids=new Set();let total=null,pages=0;
        for(let page=1;page<=maxPages;page++) {
          // The observed UI chooses recommend when only fixed category codes
          // are present, and result when a brand-group filter is applied.
          const recommended=!body.searchBrandMGroup,endpoint=recommended?contract.recommendUrl:contract.apiUrl;
          const request={...body,pageNumber:page,...(recommended?{mgnDvsnCd:'10'}:{})},json=await postJson(endpoint,request,{pageUrl:url,csrf});
          out.evidence.push({brand,source:label,url:endpoint,pageUrl:url,method:'POST',request,contentHash:hash(JSON.stringify(json)),json});
          const r=json.response,n=Number(r?.totalSize);
          if(json.code!=='000'||!Number.isSafeInteger(n)||n<0||!Array.isArray(r.searchResult))throw Error('Invalid official category JSON');
          if(total!==null&&total!==n)throw Error('Category total changed during pagination');total=n;pages=page;
          if(r.searchResult.length!==Math.min(50,Math.max(0,n-(page-1)*50)))throw Error('Category page count mismatch');
          for(const row of r.searchResult) {
            if(row.brandNm!==brand||!row.goodsCd||ids.has(row.goodsCd))throw Error('Repeated SKU or category brand mismatch');
            if(row.totalCnt!=null&&Number(row.totalCnt)!==n)throw Error('Row total disagrees with category total');
            const img=new URL(row.listMainImgUrl,row.imgBaseUrl);
            if(img.origin!=='https://contents.k-village.co.kr'||!img.pathname.includes('/'+row.goodsCd+'/'+row.goodsCd+'_'))throw Error('Unbound category SKU image');
            ids.add(row.goodsCd);rows.push(row);
          }
          await onProgress({brand,source:label,page,read:rows.length,total});
          if(rows.length===total){out.sourceCoverage.push({brand,source:label,url,total,read:rows.length,pages,exhausted:true,scope:'exact-category-query'});return rows;}
        }
        throw Error('Category pagination exceeded bound');
      };
      const footwear=await enumerate('footwear',pageUrl,{...base,searchBrandMCode:spec.mid,cm:spec.mid});
      const membership=new Map();
      for(const [id,name] of spec.subcategories) {
        if(!html.includes("'"+spec.mid+"','"+id+"'"))throw Error('Subcategory is not linked by official page');
        const rows=await enumerate('category-'+id,kvOrigin+'/'+spec.path+'?cm='+spec.mid+'&cs='+id,{...base,searchBrandSCode:id,cm:spec.mid,cs:id});
        for(const r of rows){const a=membership.get(r.goodsCd)||[];a.push(id);membership.set(r.goodsCd,a);}
      }
      let newRows=[],newUrl;
      if(brand==='K2') {
        newUrl=kvOrigin+'/k2?cm=1361&cs=12000';const nh=await readHtml(newUrl);
        if(!html.includes('/k2?cm=1361&cs=12000')&&!html.includes('/k2?cm=1361&amp;cs=12000'))throw Error('FW New source not linked');
        if(!/groobeeCategory\.cateNm = '# FW NEW ARRIVAL'/.test(nh))throw Error('FW New collection title missing');
        // Returned for the integrator's existing publication gate. This does
        // not mutate shared configuration or turn the ordinary footwear list
        // into New evidence: only the explicitly named FW New target is bound.
        out.sourceBindings.K2=[{name:'K2 official FW New footwear',url:newUrl,sectionEvidence:{kind:'new-arrivals-navigation',url:pageUrl,targetUrl:newUrl,contentHash:hash(html),excerpt:'# FW NEW ARRIVAL',verifiedAt:out.checkedAt}}];
        newRows=await enumerate('fw-new-footwear',newUrl,{...base,searchBrandSCode:'12000',searchBrandMGroup:spec.mid,cm:'1361',cs:'12000'});
        const ids=new Set(footwear.map(r=>r.goodsCd));if(newRows.some(r=>!ids.has(r.goodsCd)))throw Error('FW New footwear filter not bound to category');
      }
      const badgeRows=footwear.filter(r=>kvillageVisibleNewBadge(r,now));
      if(brand==='DYNAFIT'){newRows=badgeRows;newUrl=pageUrl;}
      else {const ids=new Set(newRows.map(r=>r.goodsCd));newRows.push(...badgeRows.filter(r=>!ids.has(r.goodsCd)));}
      for(const row of newRows) {
        const image=new URL(row.listMainImgUrl,row.imgBaseUrl).href,member=membership.get(row.goodsCd)||[];
        const photoHash=await readImageHash(image),review=classifyKVillageReviewedPhoto(row,{imageHash:photoHash,categoryMembership:member});
        const candidate={brand,style:row.goodsCd,name:row.pcDspyNm,url:kvOrigin+'/goods/'+row.goodsCd,image,categoryMembership:member,review,approvalTimestamp:row.cnsntDtm,approvalIsReleaseDate:false};out.candidates.push(candidate);
        if(review.decision!=='eligible'){out[review.decision==='excluded'?'excluded':'held'].push(candidate);continue;}
        const at=out.checkedAt,proof={verified:true,brand,style:row.goodsCd,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:hash(JSON.stringify(row))};
        const isCollection=brand==='K2'&&out.evidence.some(e=>e.brand===brand&&e.source==='fw-new-footwear'&&e.json.response.searchResult.some(r=>r.goodsCd===row.goodsCd));
        const evidenceUrl=isCollection?newUrl:pageUrl,kind=isCollection?'new-arrivals-listing':'new-badge';
        const category=spec.subcategories.find(([id])=>member.includes(id))?.[1]||'신발';
        out.products.push({id:'kvillage-new-'+row.goodsCd,brand,name:row.pcDspyNm,style:row.goodsCd,manufacturerStyle:row.goodsCd,url:candidate.url,image,country:'KR',category:'sneaker',productType:'sneaker',officialCategory:category,description:row.pcDspyNm+' · reviewed low-cut athletic footwear',priceLabel:'KRW '+row.sellPrice,colors:[],colorway:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:evidenceUrl,sourceSignals:[],arrivalEvidence:{...proof,kind,url:evidenceUrl,productUrl:candidate.url,excerpt:isCollection?'# FW NEW ARRIVAL · '+row.pcDspyNm:'NEW · official seven-day badge rule',...(kind==='new-badge'?{ruleHash:contract.newRuleHash,badgeTimezone:contract.badgeTimezone}:{})},officialProductEvidence:{...proof,url:candidate.url},officialImageEvidence:{...proof,url:image,sourceUrl:evidenceUrl},sneakerEligibilityEvidence:{...proof,url:image,contentHash:photoHash,categoryUrl:kvOrigin+'/'+spec.path+'?cm='+spec.mid+'&cs='+review.categoryId,excerpt:'Exact source category and visually reviewed low-cut athletic SKU photo'}});
      }
      out.coverage.push({brand,status:'partial',scope:'current-regular-footwear-and-linked-FW-New',scopedOfficialNew:true,newFootwearEnumerationComplete:true,footwearRead:footwear.length,newFootwearRead:newRows.length,newBadgeRows:badgeRows.length,read:newRows.length,total:null,pages:out.sourceCoverage.filter(c=>c.brand===brand).reduce((s,c)=>s+c.pages,0),exhaustive:false,exhausted:false,note:'Exact source queries reconciled; no brand-wide/outlet completion claim. Product eligibility is reported separately.'});
    }catch(e){out.errors.push({brand,error:e.message});out.coverage.push({brand,status:'failed',total:null,exhaustive:false,exhausted:false,newFootwearEnumerationComplete:false,errors:[e.message]});}
  }
  return out;
}

// Stdout only: importing/running this module does not modify config or datasets.
if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await (process.argv.includes('--kvillage-footwear')?collectKVillageFootwearAudit():collectKoreanNewSections()),null,2));
