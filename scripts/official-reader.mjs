import {readPublicSource,decodeText} from './source-feeds.mjs';
import {setTimeout as delay} from 'node:timers/promises';

// Three attempts, each waiting longer than the last. A site that answered a
// timeout or a 503 once will often answer the third try; hammering it at a
// fixed interval will not. Access denials and CAPTCHAs are never retried -
// the same client gets the same answer - they escalate to the rendered
// reader instead.
export const MAX_OFFICIAL_ATTEMPTS=3;
export function pacedOfficialFetch({fetchImpl=fetch,sleep=delay,intervalMs=2500,retryMs=5000,now=Date.now,attempts=MAX_OFFICIAL_ATTEMPTS}={}){
  const queues=new Map(),next=new Map();
  const backoff=attempt=>retryMs*Math.pow(3,attempt);   // 5s, 15s
  return async function fetchOfficial(url,options){
    const origin=new URL(url).origin;
    for(let attempt=0;attempt<attempts;attempt++){
      const last=attempt===attempts-1;
      const turn=(queues.get(origin)||Promise.resolve()).then(async()=>{await sleep(Math.max(0,(next.get(origin)||0)-now()));next.set(origin,now()+intervalMs);});
      queues.set(origin,turn.catch(()=>{}));await turn;
      let response;
      try{response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(20000)});}catch(error){
        if(last||!['TypeError','TimeoutError','AbortError'].includes(error.name))throw error;
        await sleep(backoff(attempt));continue;
      }
      if(!last&&[429,500,502,503,504].includes(response.status)){
        const header=response.headers.get('retry-after');
        const wait=header?(Number.isFinite(Number(header))?Number(header)*1000:Date.parse(header)-now()):backoff(attempt);
        // A long server cooldown is deferred to the next scheduled run.
        if(wait>60000)return response;
        await response.body?.cancel();await sleep(Math.max(backoff(attempt),Number.isFinite(wait)?wait:backoff(attempt)));continue;
      }
      return response; // Never retry access denials, CAPTCHAs or missing pages.
    }
  };
}

export function assertReadableOfficial(text){
  if(/^Title:.*(?:Just a moment|Access Denied|Pardon Our Interruption|Page Not Found|captcha|robot check|sign in|log in|login|ログイン|로그인)/im.test(text)||/powered and protected by[\s\S]{0,500}akamai|YOUR ACCESS TO .{1,80} IS TEMPORARILY RESTRICTED|verify (?:that )?you are human|enable javascript and cookies to continue/i.test(text))throw Error('OFFICIAL_ACCESS_CHALLENGE');
  if(/(?:^|\n)#{1,3}\s*(?:\*\*)?PAGE NOT FOUND/i.test(text))throw Error('OFFICIAL_PAGE_NOT_FOUND');
  return text;
}

// A public HTML fallback for reviewed official origins. It uses no credentials,
// follows no redirects and never treats a challenge or an empty JS shell as data.
export function officialHtmlMarkdown(html,url){
  const title=decodeText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
  if(/access denied|just a moment|captcha|robot check|pardon our interruption/i.test(title))throw Error('OFFICIAL_ACCESS_CHALLENGE');
  const clean=t=>decodeText(t.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
  // An empty src or href is not an address. `new URL('', page)` resolves to the
  // page itself, so a lazy-loaded <img> with no src was being written down as a
  // photograph of the product page: 35 of 49 Prada records carried their own
  // product URL in the image field and could never show a picture.
  const absolute=value=>{if(!String(value||'').trim())return '';try{const u=new URL(decodeText(value),url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
  const attr=(tag,name)=>tag.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`,'i'))?.[1]||'';
  let body=html.replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  // Prada's gallery is a <picture> whose <img> has no src at all: the real
  // renditions sit in the sibling <source srcset>. Hand those candidates to
  // the <img> so the one reader below still sees a single tag to read.
  body=body.replace(/<picture\b[^>]*>([\s\S]*?)<\/picture>/gi,(whole,inner)=>{
    const img=inner.match(/<img\b[^>]*>/i);if(!img)return whole;
    if(['src','srcset','data-src','data-srcset'].some(name=>attr(img[0],name)))return inner;
    const candidates=[...inner.matchAll(/<source\b[^>]*>/gi)].map(m=>attr(m[0],'data-srcset')||attr(m[0],'srcset')).filter(Boolean).join(', ');
    return candidates?img[0].replace(/<img\b/i,`<img srcset="${candidates.replaceAll('"','&quot;')}"`):inner;
  });
  body=body.replace(/<img\b[^>]*>/gi,tag=>{
    // A srcset describes its candidates by width ("1200w") or by pixel density
    // ("2x", or nothing at all for 1x). Only widths were read before, so a
    // density-only srcset counted as no candidates and fell through to src.
    const candidates=[...(attr(tag,'data-srcset')||attr(tag,'srcset')).matchAll(/(?:^|,)\s*(https:\/\/[^\s,]+)(?:\s+(\d+(?:\.\d+)?)(w|x))?/g)]
      .map(m=>({url:m[1],width:m[3]==='w'?Number(m[2]):0,density:m[3]==='x'?Number(m[2]):1}));
    const byWidth=candidates.filter(i=>i.width).sort((a,b)=>a.width-b.width);
    const preferred=byWidth.filter(i=>i.width>=600&&i.width<=1600).at(-1)||byWidth.at(-1)
      ||candidates.filter(i=>!i.width).sort((a,b)=>a.density-b.density)[0];
    const src=absolute(preferred?.url||attr(tag,'src'))||absolute(attr(tag,'data-src'));
    return src?`![${clean(attr(tag,'alt'))}](${src})`:'';
  })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,(_,attrs,text)=>{const href=absolute(attr(attrs,'href'));return href?`[${clean(text)}](${href})`:clean(text);})
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,(_,level,text)=>`\n${'#'.repeat(Number(level))} ${clean(text)}\n`)
    .replace(/<(?:li)\b[^>]*>/gi,'\n* ').replace(/<\/(?:p|div|section|li)>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ');
  body=decodeText(body).replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  if(body.length<150||!/\]\(https:\/\//.test(body))throw Error('OFFICIAL_HTML_NO_CONTENT');
  return assertReadableOfficial(`Title: ${title}\nURL Source: ${url}\nMarkdown Content:\n${body}`);
}
export function createOfficialReader({read,origins,fetchImpl=fetch,sleep=delay,intervalMs=2500,retryMs=5000,renderedRead,localeRead,sitemapRead}={}){
  const allowed=new Set(origins.map(url=>new URL(url).origin)),diagnostics=[];
  const officialFetch=pacedOfficialFetch({fetchImpl,sleep,intervalMs,retryMs});
  return {diagnostics,async read(url,timeout){
    try{return assertReadableOfficial(await read(url,timeout));}catch(primary){
      if(!url.startsWith('https://r.jina.ai/https://'))throw primary;
      const target=url.slice('https://r.jina.ai/'.length);
      if(!allowed.has(new URL(target).origin))throw primary;
      try{const html=await readPublicSource(target,{fetchImpl:officialFetch,maxBytes:6_000_000,headers:{Accept:'text/html'}}),text=officialHtmlMarkdown(html,target);
        diagnostics.push({url:target,method:'direct-official-html',status:'readable',primaryError:primary.message});return text;
      }catch(error){
        diagnostics.push({url:target,method:'direct-official-html',status:'unavailable',primaryError:primary.message,error:error.message});
        const trail=[`${primary.message}`,`official HTML: ${error.message}`];
        // Escalate: render it, then try the same page in another country,
        // then read the store's own sitemap. Each answers a different kind
        // of refusal, so a failure at one is not a failure at the next.
        for(const [method,attempt] of [['rendered-public-official',renderedRead],
                                       ['locale-alternate',localeRead],
                                       ['official-sitemap',sitemapRead]]){
          if(!attempt)continue;
          try{const text=assertReadableOfficial(await attempt(target));diagnostics.push({url:target,method,status:'readable'});return text;}
          catch(next){diagnostics.push({url:target,method,status:'unavailable',error:next.message});trail.push(`${method}: ${next.message}`);}
        }
        throw Error(trail.join('; '));
      }
    }
  }};
}
