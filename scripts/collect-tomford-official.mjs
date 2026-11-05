import {createHash} from 'node:crypto';
import {pacedOfficialFetch} from './official-reader.mjs';

const ORIGIN='https://www.tomfordfashion.com', BRAND='TOM FORD';
export const TOMFORD_OFFICIAL_SOURCES=Object.freeze([
  `${ORIGIN}/en-us/men/shoes/sneakers/`,
  `${ORIGIN}/en-us/women/shoes/sneakers/`,
]);
const digest=s=>createHash('sha256').update(s).digest('hex');
const decode=s=>String(s??'').replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi,x=>{
  const names={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};
  return names[x.toLowerCase()]??String.fromCodePoint(parseInt(x.slice(x[2]?.toLowerCase()==='x'?3:2,-1),x[2]?.toLowerCase()==='x'?16:10));
});
function tree(html){
  if(typeof html!=='string'||/<title[^>]*>\s*(?:Access Denied|Just a moment|Not Found)|verify (?:that )?you are human/i.test(html))throw Error('TOMFORD_UNREADABLE_HTML');
  const root={tag:'root',a:{},children:[]},stack=[root];
  for(const [token] of html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)){
    if(!token.startsWith('<')){stack.at(-1).children.push(decode(token));continue;}
    const tag=token.match(/^<\/?([\w-]+)/)[1].toLowerCase();
    if(token.startsWith('</')){const i=stack.findLastIndex(n=>n.tag===tag);if(i>0)stack.length=i;continue;}
    const a={};for(const [,key,dq,sq,bare] of token.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))a[key.toLowerCase()]=decode(dq??sq??bare);
    const node={tag,a,children:[]};stack.at(-1).children.push(node);
    if(!/^(img|input|br|hr|meta|link|source|area|base|embed|wbr)$/.test(tag)&&!token.endsWith('/>'))stack.push(node);
  }return root;
}
const find=(n,p)=>n.children.filter(x=>typeof x!=='string').flatMap(x=>[...(p(x)?[x]:[]),...find(x,p)]);
const cls=(n,c)=>(n.a.class||'').split(/\s+/).includes(c);
const text=n=>n?n.children.map(x=>typeof x==='string'?x:text(x)).join(' ').replace(/\s+/g,' ').trim():'';
function official(value,base=ORIGIN){const u=new URL(decode(value),base);if(u.origin!==ORIGIN||u.username||u.password)throw Error('TOMFORD_UNOFFICIAL_URL');return u;}
function scope(value){
  const u=official(value), canonical=TOMFORD_OFFICIAL_SOURCES.find(s=>new URL(s).pathname===u.pathname);
  if(canonical&&u.search==='')return {sourceUrl:canonical,category:canonical.includes('/women/')?'women-shoes-sneakers':'men-shoes-sneakers',gender:canonical.includes('/women/')?'Women':'Men',start:0};
  const category=u.searchParams.get('cgid'),index=['men-shoes-sneakers','women-shoes-sneakers'].indexOf(category);
  if(index<0||u.pathname!=='/on/demandware.store/Sites-tomford-Site/en_US/Search-UpdateGrid'||[...u.searchParams.keys()].some(k=>!['cgid','start','sz','srule'].includes(k))||[...new Set(u.searchParams.keys())].some(k=>u.searchParams.getAll(k).length!==1)||u.searchParams.has('srule')&&u.searchParams.get('srule')!=='defaultsortingrule')throw Error('TOMFORD_SNEAKER_SOURCE_REQUIRED');
  const start=Number(u.searchParams.get('start')),size=Number(u.searchParams.get('sz'));
  if(!u.searchParams.has('start')||!u.searchParams.has('sz')||!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(size)||size<1||size>200)throw Error('TOMFORD_INVALID_CURSOR');
  return {sourceUrl:TOMFORD_OFFICIAL_SOURCES[index],category,gender:index?'Women':'Men',start,size};
}
function productIdentity(value){
  const u=official(value),m=u.pathname.match(/^\/en-us\/[^/]+\/([A-Z0-9]+(?:-[A-Z0-9]+)+)\.html$/i);
  if(!m||u.search)throw Error('TOMFORD_PRODUCT_URL_REQUIRED');u.hash='';return {url:u.href,productId:m[1]};
}
function imageUrl(value){
  if(!value)throw Error('TOMFORD_PRIMARY_IMAGE_ABSENT');
  const u=new URL(value);
  if(u.protocol!=='https:'||u.hostname!=='cdn.media.amplience.net'||!u.pathname.startsWith('/i/tom_ford/')||u.username||u.password)throw Error('TOMFORD_UNOFFICIAL_IMAGE');
  return u.href;
}

/** Records only the primary photograph actually assigned to a bounded tile.
 * Hover images sometimes have a different color code, so they are never used.
 * data-pid is an official product ID, not an inferred manufacturer SKU. */
export function parseTomFordOfficialPage(html,url,{at=new Date().toISOString()}={}){
  const identity=scope(url),root=tree(html),grid=find(root,n=>cls(n,'product-grid'))[0]||root;
  const footers=find(grid,n=>cls(n,'grid-footer'));
  if(footers.length!==1)throw Error('TOMFORD_GRID_FOOTER_REQUIRED');
  const footer=footers[0];
  // Rendered cache strips hidden inputs; the original footer sort configuration
  // still identifies the same category without relying on page furniture.
  const hiddenCategory=find(footer,n=>n.tag==='input'&&cls(n,'category-id'))[0]?.a.value;
  let configuredCategory;
  if(footer.a['data-sort-options']){
    const settings=JSON.parse(footer.a['data-sort-options']);
    const recommended=settings.options?.find(o=>o.id==='Recommended');
    if(recommended)configuredCategory=scope(recommended.url).category;
  }
  if(hiddenCategory&&configuredCategory&&hiddenCategory!==configuredCategory)throw Error('TOMFORD_GRID_SCOPE_MISMATCH');
  const category=hiddenCategory||configuredCategory;
  const pageNumber=Number(footer.a['data-page-number']),pageSize=Number(footer.a['data-page-size']);
  if(category!==identity.category||!Number.isSafeInteger(pageNumber)||!Number.isSafeInteger(pageSize)||pageSize<1||pageNumber*pageSize!==identity.start)throw Error('TOMFORD_GRID_SCOPE_MISMATCH');
  const countNode=find(root,n=>cls(n,'search-result-count'))[0];
  const total=countNode?Number(text(countNode).match(/^([\d,]+)\s+results?\b/i)?.[1]?.replaceAll(',','')):undefined;
  if(countNode&&(!Number.isSafeInteger(total)||total<0))throw Error('TOMFORD_INVALID_TOTAL');
  const cards=find(grid,n=>cls(n,'product')&&n.a['data-pid']),products=[],excluded=[],ids=[];
  for(const card of cards){
    const pid=card.a['data-pid'],nameLink=find(card,n=>cls(n,'pdp-link'))[0];
    const a=nameLink&&find(nameLink,n=>n.tag==='a'&&n.a.href)[0];
    if(!a)throw Error('TOMFORD_TILE_NAME_ABSENT');
    const id=productIdentity(official(a.a.href,url).href),name=text(a);
    if(id.productId!==pid||!name)throw Error('TOMFORD_TILE_IDENTITY_MISMATCH');
    const imageLinks=find(card,n=>n.tag==='a'&&cls(n,'tile-image-container'));
    const own=imageLinks.filter(n=>{try{return productIdentity(official(n.a.href,url).href).productId===pid;}catch{return false;}});
    const primary=own.flatMap(n=>find(n,x=>x.tag==='img'&&cls(x,'tile-image-primary')));
    if(primary.length!==1)throw Error('TOMFORD_PRIMARY_IMAGE_ABSENT');
    const image=imageUrl(primary[0].a['data-src']||primary[0].a.src);
    const hash=digest(html),proof={verified:true,brand:BRAND,style:pid,identifierType:'official-product-id',verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:hash};
    const row={id:`tomford-${pid}`,brand:BRAND,name,style:pid,styleType:'official-product-id',productId:pid,productVariantId:pid,url:id.url,
      image,images:[image],gallery:[image],colors:[],gender:identity.gender,officialCategory:'Sneakers',country:'US',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:url,
      officialProductEvidence:{...proof,url:id.url},officialImageEvidence:{...proof,url:image,sourceUrl:url,binding:'product[data-pid] > tile-image-container > tile-image-primary'},
      arrivalEvidence:{...proof,kind:'official-assortment-listing',url,productUrl:id.url,excerpt:`Official ${identity.gender} sneaker category card: ${name}; data-pid=${pid}`},
      scopeEvidence:{kind:'official-sneaker-assortment',url:identity.sourceUrl,pageUrl:url,category,contentHash:hash}};
    ids.push(pid);
    if(!/\b(?:sneakers?|trainers?)\b/i.test(name)||/\b(?:boots?|pumps?|sandals?|loafers?|heels?)\b/i.test(name))excluded.push({...row,reason:'non-sneaker-or-ambiguous-footwear'});else products.push(row);
  }
  if(new Set(ids).size!==ids.length)throw Error('TOMFORD_DUPLICATE_TILE');
  const nextNodes=find(footer,n=>n.tag==='button'&&cls(n,'more'));
  if(nextNodes.length>1)throw Error('TOMFORD_MULTIPLE_CURSORS');
  let next=null;
  if(nextNodes.length){
    if(!nextNodes[0].a['data-url'])throw Error('TOMFORD_CURSOR_ABSENT');
    next=official(nextNodes[0].a['data-url'],url).href;const target=scope(next);
    if(target.category!==category||target.start!==identity.start+cards.length||target.start<=identity.start||target.size!==pageSize)throw Error('TOMFORD_CURSOR_MISMATCH');
  }
  return {...identity,url,total,ids,products,excluded,next,terminal:!next,pageNumber,pageSize,contentHash:digest(html)};
}

async function htmlFrom(value,url){
  if(typeof value==='string')return value;
  const data=value?.data||value;
  const status=data?.status??data?.metadata?.statusCode;
  if(status!==undefined&&Number(status)!==200)throw Error(`TOMFORD_HTTP_${status}`);
  const final=data?.url||data?.metadata?.url||data?.metadata?.sourceURL;
  if(final&&official(final).href!==official(url).href)throw Error('TOMFORD_REDIRECTED_SOURCE');
  const html=data?.rawHtml||data?.html||data?.body;
  if(typeof html!=='string')throw Error('TOMFORD_HTML_REQUIRED');return html;
}

/** readHtml(url) accepts HTML or {rawHtml|html|body,metadata?}. Cache adapters may
 * supply their original checkedAt through now. Store checkpoint from result or
 * onProgress; resume never refetches accepted pages. This function writes nothing.
 * exhausted means both category totals reconcile AND both explicit footers end. */
export async function collectTomFordOfficial({readHtml,now=new Date(),resume,maxPages=40,maxDurationMs=480000,onProgress=async()=>{}}={}){
  if(!Number.isSafeInteger(maxPages)||maxPages<0||!Number.isFinite(maxDurationMs)||maxDurationMs<0)throw Error('TOMFORD_INVALID_LIMIT');
  if(resume&&(resume.version!==1||resume.brand!==BRAND))throw Error('TOMFORD_INVALID_CHECKPOINT');
  const checkedAt=resume?.checkedAt||new Date(now).toISOString(),start=Date.now();
  const state=resume?structuredClone(resume):{version:1,brand:BRAND,checkedAt,pending:[...TOMFORD_OFFICIAL_SOURCES],pages:[],products:[],excluded:[]};
  const errors=[];let reads=0;
  const get=pacedOfficialFetch();readHtml??=async url=>{const r=await get(url,{redirect:'error',headers:{Accept:'text/html'}});return {body:await r.text(),url:r.url,status:r.status};};
  const save=()=>onProgress({brand:BRAND,checkedAt,reads,checkpoint:structuredClone(state)});
  while(state.pending.length&&reads<maxPages&&Date.now()-start<maxDurationMs){
    const url=state.pending[0];reads++;
    let page;
    try{
      scope(url);page=parseTomFordOfficialPage(await htmlFrom(await readHtml(url),url),url,{at:checkedAt});
      const prior=state.pages.filter(p=>p.sourceUrl===page.sourceUrl),expected=prior[0]?.total??page.total;
      if(expected===undefined)throw Error('TOMFORD_TOTAL_REQUIRED');
      if(page.total!==undefined&&page.total!==expected)throw Error('TOMFORD_TOTAL_CHANGED');
      if(page.start!==prior.reduce((n,p)=>n+p.ids.length,0))throw Error('TOMFORD_CURSOR_GAP');
      const seen=new Set(prior.flatMap(p=>p.ids));
      if(page.ids.some(id=>seen.has(id)))throw Error('TOMFORD_REPEATED_PAGE');
      const count=seen.size+page.ids.length;
      if(count>expected||page.terminal&&count!==expected||!page.ids.length&&expected>0||page.next&&count>=expected)throw Error('TOMFORD_TOTAL_MISMATCH');
      if(page.next&&state.pages.some(p=>p.url===page.next))throw Error('TOMFORD_REPEATED_CURSOR');
      page.total=expected;
    }catch(e){errors.push({url,error:e.message});break;}
    state.products.push(...page.products);state.excluded.push(...page.excluded);
    const {products,excluded,...summary}=page;state.pages.push(summary);
    state.pending=state.pending.slice(1);if(page.next)state.pending.unshift(page.next);
    await save();
  }
  const coverage=TOMFORD_OFFICIAL_SOURCES.map(sourceUrl=>{
    const pages=state.pages.filter(p=>p.sourceUrl===sourceUrl),total=pages[0]?.total,cards=new Set(pages.flatMap(p=>p.ids)).size;
    return {sourceUrl,gender:sourceUrl.includes('/women/')?'Women':'Men',total,cards,pages:pages.length,exhausted:total!==undefined&&cards===total&&pages.at(-1)?.terminal===true};
  });
  const exhausted=!state.pending.length&&!errors.length&&coverage.every(c=>c.exhausted);
  await save();
  return {brand:BRAND,checkedAt,products:state.products,excluded:state.excluded,pages:state.pages,coverage,errors,exhausted,truncated:!exhausted,pending:[...state.pending],checkpoint:structuredClone(state),scope:'Official men and women sneaker category color cards; primary tile photographs only.'};
}
