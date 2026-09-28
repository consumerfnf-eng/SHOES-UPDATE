import {canonicalBrand,httpUrl,kstDay} from './curation.mjs';

// Only public, reviewed origins are passed by the collector. No cookies or API keys.
export async function readPublicSource(url,{fetchImpl=fetch,maxBytes=2_000_000}={}) {
  if(!httpUrl(url))throw Error('PUBLIC_SOURCE_URL_INVALID');
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(20000),redirect:'error',headers:{'User-Agent':'SHOES-UPDATE/1.0 (public source verification)','Accept':'application/rss+xml, application/atom+xml, application/json, text/html;q=0.8'}});
  if(!response.ok)throw Error(`PUBLIC_SOURCE_HTTP_${response.status}`);
  if(Number(response.headers.get('content-length'))>maxBytes)throw Error('PUBLIC_SOURCE_TOO_LARGE');
  const reader=response.body.getReader();let size=0;const chunks=[];
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw Error('PUBLIC_SOURCE_TOO_LARGE');chunks.push(value);}}
  finally {await reader.cancel();}
  return Buffer.concat(chunks).toString('utf8');
}

export function decodeText(value='') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,m=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '}[m]));
}
export function htmlText(html='') {
  return decodeText(html).replace(/<(script|style|nav|aside|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<h[1-6]\b[^>]*>/gi,'\n## ').replace(/<\/(?:p|div|h[1-6]|li)>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/[ \t]+/g,' ').trim();
}
const tag=(xml,name)=>xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]||'';
const sameHost=(url,domain)=>{try{const host=new URL(url).hostname.replace(/^www\./,'');return host===domain||host.endsWith('.'+domain);}catch{return false;}};
export function parseEditorialFeed(xml,source,{now=new Date()}={}) {
  // Fail closed on HTML redirects and entity declarations; never expand external entities.
  if(!/<(?:rss|feed)\b/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('EDITORIAL_FEED_INVALID');
  const rows=[];const cutoff=new Date(now).getTime()-30*86400000;
  for(const match of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const block=match[2],url=decodeText(tag(block,'link')).trim()||block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1];
    const published=decodeText(tag(block,'pubDate')||tag(block,'published')).trim(),stamp=Date.parse(published);
    const title=htmlText(tag(block,'title'));if(!httpUrl(url)||!sameHost(url,source.domain)||!title||!Number.isFinite(stamp)||stamp<cutoff||stamp>new Date(now).getTime()+5*60000)continue;
    const body=htmlText(tag(block,'content:encoded')||tag(block,'content')||tag(block,'description')||tag(block,'summary'));
    rows.push({url,title,publishedAt:kstDay(new Date(stamp)),text:`Title: ${title}\nPublished Time: ${kstDay(new Date(stamp))}\n${body}`,source});
    if(rows.length>=100)break;
  }
  return rows;
}

export function articleFromHtml(html,{title='',publishedAt=''}={}) {
  const meta=(name)=>{for(const m of html.matchAll(/<meta\b[^>]*>/gi)){if(new RegExp(`(?:property|name)=["']${name}["']`,'i').test(m[0]))return decodeText(m[0].match(/content=["']([^"']+)["']/i)?.[1]||'');}return '';};
  const body=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  // No whole-page fallback: menus and recommended cards can mention unrelated SKUs.
  if(!body)return null;
  const date=meta('article:published_time')||publishedAt;
  return `Title: ${meta('og:title')||title}\nPublished Time: ${date}\n${htmlText(body)}`;
}

export function parseRanking(text,source,{checkedAt,product,matchesModel}) {
  if(!source.country||!source.category||!source.categoryCode)return [];
  let data;try{data=JSON.parse(text);}catch{return [];}
  const matches=[];
  const add=(row,{rank,name,brand,url,date,category,rankBasis})=>{
    if(!Number.isInteger(rank)||rank<1||rank>100||!httpUrl(url)||!canonicalBrand(brand)||canonicalBrand(brand)!==canonicalBrand(product.brand)||!matchesModel(name,product)||String(category)!==String(source.categoryCode))return;
    matches.push({type:'ecommerce',url:source.url,title:`${source.name} · ${source.category} ${rank}위`,publishedAt:date||kstDay(checkedAt),checkedAt,modelMatched:true,rank,rankVerified:true,country:source.country,rankingCategory:source.category,rankingPeriod:source.period,rankingDefinition:source.basis,rankBasis,captureLimit:100,publisherId:source.id,publisherName:source.name,platformName:source.name,productUrl:url,rankingEvidenceUrl:source.apiUrl,rankingProductId:String(row),snapshotAt:checkedAt,dateBasis:date?'platform-updated-at':'observed-snapshot'});
  };
  if(source.adapter==='musinsa'&&data.meta?.result==='SUCCESS') {
    const modules=data.data?.modules||[],updated=modules.find(m=>m.type==='QUERY_UPDATEDAT')?.information?.updatedAt;
    const date=Number.isFinite(updated)?kstDay(new Date(updated)):null;
    for(const item of modules.filter(m=>m.type==='MULTICOLUMN').flatMap(m=>m.items||[])) {
      const payload=item.onClick?.eventLog?.ga4?.payload;
      if(payload?.section_name!=='ranking_goods_list'||payload?.applied_tab!=='ranking_cat')continue;
      add(payload.item_id,{rank:item.image?.rank,name:item.info?.productName,brand:payload.item_brand,url:item.onClick?.url,date,category:payload.item_category_id,rankBasis:'platform-explicit-rank'});
    }
  }
  if(source.adapter==='29cm'&&data.result==='SUCCESS'&&Array.isArray(data.data?.content)) {
    // The official BEST page numbers this ordered API list with counter(list-number).
    data.data.content.slice(0,100).forEach((item,index)=>{const category=item.frontCategoryInfo?.find(c=>String(c.category1Code)===String(source.categoryCode));if(!category)return;
      add(item.itemNo,{rank:index+1,name:item.itemName,brand:item.frontBrandNameEng,url:`https://www.29cm.co.kr/product/${item.itemNo}`,category:category.category1Code,rankBasis:'platform-best-list-position'});
    });
  }
  return matches;
}

export function configuredDirectory(config,checkedAt) {
  const result=Object.fromEntries(['magazine','newsletter','sns','ecommerce'].map(type=>[type,{configured:[],observed:[],checkedAt}]));
  for(const source of config.editorialSources||[])result[source.type].configured.push({id:source.id,name:source.name,url:source.url,method:source.feedUrl?'public-rss':'public-article-search'});
  for(const source of config.snsAccounts||[])result.sns.configured.push({id:source.handle,name:`Instagram @${source.handle}`,url:`https://www.instagram.com/${source.handle}/`,method:'reviewed-original-posts'});
  for(const source of config.rankingPages||[]) {
    const previous=result.ecommerce.configured.find(s=>s.id===source.id);
    if(previous)previous.categories.push(source.category);
    else result.ecommerce.configured.push({id:source.id,name:source.name,url:source.url,method:'public-platform-ranking',categories:[source.category],country:source.country,period:source.period,captureLimit:100,basis:source.basis});
  }
  return result;
}
