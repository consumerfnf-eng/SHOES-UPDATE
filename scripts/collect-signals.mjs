import fs from 'node:fs/promises';
import {httpUrl,canonicalUrl,validateSignals,kstDay} from './curation.mjs';
import {exactDate} from './collect-evidence.mjs';

export function matchesModel(text,p) {
  const normal=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const body=normal(text);
  if(p.style&&normal(p.style).length>=6&&body.includes(normal(p.style)))return true;
  // Reviewed aliases keep broad model names (e.g. "XT-6") from matching unrelated colorways.
  return (p.signalAliases||[]).some(a=>normal(a).length>=12&&body.includes(normal(a)));
}
export function discoverUrls(text) {return [...new Set([...text.matchAll(/https:\/\/[^\s<>\])"]+/g)].map(m=>m[0].replace(/[.,;]$/,'')))];}
export function keywordsFromText(text) {
  const terms=[['레트로 러닝',/retro.run|retro.runner|2000s.running/i],['로우 프로파일',/low.profile|low.slung|slim.silhouette/i],['플랫폼',/platform.sole|platform.sneaker/i],['메쉬',/mesh.upper|breathable.mesh/i],['스컬프처 어퍼',/sculptural|sculpted.upper/i],['트레일',/trail.running|trail.inspired/i],['클로그',/\bclogs?\b/i],['메리제인 스니커즈',/mary.jane.sneaker/i]];
  return terms.filter(([,pattern])=>pattern.test(text)).map(([label])=>label);
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
  const sponsored=/paid partnership|sponsored (?:post|content)|advertorial|유료 광고|협찬 기사/i.test(header);
  return {type,url,title,publishedAt:day,checkedAt,modelMatched:true,publisherId:host,sponsored,independent:!sponsored,keywords:keywordsFromText(header)};
}
export function parseSocial(text,{url,product,checkedAt,config}) {
  if(!/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+/.test(url)||!matchesModel(text,product))return null;
  const account=config.snsAccounts.find(a=>a.independent===true&&a.seller===false&&a.brandOwned===false&&new RegExp(`(?:@|Instagram: )${a.handle}\\b`,'i').test(text));
  const dateLine=text.split('\n').find(l=>/^Published Time:|^Date:/.test(l)),day=dateLine&&exactDate(dateLine);
  if(!account||!day||/paid partnership|sponsored|#ad\b|광고|협찬|repost|regram/i.test(text))return null;
  if(!account.originalPostsVerified)return null;
  return {type:'sns',url,title:`${product.brand} ${product.name}`,publishedAt:day,checkedAt,modelMatched:true,account:account.handle,original:true,originalId:canonicalUrl(url),sponsored:false,seller:false,brandOwned:false,independent:true,keywords:keywordsFromText(text)};
}
export async function collectSignals({products,read,now=new Date(),maxProducts=40,config}) {
  config ||= JSON.parse(await fs.readFile(new URL('../config/signal-sources.json',import.meta.url),'utf8'));
  const checkedAt=new Date(now).toISOString(),diagnostics=[],updates=[];
  const selected=[...products].sort((a,b)=>(a.lastSignalCheckedAt||'').localeCompare(b.lastSignalCheckedAt||'')||(b.releaseDate||'').localeCompare(a.releaseDate||''));
  for(const p of selected.slice(0,maxProducts)) {
    const old=validateSignals(p.sourceSignals||[],kstDay(now)),signals=[...old];
    // Original model/source evidence remains available if a publisher temporarily blocks a refresh.
    const query=`"${p.brand}" "${p.style||p.name}" sneakers ${now.getUTCFullYear()}`;
    let found=[];
    try {found=discoverUrls(await read(`https://s.jina.ai/${encodeURIComponent(query)}`));}
    catch(e){diagnostics.push({id:p.id,reason:e.message});}
    const urls=[...new Set([...old.map(s=>s.url),...found])].filter(httpUrl).slice(0,12);
    for(const url of urls) {
      const host=new URL(url).hostname.replace(/^www\./,'');
      const type=config.magazineDomains.some(d=>host===d||host.endsWith('.'+d))?'magazine':config.newsletterDomains.some(d=>host===d||host.endsWith('.'+d))?'newsletter':host==='instagram.com'?'sns':null;
      if(!type)continue;
      try {
        const text=await read(`https://r.jina.ai/${url}`),signal=type==='sns'?parseSocial(text,{url,product:p,checkedAt,config}):parseArticle(text,{url,type,product:p,checkedAt,config});
        if(signal){const index=signals.findIndex(s=>canonicalUrl(s.url)===canonicalUrl(signal.url));if(index<0)signals.push(signal);else signals[index]=signal;}
      } catch(e){diagnostics.push({id:p.id,url,reason:e.message});}
    }
    // Ecommerce adapters use explicit reviewed rankings; a product grid is insufficient evidence.
    for(const rankSource of config.rankingPages||[]) {
      if(!rankSource.country||!rankSource.category||!rankSource.rankPattern)continue;
      try{const text=await read(`https://r.jina.ai/${rankSource.url}`),line=text.split('\n').find(l=>matchesModel(l,p)),match=line&&line.match(new RegExp(rankSource.rankPattern));
        const day=exactDate(text.split('\n').find(l=>/^Published Time:|^Ranking date:/.test(l))||'');
        if(day&&match&&Number(match[1])>0)signals.push({type:'ecommerce',url:rankSource.url,title:`${rankSource.category} 순위`,publishedAt:day,checkedAt,modelMatched:true,rank:Number(match[1]),rankVerified:true,country:rankSource.country,rankingCategory:rankSource.category});
      }catch(e){diagnostics.push({url:rankSource.url,reason:e.message});}
    }
    updates.push({...p,sourceSignals:signals,lastSignalCheckedAt:checkedAt});
  }
  return {products:updates,diagnostics};
}
