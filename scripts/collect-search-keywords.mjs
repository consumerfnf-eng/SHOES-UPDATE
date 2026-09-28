import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readPublicSource,htmlText} from './source-feeds.mjs';

const configUrl=new URL('../config/search-keyword-sources.json',import.meta.url);
const supportedOrigins={
  'musinsa-search':'https://api.musinsa.com',
  '29cm-search':'https://display-bff-api.29cm.co.kr',
  'tiktok-hashtags':'https://ads.tiktok.com',
  'tagwalk-traffic':'https://www2.tag-walk.com',
  'lyst-brand-index':'https://www.lyst.com'
};
const validTerm=value=>typeof value==='string'&&value.trim().length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);
function calendarInstant(value) {
  const match=/^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/.exec(value||'');
  if(!match)return NaN;
  const day=Number(match[1]),month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[2]),year=Number(match[3]);
  const date=new Date(Date.UTC(year,month,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month&&date.getUTCDate()===day?date.getTime():NaN;
}

export async function readSearchSource(url,{method='GET',requestBody,fetchImpl=fetch}={}) {
  if(method==='GET')return readPublicSource(url,{fetchImpl});
  if(method!=='POST')throw Error('SEARCH_METHOD_UNREVIEWED');
  // This documented-by-page POST reads the public hashtag list; it creates no resource.
  return readPublicSource(url,{fetchImpl:(target,options)=>fetchImpl(target,{...options,method,
    headers:{...options.headers,'Content-Type':'application/json'},body:JSON.stringify(requestBody)})});
}

export function latestLystReport(index,{now=new Date()}={}) {
  const candidates=[...index.matchAll(/href=["']https:\/\/www\.lyst\.com\/the-lyst-index\/Q([1-4])-(\d{2})\/?["']/g)].map(match=>{
    const quarter=Number(match[1]),year=2000+Number(match[2]);
    const start=new Date(Date.UTC(year,(quarter-1)*3,1)),end=new Date(Date.UTC(year,quarter*3,0));
    return {url:`https://www.lyst.com/the-lyst-index/Q${quarter}-${match[2]}/`,reportId:`lyst:Q${quarter}-${match[2]}`,periodStart:start.toISOString().slice(0,10),periodEnd:end.toISOString().slice(0,10),end:end.getTime(),rankingPeriod:`Q${quarter} ${year}`};
  }).sort((a,b)=>b.end-a.end);
  const latest=candidates[0],capture=new Date(now).getTime();
  if(!latest||latest.end>capture||capture-latest.end>180*86400000)throw Error('LYST_LATEST_REPORT_UNVERIFIED');
  const {end,...report}=latest;return report;
}

export function parseSearchKeywordSnapshot(text,source,{capturedAt}={}) {
  const data=['tagwalk-traffic','lyst-brand-index'].includes(source.adapter)?null:JSON.parse(text);
  let entries,sourceUpdatedAt=null,sourceTitle,kind='search-rank',rankingPeriod=source.rankingPeriod??null,report={};
  if(source.adapter==='musinsa-search') {
    if(data.meta?.result!=='SUCCESS')throw Error('SEARCH_SOURCE_UNSUCCESSFUL');
    const list=data.data?.componentList?.find(row=>row.key==='popular');
    if(list?.meta?.title!=='인기 검색어'||!Array.isArray(list.items))throw Error('SEARCH_LIST_UNVERIFIED');
    sourceTitle=list.meta.title;sourceUpdatedAt=list.meta.updateDate||null;
    // The official search-home UI numbers this list with a CSS counter.
    // rankIncrement is the change in rank, never the absolute rank.
    entries=list.items.map((row,index)=>({term:row.text,rank:index+1}));
  } else if(source.adapter==='29cm-search') {
    const list=data.data?.popularKeywords;
    if(list?.title?.text!=='인기 검색어'||!Array.isArray(list.rankings))throw Error('SEARCH_LIST_UNVERIFIED');
    sourceTitle=list.title.text;sourceUpdatedAt=list.title.subText||null;
    entries=list.rankings.map(row=>({term:row.title,rank:row.rank}));
  } else if(source.adapter==='tiktok-hashtags') {
    if(data.BaseResp?.StatusCode!==0||!Array.isArray(data.items)||source.requestBody?.countryCode!==source.country||source.requestBody?.timeRange!==7)throw Error('HASHTAG_LIST_UNVERIFIED');
    // The public endpoint may restrict anonymous callers to three rows. Do not
    // invent a larger capture range or fall back to sample data in its JS bundle.
    entries=data.items.map(row=>({term:row.hashtagName,rank:row.rankIndex,sourceItemId:row.hashtagID}));
    sourceTitle='Hashtag';kind='hashtag-rank';
  } else if(source.adapter==='tagwalk-traffic') {
    const sections=[...text.matchAll(/<section\b[^>]*class=["'][^"']*\bbrands-ranking\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/g)];
    if(sections.length!==1||!sections[0][1].includes('Basado en el tráfico de Tagwalk'))throw Error('TRAFFIC_RANKING_UNVERIFIED');
    const section=sections[0][1],range=section.match(/\((\d{1,2} [A-Za-z]{3} \d{4}) - (\d{1,2} [A-Za-z]{3} \d{4})\)/);
    const begin=calendarInstant(range?.[1]),end=calendarInstant(range?.[2]),capture=Date.parse(capturedAt);
    if(!range||!Number.isFinite(begin)||!Number.isFinite(end)||begin>end||end-begin>8*86400000||end>capture||capture-end>8*86400000)throw Error('TRAFFIC_REPORT_DATE_INVALID');
    entries=[...section.matchAll(/<span class=["']rank-number["']>(\d+)<\/span>[\s\S]*?<span class=["']brand["']>([^<]+)<\/span>/g)].map(match=>({term:htmlText(match[2]),rank:Number(match[1])}));
    sourceTitle='Ranking de marcas';kind='composite-rank';rankingPeriod=`${range[1]} – ${range[2]}`;
    sourceUpdatedAt=new Date(end).toISOString().slice(0,10);
    report={reportId:`tagwalk-traffic:${range[1]}:${range[2]}`,periodStart:new Date(begin).toISOString().slice(0,10),periodEnd:sourceUpdatedAt,latestPeriodVerified:true,metric:'brand-traffic',validUntil:new Date(end+7*86400000).toISOString().slice(0,10),validityBasis:'최신 홈페이지의 명시 기간 확인 · 기간 종료일부터 7일 이내'};
  } else if(source.adapter==='lyst-brand-index') {
    if(!source.latestReportVerified||!source.reportId||!source.periodEnd||Date.parse(capturedAt)-Date.parse(source.periodEnd)>180*86400000)throw Error('LYST_REPORT_UNVERIFIED');
    const identity=/^lyst:(Q[1-4]-\d{2})$/.exec(source.reportId)?.[1];
    const meta=[...text.matchAll(/<meta\b[^>]*>/gi)].find(match=>/\bproperty=["']og:title["']/.test(match[0]))?.[0].match(/\bcontent=["']([^"']+)["']/)?.[1];
    const canonical=[...text.matchAll(/<link\b[^>]*>/gi)].find(match=>/\brel=["']canonical["']/.test(match[0]))?.[0].match(/\bhref=["']([^"']+)["']/)?.[1];
    const visibleQuarter=text.match(/<div class=["']text-block-4 right["']>\s*(Q[1-4]-\d{2})\s*<\/div>/)?.[1];
    if(!identity||meta!==identity||visibleQuarter!==identity||canonical!==source.apiUrl||new URL(canonical).pathname!==`/the-lyst-index/${identity}/`)throw Error('LYST_REPORT_IDENTITY_MISMATCH');
    entries=[...text.matchAll(/<div class="chart-text-left">\s*<div class="mono-type update">(\d+)<\/div>\s*<div class="mono-type">([^<]+)<\/div>/g)].map(match=>({term:htmlText(match[2]),rank:Number(match[1])}));
    // Other hidden templates on this page contain old tables. Only the current
    // visible chart's explicit rank/name structure is accepted, exactly 1–20.
    if(entries.length!==20||entries.some((row,index)=>row.rank!==index+1))throw Error('LYST_CHART_UNVERIFIED');
    sourceTitle='Hottest Brands';kind='composite-rank';sourceUpdatedAt=source.periodEnd;
    report={reportId:source.reportId,periodStart:source.periodStart,periodEnd:source.periodEnd,latestPeriodVerified:true,metric:'quarterly-brand-popularity',validUntil:new Date(Date.parse(source.periodEnd)+180*86400000).toISOString().slice(0,10),validityBasis:'공식 Index에서 최신 완료 분기 확인 · 분기 종료일부터 180일 이내'};
  } else throw Error('SEARCH_ADAPTER_UNSUPPORTED');
  if(!entries.length||entries.some(row=>!validTerm(row.term)||!Number.isInteger(row.rank)||row.rank<1))throw Error('SEARCH_ROWS_INVALID');
  if(new Set(entries.map(row=>row.rank)).size!==entries.length||new Set(entries.map(row=>row.term)).size!==entries.length)throw Error('SEARCH_ROWS_DUPLICATED');
  if(!Number.isFinite(Date.parse(capturedAt)))throw Error('SEARCH_CAPTURE_DATE_INVALID');
  const contentHash=createHash('sha256').update(text).digest('hex');
  const snapshotId=`${source.id}:${capturedAt}:${contentHash.slice(0,16)}`;
  // Preserve the source's label and rank, including gaps; never translate or renumber.
  return {
    sourceRanks:entries.slice(0,source.captureLimit).map(row=>({
      platform:source.id,platformName:source.name,...row,kind,verified:true,
      sourceUrl:source.url,evidenceUrl:source.apiUrl,capturedAt,rankingPeriod,...report,
      sourceUpdatedAt,sourceTitle,country:source.country,scope:source.scope,snapshotId,
      rankBasis:source.rankBasis,contentHash,...(source.rankingDefinition?{rankingDefinition:source.rankingDefinition}:{})
    })),
    snapshotId,contentHash,sourceUpdatedAt,sourceTitle,rankingPeriod,...report,entryCount:entries.length
  };
}

async function preserveSnapshot(directory,source,text,parsed,capturedAt) {
  if(!directory)return;
  await mkdir(directory,{recursive:true});
  const safeId=source.id.replace(/[^a-z0-9.-]/gi,'_');
  const name=`${safeId}-${capturedAt.replace(/[:.]/g,'-')}-${parsed.contentHash.slice(0,16)}.json`;
  const snapshot={schemaVersion:1,platform:source.id,evidenceUrl:source.apiUrl,capturedAt,
    sourceUpdatedAt:parsed.sourceUpdatedAt,contentHash:parsed.contentHash,snapshotId:parsed.snapshotId,
    request:{authenticated:false,cookies:false,scope:source.scope,method:source.method==='POST'?'POST':'GET',...(source.requestBody?{body:source.requestBody}:{})},body:['tagwalk-traffic','lyst-brand-index'].includes(source.adapter)?{format:'html',text}:JSON.parse(text)};
  // Public response only; immutable file, outside tracked catalog data.
  try {await writeFile(resolve(directory,name),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});}
  catch(error){if(error.code!=='EEXIST')throw error;}
}

export async function collectSearchKeywords({config,now=new Date(),readPublic=readSearchSource,auditDir=resolve(fileURLToPath(new URL('../logs/research/search-keywords/',import.meta.url)))}={}) {
  config??=JSON.parse(await readFile(configUrl,'utf8'));
  const capturedAt=new Date(now).toISOString();
  const results=await Promise.all((config.sources||[]).filter(source=>source.enabled!==false).map(async source=>{
    const base={platform:source.id,name:source.name,url:source.url,checkedAt:capturedAt};
    try {
      if(new URL(source.apiUrl).origin!==supportedOrigins[source.adapter])throw Error('SEARCH_ORIGIN_UNREVIEWED');
      if(source.adapter==='lyst-brand-index') {
        const indexSource=source,index=await readPublic(source.apiUrl),report=latestLystReport(index,{now});
        source={...source,...report,apiUrl:report.url,latestReportVerified:true};
        base.url=report.url;
        await preserveSnapshot(auditDir,{...indexSource,id:'lyst-index'},index,{sourceUpdatedAt:report.periodEnd,contentHash:createHash('sha256').update(index).digest('hex'),snapshotId:`lyst-index:${capturedAt}`},capturedAt);
      }
      const text=await readPublic(source.apiUrl,{method:source.method==='POST'?'POST':'GET',requestBody:source.requestBody}),parsed=parseSearchKeywordSnapshot(text,source,{capturedAt});
      await preserveSnapshot(auditDir,source,text,parsed,capturedAt);
      return {sourceRanks:parsed.sourceRanks,status:{...base,status:'available',reason:null,
        count:parsed.sourceRanks.length,sourceUpdatedAt:parsed.sourceUpdatedAt,rankingPeriod:parsed.rankingPeriod,snapshotId:parsed.snapshotId,kind:parsed.sourceRanks[0]?.kind,country:source.country,...(parsed.reportId?{reportId:parsed.reportId,periodEnd:parsed.periodEnd}:{})},
        diagnostic:{platform:source.id,status:'fetched',contentHash:parsed.contentHash,entryCount:parsed.entryCount,checkedAt:capturedAt}};
    } catch(error) {
      return {sourceRanks:[],status:{...base,status:'unavailable',reason:source.adapter==='tiktok-hashtags'?'공개 해시태그 순위 원문 확인 불가':source.adapter==='tagwalk-traffic'?'공개 트래픽 순위 원문 확인 불가':'공개 검색순위 원문 확인 불가'},
        diagnostic:{platform:source.id,status:'unavailable',reason:error.message,checkedAt:capturedAt}};
    }
  }));
  return {sourceRanks:results.flatMap(result=>result.sourceRanks),searchRankStatus:[...results.map(result=>result.status),
    ...(config.unavailable||[]).map(source=>({platform:source.id,name:source.name,url:source.url,kind:source.kind||'search-rank',status:'unavailable',reason:source.reason,checkedAt:config.verifiedAt||capturedAt}))],
    checkedAt:capturedAt,diagnostics:results.map(result=>result.diagnostic)};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const result=await collectSearchKeywords();
  // CLI prints source status and counts only; collection is consumed by the weekly job.
  console.log(JSON.stringify({checkedAt:result.checkedAt,rows:result.sourceRanks.length,searchRankStatus:result.searchRankStatus,diagnostics:result.diagnostics},null,2));
}
