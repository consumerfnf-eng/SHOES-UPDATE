import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {httpUrl,canonicalUrl,validateSignals,kstDay} from './curation.mjs';
import {exactDate} from './collect-evidence.mjs';
import {keywordIdsFromText} from './keyword-taxonomy.mjs';
import {readPublicSource,parseEditorialFeed,articleFromHtml,parseRanking,configuredDirectory} from './source-feeds.mjs';

export function matchesModel(text,p) {
  const normal=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const body=normal(text);
  if(p.style&&normal(p.style).length>=6) {
    const pattern=normal(p.style).split('').join('[\\s._/-]*');
    if(new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`,'i').test(text))return true;
  }
  // Reviewed aliases keep broad model names (e.g. "XT-6") from matching unrelated colorways.
  return (p.signalAliases||[]).some(a=>normal(a).length>=12&&body.includes(normal(a)));
}
export function discoverUrls(text) {return [...new Set([...text.matchAll(/https:\/\/[^\s<>\])"]+/g)].map(m=>m[0].replace(/[.,;]$/,'')))];}
export function keywordsFromText(text) {
  return keywordIdsFromText(text);
}
export function parseArticle(text,{url,type,product,checkedAt,config}) {
  const article=text.split(/\n#{1,6}\s*(?:Related(?: articles| stories| products)?|Recommended|You may also|More from|Latest posts|Read next)\b/i)[0];
  if(!httpUrl(url)||!matchesModel(article,product))return null;
  const host=new URL(url).hostname.replace(/^www\./,'');
  const allowed=(type==='magazine'?config.magazineDomains:config.newsletterDomains).some(d=>host===d||host.endsWith('.'+d));
  if(!allowed)return null;
  const header=article.slice(0,10000),line=header.split('\n').find(l=>/^Published Time:|^Date:|^Published:|^\*?\*?Published on/i.test(l));
  const day=line&&exactDate(line);if(!day)return null;
  const title=header.match(/^Title:\s*(.+)$/m)?.[1]||header.match(/^#\s+(.+)$/m)?.[1];if(!title)return null;
  const sponsored=/paid partnership|sponsored|advertorial|presented by|partner content|in partnership with|유료 광고|협찬 기사/i.test(header);
  const source=config.editorialSources?.find(s=>s.type===type&&(host===s.domain||host.endsWith('.'+s.domain)));
  return {type,url,title,publishedAt:day,checkedAt,modelMatched:true,publisherId:source?.id||host,publisherName:source?.name||host,sponsored,independent:!sponsored,keywords:keywordsFromText(header)};
}
export function parseSocial(text,{url,product,checkedAt,config}) {
  if(!/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+/.test(url)||!matchesModel(text,product))return null;
  const account=(config.snsAccounts||[]).find(a=>/^[a-z0-9._]{1,30}$/i.test(a.handle)&&a.independent===true&&a.seller===false&&a.brandOwned===false&&new RegExp(`(?:@|Instagram: )${a.handle.replaceAll('.','\\.')}\\b`,'i').test(text));
  const dateLine=text.split('\n').find(l=>/^Published Time:|^Date:/.test(l)),day=dateLine&&exactDate(dateLine);
  if(!account||!day||/paid partnership|sponsored|#ad\b|광고|협찬|repost|regram/i.test(text))return null;
  const original=account.reviewedOriginalPosts?.find(p=>httpUrl(p.url)&&canonicalUrl(p.url)===canonicalUrl(url)&&p.original===true&&Number.isFinite(Date.parse(p.verifiedAt))&&Date.parse(p.verifiedAt)<=Date.parse(checkedAt)&&typeof p.evidence==='string'&&p.evidence.trim());
  if(!original)return null;
  return {type:'sns',url,title:`${product.brand} ${product.name}`,publishedAt:day,checkedAt,modelMatched:true,account:account.handle,publisherId:account.handle,publisherName:`Instagram @${account.handle}`,platformName:'Instagram',original:true,originalId:canonicalUrl(url),originalVerifiedAt:original.verifiedAt,sponsored:false,seller:false,brandOwned:false,independent:true,keywords:keywordsFromText(text)};
}
export async function collectSignals({products,read,readPublic=readPublicSource,now=new Date(),maxProducts=Infinity,config}) {
  config ||= JSON.parse(await fs.readFile(new URL('../config/signal-sources.json',import.meta.url),'utf8'));
  const checkedAt=new Date(now).toISOString(),diagnostics=[],updates=[],sourceDirectory=configuredDirectory(config,checkedAt),feedEntries=[],rankingBodies=[];
  // Each original source is read once per run; all eligible items can be matched locally.
  for(const source of config.editorialSources||[])if(source.feedUrl) {
    try {const text=await readPublic(source.feedUrl,{maxBytes:Math.min(source.maxBytes||2_000_000,5_000_000)}),contentHash=createHash('sha256').update(text).digest('hex'),entries=parseEditorialFeed(text,source,{now});feedEntries.push(...entries.map(e=>({...e,contentHash})));diagnostics.push({sourceId:source.id,type:source.type,url:source.feedUrl,method:'public-rss',status:'fetched',entryCount:entries.length,contentHash,checkedAt});}
    catch(e){diagnostics.push({sourceId:source.id,url:source.feedUrl,method:'public-rss',status:'unavailable',reason:e.message,checkedAt});}
  }
  for(const source of config.rankingPages||[])if(source.apiUrl) {
    try {const text=await readPublic(source.apiUrl);const data=JSON.parse(text);const count=source.adapter==='musinsa'?(data.data?.modules||[]).filter(m=>m.type==='MULTICOLUMN').flatMap(m=>m.items||[]).filter(i=>Number.isInteger(i.image?.rank)&&i.image.rank<=100).length:source.adapter==='29cm'?data.data?.content?.length:0;
      if(!count)throw Error('RANKING_SCHEMA_OR_ITEMS_UNAVAILABLE');
      const contentHash=createHash('sha256').update(text).digest('hex');rankingBodies.push({source,text,contentHash});diagnostics.push({sourceId:source.id,type:'ecommerce',url:source.apiUrl,method:'public-platform-ranking',status:'fetched',entryCount:Math.min(count,100),contentHash,category:source.category,country:source.country,period:source.period,captureLimit:100,checkedAt});
    }catch(e){diagnostics.push({sourceId:source.id,url:source.apiUrl,status:'unavailable',reason:e.message,checkedAt});}
  }
  const selected=[...products].sort((a,b)=>(a.lastSignalSearchCheckedAt||'').localeCompare(b.lastSignalSearchCheckedAt||'')||(b.releaseDate||'').localeCompare(a.releaseDate||''));
  const searchIds=new Set(selected.slice(0,maxProducts).map(p=>p.id)),cache=new Map();let discoveryUnavailable=false;
  const publicArticle=async(url)=>{if(!cache.has(url))cache.set(url,readPublic(url).catch(()=>null));return cache.get(url);};
  for(const p of selected) {
    const old=validateSignals(p.sourceSignals||[],kstDay(now)).map(s=>{
      const host=new URL(s.url).hostname.replace(/^www\./,''),source=config.editorialSources?.find(x=>x.type===s.type&&(host===x.domain||host.endsWith('.'+x.domain)));
      return source?{...s,publisherId:source.id,publisherName:source.name}:s;
    }),signals=[...old];
    const add=signal=>{if(!signal)return;const index=signals.findIndex(s=>canonicalUrl(s.url)===canonicalUrl(signal.url));if(index<0)signals.push(signal);else signals[index]=signal;};
    for(const entry of feedEntries) {
      // A publisher's own RSS content must identify this exact variant.
      if(!matchesModel(entry.text,p))continue;
      const signal=parseArticle(entry.text,{url:entry.url,type:entry.source.type,product:p,checkedAt,config});
      if(signal)add({...signal,evidenceMethod:'publisher-rss',evidenceUrl:entry.source.feedUrl,evidenceHash:entry.contentHash});
    }
    for(const {source,text,contentHash}of rankingBodies)for(const signal of parseRanking(text,source,{checkedAt,product:p,matchesModel}))add({...signal,evidenceHash:contentHash});
    // Original model/source evidence remains available if a publisher temporarily blocks a refresh.
    const query=`"${p.brand}" "${p.style||p.name}" sneakers ${now.getUTCFullYear()}`;
    let found=[],searchAttempted=false;
    if(read&&searchIds.has(p.id)&&!discoveryUnavailable)try {searchAttempted=true;found=discoverUrls(await read(`https://s.jina.ai/${encodeURIComponent(query)}`));}
    catch(e){diagnostics.push({id:p.id,method:'article-search',reason:e.message});if(/401|unauthori[sz]ed|AUTH|402/i.test(e.message))discoveryUnavailable=true;}
    const urls=[...new Set([...old.map(s=>s.url),...found])].filter(httpUrl).slice(0,12);
    for(const url of urls) {
      const host=new URL(url).hostname.replace(/^www\./,'');
      const type=config.magazineDomains.some(d=>host===d||host.endsWith('.'+d))?'magazine':config.newsletterDomains.some(d=>host===d||host.endsWith('.'+d))?'newsletter':host==='instagram.com'?'sns':null;
      if(!type)continue;
      try {
        let text=null;if(type!=='sns'){const html=await publicArticle(url);if(html)text=articleFromHtml(html);}
        if(!text&&read&&searchIds.has(p.id))text=await read(`https://r.jina.ai/${url}`);
        if(text)add(type==='sns'?parseSocial(text,{url,product:p,checkedAt,config}):parseArticle(text,{url,type,product:p,checkedAt,config}));
      } catch(e){diagnostics.push({id:p.id,url,reason:e.message});}
    }
    updates.push({...p,sourceSignals:validateSignals(signals,kstDay(now)),lastSignalCheckedAt:checkedAt,...(searchAttempted?{lastSignalSearchCheckedAt:checkedAt}:{})});
  }
  for(const d of diagnostics)if(d.status==='fetched')d.matchedProductCount=updates.filter(p=>p.sourceSignals.some(s=>s.publisherId===d.sourceId&&s.checkedAt===checkedAt&&(d.method==='public-rss'?s.evidenceUrl===d.url:s.rankingCategory===d.category))).length;
  for(const type of Object.keys(sourceDirectory))sourceDirectory[type].checks=diagnostics.filter(d=>d.type===type&&d.status==='fetched').map(({sourceId,url,method,status,entryCount,contentHash,checkedAt,matchedProductCount,category,country,period,captureLimit})=>({id:sourceId,url,method,status,entryCount,contentHash,checkedAt,matchedProductCount,...(category?{category,country,period,captureLimit}:{})}));
  return {products:updates,diagnostics,sourceDirectory};
}
