import {setTimeout as delay} from 'node:timers/promises';
import {officialHtmlMarkdown} from './official-reader.mjs';

// Supplementary rendered-page fallback using the user's own paid ScrapingBee
// key, tried only after the Firecrawl-based reader (rendered-official-reader.mjs)
// fails or is out of quota. Same public-official-origins-only restriction, same
// "never fabricate a usable page" posture: a challenge page or near-empty body
// throws, it is never returned as if it were real content.
//
// Credit-conscious by design (ScrapingBee's free tier is 1,000 credits total):
// each request tries the light fetch first (render_js=false, premium_proxy=false,
// 1 credit) and only escalates to the premium fetch (render_js=true,
// premium_proxy=true, 25 credits - needed for Akamai/Cloudflare-protected
// luxury sites) when the light fetch comes back too small or still looks
// like a bot-challenge page. A per-run credit cap (default 125) keeps any
// single run from draining the account.
export function createScrapingBeeReader({origins=[],apiKey='',fetchImpl=fetch,sleep=delay,maxCreditsPerRun=125,shouldContinue=()=>true}={}) {
  const allowed=new Set(origins.map(value=>new URL(value).origin));
  const stats={attempted:0,readable:0,creditsUsed:0,quotaStopped:false,mode:apiKey?'account':'no-key'};
  const cache=new Map();let tail=Promise.resolve();

  async function fetchOnce(target,params){
    const url=new URL('https://app.scrapingbee.com/api/v1/');
    url.searchParams.set('api_key',apiKey);
    url.searchParams.set('url',target);
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
    const response=await fetchImpl(url.href,{signal:AbortSignal.timeout(60000)});
    return response;
  }

  async function scrape(target){
    if(!apiKey)throw Error('SCRAPINGBEE_NO_KEY');
    if(!shouldContinue())throw Error('SCRAPINGBEE_TIME_BUDGET');
    const url=new URL(target);
    if(url.protocol!=='https:'||url.username||url.password||!allowed.has(url.origin))throw Error('SCRAPINGBEE_URL_NOT_ALLOWED');
    if(stats.quotaStopped)throw Error('SCRAPINGBEE_QUOTA_STOPPED');
    if(stats.creditsUsed>=maxCreditsPerRun)throw Error('SCRAPINGBEE_RUN_BUDGET_EXHAUSTED');
    if(stats.attempted)await sleep(1500);
    stats.attempted++;
    let response;
    try{response=await fetchOnce(target,{render_js:'false',premium_proxy:'false'});}
    catch(e){throw Error(`SCRAPINGBEE_LIGHT_FETCH_FAILED: ${e.message}`);}
    if(response.status===401||response.status===402){stats.quotaStopped=true;throw Error(`SCRAPINGBEE_HTTP_${response.status}`);}
    stats.creditsUsed+=1;
    // officialHtmlMarkdown already rejects challenge titles, near-empty bodies
    // and pages with no real links - reuse that one validator instead of a
    // second, looser heuristic that could disagree with it either way.
    let text;
    try{if(!response.ok)throw Error(`SCRAPINGBEE_HTTP_${response.status}`);text=officialHtmlMarkdown(await response.text(),target);}
    catch(lightError){
      if(stats.creditsUsed+25>maxCreditsPerRun)throw Error('SCRAPINGBEE_RUN_BUDGET_WOULD_EXCEED_PREMIUM');
      let premiumResponse;
      try{premiumResponse=await fetchOnce(target,{render_js:'true',premium_proxy:'true',wait:'3500',block_ads:'true'});}
      catch(e){throw Error(`SCRAPINGBEE_PREMIUM_FETCH_FAILED: ${e.message}`);}
      if(premiumResponse.status===401||premiumResponse.status===402){stats.quotaStopped=true;throw Error(`SCRAPINGBEE_HTTP_${premiumResponse.status}`);}
      stats.creditsUsed+=25;
      if(!premiumResponse.ok)throw Error(`SCRAPINGBEE_HTTP_${premiumResponse.status}`);
      text=officialHtmlMarkdown(await premiumResponse.text(),target);
    }
    stats.readable++;
    return text;
  }
  function read(target){
    const key='sb:'+target;
    if(!cache.has(key)){const pending=tail.then(()=>scrape(target));tail=pending.catch(()=>{});cache.set(key,pending);}
    return cache.get(key);
  }
  return {stats,read,readHtml:read};
}
