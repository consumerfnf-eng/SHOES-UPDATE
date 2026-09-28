import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readPublicSource,htmlText} from './source-feeds.mjs';
import {kstDay,validDay} from './curation.mjs';

const configUrl=new URL('../config/forecast-sources.json',import.meta.url);
const urls=new Set(['https://www.wgsn.com/en/blog/s-s-27-key-colours-have-landed','https://www.wgsn.com/jp/node/2563']);
const terms=['Luminous Blue','Energy Orange','Pop Pink','Meadowland Green','Clay'];
const title='The S/S 27 Key Colours have landed';
const hash=text=>createHash('sha256').update(text).digest('hex');
function validateSource(source) {
  if(source.adapter!=='wgsn-seasonal-colours'||!urls.has(source.url)||!urls.has(source.alternateUrl)||source.title!==title||source.publishedAt!=='2025-07-18')throw Error('FORECAST_SOURCE_UNREVIEWED');
  if(!validDay(source.validUntil)||source.validUntil!=='2027-08-31'||source.validityBasis!=='season-end-policy'||source.forecastPeriod!=='S/S 2027')throw Error('FORECAST_SEASON_INVALID');
  if(JSON.stringify(source.terms?.map(t=>t.label))!==JSON.stringify(terms))throw Error('FORECAST_TERMS_UNREVIEWED');
}
export function parseForecastPage(body,source) {
  validateSource(source);let text=body;
  if(body.trim().startsWith('{')) {
    const data=JSON.parse(body);if(data.code!==200||!urls.has(data.data?.url)||data.data?.title!==title||typeof data.data?.content!=='string')throw Error('FORECAST_READER_INVALID');
    text=`# ${data.data.title}\n${data.data.content}`;
  } else if(/<html\b/i.test(body)) {
    const article=body.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)?.[0];
    if(!article)throw Error('FORECAST_ARTICLE_MISSING');text=htmlText(article);
  }
  if(!text.includes(title)||!/Jul\s+18,\s+2025/.test(text)||!/S\/S\s*27/.test(text))throw Error('FORECAST_IDENTITY_UNVERIFIED');
  // Require all five article headings. Mentions in menus, related cards or a
  // snippet cannot establish the full public forecast.
  for(const term of terms)if(!new RegExp(`^#{1,6}\\s+${term}\\s*$`,'m').test(text))throw Error('FORECAST_COLOUR_HEADING_MISSING');
  const meadow=text.split(/^#{1,6}\s+Meadowland Green\s*$/m)[1]?.split(/^#{1,6}\s/m)[0]||'';
  if(!/footwear/i.test(meadow))throw Error('FORECAST_FOOTWEAR_CONTEXT_MISSING');
  return {contentHash:hash(body),publishedAt:source.publishedAt};
}
function reviewed(source,now) {
  const review=source.reviewedEvidence;
  return review?.verificationMethod==='reviewed-public-source'&&urls.has(review.sourceUrl)&&/^[a-f0-9]{64}$/.test(review.contentHash||'')&&Number.isFinite(Date.parse(review.verifiedAt))&&Date.parse(review.verifiedAt)<=new Date(now).getTime()&&JSON.stringify(review.exactTerms)===JSON.stringify(terms);
}
async function preserve(directory,source,record) {
  if(!directory)return;await mkdir(directory,{recursive:true});
  const digest=hash(JSON.stringify(record)),filename=`${source.id}-${record.checkedAt.replace(/[:.]/g,'-')}-${digest.slice(0,16)}.json`;
  if(!/^[a-z0-9.-]+$/i.test(source.id))throw Error('FORECAST_SOURCE_ID_INVALID');
  try {await writeFile(resolve(directory,filename),JSON.stringify(record,null,2)+'\n',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
}
export async function collectForecastKeywords({config,now=new Date(),readPublic=readPublicSource,auditDir=resolve(fileURLToPath(new URL('../logs/research/forecast-keywords/',import.meta.url)))}={}) {
  config??=JSON.parse(await readFile(configUrl,'utf8'));const checkedAt=new Date(now).toISOString(),day=kstDay(new Date(now));
  const results=await Promise.all((config.sources||[]).filter(s=>s.enabled!==false).map(async source=>{
    const base={platform:source.id,name:source.name,url:source.url,checkedAt,validUntil:source.validUntil,forecastPeriod:source.forecastPeriod};
    const attempts=[];let evidence=null,verificationMethod=null,capturedAt=null,automatedStatus='unavailable';
    try {
      validateSource(source);
      if(day>source.validUntil)return {sourceRanks:[],status:{...base,status:'unavailable',reason:'전망 시즌의 표시 기간이 끝났습니다.'}};
      for(const evidenceUrl of [source.url,`https://r.jina.ai/${source.alternateUrl}`]) {
        try {const body=await readPublic(evidenceUrl),parsed=parseForecastPage(body,source);evidence={...parsed,evidenceUrl:source.url};capturedAt=checkedAt;verificationMethod='public-source-fetch';automatedStatus='available';attempts.push({evidenceUrl,status:'verified',contentHash:parsed.contentHash,body});break;}
        catch(error){attempts.push({evidenceUrl,status:'unavailable',reason:error.message});}
      }
      if(!evidence&&reviewed(source,now)){evidence={contentHash:source.reviewedEvidence.contentHash,evidenceUrl:source.reviewedEvidence.sourceUrl,publishedAt:source.publishedAt};capturedAt=source.reviewedEvidence.verifiedAt;verificationMethod='reviewed-public-source';}
      await preserve(auditDir,source,{checkedAt,sourceUrl:source.url,automatedStatus,verificationMethod,attempts});
      if(!evidence)return {sourceRanks:[],status:{...base,status:'unavailable',automatedStatus,reason:'공개 전망 원문 확인 불가'}};
      return {sourceRanks:source.terms.map(term=>({platform:source.id,platformName:source.name,term:term.label,rank:null,kind:'forecast-keyword',verified:true,sourceUrl:source.url,evidenceUrl:evidence.evidenceUrl,capturedAt,verifiedAt:capturedAt,publishedAt:evidence.publishedAt,rankingPeriod:null,forecastPeriod:source.forecastPeriod,validUntil:source.validUntil,validityBasis:source.validityBasis,scope:'fashion-colour-forecast',applicability:term.scope,verificationMethod,automatedStatus,contentHash:evidence.contentHash,snapshotId:`${source.id}:${capturedAt}:${evidence.contentHash.slice(0,16)}`})),status:{...base,status:'available',automatedStatus,verificationMethod,verifiedAt:capturedAt,count:terms.length,reason:automatedStatus==='unavailable'?'검토한 공개 원문 유지 · 자동 재확인 불가':null}};
    } catch(error) {return {sourceRanks:[],status:{...base,status:'unavailable',automatedStatus,reason:'공개 전망 원문 확인 불가'},diagnostic:error.message};}
  }));
  const forecastStatus=[...results.map(r=>r.status),...(config.unavailable||[]).map(s=>({platform:s.id,name:s.name,url:s.url,status:'unsupported',checkedAt,reason:s.reason}))];
  return {sourceRanks:results.flatMap(r=>r.sourceRanks),forecastStatus,checkedAt,diagnostics:results.filter(r=>r.diagnostic).map(r=>({platform:r.status.platform,reason:r.diagnostic}))};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const result=await collectForecastKeywords();console.log(JSON.stringify({checkedAt:result.checkedAt,rows:result.sourceRanks.length,forecastStatus:result.forecastStatus,diagnostics:result.diagnostics},null,2));}
