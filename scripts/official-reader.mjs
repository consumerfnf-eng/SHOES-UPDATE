import {readPublicSource,decodeText} from './source-feeds.mjs';
import {setTimeout as delay} from 'node:timers/promises';

export function pacedOfficialFetch({fetchImpl=fetch,sleep=delay,intervalMs=2500,retryMs=5000,now=Date.now}={}){
  const queues=new Map(),next=new Map();
  return async function fetchOfficial(url,options){
    const origin=new URL(url).origin;
    for(let attempt=0;attempt<2;attempt++){
      const turn=(queues.get(origin)||Promise.resolve()).then(async()=>{await sleep(Math.max(0,(next.get(origin)||0)-now()));next.set(origin,now()+intervalMs);});
      queues.set(origin,turn.catch(()=>{}));await turn;
      let response;
      try{response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(20000)});}catch(error){
        if(attempt||!['TypeError','TimeoutError','AbortError'].includes(error.name))throw error;
        await sleep(retryMs);continue;
      }
      if(!attempt&&[429,500,502,503,504].includes(response.status)){
        const header=response.headers.get('retry-after');
        const wait=header?(Number.isFinite(Number(header))?Number(header)*1000:Date.parse(header)-now()):retryMs;
        // A long server cooldown is deferred to the next scheduled run.
        if(wait>60000)return response;
        await response.body?.cancel();await sleep(Math.max(retryMs,Number.isFinite(wait)?wait:retryMs));continue;
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
  const absolute=value=>{try{const u=new URL(decodeText(value),url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
  const attr=(tag,name)=>tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`,'i'))?.[1]||'';
  let body=html.replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  body=body.replace(/<img\b[^>]*>/gi,tag=>{const src=absolute(attr(tag,'src'));return src?`![${clean(attr(tag,'alt'))}](${src})`:'';})
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,(_,attrs,text)=>{const href=absolute(attr(attrs,'href'));return href?`[${clean(text)}](${href})`:clean(text);})
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,(_,level,text)=>`\n${'#'.repeat(Number(level))} ${clean(text)}\n`)
    .replace(/<(?:li)\b[^>]*>/gi,'\n* ').replace(/<\/(?:p|div|section|li)>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ');
  body=decodeText(body).replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  if(body.length<150||!/\]\(https:\/\//.test(body))throw Error('OFFICIAL_HTML_NO_CONTENT');
  return assertReadableOfficial(`Title: ${title}\nURL Source: ${url}\nMarkdown Content:\n${body}`);
}
export function createOfficialReader({read,origins,fetchImpl=fetch,sleep=delay,intervalMs=2500,retryMs=5000,renderedRead}={}){
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
        if(renderedRead)try{const text=assertReadableOfficial(await renderedRead(target));diagnostics.push({url:target,method:'rendered-public-official',status:'readable'});return text;}
        catch(renderedError){diagnostics.push({url:target,method:'rendered-public-official',status:'unavailable',error:renderedError.message});throw Error(`${primary.message}; official HTML: ${error.message}; rendered: ${renderedError.message}`);}
        throw Error(`${primary.message}; official HTML: ${error.message}`);
      }
    }
  }};
}
