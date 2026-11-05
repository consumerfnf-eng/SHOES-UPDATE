import {sneakerShelfLinks} from './luxury-shelves.mjs';
import {createHash} from 'node:crypto';
import {canonicalUrl,isOfficialProductUrl,classifyFootwear,officialHybridReview,officialEvidenceFor,kstDay,httpUrl} from './curation.mjs';
import {isLuxuryMaison} from './luxury-shelves.mjs';
import {assertReadableOfficial} from './official-reader.mjs';
import {isExcludedBrand} from '../public/assets/brand-exclusions.mjs';

const digest=s=>createHash('sha256').update(s).digest('hex');
const clean=s=>{s=String(s||'');for(const m of markdownLinks(s).filter(l=>l.image).reverse())s=s.slice(0,m.start-1)+s.slice(m.end);return s.replace(/[\\*#\n]+/g,' ').replace(/\s+/g,' ').trim();};
export function markdownLinks(text){
  const out=[];
  for(let i=0;i<text.length;i++){
    if(text[i]!=='['||text[i-1]==='\\')continue;
    const start=i;let depth=1,j=i+1;
    for(;j<text.length&&depth;j++){if(text[j-1]==='\\')continue;if(text[j]==='[')depth++;if(text[j]===']')depth--;}
    if(depth||text[j]!=='(')continue;
    const label=text.slice(i+1,j-1);let end=j+1,level=1;
    for(;end<text.length&&level;end++){if(text[end-1]==='\\')continue;if(text[end]==='(')level++;if(text[end]===')')level--;}
    if(level)continue;
    const url=text.slice(j+1,end-1).replace(/\s+"[^"]*"$/,'').replaceAll('&amp;','&');
    if(/^https:\/\//.test(url))out.push({label,url,start,end,image:text[start-1]==='!'});
    i=end-1;
  }
  return out;
}
const newPath=/(?:^|[\/_-])(?:new)(?:\/|$)|(?:^|[\/_-])(?:new[\s_-]?(?:in|arrivals?|shoes)|newness|nouveautes|novita|신상품)(?:[\/_-]|$)/i;
// A URL keeps its path percent-encoded, so a Korean store's own word for new
// arrivals never matched: Golden Goose's women's listing is
// /kr/ko/ls/여성/여성-신상품-w-ko_kr, which URL.pathname spells
// /kr/ko/ls/%EC%97%AC%EC%84%B1/%EC%97%AC%EC%84%B1-%EC%8B%A0%EC%83%81%ED%92%88-w-ko_kr.
// Decode before matching; a malformed escape is left as it was written.
function readablePath(pathname){try{return decodeURIComponent(pathname);}catch{return pathname;}}
export function isNewListing(url,text=''){
  try{
    const u=new URL(url);
    if(u.hostname==='www.nike.com'&&/^\/w\/new-jordan-shoes-37eefz3n82yzy7ok\/?$/.test(u.pathname))return true;
    if(u.hostname==='shop.lululemon.com'&&/^\/c\/whats-new-sneakers\/n1d852zq0cf\/?$/.test(u.pathname))return true;
  }catch{}
  try{const u=new URL(url),path=readablePath(u.pathname);return (!isProductLink(url)||/\/(?:c|category)\//i.test(u.pathname)||/\/(?:new-arrivals?|new-in)\.html$/i.test(u.pathname))&&(newPath.test(path.replace(/\.html$/i,''))||newPath.test(u.searchParams.get('cgid')||'')||/^#\s+(?:new arrivals?|new in(?:\s+shoes)?|new shoes|신상품)\s*$/im.test(text));}catch{return false;}
}
// Arc'teryx files a product under /shop, with the style number on the end of
// the slug: /shop/mens/kragg-shoe-0078. Its own category pages live under /c
// (/c/mens/footwear/shoes), so /shop plus a trailing number is a product and
// nothing else is. Fifteen listing pages were read every week and every
// product link on them was discarded for not looking like one.
const productPath=/\/(?:products?|produtos|p|pr|pd|t)\/|\/[^/]+\.html(?:$|\?)|(?:-p-|\/p-)[a-z0-9]|\/(?:men|women)\/footwear\/[^/]+\/[^/?]+|\/shop\/[^/]+\/[a-z0-9][a-z0-9-]*-\d{3,}(?:[.?/]|$)|\/[0-9]{6,}(?:[.?/]|$)/i;
// A kids' shelf is a kids' shelf whatever else the URL says. 353 of the
// sports catalogue's 1,888 held records are kids-sizing - FILA's and AMIRI's
// children's New listings, read in full every week and then refused one at a
// time by the curator. Not reading them leaves the budget for shelves whose
// shoes can publish.
const kidsListing=/(?:^|[\/_-])(?:kids?|kid-new|junior|juniors|youth|boys?|girls?|children|toddler|infant|baby|bebe|enfant|bambino|키즈|아동|주니어|유아)(?:[\/_-]|$)/i;
export function isKidsListing(url){try{return kidsListing.test(readablePath(new URL(url).pathname))||kidsListing.test(new URL(url).search);}catch{return false;}}
function fendiProductCode(url){try{const u=new URL(url);return /(?:^|\.)fendi\.com$/i.test(u.hostname)?u.pathname.match(/-([78][a-z]\d{4}[a-z0-9]{8,})$/i)?.[1]?.toLowerCase()||'':'';}catch{return '';}}
function fendiImageSlot(image,sku){try{const u=new URL(image.url),m=u.pathname.match(/\/([78][a-z]\d{4}[a-z0-9]{8,})_(\d{2})(?:\.(?:jpe?g|png|webp))?$/i);return u.protocol==='https:'&&u.hostname==='static.fendi.com'&&m?.[1].toLowerCase()===sku&&Number(m[2])>0?Number(m[2]):null;}catch{return null;}}
function isProductLink(url){try{const u=new URL(url);if(/^\/(?:NODE\/)?product\/list\.html$/i.test(u.pathname)&&/^\d+$/.test(u.searchParams.get('cate_no')||''))return false;if(/(?:prada|miumiu)\.com$/.test(u.hostname)&&/\/c\/[^/]+\.html$/.test(u.pathname)||/(?:^|\.)miharayasuhiro\.jp$/.test(u.hostname)&&u.pathname==='/products/list.php'||/\/stories\//.test(u.pathname))return false;return !!fendiProductCode(url)||/(?:^|\.)burberry\.com$/.test(u.hostname)&&/-p\d{8,}\/?$/.test(u.pathname)||/(?:^|\.)ferragamo\.com$/.test(u.hostname)&&/-\d{6}--\d+\/?$/.test(u.pathname)||productPath.test(u.pathname)||u.hostname.endsWith('valentino.com')&&/\/product-[^/]+/.test(u.pathname)||u.hostname.endsWith('zegna.com')&&/\/product\.[^/]+\.\d+\/?$/.test(u.pathname)||u.hostname==='usa.mizuno.com'&&/^\/running-[^/]+\/?$/.test(u.pathname);}catch{return false;}}
function colorLabel(alt,brand){
  if(brand==='Cecilie Bahnsen'&&/\b[A-Z]+\/[A-Z]+$/.test(alt))return alt.split(/\s+/).at(-1);
  let color=['ASICS','PUMA','Onitsuka Tiger'].includes(brand)?alt.split(',')[1]?.trim().replace(/\s+\d+$/,'')||'':alt.split(/\s[-—–]\s/)[1]||'';
  color=color.replace(/^(.+)\s+\1$/i,'$1').trim();
  return /\b(?:women|men|unisex|image|view|united states)\b|\|/.test(color.toLowerCase())?'':color;
}
const imageUrls=text=>markdownLinks(text).flatMap(l=>l.image?[l]:markdownLinks(l.label).filter(child=>child.image)).map(l=>({alt:l.label,url:l.url})).filter(i=>{
  if(/(?:placeholder|fallback|logo|swatch|icon|LOOK_|lookbook|campaign|lifestyle|cardPayment|packaging|_MDL\b|variantthumbnail)/i.test(i.url+' '+i.alt)||/\/(?:new[-_])?menu\/|\/(?:undefined|null)(?:[?/#]|$)/i.test(i.url)||/[.]svg(?:[?\/]|$)/i.test(i.url))return false;
  const u=new URL(i.url),size=Number(u.searchParams.get('width')||u.searchParams.get('wid')||u.searchParams.get('w'));
  if(/(?:^|\.)(?:bing\.net|teads\.tv|doubleclick\.net|google-analytics\.com|facebook\.com|t\.co|twitter\.com)$/i.test(u.hostname))return false;
  return !(size&&size<160)&&!/(?:^|[\/_])(?:40x40|60x60|80x80)(?:[\/_]|$)/i.test(u.pathname);
});
/** A source can declare that it is not a New section at all.
 *
 *  Some brands have no New category and no newest-first sort - their shop is
 *  simply what they currently sell, and some of them only ever add to it. A
 *  product on such a page carries no newness claim, so taking only the cards
 *  with a NEW badge takes nothing: Rockfish Weatherwear's own home page lists
 *  its whole range and returned 0 candidates every week for that reason.
 *
 *  Declaring `basis: 'catalogue'` on the source takes every product on the
 *  page instead, and says so in the evidence: the kind is `catalogue-listing`,
 *  which the arrival-evidence gate does not accept. What dates these records
 *  is the source watch - we read this brand's shelf every week, and a shoe
 *  that was not on it last week and is on it now was newly listed - which is
 *  the one claim the page actually supports. */
export function parseArrivalListing(text,{brand,url,checkedAt,sectionEvidence,basis}){
  const sourceHash=digest(text),heading=text.search(/^#{1,2}\s+.+$/m);
  const fendiPageImages=brand==='Fendi'?imageUrls(text):[];
  const firstProduct=markdownLinks(text).find(l=>!l.image&&isOfficialProductUrl(brand,l.url)&&isProductLink(l.url)&&(/!\[/.test(l.label)||/sneaker|shoe|trainer/i.test(l.label)))?.start??Infinity;
  const footer=[...text.matchAll(/\n#{1,3}\s*(?:You may (?:also |be )|Recommended|Related|Recently viewed|What's Trending|Fearlessly Independent|Stay in the loop|Subscribe)/gi)].find(m=>m.index>firstProduct)?.index??text.length;
  text=text.slice(heading>=0&&heading<firstProduct?heading:0,footer);
  const links=markdownLinks(text).filter(l=>!l.image&&isOfficialProductUrl(brand,l.url)&&isProductLink(l.url));
  // `catalogue-latest` is the same instruction with a weaker claim behind it:
  // take every shoe on the shelf, but this shelf is only sorted newest first,
  // not known to hold this season alone - so the record says so, and the
  // three-month window dates it from the retail index.
  const catalogue=basis==='catalogue'||basis==='catalogue-latest'||basis==='assortment';
  const catalogueKind=basis==='assortment'?'official-assortment-listing':basis==='catalogue-latest'?'catalogue-latest-listing':'catalogue-listing';
  const rows=new Map(),isNew=!catalogue&&(isNewListing(url,text)||sectionEvidence?.kind==='new-arrivals-navigation'&&sectionEvidence.targetUrl===url&&isOfficialProductUrl(brand,sectionEvidence.url)&&!!sectionEvidence.contentHash);
  for(let i=0;i<links.length;i++){
    const link=links[i],key=canonicalUrl(link.url),previous=links[i-1],next=links.slice(i+1).find(l=>canonicalUrl(l.url)!==key);
    // A badge belongs only to the immediately following card, never an entire category.
    const before=text.slice(previous?.end||0,link.start).slice(-160);
    const badge=/(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?(?:new|new in|new arrival|new season|신상품|신제품|新作)(?:\*\*)?\s*(?:\n|$)/i.test(before)||/^\s*(?:\*\*)?(?:new(?: in| arrival)?|신상품|新作)(?:\*\*)?[\s\\]*(?:\n|!\[)/i.test(link.label);
    if(!isNew&&!badge&&!catalogue&&!rows.has(key))continue;
    const labelText=clean(link.label).replace(/\b(?:Next slide|Previous slide|App Access)\s*/gi,'').trim();
    let name=link.label.match(/\*\*([^*]+)\*\*/)?.[1]||labelText.split(/(?:\$|€|£|₩)\s*[\d,.]/)[0]||imageUrls(link.label)[0]?.alt;
    name=clean(name).replace(/\s+E\d{2}$/,'');
    if(!/[\p{L}\p{N}]/u.test(name))name=clean(imageUrls(link.label)[0]?.alt||'');
    // Melissa's cards read "+2 colors View Hip Sneaker in other colors": the
    // colour counter and the swatch link's own wording, with the shoe's name
    // in the middle of them.
    name=name.replace(/^\+\d+\s*colou?rs?\s*/i,'').replace(/^view\s+/i,'').replace(/\s+in other colou?rs?\b.*$/i,'');
    name=name.replace(/^\d+ Colors?,\s*/i,'').replace(/^(?:Shop the look|Main product image of)\s*/i,'').replace(/,\s*Price,?\s*$/i,'').replace(/\s+\d[\d,.]*\s+USD\s+.*$/i,'').replace(/(?:\s+-)+\s*$/,'');
    // A listing card puts its colour swatches around the name: Balenciaga
    // reads as "0 1 2 triple s.2 denim sneaker 2 colors", where "0 1 2" are
    // the swatch indices and "2 colors" is how many there are. Neither is
    // part of the shoe's name, and leaving them in put the same model on two
    // cards - one per spelling.
    name=name.replace(/^(?:\d{1,2}\s+){1,8}/,'').replace(/\s+\d{1,2}\s+colou?rs?$/i,'')
      .replace(/\s+(?:Men|Women|Unisex)(?:'?s)?$/i,'').trim();
    name=name.replace(/\s+-\s+Slide\s+\d+/gi,'').trim();
    const imageDerivedName=/^new(?: in)?$/i.test(name);
    if(imageDerivedName)name=clean(imageUrls(link.label)[0]?.alt||'').replace(new RegExp('^'+brand+'\\s+','i'),'');
    if(!name||/^(?:shop now|quick view|discover|view product|add to bag|new|coming soon|\+?\d+)$/i.test(name))continue;
    const block=text.slice(link.start,next?.start||link.end+1600);
    const images=imageUrls(link.label).concat(imageUrls(block));
    const row=rows.get(key)||{brand,name,url:link.url,images:[],linkedImages:[],cardDescription:clean(link.label),arrivalEvidence:{verified:true,brand,productUrl:link.url,kind:isNew?'new-arrivals-listing':badge?'new-badge':catalogueKind,url,verifiedAt:checkedAt,excerpt:(isNew?'Official New / New Arrivals listing: ':badge?'Official product New badge: ':catalogueKind==='catalogue-latest-listing'?'Official sneaker shelf read newest first: ':'Official catalogue listing, dated by the source watch: ')+name,contentHash:sourceHash}};
    if(labelText&&/sneaker|trainer|shoe/i.test(name))row.name=name;
    if(imageDerivedName||/^(?:하드웨어|(?:바디\s*)?메인컬러|색상|colou?r|hardware)\s*:/i.test(name))row.needsProductTitle=true;
    if(labelText.length>row.cardDescription.length)row.cardDescription=labelText;
    row.images=[...new Map([...row.images,...images].map(image=>[image.url,image])).values()];
    row.linkedImages=[...new Map([...row.linkedImages,...imageUrls(link.label)].map(image=>[image.url,image])).values()];
    if(brand==='Fendi'){
      const sku=fendiProductCode(link.url);
      row.skuBoundImages=sku?fendiPageImages.filter(image=>fendiImageSlot(image,sku)!==null).sort((a,b)=>fendiImageSlot(a,sku)-fendiImageSlot(b,sku)).map(image=>({...image,sku,sourceUrl:url,contentHash:sourceHash})):[];
    }
    rows.set(key,row);
  }
  return [...rows.values()].filter(p=>classifyFootwear({...p,description:'',officialCategory:''}).reason!=='excluded-footwear');
}
// Facets are subsets of a shelf, not more pages. Following every size pair
// produced hundreds of redundant requests and exhausted the verification time.
function selectedListingFacets(raw){
  const u=new URL(raw),out=[];
  for(const [k,v]of u.searchParams){
    if(/^(?:size|colou?r|width|material|gender)$/i.test(k)||/^filter\./i.test(k))out.push(k+'='+v);
    if(/^prefn\d*$/i.test(k)&&/size|colou?r|width|material|gender/i.test(v))out.push(v+'='+u.searchParams.get(k.replace(/^prefn/i,'prefv')));
  }
  return out.sort().join('&');
}
export function listingFollowups(text,url,brand,sectionEvidence){
  const facets=selectedListingFacets(url);
  const parentNew=isNewListing(url,text)||sectionEvidence?.kind==='new-arrivals-navigation'&&sectionEvidence.targetUrl===url&&!!sectionEvidence.contentHash&&isOfficialProductUrl(brand,sectionEvidence.url);
  const withinNewShelf=target=>{
    if(!parentNew)return false;
    const current=new URL(url),next=new URL(target),path=current.pathname.replace(/\/$/,'');
    if(next.origin!==current.origin||!path)return false;
    const bindings=[...current.searchParams].filter(([key])=>!/^(?:page|pageNumber|pagination|p|start|sz|sort|sort_by|sort_method|srule|utm_.*)$/i.test(key));
    return (next.pathname===current.pathname||next.pathname.startsWith(path+'/'))&&bindings.every(([key,value])=>next.searchParams.get(key)===value);
  };
  // A New page that is an editorial hub rather than a grid. Zegna's
  // /us-en/new-in/ is fifteen pages of campaign imagery whose only way
  // through to a shoe is a "Sneakers" link to /us-en/shoes/sneakers/ - no
  // cgid, no "new" in the path - so requiring a cgid meant reading the hub
  // every week and following nothing out of it. Any same-origin footwear
  // shelf linked from a maison's New page is followed as assortment; sports
  // and casual stores must preserve the New subset boundary below.
  const footwearFilter=l=>{
    if(!parentNew)return false;
    // A sports shop's footer links its entire shoe department. Only a path
    // inside this New shelf, or the same shelf with its category binding
    // preserved, can inherit New membership. Maisons collect assortment.
    if(!isLuxuryMaison(brand)&&!isNewListing(l.url)){
      if(!withinNewShelf(l.url))return false;
    }
    try{return /sneakers?|shoes?|footwear|trainers?|스니커즈|신발|슈즈/i.test(clean(l.label)+' '+readablePath(new URL(l.url).pathname))
      &&new URL(l.url).origin===new URL(url).origin;}catch{return false;}
  };
  const links=markdownLinks(text),result=links.filter(l=>!l.image&&isOfficialProductUrl(brand,l.url)&&!isProductLink(l.url)&&!isKidsListing(l.url)&&canonicalUrl(l.url)!==canonicalUrl(url))
    .filter(l=>selectedListingFacets(l.url)===facets)
    .filter(l=>isLuxuryMaison(brand)||!parentNew||!/^(?:next|next page|load more|view more|다음|더 보기|次へ|\d+)$/i.test(clean(l.label))||isNewListing(l.url)||withinNewShelf(l.url))
    .filter(l=>footwearFilter(l)||isNewListing(l.url)&&!/[?&](?:prefn|filter\.|srule=)/i.test(l.url)||/^(?:new|new arrivals?|new in(?: shoes)?|신상품|新作)$/i.test(clean(l.label))||/^(?:next|next page|load more|view more|다음|더 보기|次へ|\d+)$/i.test(clean(l.label))&&new URL(l.url).origin===new URL(url).origin)
    .map(l=>({url:l.url,name:clean(l.label)||'Official listing continuation',...(footwearFilter(l)||withinNewShelf(l.url)||/^(?:new|new arrivals?|new in(?: shoes)?|신상품|新作)$/i.test(clean(l.label))?{sectionEvidence:{kind:'new-arrivals-navigation',url,targetUrl:l.url,contentHash:digest(text)}}:{})})).sort((a,b)=>Number(/sneaker|shoes|footwear/i.test(b.name))-Number(/sneaker|shoes|footwear/i.test(a.name)));
  const count=Number(text.match(/\b([\d,]+)\s+(?:products|items)\b/i)?.[1]?.replaceAll(',',''));
  const ajax=links.find(l=>selectedListingFacets(l.url)===facets&&isNewListing(l.url)&&/\/searchajax\?/.test(l.url)&&new URL(l.url).searchParams.has('start'));
  if(count&&ajax){const next=new URL(ajax.url),size=Number(next.searchParams.get('sz'));const offset=Number(new URL(url).searchParams.get('start')||0)+size;if(size>0&&offset<count&&offset<2000){next.searchParams.set('start',String(offset));result.push({url:next.href,name:'Official New Arrivals next product page'});}}
  // Some stores print pagination as bare URLs, not Markdown anchors. Only
  // follow a page-number change on this exact shelf, never arbitrary links.
  for(const match of text.matchAll(/https:\/\/[^\s<>"\])]+/g)){
    try{
      const next=new URL(match[0].replaceAll('&amp;','&')),current=new URL(url);
      if(next.origin!==current.origin||next.pathname!==current.pathname||selectedListingFacets(next.href)!==facets)continue;
      if(parentNew&&!isLuxuryMaison(brand)&&!withinNewShelf(next.href))continue;
      const page=['page','pageNumber','pagination','p'].find(k=>/^\d+$/.test(next.searchParams.get(k)||''));
      if(!page||Number(next.searchParams.get(page))<2||canonicalUrl(next.href)===canonicalUrl(url))continue;
      if(!result.some(r=>canonicalUrl(r.url)===canonicalUrl(next.href)))result.push({url:next.href,name:'Official listing next product page',...(withinNewShelf(next.href)?{sectionEvidence:{kind:'new-arrivals-navigation',url,targetUrl:next.href,contentHash:digest(text)}}:{})});
    }catch{}
  }
  return result;
}
export function listingProduct(candidate,checkedAt){
  if(candidate.needsProductTitle)return null;
  // Each brand's lateral slot, by its own filename. _A is Bottega Veneta's
  // lateral and Balenciaga's outsole, so the generic preference cannot be
  // shared: Balenciaga's is _X on its older models and _F on the newer ones.
  const lateral=candidate.brand==='Balenciaga'?/_[XF]\.jpg$/i:/_SLS\.|_PM1_Side|_nb_02_i|_SBG_E02|_A\.(?:jpg|png)/i;
  const fendiSku=candidate.brand==='Fendi'?fendiProductCode(candidate.url):'';
  const skuImages=fendiSku?(candidate.skuBoundImages||[]).filter(i=>i.sku===fendiSku&&i.sourceUrl===candidate.arrivalEvidence?.url&&i.contentHash===candidate.arrivalEvidence?.contentHash&&/^[a-f0-9]{64}$/i.test(i.contentHash||'')&&fendiImageSlot(i,fendiSku)!==null).sort((a,b)=>fendiImageSlot(a,fendiSku)-fendiImageSlot(b,fendiSku)):[];
  const chosen=skuImages[0]||candidate.linkedImages?.find(i=>lateral.test(i.url))||candidate.linkedImages?.find(i=>candidate.brand!=='Balenciaga'||!/_A\.jpg$/i.test(i.url))||candidate.linkedImages?.[0];
  if(!chosen)return null;
  const last=new URL(candidate.url).pathname.split('/').filter(Boolean).pop().replace(/\.html$/i,'');
  const code=/^[A-Z0-9][A-Z0-9_.-]{4,}$/.test(last)?last:last.match(/(?:-p-|[-_])([A-Z0-9_]{7,})$/)?.[1]||'';
  let sku=['Prada','Miu Miu','Dior','Louis Vuitton','Gucci','ASICS'].includes(candidate.brand)?code.replace(/^ANA_/,''):'';
  if(fendiSku)sku=fendiSku;
  if(candidate.brand==='New Balance')sku=[...new URL(candidate.url).searchParams].find(([k])=>/_style$/.test(k))?.[1]||'';
  const productNumber=new URL(candidate.url).searchParams.get('product_no')||new URL(candidate.url).pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/)?.[1];
  const style=sku||productNumber||last,method='official-new-listing-sku-image';
  const p={id:`arrival-${digest(candidate.brand+'|'+canonicalUrl(candidate.url)).slice(0,20)}`,brand:candidate.brand,name:candidate.name,style,...(!sku?{styleType:'official-product-id'}:{}),url:candidate.url,image:chosen.url,
    description:candidate.cardDescription,colorway:colorLabel(chosen.alt,candidate.brand),colors:[],priceLabel:candidate.cardDescription?.match(/(?:[$€£₩¥]\s?[0-9,.]+|[0-9][0-9,.]*\s?(?:원|円|USD|EUR|GBP|KRW|JPY))/)?.[0]||'',
    country:region(candidate.url),firstSeen:checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:candidate.arrivalEvidence.url,
    arrivalEvidence:{...candidate.arrivalEvidence,style},sourceSignals:[],imageCandidates:skuImages.length?skuImages:candidate.linkedImages};
  if(skuImages.includes(chosen))p.sourceSkuBinding={verified:true,brand:p.brand,url:p.url,image:p.image,style,sourceUrl:p.arrivalEvidence.url,contentHash:p.arrivalEvidence.contentHash,method:'official-full-sku-image'};
  const base={verified:true,brand:p.brand,style,verifiedAt:checkedAt,verificationMethod:method,contentHash:p.arrivalEvidence.contentHash,...(!sku?{identifierType:'official-product-id'}:{})};
  p.officialProductEvidence={...base,url:p.url};p.officialImageEvidence={...base,url:p.image,sourceUrl:p.arrivalEvidence.url};
  const hybrid=officialHybridReview(p,p.name+' '+p.description,checkedAt);if(hybrid)p.hybridReview=hybrid;
  const labeled=officialVariantLabels(p,candidate);
  return classifyFootwear(labeled).category?labeled:null;
}
/** A maison's card, taken on the shelf's authority alone.
 *
 *  `listingProduct` refuses a card it cannot bind an image to and refuses one
 *  whose name it had to read off an image, and then the product page is read
 *  to settle it. On a maison's shop that second read is the one that does not
 *  happen: 212 Margiela candidates, 133 AMIRI, 112 Mihara, 62 Rick Owens and
 *  39 Chanel were found on the brands' own shelves and none of them ever
 *  became a record, because ysl.com and chanel.com answer a product request
 *  with a 403 and the render budget was five pages a run.
 *
 *  So the card publishes on what the shelf actually shows: this shoe, at this
 *  URL, in this photograph, on the brand's own page, read on this day. No
 *  officialProductEvidence is written - there was no product page read, and
 *  claiming one would be a lie - which is exactly the condition the curator's
 *  maison rule looks for. Everything else still applies: the footwear
 *  classifier, the three-month window and the retail launch index.
 */
// What a shelf card says where the shoe's name should be, when it is not
// saying the shoe's name: a pre-order flag, a carousel slide number, a bare
// colour, a button. Margiela's cards read "Preorder" and AMIRI's read
// "Image 23: View 1 - A black shearling slipper", and neither is a product.
const CARD_FURNITURE=/^(?:pre[- ]?order|new(?: in)?|image\s*\d+\b.*|view\s*\d+|shop now|quick view|sold out|coming soon|men(?:'s)? sizing.*|women(?:'s)? sizing.*|[a-z\s]{0,12}(?:black|white|cream|brown|grey|gray|beige|ivory|tan|navy|silver|gold)\s*)$/i;
// An opt-in exact tile proof, independent of the legacy shelf fallback below.
// linkedImages comes only from images nested inside this product's own anchor;
// candidate.images also contains adjacent images and must never be used here.
export function strictLuxuryTileProduct(candidate,checkedAt){
  if(!isLuxuryMaison(candidate.brand)||!httpUrl(candidate.url)||!isOfficialProductUrl(candidate.brand,candidate.url)||!isProductLink(candidate.url))return null;
  const name=String(candidate.name||'').trim(),arrival=candidate.arrivalEvidence;
  if(CARD_FURNITURE.test(name)||!/\b(?:sneakers?|trainers?)\b/i.test(name))return null;
  if(arrival?.verified!==true||arrival.brand!==candidate.brand||canonicalUrl(arrival.productUrl)!==canonicalUrl(candidate.url)||!isOfficialProductUrl(candidate.brand,arrival.url)||!httpUrl(arrival.url)||!/^[a-f0-9]{64}$/i.test(arrival.contentHash||''))return null;
  const chosen=candidate.linkedImages?.[0];
  if(!chosen||!httpUrl(chosen.url))return null;
  // An explicit contradictory image label is not this named sneaker's proof.
  const alt=clean(chosen.alt).toLowerCase(),title=clean(name).toLowerCase();
  if(alt&&!alt.includes(title))return null;
  const style=new URL(candidate.url).pathname.split('/').filter(Boolean).at(-1)?.replace(/\.html$/i,'');
  if(!style)return null;
  const method='official-new-listing-sku-image';
  const sourceTileBinding={verified:true,brand:candidate.brand,url:candidate.url,image:chosen.url,style,sourceUrl:arrival.url,contentHash:arrival.contentHash};
  const p={id:`arrival-${digest(candidate.brand+'|'+canonicalUrl(candidate.url)).slice(0,20)}`,
    brand:candidate.brand,name,style,styleType:'official-product-id',url:candidate.url,image:chosen.url,
    description:candidate.cardDescription||'',colorway:colorLabel(chosen.alt||'',candidate.brand),colors:[],country:region(candidate.url),
    firstSeen:checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:arrival.url,
    arrivalEvidence:{...arrival,style},sourceSignals:[],imageCandidates:candidate.linkedImages,sourceTileBinding};
  const base={verified:true,brand:p.brand,style,identifierType:'official-product-id',verifiedAt:checkedAt,verificationMethod:method,contentHash:arrival.contentHash};
  p.officialProductEvidence={...base,url:p.url};
  p.officialImageEvidence={...base,url:p.image,sourceUrl:arrival.url};
  if(classifyFootwear(p).category!=='sneaker'||!officialEvidenceFor(p,kstDay(checkedAt)))return null;
  return p;
}
/** The brand's own words for the shoe, out of its own product URL.
 *  /en-us/tabi-ankle-boots-tapestry-S39WU0250P9369HB715.html -> Tabi Ankle Boots Tapestry
 */
export function nameFromProductSlug(url){
  try{
    const last=new URL(url).pathname.split('/').filter(Boolean).pop().replace(/\.html$/i,'');
    const words=last.split(/[-_]/).filter(w=>w&&!/^[A-Z0-9]{6,}$/.test(w)&&!/^\d+$/.test(w)&&!/^p$/i.test(w));
    if(words.length<2)return '';
    const name=words.map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
    return /[\p{L}]{3}/u.test(name)?name:'';
  }catch{return '';}
}
export function maisonShelfProduct(candidate,checkedAt){
  const chosen=candidate.linkedImages?.[0]||candidate.images?.[0];
  if(!chosen)return null;
  const card=String(candidate.name||'').trim();
  // A card title that is page furniture is replaced by the brand's own slug,
  // never published as the shoe's name and never used to refuse the shoe.
  const name=CARD_FURNITURE.test(card)||!card?nameFromProductSlug(candidate.url):card;
  if(!name)return null;
  const last=new URL(candidate.url).pathname.split('/').filter(Boolean).pop().replace(/\.html$/i,'');
  const code=/^[A-Z0-9][A-Z0-9_.-]{4,}$/.test(last)?last:last.match(/(?:-p-|[-_])([A-Z0-9_]{7,})$/)?.[1]||'';
  const style=code||last;
  const p={id:`arrival-${digest(candidate.brand+'|'+canonicalUrl(candidate.url)).slice(0,20)}`,
    brand:candidate.brand,name,style,
    url:candidate.url,image:chosen.url,description:candidate.cardDescription,
    colorway:colorLabel(chosen.alt,candidate.brand),colors:[],
    priceLabel:candidate.cardDescription?.match(/(?:[$€£₩¥]\s?[0-9,.]+|[0-9][0-9,.]*\s?(?:원|円|USD|EUR|GBP|KRW|JPY))/)?.[0]||'',
    country:region(candidate.url),firstSeen:checkedAt,
    arrivalEvidence:{...candidate.arrivalEvidence,style},sourceSignals:[],imageCandidates:candidate.linkedImages||[]};
  const labeled=officialVariantLabels(p,candidate);
  return classifyFootwear(labeled).category?labeled:null;
}
// Use only the exact official product's card, URL or title to repair navigation
// labels accidentally parsed as a color. Never borrow a neighbouring swatch.
export function officialVariantLabels(product,candidate){
  const p={...product},last=new URL(p.url).pathname.split('/').filter(Boolean).pop().replace(/\.html$/i,'');
  if(p.brand==='Valentino Garavani'){
    const alt=candidate?.linkedImages?.map(i=>i.alt.replace(/^Image\s+\d+:\s*/i,'')).find(a=>/^Valentino Garavani\s+-\s+/i.test(a));
    if(alt){const parts=alt.split(/\s+-\s+/);p.name=parts[1];if(parts[2])p.colorway=parts[2];}
  }
  // Jil Sander calls its sneaker models "Elbe Lace-Up Shoe". The exact
  // official sneaker category supplies the type absent from those names.
  if(p.brand==='Jil Sander'&&/\bshoe\b/i.test(p.name||'')){
    try{if(/\/shoes\/sneakers\/?$/.test(new URL(candidate?.arrivalEvidence?.url).pathname))p.officialCategory='Sneakers';}catch{}
  }
  if(p.brand==='On'){
    const title=candidate?.cardDescription?.replace(/^New(?:\s+color)?\s+/i,'').split(/\s+(?:Men|Women|Unisex)\s*[–—-]/)[0]?.trim();
    if(title&&/Cloud/i.test(title))p.name=title;
    const color=candidate?.linkedImages?.find(i=>/^[\p{L}\s]+\s\|\s[\p{L}\s]+$/u.test(i.alt))?.alt;
    if(color)p.colorway=color;
  }
  if(['Balenciaga','Bottega Veneta'].includes(p.brand)){
    const prefix=p.name.toLowerCase().replace(/\s+/g,'-')+'-';
    if(last.toLowerCase().startsWith(prefix)){
      const color=last.slice(prefix.length).replace(/-[A-Z0-9]{8,}$/,'');
      if(color&&/^[a-z-]+$/i.test(color))p.colorway=color.replaceAll('-',' ');
    }
  }
  if(p.brand==='ALOHAS'){
    const title=p.name.match(/^Tb\.\d+\s+(?:Aera|Club Nylon)\s+(.+?)\s+Sneakers$/i);
    if(title)p.colorway=title[1];
  }
  if(p.brand==='FILA'&&p.colorway)p.colorway=p.colorway.split(/!\[|https?:|\\/)[0].trim();
  if(/^(?:image\s*\d+|(?:women|men)\s*\||sneakers?\s*[·|]|공식 색상명 미표기)/i.test(p.colorway||''))p.colorway='';
  return p;
}
export function adidasProductColor(text,url){
  // Bind a label to this exact PDP. Review text and neighbouring color tiles
  // can describe different colorways, even when they share the same model.
  const own=markdownLinks(text).find(l=>!l.image&&canonicalUrl(l.url)===canonicalUrl(url)&&/!\[Product colou?r:/i.test(l.label));
  return own?.label.match(/!\[Product colou?r:\s*([^\]]+)\]/i)?.[1]?.trim()||'';
}
export function pageProduct(candidate,text,checkedAt,existing){
  const url=candidate.url;
  if(existing&&officialEvidenceFor(existing,kstDay(checkedAt))){
    const p={...existing,arrivalEvidence:{...candidate.arrivalEvidence,style:existing.style,productUrl:existing.url}};
    const alt=existing.imageCandidates?.find(i=>i.url===existing.image)?.alt||'';
    if(/\bsneakers?\b/i.test(alt))p.officialCategory='Sneakers';
    const hybrid=officialHybridReview(p,p.name+' '+p.description+' '+alt,checkedAt);if(hybrid)p.hybridReview=hybrid;
    return p;
  }
  const body=text.replaceAll('\\_','_').split(/\n#{1,3}\s*(?:Related|Recommended|You may also|Recently viewed)/i)[0];
  const heading=body.match(/^#\s+(.+)$/m)?.[1];
  if(!heading)return null;
  const tokens=clean(candidate.name).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>2);
  if(!tokens.length||tokens.filter(t=>heading.toLowerCase().includes(t)).length<Math.min(2,tokens.length)&&!clean(candidate.name).toLowerCase().includes(clean(heading).toLowerCase()))return null;
  const itemBody=body.slice(body.indexOf('# '+heading));
  const code=itemBody.match(/(?:^|\n)[\s*-]*(?:product (?:code|id)|style (?:code|no\.?|number|#)|sku|reference|品番|제품 코드|상품코드)\s*:?\s*([A-Z0-9][A-Z0-9_.-]{3,70})/i)?.[1];
  const last=new URL(url).pathname.split('/').filter(Boolean).pop().replace(/\.html$/i,'');
  const fromUrl=fendiProductCode(url)||(/^[A-Z0-9][A-Z0-9_.-]{4,}$/.test(last)?last:last.match(/(?:-p-|[-_])([A-Z0-9_.]{7,})$/)?.[1]||'');
  const variant=candidate.brand==='New Balance'?[...new URL(url).searchParams].find(([k])=>/_style$/.test(k))?.[1]:'';
  const verifiedVariant=variant&&body.toLowerCase().includes(variant.toLowerCase())?variant:'';
  const productNumber=new URL(url).searchParams.get('product_no')||new URL(url).pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/)?.[1];
  const style=verifiedVariant||fromUrl||code||productNumber||last;
  const styleType=verifiedVariant||code||fromUrl?undefined:'official-product-id';
  // LV's colour picker includes other variants' large photographs after the
  // heading. Only its current variant gallery before H1 is identity evidence.
  const gallery=candidate.brand==='Louis Vuitton'?body.slice(0,body.indexOf('# '+heading)):body;
  const lvSlug=candidate.brand==='Louis Vuitton'&&gallery.includes(style)?new URL(url).pathname.match(/\/products\/(.+)-nvprod/)?.[1]:'';
  const cbStyle=candidate.brand==='Cecilie Bahnsen'?last.match(/^\d-\d{2}ftw\d+/i)?.[0]?.replace(/[^a-z0-9]/gi,'').toLowerCase():'';
  const exactStyle=style.replace(/[^a-z0-9]/gi,'').toLowerCase();
  const images=imageUrls(gallery),own=images.filter(i=>candidate.linkedImages?.some(c=>canonicalUrl(c.url)===canonicalUrl(i.url))||i.url.toLowerCase().replace(/[^a-z0-9]/g,'').includes(exactStyle)||lvSlug&&i.url.includes('louis-vuitton-'+lvSlug+'--')||cbStyle&&i.url.toLowerCase().replace(/[^a-z0-9]/g,'').includes(cbStyle)||styleType==='official-product-id'&&tokens.filter(t=>i.alt.toLowerCase().includes(t)).length>=Math.min(2,tokens.length));
  // Tory's current-colour side gallery contains several thumbnail sizes.
  // Use only observed same-colour assets, preferring the largest rendition.
  const torySide=candidate.brand==='Tory Burch'?own.filter(i=>{const u=new URL(candidate.url),article=u.pathname.split('/').at(-1).replace('.html',''),colour=u.searchParams.get('color');return !!colour&&i.url.includes('_'+article+'_'+colour+'_SLSID.');}).sort((a,b)=>{const area=i=>{const m=i.url.match(/(?:pdp|grid)-(\d+)x(\d+)/i);return m?Number(m[1])*Number(m[2]):0;};return area(b)-area(a);})[0]:null;
  const chosen=torySide||(candidate.brand==='Moncler'?own.find(i=>i.url.includes('/'+style+'_1/image/')):null)||own.find(i=>/_SLS\.|_PM1_Side|_Side\.|_nb_02_i|_SBG_E02|_A\.(?:jpg|png)/i.test(i.url))||own.find(i=>/_SLR\.|_PM2_/i.test(i.url))||own[0];
  if(!chosen)return null;
  const detail=body.slice(body.indexOf('# '+heading)).split(/\n#{1,4}\s*(?:Contact us|Shipping|Delivery|Free shipping|SUBSCRIBE)/i)[0];
  const description=detail.split('\n').filter(l=>!l.includes('https://')&&l.trim().length>30).join(' ').slice(0,6000);
  const p={id:existing?.id||`arrival-${digest(candidate.brand+'|'+canonicalUrl(url)).slice(0,20)}`,brand:candidate.brand,name:clean(heading),url,image:chosen.url,style,styleType:styleType||'sku',description,
    colorway:body.match(/(?:^|\n)\s*[-*]?\s*#{0,3}\s*(?:Colors?|Colours?|색상)\s*:?\s*([^\n]{2,90})/i)?.[1]?.trim()||colorLabel(chosen.alt,candidate.brand),colors:[],
    priceLabel:body.match(/(?:[$€£₩¥]\s?[0-9,.]+|[0-9][0-9,.]*\s?(?:원|円|USD|EUR|GBP|KRW|JPY))/)?.[0]||'',country:region(url),gender:/\/women|\/womens|shop-women/i.test(url)?'Women':/\/men|\/mens|shop-men/i.test(url)?'Men':'',
    firstSeen:checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:url,arrivalEvidence:{...candidate.arrivalEvidence,style},sourceSignals:[]};
  if(/\bsneakers?\b/i.test(chosen.alt))p.officialCategory='Sneakers';
  if(candidate.brand==='Loewe'){
    const alt=chosen.alt.replace(/^LOEWE\s+/i,'').replace(/\s+/g,' ').trim(),prefix=clean(heading)+' ';
    if(alt.toLowerCase().startsWith(prefix.toLowerCase()))p.colorway=alt.slice(prefix.length);
  }
  if(candidate.brand==='adidas')p.colorway=adidasProductColor(text,url)||p.colorway;
  if(/sneakerina|スニーカリーナ/i.test(p.name))p.officialCategory='Ballet sneaker';
  const hybrid=officialHybridReview(p,body,checkedAt);if(hybrid)p.hybridReview=hybrid;
  const base={verified:true,brand:p.brand,style,verifiedAt:checkedAt,verificationMethod:'official-new-arrivals-and-product-page',contentHash:digest(text),...(styleType?{identifierType:styleType}:{})};
  p.officialProductEvidence={...base,url};p.officialImageEvidence={...base,url:p.image,sourceUrl:url};
  p.imageCandidates=own;
  return p;
}
function region(url){const u=new URL(url),m=(u.hostname+'/'+u.pathname).match(/(?:^|[./_-])(us|uk|gb|jp|kr|ca|hk|cn|au|fr|it|de|dk)(?:[./_-]|$)/i);return m?(m[1].toUpperCase()==='UK'?'GB':m[1].toUpperCase()):'GL';}
// Receipts deliberately count all observed official product links, including
// cards the eligibility parser omits. An omitted card is not an exclusion proof.
function listingReceipt(text,brand,source,rows,followups,checkedAt){
  const productLinks=markdownLinks(text).filter(l=>!l.image&&isOfficialProductUrl(brand,l.url)&&isProductLink(l.url));
  const sourceGridItemUrls=[...new Set(productLinks.map(l=>canonicalUrl(l.url)))];
  // Only standalone counters before the first product card can declare the
  // shelf's total. Prose such as "made with 12 products" is not a counter.
  const counterArea=text.slice(0,productLinks[0]?.start??text.length);
  const declaredTotalEvidence=counterArea.split('\n').flatMap(line=>{
    const counter=line.trim().replace(/^#{1,6}\s+/,'').replace(/^\*\*(.*?)\*\*$/,'$1').trim();
    const match=counter.match(/^(?:([\d,]+)\s+(?:products|items)|(?:products|items)\s*\(([\d,]+)\)|showing\s+\d[\d,]*\s*[-–]\s*\d[\d,]*\s+of\s+([\d,]+)\s+(?:products|items))$/i);
    return match?[{count:Number((match[1]||match[2]||match[3]).replaceAll(',','')),text:line.trim(),kind:'listing-counter'}]:[];
  });
  const totals=declaredTotalEvidence.map(e=>e.count);
  const pages=[...text.matchAll(/\bpage\s+(\d+)\s+(?:of|\/)\s*(\d+)\b/gi)].map(m=>({current:Number(m[1]),total:Number(m[2])}));
  const terminal=pages.find(p=>p.current>0&&p.current===p.total);
  const terminalText=text.match(/(?:^|\n)\s*(?:no more (?:products|items)|end of (?:results|products))\s*[.!]?\s*(?:\n|$)/i)?.[0]?.trim();
  return {brand,url:source.url,shelfUrl:source.shelfUrl||source.url,contentHash:digest(text),checkedAt,
    candidateUrls:rows.map(p=>canonicalUrl(p.url)),extractedCandidateUrlCount:rows.length,sourceGridItemUrls,
    declaredTotalCounts:[...new Set(totals)],declaredTotalEvidence,followupUrls:[...new Set(followups.map(p=>canonicalUrl(p.url)))],
    pagingCounts:pages,terminalPaging:terminal?{kind:'page-count',...terminal}:terminalText?{kind:'explicit-end',text:terminalText}:null};
}

// This proof is scoped to configured shelves, never to a brand's whole site.
// Static enumeration needs an anchored positive source counter and every own
// product proof/exclusion. Absence of a Next link alone never proves anything.
export function proveListingCompletion({brand,configured=[],receipts=[],outcomes=[],listingPending=[],pending=[],errors=[],today=kstDay()}){
  const reasons=[],shelves=[];
  const byUrl=new Map(receipts.filter(r=>r.brand===brand).map(r=>[canonicalUrl(r.url),r]));
  const byCandidate=new Map(outcomes.filter(o=>o.brand===brand).map(o=>[canonicalUrl(o.url),o]));
  if(!configured.length)reasons.push('no-configured-shelves');
  if(listingPending.some(e=>e.brand===brand))reasons.push('listing-pending');
  if(pending.some(e=>e.brand===brand))reasons.push('candidate-pending');
  if(errors.length)reasons.push('listing-or-product-errors');
  for(const source of configured){
    const root=canonicalUrl(source.url),visited=new Set(),queue=[root],pages=[];
    while(queue.length){
      const url=queue.shift();if(visited.has(url))continue;visited.add(url);
      const receipt=byUrl.get(url);
      if(!receipt?.contentHash||!isOfficialProductUrl(brand,url)){reasons.push('missing-page-receipt:'+url);continue;}
      pages.push(receipt);queue.push(...(receipt.followupUrls||[]).map(canonicalUrl));
    }
    const totals=[...new Set(pages.flatMap(p=>p.declaredTotalCounts||[]))];
    const observed=[...new Set(pages.flatMap(p=>p.sourceGridItemUrls||[]).map(canonicalUrl))];
    const terminal=pages.some(p=>p.terminalPaging);
    const totalMatches=totals.length===1&&Number.isSafeInteger(totals[0])&&totals[0]>0&&totals[0]===observed.length;
    const enumeration=pages.length===1&&canonicalUrl(pages[0].url)===root&&!(pages[0].pagingCounts||[]).length&&totalMatches&&pages[0].declaredTotalEvidence?.length>0&&pages[0].declaredTotalEvidence.every(e=>e.kind==='listing-counter'&&e.count===totals[0]);
    if(!terminal&&!enumeration)reasons.push('terminal-paging-unproven:'+root);
    if(!totalMatches)reasons.push('declared-total-mismatch-or-missing:'+root);
    for(const url of observed){
      const outcome=byCandidate.get(url);
      const exclusionSource=outcome?.evidence?.url&&byUrl.get(canonicalUrl(outcome.evidence.url));
      const bound=!!exclusionSource?.contentHash&&exclusionSource.contentHash===outcome.evidence.contentHash&&(exclusionSource.sourceGridItemUrls||[]).some(item=>canonicalUrl(item)===url);
      const complete=bound&&outcome?.outcome==='complete'&&outcome.product&&canonicalUrl(outcome.product.url)===url&&outcome.product.brand===brand&&officialEvidenceFor(outcome.product,today);
      const excluded=bound&&outcome?.outcome==='explicitlyexcluded'&&outcome.reason;
      if(!complete&&!excluded)reasons.push('candidate-unverified:'+url);
    }
    shelves.push({url:source.url,declaredTotal:totals.length===1?totals[0]:null,uniqueObserved:observed.length,terminalPaging:terminal,method:terminal?'terminal-paging-and-declared-total':enumeration?'source-declared-enumeration':null});
  }
  const methods=[...new Set(shelves.map(s=>s.method))];
  return {complete:reasons.length===0,method:reasons.length?null:methods.length===1?methods[0]:'configured-shelf-proofs',scope:'configured-shelves',shelves,reasons:[...new Set(reasons)]};
}

// Admin opt-ins: listingSeeds replaces configured starting pages (including []);
// feed listingPending back as seeds and carry listingReceipts/candidateOutcomes
// to avoid revisiting successful pages and to prove a multi-pass traversal.
// strictLuxuryTileProofs enables only the own-anchor official-product-id gate;
// it does not promote legacy maison shelf records into official PDP evidence.
export async function collectNewArrivals({read,readDetails,sources,brands,existing=[],now=new Date(),maxPagesPerBrand=16,maxDetailMsPerBrand=Infinity,canReadDetails=()=>true,clock=Date.now,onProgress,log=console.log,carriedPending=[],catalogueBrands=[],skipDiscovery=false,initialDiscovery,allowListingFollowup=()=>true,filterCandidate=()=>true,listingSeeds,resumeReceipts,listingReceipts:priorReceipts=resumeReceipts||[],candidateOutcomes:priorOutcomes=[],completionProof=false,strictLuxuryTileProofs=false}={}){
  const checkedAt=new Date(now).toISOString(),products=[],coverage=[],work=[];
  const receipts=[...priorReceipts],outcomes=new Map(priorOutcomes.map(o=>[o.brand+'|'+canonicalUrl(o.url),o]));
  const recordOutcome=(candidate,outcome,reason,product)=>outcomes.set(candidate.brand+'|'+canonicalUrl(candidate.url),{brand:candidate.brand,url:candidate.url,outcome,...(reason?{reason}:{}),...(product?{product}:{}),evidence:candidate.arrivalEvidence,checkedAt});
  const listingWork=new Map();
  const startingListings=listingSeeds===undefined?brands.filter(b=>!isExcludedBrand(b)).flatMap(brand=>(sources[brand]||[]).map(source=>({brand,source}))):listingSeeds;
  const listingPending=()=>[...new Map([...listingWork].flatMap(([brand,state])=>[...state.queue,...state.deferred,...state.failed,...(state.inflight?[state.inflight]:[])].filter(s=>!state.success.has(canonicalUrl(s.url))).map(source=>({brand,source})))
    .concat(startingListings.filter(e=>!listingWork.has(e.brand)&&!receipts.some(r=>r.brand===e.brand&&canonicalUrl(r.url)===canonicalUrl(e.source.url))))
    .map(e=>[e.brand+'|'+canonicalUrl(e.source.url),e])).values()];
  if(initialDiscovery){products.push(...(initialDiscovery.products||[]));for(const status of initialDiscovery.coverage||[]){const candidates=new Map((initialDiscovery.pending||[]).filter(e=>e.brand===status.brand).map(e=>[canonicalUrl(e.candidate.url),e.candidate]));coverage.push({...status});work.push({brand:status.brand,status:coverage.at(-1),candidates});}}
  const stillPending=()=>{
    const active=work.flatMap(w=>[...(w.pending||w.candidates.values()),...(w.failedPending||[]),...(w.inflight?[w.inflight]:[])].map(candidate=>({brand:w.brand,candidate})));
    const carried=carriedPending.filter(e=>!['complete','explicitlyexcluded'].includes(outcomes.get(e.brand+'|'+canonicalUrl(e.candidate?.url))?.outcome));
    return [...new Map([...carried,...active].map(e=>[e.brand+'|'+canonicalUrl(e.candidate?.url),e])).values()];
  };
  let progressTail=Promise.resolve();
  async function checkpoint(phase){
    if(!onProgress)return;
    const snapshot=structuredClone({checkedAt,phase,products,coverage,pending:stillPending(),listingPending:listingPending(),listingReceipts:receipts,candidateOutcomes:[...outcomes.values()]});
    progressTail=progressTail.then(()=>onProgress(snapshot));await progressTail;
  }
  let discoveryCursor=0;
  async function discoverBrands(){while(discoveryCursor<brands.length){const brand=brands[discoveryCursor++];
    if(isExcludedBrand(brand))continue;
    const full=catalogueBrands.includes(brand);
    const configured=(sources[brand]||[]).map(s=>full?{...s,basis:'assortment'}:s);
    const seeds=listingSeeds===undefined?configured:listingSeeds.filter(e=>e.brand===brand).map(e=>e.source);
    const queue=seeds.map(s=>({...s,shelfUrl:s.shelfUrl||s.url,...(full?{basis:'assortment'}:{})})).sort((a,b)=>Number(isNewListing(b.url))-Number(isNewListing(a.url))),seen=new Set(),candidates=new Map();
    const success=new Set(receipts.filter(r=>r.brand===brand).map(r=>canonicalUrl(r.url))),state={queue,success,failed:[],deferred:[]};listingWork.set(brand,state);
    const status={brand,attempts:0,responses:0,listingPages:0,candidates:0,verified:0,errors:[],checkedAt,exhaustive:false};
    work.push({brand,status,candidates});coverage.push(status);
    while(queue.length&&seen.size<maxPagesPerBrand){
      const source=queue.shift(),key=canonicalUrl(source.url);if(seen.has(key)||success.has(key)||!isOfficialProductUrl(brand,source.url)||isKidsListing(source.url))continue;seen.add(key);status.attempts++;state.inflight=source;
      try{
        const text=assertReadableOfficial(await read(`https://r.jina.ai/${source.url}`));status.responses++;
        const rows=parseArrivalListing(text,{brand,url:source.url,checkedAt,sectionEvidence:source.sectionEvidence,basis:source.basis});if(isNewListing(source.url,text)||rows.length)status.listingPages++;
        const hasNewCards=rows.some(p=>!candidates.has(canonicalUrl(p.url)));
        if(rows.length&&!hasNewCards)status.repeatedListingPages=(status.repeatedListingPages||0)+1;
        for(const p of rows){candidates.set(canonicalUrl(p.url),p);recordOutcome(p,'unverified','awaiting-product-proof');}
        let followups=listingFollowups(text,source.url,brand,source.sectionEvidence);
        const observedFollowups=[...followups];
        // Loro Piana emits a next-page URL even beyond its last product page.
        // Do not spend the entire run following empty pages indefinitely.
        if(listingSeeds===undefined&&!completionProof&&(!rows.length||!hasNewCards)){
          const current=new URL(source.url);
          followups=followups.filter(next=>new URL(next.url).pathname!==current.pathname);
        }
        if(full){
          followups.push(...sneakerShelfLinks(markdownLinks(text),{origin:new URL(source.url).origin,pageUrl:source.url,limit:100}).map(url=>({url})));
          for(const next of followups)next.basis='assortment';
        }
        observedFollowups.push(...followups);
        const allowed=followups.filter(next=>allowListingFollowup(next,source));
        // The default repeated-page guard still ends this pass, but its visible
        // unread links survive in the continuation checkpoint for an admin.
        const deferred=observedFollowups.filter(next=>!followups.some(p=>canonicalUrl(p.url)===canonicalUrl(next.url)))
          .filter(next=>allowListingFollowup(next,source));
        const receipt=listingReceipt(text,brand,source,rows,observedFollowups,checkedAt);
        for(const url of receipt.sourceGridItemUrls)if(!outcomes.has(brand+'|'+url))recordOutcome({brand,url,arrivalEvidence:{url:source.url,contentHash:receipt.contentHash}},'unverified','listing-card-unparsed-or-ineligible');
        receipts.push(receipt);success.add(key);
        state.deferred.push(...deferred.map(next=>({...next,shelfUrl:source.shelfUrl,...(source.basis&&!next.basis?{basis:source.basis}:{})})));
        for(const next of allowed)if(!seen.has(canonicalUrl(next.url))&&!success.has(canonicalUrl(next.url))&&!queue.some(q=>canonicalUrl(q.url)===canonicalUrl(next.url)))queue.push({...next,shelfUrl:source.shelfUrl,...(source.basis&&!next.basis?{basis:source.basis}:{})});
      }catch(e){status.errors.push({url:source.url,error:e.message});state.failed.push(source);}
      finally{delete state.inflight;}
      status.candidates=candidates.size;
      await checkpoint('listing-page');
    }
    status.truncated=queue.some(s=>!seen.has(canonicalUrl(s.url))&&!success.has(canonicalUrl(s.url)));status.candidates=candidates.size;
    log(`${brand}: listing discovery checked (${status.responses}/${status.attempts} responses).`);
    await checkpoint('listing-discovery');
  }}
  // A verification run reads no listing at all. Discovery is what refills the
  // queue, and while it ran in the same budget the queue could only grow: the
  // listings yield candidates far faster than product pages can be checked, so
  // a run that does both ends with more waiting than it started with. This mode
  // exists to make the queue shorter.
  if(!skipDiscovery)await Promise.all(Array.from({length:4},()=>discoverBrands()));
  // Resolve every brand's exact linked listing photos before doing ANY slower
  // PDP work, so a large assortment cannot starve another brand's ready proofs.
  const oldByUrl=new Map(existing.map(p=>[p.brand+'|'+canonicalUrl(p.url),p]));
  const accept=(p,candidate,status)=>{
    p=officialVariantLabels(p,candidate);
    if(catalogueBrands.includes(p.brand)&&!['sneaker','hybrid','ballet-sneaker','mary-jane-sneaker','mule-sneaker'].includes(classifyFootwear(p).category)){recordOutcome(candidate,'explicitlyexcluded','outside-catalogue-footwear-scope');return true;}
    if(classifyFootwear(p).reason==='excluded-footwear'){recordOutcome(candidate,'explicitlyexcluded','excluded-footwear');return true;}
    products.push(p);status.verified++;
    const validated=!!officialEvidenceFor(p,kstDay(now));
    recordOutcome(candidate,validated?'complete':'unverified',validated?undefined:'product-proof-invalid',p);
    return validated;
  };
  for(const item of work){
    const {brand,status,candidates}=item;item.pending=item.pending||[];
    for(const candidate of candidates.values()){
      if(!filterCandidate(candidate,brand)){status.excludedNonFootwear=(status.excludedNonFootwear||0)+1;recordOutcome(candidate,'explicitlyexcluded','candidate-filter');continue;}
      recordOutcome(candidate,'unverified','awaiting-product-proof');
      const old=oldByUrl.get(brand+'|'+canonicalUrl(candidate.url));
      // Avoid product requests for clearly unrelated clothing and ordinary dress shoes.
      const footwearHint=/sneaker|sneakerina|trainers?|running|shoes?|ballet|mary.jane|mule|jelly|platform|スニーカー|슈즈|스니커|运动鞋|運動鞋/i.test(candidate.name+' '+candidate.cardDescription+' '+new URL(candidate.url).pathname);
      const nonFootwear=/\b(?:shirts?|jackets?|coats?|bags?|wallets?|belts?|trousers|pants|shorts|socks|caps?|hats?|dresses?|sunglasses|eyewear|jewell?ery|earrings?|necklaces?|bracelets?|scarves|sweaters?|hoodies?|t-shirts?|tops?|leggings?|bras?|skorts?)\b|재킷|자켓|팬츠|가방|티셔츠|양말|모자/i.test(candidate.name);
      if(!footwearHint&&(!candidate.linkedImages.length||nonFootwear)){
        recordOutcome(candidate,nonFootwear?'explicitlyexcluded':'unverified',nonFootwear?'non-footwear-card':'footwear-unconfirmed');
        if(!nonFootwear)item.pending.push(candidate);
        continue;
      }
      try{
        const retained=old&&old.officialProductEvidence?.verificationMethod!=='official-new-listing-sku-image'&&officialEvidenceFor(old,kstDay(now));
        const listedCandidate=retained?null:listingProduct(candidate,checkedAt);
        const listed=listedCandidate&&officialEvidenceFor(listedCandidate,kstDay(now))?listedCandidate:null;
        const tile=strictLuxuryTileProofs&&!retained&&!listed?strictLuxuryTileProduct(candidate,checkedAt):null;
        const p=tile?{...tile,...(old?{id:old.id}:{})}:listed?{...listed,...(old?{id:old.id}:{}),...(!listed.colorway&&old?.colorway&&old?.officialProductEvidence?.verificationMethod!=='official-new-listing-sku-image'?{colorway:old.colorway,colors:old.colors}:{} )}:retained?pageProduct(candidate,'',checkedAt,old):null;
        if(tile)status.sourceTileProofs=(status.sourceTileProofs||0)+1;
        if(!p||!accept(p,candidate,status))item.pending.push(candidate);
      }catch(e){status.errors.push({url:candidate.url,error:e.message});recordOutcome(candidate,'unverified',e.message);item.pending.push(candidate);}
    }
    status.detailPending=item.pending.length;
  }
  // Last run's unchecked candidates, ahead of this run's. They were found by
  // a listing read we have already paid for, and a candidate that has waited
  // a week is the one most likely to drop out of the brand's New section
  // before anybody checks it. A brand this run did not reach keeps its queue
  // for the run after - carriedPending is returned untouched for those.
  const byBrand=new Map(work.map(item=>[item.brand,item]));
  for(const entry of carriedPending){
    const candidate=entry?.candidate;
    if(!candidate?.url)continue;
    if(!filterCandidate(candidate,entry.brand)){recordOutcome(candidate,'explicitlyexcluded','candidate-filter');continue;}
    let item=byBrand.get(entry.brand);
    // In a verification run there was no discovery, so the brand has no work
    // item yet; the queue itself is the work. `verification-only` keeps that
    // status out of the unavailable-source count, which is about listings.
    if(!item&&skipDiscovery&&entry.brand){
      item={brand:entry.brand,candidates:new Map(),pending:[],
            status:{brand:entry.brand,attempts:0,responses:0,listingPages:0,candidates:0,verified:0,
                    errors:[],checkedAt,exhaustive:false,verificationOnly:true}};
      work.push(item);coverage.push(item.status);byBrand.set(entry.brand,item);
    }
    if(!item)continue;
    const key=canonicalUrl(candidate.url);
    if(item.candidates.has(key)||item.pending.some(c=>canonicalUrl(c.url)===key))continue;
    if(strictLuxuryTileProofs){
      try{
        const tile=strictLuxuryTileProduct(candidate,checkedAt);
        if(tile&&accept(tile,candidate,item.status)){item.status.sourceTileProofs=(item.status.sourceTileProofs||0)+1;continue;}
      }catch(e){item.status.errors.push({url:candidate.url,error:e.message});}
    }
    recordOutcome(candidate,'unverified','awaiting-product-proof');
    item.pending.unshift(candidate);item.status.detailPending=item.pending.length;
  }
  // --- B: who gets the budget ------------------------------------------------
  // Verification is the scarce resource - the clock runs out long before the
  // queue does - and it used to be spent in whatever order the brands were
  // configured in. That gave On's 768 waiting candidates the budget while a
  // maison with one candidate and nothing on the site at all waited behind
  // them. The brands publishing least go first: one verified product is the
  // difference between a brand being on the site and being a bare "0", and is
  // worth more there than it is on a brand already showing hundreds.
  const publishedBy=new Map();
  for(const product of existing){const brand=product?.brand;if(brand)publishedBy.set(brand,(publishedBy.get(brand)||0)+1);}
  const carriedBy=new Map();
  for(const entry of carriedPending){if(entry?.brand)carriedBy.set(entry.brand,(carriedBy.get(entry.brand)||0)+1);}
  work.sort((a,b)=>
    Number((b.pending?.length||0)>0)-Number((a.pending?.length||0)>0)   // nothing to check costs nothing: last
    ||(publishedBy.get(a.brand)||0)-(publishedBy.get(b.brand)||0)       // the emptiest brand first
    ||(carriedBy.get(b.brand)||0)-(carriedBy.get(a.brand)||0)           // then whoever has waited longest
    ||String(a.brand).localeCompare(String(b.brand)));
  await checkpoint('listing-proofs');
  let cursor=0;
  async function verifyBrands(){while(cursor<work.length){
    const item=work[cursor++],{brand,status}=item,started=clock();item.failedPending=[];
    while(item.pending.length&&canReadDetails()&&clock()-started<maxDetailMsPerBrand){
      const candidate=item.pending.shift();
      item.inflight=candidate;
      try{
        let p=pageProduct(candidate,assertReadableOfficial(await read(`https://r.jina.ai/${candidate.url}`)),checkedAt,null);
        if(!p&&readDetails&&canReadDetails())p=pageProduct(candidate,assertReadableOfficial(await readDetails(candidate.url)),checkedAt,null);
        if(!p||!accept(p,candidate,status)){status.errors.push({url:candidate.url,error:'product-identity-image-unverified'});recordOutcome(candidate,'unverified','product-identity-image-unverified');item.failedPending.push(candidate);}
      }catch(e){status.errors.push({url:candidate.url,error:e.message});recordOutcome(candidate,'unverified',e.message);item.failedPending.push(candidate);}
      finally{delete item.inflight;item.detailAttempts=(item.detailAttempts||0)+1;if(item.detailAttempts%10===0){status.detailPending=item.pending.length;log(`${brand}: ${status.verified} verified; ${status.detailPending} details remaining`);await checkpoint('product-verification');}}
    }
    // A maison's leftovers are not left over. Whatever the clock or the
    // render budget stopped us checking still has the brand's own shelf
    // behind it, and for these shops that is all there will ever be.
    if((isLuxuryMaison(brand)||catalogueBrands.includes(brand))&&item.pending.length){
      const taken=[];
      for(const candidate of item.pending){
        try{const p=maisonShelfProduct(candidate,checkedAt);if(p&&accept(p,candidate,status))taken.push(candidate);}
        catch(e){status.errors.push({url:candidate.url,error:e.message});}
      }
      const done=new Set(taken.map(c=>canonicalUrl(c.url)));
      item.pending=item.pending.filter(c=>!done.has(canonicalUrl(c.url)));
      if(taken.length)status.shelfBasisProofs=(status.shelfBasisProofs||0)+taken.length;
    }
    item.pending.push(...item.failedPending);item.failedPending=[];
    status.detailPending=item.pending.length;
    if(status.detailPending)status.errors.push({error:'product-follow-up-deferred',reason:'detail-time-budget',remaining:status.detailPending});
    // Dynamic pagination may hide additional items: never equate a response with completeness.
    status.status=status.verificationOnly?'verification-only'
      :!status.responses?'unavailable':!status.listingPages?'new-section-unconfirmed':status.errors.length||status.truncated?'partial':'checked';
    log(`${brand}: ${status.listingPages} New listing pages, ${status.candidates} candidates, ${status.verified} product proofs, ${status.errors.length} unresolved checks`);
    await checkpoint('product-verification');
  }}
  await Promise.all(Array.from({length:3},()=>verifyBrands()));
  if(completionProof){
    for(const status of coverage){
      status.completionProof=proveListingCompletion({brand:status.brand,configured:sources[status.brand]||[],receipts,outcomes:[...outcomes.values()],listingPending:listingPending(),pending:stillPending(),errors:status.errors,today:kstDay(now)});
      status.exhaustive=status.completionProof.complete;
    }
  }
  await checkpoint('complete');
  // Everything still unchecked, including carried candidates for brands this
  // run never reached, so a brand dropped from the list for one week does not
  // lose the queue it had built up.
  return {products,coverage,checkedAt,listingPending:listingPending(),listingReceipts:receipts,candidateOutcomes:[...outcomes.values()],
    pending:stillPending()};
}
