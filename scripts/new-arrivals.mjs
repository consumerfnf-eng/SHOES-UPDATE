import {createHash} from 'node:crypto';
import {canonicalUrl,isOfficialProductUrl,classifyFootwear,officialHybridReview,officialEvidenceFor,kstDay} from './curation.mjs';
import {assertReadableOfficial} from './official-reader.mjs';

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
export function isNewListing(url,text=''){
  try{const u=new URL(url);return (!isProductLink(url)||/\/(?:new-arrivals?|new-in)\.html$/i.test(u.pathname))&&(newPath.test(u.pathname.replace(/\.html$/i,''))||newPath.test(u.searchParams.get('cgid')||'')||/^#\s+(?:new arrivals?|new in(?:\s+shoes)?|new shoes|신상품)\s*$/im.test(text));}catch{return false;}
}
const productPath=/\/(?:products?|produtos|p|pr|pd|t)\/|\/[^/]+\.html(?:$|\?)|(?:-p-|\/p-)[a-z0-9]|\/(?:men|women)\/footwear\/[^/]+\/[^/?]+|\/[0-9]{6,}(?:[.?/]|$)/i;
function isProductLink(url){try{const u=new URL(url);return productPath.test(u.pathname)||u.hostname==='usa.mizuno.com'&&/^\/running-[^/]+\/?$/.test(u.pathname);}catch{return false;}}
function colorLabel(alt,brand){
  if(brand==='Cecilie Bahnsen'&&/\b[A-Z]+\/[A-Z]+$/.test(alt))return alt.split(/\s+/).at(-1);
  let color=['ASICS','PUMA','Onitsuka Tiger'].includes(brand)?alt.split(',')[1]?.trim().replace(/\s+\d+$/,'')||'':alt.split(/\s[-—–]\s/)[1]||'';
  color=color.replace(/^(.+)\s+\1$/i,'$1').trim();
  return /\b(?:women|men|unisex|image|view|united states)\b|\|/.test(color.toLowerCase())?'':color;
}
const imageUrls=text=>markdownLinks(text).flatMap(l=>l.image?[l]:markdownLinks(l.label).filter(child=>child.image)).map(l=>({alt:l.label,url:l.url})).filter(i=>{
  if(/(?:placeholder|fallback|logo|swatch|icon|LOOK_|lookbook|campaign|lifestyle|cardPayment|packaging|_MDL\b|variantthumbnail)/i.test(i.url+' '+i.alt)||/[.]svg(?:[?\/]|$)/i.test(i.url))return false;
  const u=new URL(i.url),size=Number(u.searchParams.get('width')||u.searchParams.get('wid')||u.searchParams.get('w'));
  return !(size&&size<160)&&!/(?:^|[\/_])(?:40x40|60x60|80x80)(?:[\/_]|$)/i.test(u.pathname);
});
export function parseArrivalListing(text,{brand,url,checkedAt,sectionEvidence}){
  const sourceHash=digest(text),heading=text.search(/^#{1,2}\s+.+$/m);
  const firstProduct=markdownLinks(text).find(l=>!l.image&&isOfficialProductUrl(brand,l.url)&&isProductLink(l.url)&&(/!\[/.test(l.label)||/sneaker|shoe|trainer/i.test(l.label)))?.start??Infinity;
  const footer=[...text.matchAll(/\n#{1,3}\s*(?:You may (?:also |be )|Recommended|Related|Recently viewed|What's Trending|Fearlessly Independent|Stay in the loop|Subscribe)/gi)].find(m=>m.index>firstProduct)?.index??text.length;
  text=text.slice(heading>=0&&heading<firstProduct?heading:0,footer);
  const links=markdownLinks(text).filter(l=>!l.image&&isOfficialProductUrl(brand,l.url)&&isProductLink(l.url));
  const rows=new Map(),isNew=isNewListing(url,text)||sectionEvidence?.kind==='new-arrivals-navigation'&&sectionEvidence.targetUrl===url&&isOfficialProductUrl(brand,sectionEvidence.url)&&!!sectionEvidence.contentHash;
  for(let i=0;i<links.length;i++){
    const link=links[i],key=canonicalUrl(link.url),previous=links[i-1],next=links.slice(i+1).find(l=>canonicalUrl(l.url)!==key);
    // A badge belongs only to the immediately following card, never an entire category.
    const before=text.slice(previous?.end||0,link.start).slice(-160);
    const badge=/(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?(?:new|new in|new arrival|new season|신상품|신제품|新作)(?:\*\*)?\s*(?:\n|$)/i.test(before)||/^\s*(?:\*\*)?(?:new(?: in| arrival)?|신상품|新作)(?:\*\*)?[\s\\]*(?:\n|!\[)/i.test(link.label);
    if(!isNew&&!badge&&!rows.has(key))continue;
    const labelText=clean(link.label).replace(/\b(?:Next slide|Previous slide|App Access)\s*/gi,'').trim();
    let name=link.label.match(/\*\*([^*]+)\*\*/)?.[1]||labelText.split(/(?:\$|€|£|₩)\s*[\d,.]/)[0]||imageUrls(link.label)[0]?.alt;
    name=clean(name).replace(/\s+E\d{2}$/,'');
    if(!/[\p{L}\p{N}]/u.test(name))name=clean(imageUrls(link.label)[0]?.alt||'');
    name=name.replace(/^\d+ Colors?,\s*/i,'').replace(/^(?:Shop the look|Main product image of)\s*/i,'').replace(/,\s*Price,?\s*$/i,'').replace(/\s+\d[\d,.]*\s+USD\s+.*$/i,'').replace(/(?:\s+-)+\s*$/,'');
    name=name.replace(/\s+-\s+Slide\s+\d+/gi,'').trim();
    const imageDerivedName=/^new(?: in)?$/i.test(name);
    if(imageDerivedName)name=clean(imageUrls(link.label)[0]?.alt||'').replace(new RegExp('^'+brand+'\\s+','i'),'');
    if(!name||/^(?:shop now|quick view|discover|view product|add to bag|new|coming soon|\+?\d+)$/i.test(name))continue;
    const block=text.slice(link.start,next?.start||link.end+1600);
    const images=imageUrls(link.label).concat(imageUrls(block));
    const row=rows.get(key)||{brand,name,url:link.url,images:[],linkedImages:[],cardDescription:clean(link.label),arrivalEvidence:{verified:true,brand,productUrl:link.url,kind:isNew?'new-arrivals-listing':'new-badge',url,verifiedAt:checkedAt,excerpt:(isNew?'Official New / New Arrivals listing: ':'Official product New badge: ')+name,contentHash:sourceHash}};
    if(labelText&&/sneaker|trainer|shoe/i.test(name))row.name=name;
    if(imageDerivedName)row.needsProductTitle=true;
    if(labelText.length>row.cardDescription.length)row.cardDescription=labelText;
    row.images=[...new Map([...row.images,...images].map(image=>[image.url,image])).values()];
    row.linkedImages=[...new Map([...row.linkedImages,...imageUrls(link.label)].map(image=>[image.url,image])).values()];rows.set(key,row);
  }
  return [...rows.values()].filter(p=>classifyFootwear({...p,description:'',officialCategory:''}).reason!=='excluded-footwear');
}
export function listingFollowups(text,url,brand,sectionEvidence){
  const parentNew=isNewListing(url,text)||sectionEvidence?.kind==='new-arrivals-navigation';
  const footwearFilter=l=>parentNew&&/sneakers?|shoes?|footwear/i.test(clean(l.label))&&new URL(l.url).searchParams.has('cgid');
  const links=markdownLinks(text),result=links.filter(l=>!l.image&&isOfficialProductUrl(brand,l.url)&&!isProductLink(l.url)&&canonicalUrl(l.url)!==canonicalUrl(url))
    .filter(l=>footwearFilter(l)||isNewListing(l.url)&&!/[?&](?:prefn|filter\.|srule=)/i.test(l.url)||/^(?:new|new arrivals?|new in(?: shoes)?|신상품|新作)$/i.test(clean(l.label))||/^(?:next|next page|load more|view more|다음|더 보기|次へ|\d+)$/i.test(clean(l.label))&&new URL(l.url).origin===new URL(url).origin)
    .map(l=>({url:l.url,name:clean(l.label)||'Official listing continuation',...(footwearFilter(l)||/^(?:new|new arrivals?|new in(?: shoes)?|신상품|新作)$/i.test(clean(l.label))?{sectionEvidence:{kind:'new-arrivals-navigation',url,targetUrl:l.url,contentHash:digest(text)}}:{})})).sort((a,b)=>Number(/sneaker|shoes|footwear/i.test(b.name))-Number(/sneaker|shoes|footwear/i.test(a.name)));
  const count=Number(text.match(/\b([\d,]+)\s+(?:products|items)\b/i)?.[1]?.replaceAll(',',''));
  const ajax=links.find(l=>isNewListing(l.url)&&/\/searchajax\?/.test(l.url)&&new URL(l.url).searchParams.has('start'));
  if(count&&ajax){const next=new URL(ajax.url),size=Number(next.searchParams.get('sz'));const offset=Number(new URL(url).searchParams.get('start')||0)+size;if(size>0&&offset<count&&offset<2000){next.searchParams.set('start',String(offset));result.push({url:next.href,name:'Official New Arrivals next product page'});}}
  return result;
}
export function listingProduct(candidate,checkedAt){
  if(candidate.needsProductTitle)return null;
  const chosen=candidate.linkedImages?.find(i=>/_SLS\.|_PM1_Side|_nb_02_i|_SBG_E02|_A\.(?:jpg|png)/i.test(i.url))||candidate.linkedImages?.[0];
  if(!chosen)return null;
  const last=new URL(candidate.url).pathname.split('/').filter(Boolean).pop().replace(/\.html$/i,'');
  const code=/^[A-Z0-9][A-Z0-9_.-]{4,}$/.test(last)?last:last.match(/(?:-p-|[-_])([A-Z0-9_]{7,})$/)?.[1]||'';
  let sku=['Prada','Miu Miu','Dior','Louis Vuitton','Gucci','ASICS'].includes(candidate.brand)?code.replace(/^ANA_/,''):'';
  if(candidate.brand==='New Balance')sku=[...new URL(candidate.url).searchParams].find(([k])=>/_style$/.test(k))?.[1]||'';
  const style=sku||last,method='official-new-listing-sku-image';
  const p={id:`arrival-${digest(candidate.brand+'|'+canonicalUrl(candidate.url)).slice(0,20)}`,brand:candidate.brand,name:candidate.name,style,...(!sku?{styleType:'official-product-id'}:{}),url:candidate.url,image:chosen.url,
    description:candidate.cardDescription,colorway:colorLabel(chosen.alt,candidate.brand),colors:[],priceLabel:candidate.cardDescription?.match(/(?:\$|€|£|₩)\s?[\d,.]+/)?.[0]||'',
    country:region(candidate.url),firstSeen:checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:candidate.arrivalEvidence.url,
    arrivalEvidence:{...candidate.arrivalEvidence,style},sourceSignals:[],imageCandidates:candidate.linkedImages};
  const base={verified:true,brand:p.brand,style,verifiedAt:checkedAt,verificationMethod:method,contentHash:p.arrivalEvidence.contentHash,...(!sku?{identifierType:'official-product-id'}:{})};
  p.officialProductEvidence={...base,url:p.url};p.officialImageEvidence={...base,url:p.image,sourceUrl:p.arrivalEvidence.url};
  const hybrid=officialHybridReview(p,p.name+' '+p.description,checkedAt);if(hybrid)p.hybridReview=hybrid;
  const labeled=officialVariantLabels(p,candidate);
  return classifyFootwear(labeled).category?labeled:null;
}
// Use only the exact official product's card, URL or title to repair navigation
// labels accidentally parsed as a color. Never borrow a neighbouring swatch.
export function officialVariantLabels(product,candidate){
  const p={...product},last=new URL(p.url).pathname.split('/').filter(Boolean).pop().replace(/\.html$/i,'');
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
function pageProduct(candidate,text,checkedAt,existing){
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
  const code=body.match(/(?:^|\n)[\s*-]*(?:product (?:code|id)|style (?:code|no\.?|number|#)|sku|reference|品番|제품 코드|상품코드)\s*:?\s*([A-Z0-9][A-Z0-9_.-]{3,70})/i)?.[1];
  const last=new URL(url).pathname.split('/').filter(Boolean).pop().replace(/\.html$/i,'');
  const fromUrl=/^[A-Z0-9][A-Z0-9_.-]{4,}$/.test(last)?last:last.match(/(?:-p-|[-_])([A-Z0-9_]{7,})$/)?.[1]||'';
  const variant=candidate.brand==='New Balance'?[...new URL(url).searchParams].find(([k])=>/_style$/.test(k))?.[1]:'';
  const verifiedVariant=variant&&body.toLowerCase().includes(variant.toLowerCase())?variant:'';
  const style=verifiedVariant||code||fromUrl||last;
  const styleType=verifiedVariant||code||fromUrl?undefined:'official-product-id';
  // LV's colour picker includes other variants' large photographs after the
  // heading. Only its current variant gallery before H1 is identity evidence.
  const gallery=candidate.brand==='Louis Vuitton'?body.slice(0,body.indexOf('# '+heading)):body;
  const lvSlug=candidate.brand==='Louis Vuitton'&&gallery.includes(style)?new URL(url).pathname.match(/\/products\/(.+)-nvprod/)?.[1]:'';
  const cbStyle=candidate.brand==='Cecilie Bahnsen'?last.match(/^\d-\d{2}ftw\d+/i)?.[0]?.replace(/[^a-z0-9]/gi,'').toLowerCase():'';
  const images=imageUrls(gallery),own=images.filter(i=>candidate.images.some(c=>canonicalUrl(c.url)===canonicalUrl(i.url))||i.url.toLowerCase().includes(style.replace(/_/g,'').toLowerCase())||i.url.toLowerCase().includes(style.toLowerCase())||lvSlug&&i.url.includes('louis-vuitton-'+lvSlug+'--')||cbStyle&&i.url.toLowerCase().replace(/[^a-z0-9]/g,'').includes(cbStyle)||tokens.filter(t=>i.alt.toLowerCase().includes(t)).length>=Math.min(2,tokens.length));
  const chosen=(candidate.brand==='Moncler'?own.find(i=>i.url.includes('/'+style+'_1/image/')):null)||own.find(i=>/_SLS\.|_PM1_Side|_Side\.|_nb_02_i|_SBG_E02|_A\.(?:jpg|png)/i.test(i.url))||own.find(i=>/_SLR\.|_PM2_/i.test(i.url))||own[0];
  if(!chosen)return null;
  const detail=body.slice(body.indexOf('# '+heading)).split(/\n#{1,4}\s*(?:Contact us|Shipping|Delivery|Free shipping|SUBSCRIBE)/i)[0];
  const description=detail.split('\n').filter(l=>!l.includes('https://')&&l.trim().length>30).join(' ').slice(0,6000);
  const p={id:existing?.id||`arrival-${digest(candidate.brand+'|'+canonicalUrl(url)).slice(0,20)}`,brand:candidate.brand,name:clean(heading),url,image:chosen.url,style,...(styleType?{styleType}:{}),description,
    colorway:body.match(/(?:^|\n)\s*[-*]?\s*#{0,3}\s*(?:Colors?|Colours?|색상)\s*:?\s*([^\n]{2,90})/i)?.[1]?.trim()||colorLabel(chosen.alt,candidate.brand),colors:[],
    priceLabel:body.match(/(?:\$|€|£|₩)\s?[\d,.]+/)?.[0]||'',country:region(url),gender:/\/women|\/womens|shop-women/i.test(url)?'Women':/\/men|\/mens|shop-men/i.test(url)?'Men':'',
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
export async function collectNewArrivals({read,readDetails,sources,brands,existing=[],now=new Date(),maxPagesPerBrand=16,log=console.log}={}){
  const checkedAt=new Date(now).toISOString(),products=[],coverage=[],work=[];
  let discoveryCursor=0;
  async function discoverBrands(){while(discoveryCursor<brands.length){const brand=brands[discoveryCursor++];
    const configured=sources[brand]||[],queue=[...configured].sort((a,b)=>Number(isNewListing(b.url))-Number(isNewListing(a.url))),seen=new Set(),candidates=new Map();
    const status={brand,attempts:0,responses:0,listingPages:0,candidates:0,verified:0,errors:[],checkedAt,exhaustive:false};
    while(queue.length&&seen.size<maxPagesPerBrand){
      const source=queue.shift(),key=canonicalUrl(source.url);if(seen.has(key)||!isOfficialProductUrl(brand,source.url))continue;seen.add(key);status.attempts++;
      try{
        const text=assertReadableOfficial(await read(`https://r.jina.ai/${source.url}`));status.responses++;
        const rows=parseArrivalListing(text,{brand,url:source.url,checkedAt,sectionEvidence:source.sectionEvidence});if(isNewListing(source.url,text)||rows.length)status.listingPages++;
        for(const p of rows)candidates.set(canonicalUrl(p.url),p);
        const followups=listingFollowups(text,source.url,brand,source.sectionEvidence);
        for(const next of followups)if(!seen.has(canonicalUrl(next.url))&&!queue.some(q=>canonicalUrl(q.url)===canonicalUrl(next.url)))queue.push(next);
      }catch(e){status.errors.push({url:source.url,error:e.message});}
    }
    status.truncated=queue.some(s=>!seen.has(canonicalUrl(s.url)));status.candidates=candidates.size;
    work.push({brand,status,candidates});coverage.push(status);
    log(`${brand}: listing discovery checked (${status.responses}/${status.attempts} responses).`);
  }}
  await Promise.all(Array.from({length:4},()=>discoverBrands()));
  // Discover every brand before slower PDP checks; one large luxury assortment
  // must not prevent the remaining mandatory brands from being attempted.
  let cursor=0;
  async function verifyBrands(){while(cursor<work.length){
    const {brand,status,candidates}=work[cursor++];
    for(const candidate of candidates.values()){
      const old=existing.find(p=>p.brand===brand&&canonicalUrl(p.url)===canonicalUrl(candidate.url));
      // Avoid product requests for clearly unrelated clothing and ordinary dress shoes.
      const footwearHint=/sneaker|sneakerina|trainers?|running|shoes?|ballet|mary.jane|mule|jelly|platform|スニーカー|슈즈|스니커|运动鞋|運動鞋/i.test(candidate.name+' '+candidate.cardDescription+' '+new URL(candidate.url).pathname);
      if(!footwearHint&&(!candidate.linkedImages.length||/\b(?:shirts?|jackets?|coats?|bags?|wallets?|belts?|trousers|pants|shorts|socks|caps?|hats?|dresses?|sunglasses|eyewear|jewell?ery|earrings?|necklaces?|bracelets?|scarves|sweaters?|hoodies?|t-shirts?|tops?|leggings?|bras?|skorts?)\b|재킷|자켓|팬츠|가방|티셔츠|양말|모자/i.test(candidate.name)))continue;
      try{
        const retained=old&&old.officialProductEvidence?.verificationMethod!=='official-new-listing-sku-image'&&officialEvidenceFor(old,kstDay(now));
        const listed=retained?null:listingProduct(candidate,checkedAt);
        const text=retained||listed?'':assertReadableOfficial(await read(`https://r.jina.ai/${candidate.url}`));
        let p=listed?{...listed,...(old?{id:old.id}:{}),...(!listed.colorway&&old?.colorway&&old?.officialProductEvidence?.verificationMethod!=='official-new-listing-sku-image'?{colorway:old.colorway,colors:old.colors}:{} )}:pageProduct(candidate,text,checkedAt,retained?old:null);
        if(!p&&readDetails)p=pageProduct(candidate,assertReadableOfficial(await readDetails(candidate.url)),checkedAt,null);
        if(!p){status.errors.push({url:candidate.url,error:'product-identity-image-unverified'});continue;}
        p=officialVariantLabels(p,candidate);
        if(classifyFootwear(p).reason==='excluded-footwear')continue;
        products.push(p);status.verified++;
      }catch(e){status.errors.push({url:candidate.url,error:e.message});}
    }
    // Dynamic pagination may hide additional items: never equate a response with completeness.
    status.status=!status.responses?'unavailable':!status.listingPages?'new-section-unconfirmed':status.errors.length||status.truncated?'partial':'checked';
    log(`${brand}: ${status.listingPages} New listing pages, ${status.candidates} candidates, ${status.verified} product proofs, ${status.errors.length} unresolved checks`);
  }}
  await Promise.all(Array.from({length:3},()=>verifyBrands()));
  return {products,coverage,checkedAt};
}
