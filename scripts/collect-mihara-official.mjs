import {createHash} from 'node:crypto';
import {pacedOfficialFetch} from './official-reader.mjs';

export const MIHARA_OFFICIAL_SOURCES = Object.freeze([
  'https://en.miharayasuhiro.jp/products/list.php?category_id=27&sex_id=1',
  'https://en.miharayasuhiro.jp/products/list.php?category_id=27&sex_id=2',
]);
const BRAND = 'Maison Mihara Yasuhiro', ORIGIN = 'https://en.miharayasuhiro.jp';
const hash = html => createHash('sha256').update(html).digest('hex');
const decode = s => String(s ?? '').replace(/&(?:amp|quot|apos|lt|gt|nbsp|raquo);|&#(?:x[\da-f]+|\d+);/gi, x => {
  const named = {'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ','&raquo;':'»'};
  return named[x.toLowerCase()] ?? String.fromCodePoint(parseInt(x.slice(x[2]?.toLowerCase() === 'x' ? 3 : 2, -1), x[2]?.toLowerCase() === 'x' ? 16 : 10));
});
// Small structural reader: nested list items must not terminate a product card.
// Scripts, comments and styles cannot contribute product links or evidence.
function dom(html) {
  if (typeof html !== 'string' || /<title[^>]*>\s*(?:Access Denied|Just a moment|Not Found)|verify (?:that )?you are human/i.test(html)) throw Error('MIHARA_UNREADABLE_HTML');
  const root = {tag:'root', a:{}, children:[]}, stack = [root];
  for (const m of html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
    const token = m[0];
    if (!token.startsWith('<')) { stack.at(-1).children.push(decode(token)); continue; }
    const tag = token.match(/^<\/?([\w-]+)/)[1].toLowerCase();
    if (token.startsWith('</')) { const i = stack.findLastIndex(n => n.tag === tag); if (i > 0) stack.length = i; continue; }
    const a = {};
    for (const [,key,dq,sq,bare] of token.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[key.toLowerCase()] = decode(dq ?? sq ?? bare);
    const node = {tag,a,children:[]}; stack.at(-1).children.push(node);
    if (!/^(?:img|input|br|hr|meta|link|source|area|base|embed|wbr)$/.test(tag) && !token.endsWith('/>')) stack.push(node);
  }
  return root;
}
const nodes = (n, predicate) => n.children.filter(x => typeof x !== 'string').flatMap(x => [...(predicate(x) ? [x] : []), ...nodes(x,predicate)]);
const byId = (n,id) => nodes(n,x=>x.a.id===id)[0];
const cls = (n,c) => (n.a.class || '').split(/\s+/).includes(c);
const text = n => n ? n.children.map(x=>typeof x==='string'?x:text(x)).join(' ').replace(/\s+/g,' ').trim() : '';
function officialUrl(value, base=ORIGIN) {
  const u = new URL(decode(value),base);
  if (u.origin !== ORIGIN || u.username || u.password) throw Error('MIHARA_UNOFFICIAL_URL');
  return u;
}
export function miharaProductIdentity(value) {
  const u = officialUrl(value);
  if (u.pathname !== '/products/detail.php' || !/^\d+$/.test(u.searchParams.get('product_id') || '') || !/^\d+$/.test(u.searchParams.get('c') || '') || u.searchParams.getAll('product_id').length!==1 || u.searchParams.getAll('c').length!==1) throw Error('MIHARA_PRODUCT_COLOR_ID_REQUIRED');
  const productId=u.searchParams.get('product_id'), colourId=u.searchParams.get('c');
  return {productId,colourId,style:`${productId}:${colourId}`,url:`${ORIGIN}/products/detail.php?product_id=${productId}&c=${colourId}`};
}
function listingIdentity(value) {
  const u=officialUrl(value);
  if(u.pathname!=='/products/list.php'||u.searchParams.get('category_id')!=='27'||!['1','2'].includes(u.searchParams.get('sex_id'))||[...u.searchParams.keys()].some(k=>!['category_id','sex_id','disp_number','pageno'].includes(k))||[...new Set(u.searchParams.keys())].some(k=>u.searchParams.getAll(k).length!==1)) throw Error('MIHARA_SNEAKER_LIST_REQUIRED');
  const page=Number(u.searchParams.get('pageno')||1);
  if(!Number.isSafeInteger(page)||page<1)throw Error('MIHARA_INVALID_PAGE');
  const sourceUrl=MIHARA_OFFICIAL_SOURCES[Number(u.searchParams.get('sex_id'))-1];
  return {sourceUrl,page,gender:u.searchParams.get('sex_id')==='1'?'Men':'Women',url:sourceUrl+(page===1?'':`&disp_number=40&pageno=${page}`)};
}
function images(node) {
  return [...new Set(nodes(node,x=>x.tag==='img').map(x=>x.a['data-src']||x.a.src).filter(Boolean).filter(value=>{
    try { const u=new URL(value); return u.protocol==='https:'&&u.hostname==='img.miharayasuhiro.jp'&&!u.username&&!u.password&&/\/product\/[^/]+\/[^/]+\.(?:jpe?g|png|webp)$/i.test(u.pathname); } catch {return false;}
  }))];
}

export function parseMiharaOfficialListing(html,url) {
  const identity=listingIdentity(url), root=dom(html), main=byId(root,'top_item_list');
  const list=main&&nodes(main,x=>x.tag==='ul'&&cls(x,'item_list_default'))[0];
  if(!list)throw Error('MIHARA_MAIN_PRODUCT_LIST_ABSENT');
  const total=Number(text(main).match(/\b([\d,]+)\s+items\b/i)?.[1]?.replaceAll(',',''));
  if(!Number.isSafeInteger(total)||total<0)throw Error('MIHARA_TOTAL_ABSENT');
  const cards=nodes(list,x=>x.tag==='li'&&cls(x,'product_item')), products=[], cardIds=[];
  for(const card of cards) {
    const name=text(nodes(card,x=>cls(x,'list_name'))[0]);
    const variants=new Map();
    for(const a of nodes(card,x=>x.tag==='a'&&/\/products\/detail\.php\?/.test(x.a.href||''))) {
      const own=images(a);
      if(!own.length)continue;
      let id;
      try {id=miharaProductIdentity(officialUrl(a.a.href,url).href);}catch(e){throw Error(`${e.message}: ${name}; ${a.a.href}`);}
      variants.set(id.style,{...id,name,image:own[0],sourceUrl:identity.url,gender:identity.gender,contentHash:hash(html)});
    }
    const ids=new Set([...variants.values()].map(x=>x.productId));
    if(!name||!variants.size||ids.size!==1)throw Error('MIHARA_UNBOUND_LIST_CARD');
    cardIds.push([...ids][0]); products.push(...variants.values());
  }
  const pages=new Map();
  for(const a of nodes(root,x=>x.tag==='a'&&x.a.href)) {
    try {const next=listingIdentity(officialUrl(a.a.href,url).href); if(next.sourceUrl===identity.sourceUrl&&next.page!==identity.page)pages.set(next.page,next.url);}catch{/* navigation outside this shelf */}
  }
  return {...identity,total,cards:cards.length,cardIds,products,pages:[...pages.values()],contentHash:hash(html)};
}

/** Select only #c{colourId} inside the PDP slider, never adjacent or unassigned
 * slides. colourIds discovers further public PDPs; collection reads each URL. */
export function parseMiharaOfficialProduct(html,url,{at=new Date().toISOString(),sourceUrl=url,genders=[],listingSources=[],listingEvidence}={}) {
  const id=miharaProductIdentity(url), root=dom(html), spec=byId(root,'item_spec'), colors=byId(spec||root,'color_block');
  const name=text(byId(spec||root,'item_spec_tit')), maker=text(byId(spec||root,'item_spec_maker'));
  const input=nodes(root,x=>x.tag==='input'&&x.a.name==='product_id')[0];
  // Rendered pages may omit hidden form inputs. Self-links still bind the PID.
  const self=nodes(root,x=>x.tag==='a'&&x.a.href).some(x=>{try{return miharaProductIdentity(officialUrl(x.a.href,sourceUrl).href).productId===id.productId;}catch{return false;}});
  if(!spec||!name||!maker||(input?input.a.value!==id.productId:!self))throw Error('MIHARA_PDP_IDENTITY_MISMATCH');
  const colorNodes=nodes(colors||{children:[]},x=>x.tag==='li'&&/^color_\d+$/.test(x.a.id||''));
  const colourIds=colorNodes.map(x=>x.a.id.slice(6));
  if(!colourIds.length||new Set(colourIds).size!==colourIds.length)throw Error('MIHARA_COLOR_INVENTORY_ABSENT');
  const selected=colorNodes.find(x=>x.a.id===`color_${id.colourId}`), slider=byId(root,'item_photo_slider');
  const own=slider?nodes(slider,x=>x.a.id===`c${id.colourId}`).flatMap(images):[];
  const gallery=[...new Set(own)];
  if(!selected||!gallery.length)throw Error('MIHARA_SELECTED_COLOR_GALLERY_ABSENT');
  const colorway=selected.a['data-colorname']||text(nodes(selected,x=>x.tag==='p')[0]);
  const details=nodes(spec,x=>x.tag==='li');
  const field=label=>details.map(x=>text(x)).find(t=>label.test(t));
  const itemNo=field(/^Item No\s*[:：]/i)?.replace(/^Item No\s*[:：]\s*/i,'').trim();
  const manufacturerStyle=itemNo&&/^[A-Z0-9][A-Z0-9._-]{3,40}$/i.test(itemNo)?itemNo:undefined;
  const material=field(/^Material\s*[:：]/i)?.replace(/^Material\s*[:：]\s*/i,'')||'';
  const otherBrand=!/^Maison\s+MIHARA\s+YASUHIRO$/i.test(maker);
  const excluded=otherBrand||/\b(?:boots?|booties|sandals?|pumps?|loafers?|derb(?:y|ies)|heels?|mules?|slippers?)\b/i.test(name)||!/\b(?:sneakers?|trainers?|sne)\b/i.test(name);
  const digest=hash(html), proof={verified:true,brand:otherBrand?maker:BRAND,style:id.style,identifierType:'official-product-id',verifiedAt:at,verificationMethod:'official-assortment-pdp-color',contentHash:digest,sourceUrl,productId:id.productId,colourId:id.colourId};
  const product={id:`mihara-${id.productId}-${id.colourId}`,brand:otherBrand?maker:BRAND,name,...id,styleType:'official-product-id',productVariantId:id.style,
    ...(manufacturerStyle?{manufacturerStyle}:{}),colorway,colors:colorway?[colorway]:[],image:gallery[0],images:gallery,gallery,material,
    gender:genders.length===2?'Unisex':genders[0]||'',genders,officialCategory:'Sneakers',country:'JP',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:sourceUrl,
    officialProductEvidence:{...proof,url:id.url},officialImageEvidence:{...proof,url:gallery[0],binding:`#item_photo_slider #c${id.colourId}`},
    scopeEvidence:{kind:'official-sneaker-assortment',url:listingSources[0]||'',urls:listingSources,...(listingEvidence?{contentHash:listingEvidence.contentHash}:{} )},
    arrivalEvidence:{...proof,kind:'official-assortment-listing',url:listingEvidence?.sourceUrl||listingSources[0]||sourceUrl,contentHash:listingEvidence?.contentHash||digest,productUrl:id.url,excerpt:`Official sneaker assortment: ${name}; product_id=${id.productId}; PDP color c=${id.colourId}`}};
  return {product,colourIds,excluded,reason:otherBrand?'other-official-brand':excluded?'non-sneaker-or-ambiguous-footwear':null};
}

/** Read-only integration API. Persist checkpoint from the result/onProgress and
 * supply it as resume. No files are written, and assortment is never called New.
 * Limits apply per invocation. A failed page remains queued for retry. */
export async function collectMiharaOfficial({readHtml,now=new Date(),resume,maxListingPages=40,maxProductPages=200,maxDurationMs=480000,onProgress=async()=>{}}={}) {
  for(const n of [maxListingPages,maxProductPages,maxDurationMs])if(!Number.isFinite(n)||n<0)throw Error('MIHARA_INVALID_LIMIT');
  if(resume&&(resume.version!==1||resume.brand!==BRAND))throw Error('MIHARA_INVALID_CHECKPOINT');
  const at=resume?.checkedAt||new Date(now).toISOString(), start=Date.now();
  const state=resume?structuredClone(resume):{version:1,brand:BRAND,checkedAt:at,pendingListings:[...MIHARA_OFFICIAL_SOURCES],pages:[],candidates:[],pendingProducts:null,products:[],excluded:[]};
  const errors=[]; let listingReads=0,productReads=0;
  const get=pacedOfficialFetch(); readHtml??=async url=>{const r=await get(url,{redirect:'error',headers:{Accept:'text/html'}});if(!r.ok)throw Error(`MIHARA_HTTP_${r.status}`);return r.text();};
  const save=async()=>onProgress({brand:BRAND,checkedAt:at,checkpoint:structuredClone(state),listingReads,productReads});
  while(state.pendingListings.length&&listingReads<maxListingPages&&Date.now()-start<maxDurationMs) {
    const url=state.pendingListings[0];listingReads++;
    try {
      listingIdentity(url);
      const page=parseMiharaOfficialListing(await readHtml(url),url), prior=state.pages.filter(p=>p.sourceUrl===page.sourceUrl);
      if(prior.some(p=>p.total!==page.total))throw Error('MIHARA_TOTAL_CHANGED');
      const seen=new Set(prior.flatMap(p=>p.cardIds));
      if(new Set(page.cardIds).size!==page.cards||page.cardIds.some(id=>seen.has(id)))throw Error('MIHARA_REPEATED_PRODUCT_PAGE');
      if(!page.cards&&page.total>0)throw Error('MIHARA_PREMATURE_EMPTY_PAGE');
      const visited=new Set([...state.pages.map(p=>p.url),url]);
      const queued=[...new Set([...state.pendingListings.slice(1),...page.pages.filter(u=>!visited.has(u))])];
      const totalSeen=seen.size+page.cards;
      if(totalSeen>page.total||!queued.some(u=>listingIdentity(u).sourceUrl===page.sourceUrl)&&totalSeen!==page.total)throw Error('MIHARA_TOTAL_MISMATCH');
      state.pages.push({...page,products:undefined});state.candidates.push(...page.products);state.pendingListings=queued;
      await save();
    }catch(e){errors.push({url,error:e.message});break;}
  }
  // Freeze listing discovery before PDP work so gender membership and expected
  // color IDs are complete even when men and women share the same product.
  if(!state.pendingListings.length&&state.pendingProducts===null)state.pendingProducts=[...new Set(state.candidates.map(c=>c.url))];
  while(!state.pendingListings.length&&state.pendingProducts?.length&&productReads<maxProductPages&&Date.now()-start<maxDurationMs) {
    const url=state.pendingProducts[0], {productId:pid}=miharaProductIdentity(url), candidates=state.candidates.filter(c=>c.productId===pid);
    productReads++;
    try {
      miharaProductIdentity(url);
      const html=await readHtml(url), opts={at,sourceUrl:url,genders:[...new Set(candidates.map(c=>c.gender))].sort(),listingSources:[...new Set(candidates.map(c=>c.sourceUrl))],listingEvidence:candidates.find(c=>c.url===url)||candidates[0]};
      const first=parseMiharaOfficialProduct(html,url,opts), expected=new Set(candidates.map(c=>c.colourId));
      if([...expected].some(c=>!first.colourIds.includes(c)))throw Error('MIHARA_LIST_PDP_COLOR_MISMATCH');
      const done=new Set([...state.products,...state.excluded].map(p=>p.url));
      const discovered=first.colourIds.map(c=>`${ORIGIN}/products/detail.php?product_id=${pid}&c=${c}`);
      const v=first;
      (v.excluded?state.excluded:state.products).push(v.excluded?{...v.product,reason:v.reason}:v.product);
      done.add(url);
      state.pendingProducts=[...new Set([...state.pendingProducts.slice(1),...discovered])].filter(u=>!done.has(u));await save();
    }catch(e){errors.push({url,error:e.message});break;}
  }
  const coverage=MIHARA_OFFICIAL_SOURCES.map(sourceUrl=>{
    const pages=state.pages.filter(p=>p.sourceUrl===sourceUrl), total=pages[0]?.total, cards=new Set(pages.flatMap(p=>p.cardIds)).size;
    return {sourceUrl,gender:listingIdentity(sourceUrl).gender,total,cards,pages:pages.length,exhausted:total!==undefined&&cards===total&&!state.pendingListings.some(u=>listingIdentity(u).sourceUrl===sourceUrl)};
  });
  const exhausted=coverage.every(c=>c.exhausted)&&state.pendingProducts?.length===0&&!errors.length;
  const result={brand:BRAND,checkedAt:at,products:state.products,excluded:state.excluded,coverage,pages:state.pages,errors,exhausted,truncated:!exhausted,
    pending:{listings:[...state.pendingListings],productUrls:state.pendingProducts===null?null:[...state.pendingProducts],productIds:state.pendingProducts===null?null:[...new Set(state.pendingProducts.map(u=>miharaProductIdentity(u).productId))]},checkpoint:structuredClone(state)};
  await save();return result;
}
