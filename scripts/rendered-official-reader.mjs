import {setTimeout as delay} from 'node:timers/promises';
import {assertReadableOfficial} from './official-reader.mjs';

// Public official pages only. This client never receives browser profiles/cookies.
// Firecrawl selects its public-page proxy automatically; a daily quota failure
// stops this fallback for the run instead of cycling IPs around that quota.
export function createRenderedOfficialReader({origins=[],apiKey='',fetchImpl=fetch,sleep=delay,maxRequests=24,intervalMs=6500}={}) {
  const allowed=new Set(origins.map(value=>new URL(value).origin));
  const stats={attempted:0,readable:0,quotaStopped:false,limit:maxRequests,mode:apiKey?'account':'keyless'};
  const cache=new Map();let tail=Promise.resolve();
  async function scrape(target){
    const url=new URL(target);
    if(url.protocol!=='https:'||url.username||url.password||!allowed.has(url.origin)||[...url.searchParams.keys()].some(k=>/^(?:token|access_token|api_key|password|session)$/i.test(k)))throw Error('RENDERED_OFFICIAL_URL_NOT_ALLOWED');
    if(stats.quotaStopped)throw Error('RENDERED_OFFICIAL_QUOTA_STOPPED');
    if(stats.attempted>=maxRequests)throw Error('RENDERED_OFFICIAL_RUN_LIMIT');
    if(stats.attempted)await sleep(intervalMs);
    stats.attempted++;
    const response=await fetchImpl('https://api.firecrawl.dev/v2/scrape',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(55000),
      headers:{'Content-Type':'application/json',...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},
      body:JSON.stringify({url:url.href,formats:['markdown'],onlyMainContent:true,maxAge:0,timeout:45000,proxy:'auto'})
    });
    if(!response.ok){if([401,402,403,429].includes(response.status))stats.quotaStopped=true;throw Error(`RENDERED_OFFICIAL_HTTP_${response.status}`);}
    if(Number(response.headers.get('content-length'))>6_000_000)throw Error('RENDERED_OFFICIAL_TOO_LARGE');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>6_000_000)throw Error('RENDERED_OFFICIAL_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel();}
    let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('RENDERED_OFFICIAL_INVALID_JSON');}
    const page=result.data,finalUrl=page?.metadata?.url,status=page?.metadata?.statusCode;
    if(result.success!==true||typeof page?.markdown!=='string'||page.markdown.length<150||page.metadata?.error||!Number.isInteger(status)||status<200||status>=300)throw Error('RENDERED_OFFICIAL_NO_USABLE_PAGE');
    // Cross-origin redirects are not silently treated as the requested regional product.
    if(!finalUrl||new URL(finalUrl).origin!==url.origin)throw Error('RENDERED_OFFICIAL_REDIRECT');
    const text=assertReadableOfficial(`Title: ${String(page.metadata?.title||'').replace(/[\r\n]/g,' ')}\nURL Source: ${finalUrl}\nMarkdown Content:\n${page.markdown}`);
    stats.readable++;
    return text;
  }
  return {stats,read(target){
    if(!cache.has(target)){
      const pending=tail.then(()=>scrape(target));tail=pending.catch(()=>{});cache.set(target,pending);
    }
    return cache.get(target);
  }};
}
