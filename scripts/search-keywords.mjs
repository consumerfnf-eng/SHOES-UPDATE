import {createHash} from 'node:crypto';
import {resolveSearchTerm,matchesSearchTerm,searchTermAliases,isStyleTrendTerm} from './keyword-taxonomy.mjs';

export const KEYWORD_METHOD='verified-style-source-rank-v2';
export const KEYWORD_MAX_AGE_MS=7*86400000;
export const EDITORIAL_MAX_AGE_MS=30*86400000;
const rankedKinds=new Set(['search-rank','composite-rank','hashtag-rank']);
const unrankedKinds=new Set(['search-popular','editorial-keyword','forecast-keyword']);
const kindAliases={'search-keyword-rank':'search-rank','popular-search-term':'search-popular'};
const isUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const time=value=>Date.parse(value);
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(time(value))&&new Date(value).toISOString().slice(0,10)===value;
function safeRow(raw,now){
  const kind=kindAliases[raw.kind]||raw.kind;
  if(raw.verified!==true||typeof raw.platform!=='string'||!raw.platform.trim()||typeof raw.term!=='string'||!raw.term.trim()||!isUrl(raw.sourceUrl))return null;
  const age=now-time(raw.capturedAt);if(!Number.isFinite(age)||age<0)return null;
  if(kind==='forecast-keyword'){
    if(!validDay(raw.validUntil)||raw.validityBasis!=='season-end-policy')return null;
    const end=time(raw.validUntil+'T23:59:59.999+09:00');if(!Number.isFinite(end)||now>end)return null;
  }else if(age>KEYWORD_MAX_AGE_MS)return null;
  if(kind==='editorial-keyword'){const publishedAge=now-time(raw.publishedAt);if(!Number.isFinite(publishedAge)||publishedAge<0||publishedAge>EDITORIAL_MAX_AGE_MS)return null;}
  if(kind==='composite-rank'){
    if(raw.latestPeriodVerified!==true||!raw.reportId||!validDay(raw.periodEnd)||raw.periodStart!==undefined&&!validDay(raw.periodStart)||!validDay(raw.validUntil)||!raw.validityBasis)return null;
    const end=time(raw.validUntil+'T23:59:59.999+09:00');if(!Number.isFinite(end)||now>end)return null;
    const captureDay=new Date(time(raw.capturedAt)+9*3600000).toISOString().slice(0,10);
    if(raw.periodStart&&raw.periodStart>raw.periodEnd||raw.periodEnd>captureDay||raw.validUntil<raw.periodEnd)return null;
  }
  if(rankedKinds.has(kind)){if(!Number.isInteger(raw.rank)||raw.rank<1)return null;}
  else if(unrankedKinds.has(kind)){if(raw.rank!==null)return null;}
  else return null;
  // Only public provenance is serialized. No API response bodies or credentials enter the catalog.
  const row={platform:raw.platform,term:raw.term,rank:raw.rank,sourceUrl:raw.sourceUrl,verified:true,kind,capturedAt:raw.capturedAt,rankingPeriod:raw.rankingPeriod??null};
  for(const field of ['snapshotId','sourceUpdatedAt','scope','country','region','name','platformName','sourceTitle','sourceItemId','sourceOriginalContext','contentHash','rankingDefinition','forecastPeriod','validUntil','validityBasis','publishedAt','evidenceUrl','rankBasis','metric','latestPeriodVerified','reportId','periodStart','periodEnd','verificationMethod','automatedStatus','verifiedAt','applicability'])if(raw[field]!==undefined)row[field]=raw[field];
  if(row.evidenceUrl&&!isUrl(row.evidenceUrl))return null;
  return row;
}
function latestRows(records,now){
  const valid=records.map(row=>safeRow(row,now)).filter(Boolean);
  // Editorial mentions accumulate across many collection runs (each article must
  // recur in >=5 posts per outlet over time), so they are never snapshot-collapsed
  // like a full-list source: only exact duplicate (platform, article, term) rows merge.
  const editorial=valid.filter(row=>row.kind==='editorial-keyword'),rest=valid.filter(row=>row.kind!=='editorial-keyword');
  const editorialByIdentity=new Map();
  for(const row of editorial){
    const identity=[row.platform,row.sourceUrl,row.term].join('|'),existing=editorialByIdentity.get(identity);
    if(!existing||time(row.capturedAt)>time(existing.capturedAt))editorialByIdentity.set(identity,row);
  }
  const snapshots=new Map();
  const bucket=row=>row.platform+'|'+(row.kind==='forecast-keyword'?'forecast':'current');
  for(const row of rest){const id=row.snapshotId||row.capturedAt,existing=snapshots.get(bucket(row));if(!existing||time(row.capturedAt)>existing.at||time(row.capturedAt)===existing.at&&id.localeCompare(existing.id)>0)snapshots.set(bucket(row),{id,at:time(row.capturedAt)});}
  const seen=new Set();const keptRest=rest.filter(row=>{
    if((row.snapshotId||row.capturedAt)!==snapshots.get(bucket(row)).id)return false;
    const identity=[row.platform,row.snapshotId||row.capturedAt,row.kind,row.term,row.rank,row.sourceUrl].join('|');if(seen.has(identity))return false;seen.add(identity);return true;
  });
  return [...keptRest,...editorialByIdentity.values()];
}
const sourceOrder=(a,b)=>(a.rank??Infinity)-(b.rank??Infinity)||a.platform.localeCompare(b.platform)||a.term.localeCompare(b.term)||a.sourceUrl.localeCompare(b.sourceUrl);
function groupsFor(records,products,forecast){
  const groups=new Map();
  for(const row of records){if((row.kind==='forecast-keyword')!==forecast)continue;
    const resolved=resolveSearchTerm(row.term);if(!resolved.key)continue;
    if(!groups.has(resolved.key))groups.set(resolved.key,{resolved,rows:[]});groups.get(resolved.key).rows.push(row);
  }
  const result=[...groups].map(([key,{resolved,rows}])=>{
    rows.sort(sourceOrder);const bestByPlatform=new Map();
    for(const row of rows)if(rankedKinds.has(row.kind)&&(!bestByPlatform.has(row.platform)||row.rank<bestByPlatform.get(row.platform)))bestByPlatform.set(row.platform,row.rank);
    const score=forecast?0:[...bestByPlatform.values()].reduce((sum,rank)=>sum+1/rank,0),productIds=products.filter(p=>matchesSearchTerm(p,resolved)).map(p=>p.id).sort();
    return {id:(forecast?'forecast-':'keyword-')+createHash('sha256').update(key).digest('hex').slice(0,16),keywordType:'style',label:rows[0].term,aliases:[...new Set([...rows.map(r=>r.term),...searchTermAliases(resolved)])],productIds,matchedProductCount:productIds.length,sourceRanks:rows,sourceCount:new Set(rows.map(r=>r.platform)).size,score,rank:null,rankingStatus:forecast?'forecast':score?'ranked':'unranked'};
  }).sort((a,b)=>b.score-a.score||b.sourceCount-a.sourceCount||Math.min(...a.sourceRanks.map(r=>r.rank??Infinity))-Math.min(...b.sourceRanks.map(r=>r.rank??Infinity))||a.id.localeCompare(b.id));
  let rank=0;for(const item of result)if(!forecast&&item.score>0)item.rank=++rank;
  return result;
}
// Ecommerce platforms whose explicit search-term rankings combine into one 1-20 list.
// Rank is by cross-platform reciprocal-rank score only, never by how many matching
// products currently exist on this site.
const ECOMMERCE_PLATFORMS=new Set(['musinsa','29cm','eql','wconcept']);
// A media keyword must recur in at least this many distinct posts from the SAME
// magazine/newsletter before it qualifies; platforms below the threshold contribute nothing.
export const EDITORIAL_MIN_POSTS_PER_OUTLET=5;
function ecommerceRanking(records,products){
  const rows=records.filter(row=>rankedKinds.has(row.kind)&&ECOMMERCE_PLATFORMS.has(row.platform));
  return groupsFor(rows,products,false).filter(k=>k.score>0).slice(0,20).map((k,i)=>({...k,rank:i+1}));
}
function editorialRanking(records,products){
  const byOutletTerm=new Map();
  for(const row of records){
    if(row.kind!=='editorial-keyword')continue;
    const resolved=resolveSearchTerm(row.term);if(!resolved.key)continue;
    const key=row.platform+'|'+resolved.key;
    if(!byOutletTerm.has(key))byOutletTerm.set(key,{platform:row.platform,resolved,rows:[],urls:new Set()});
    const entry=byOutletTerm.get(key);entry.rows.push(row);entry.urls.add(row.sourceUrl);
  }
  const byTerm=new Map();
  for(const entry of byOutletTerm.values()){
    if(entry.urls.size<EDITORIAL_MIN_POSTS_PER_OUTLET)continue;
    if(!byTerm.has(entry.resolved.key))byTerm.set(entry.resolved.key,{resolved:entry.resolved,rows:[],postCount:0,platforms:new Set()});
    const term=byTerm.get(entry.resolved.key);term.rows.push(...entry.rows);term.postCount+=entry.urls.size;term.platforms.add(entry.platform);
  }
  const result=[...byTerm.values()].map(({resolved,rows,postCount,platforms})=>{
    rows.sort(sourceOrder);
    const productIds=products.filter(p=>matchesSearchTerm(p,resolved)).map(p=>p.id).sort();
    return {id:'media-'+createHash('sha256').update(resolved.key).digest('hex').slice(0,16),keywordType:'style',label:rows[0].term,aliases:[...new Set([...rows.map(r=>r.term),...searchTermAliases(resolved)])],productIds,matchedProductCount:productIds.length,sourceRanks:rows,sourceCount:platforms.size,score:postCount,rank:null,rankingStatus:'ranked'};
  }).sort((a,b)=>b.score-a.score||b.sourceCount-a.sourceCount||a.id.localeCompare(b.id)).slice(0,20);
  let rank=0;for(const item of result)item.rank=++rank;
  return result;
}
export function buildKeywordCatalog(products,records=[],{now=new Date()}={}){
  const at=new Date(now);if(!Number.isFinite(at.getTime()))throw Error('Invalid keyword verification time');
  const sourceRanks=latestRows(records,at.getTime()).filter(row=>isStyleTrendTerm(row.term,{scope:row.scope,products}));
  return {keywordMethod:KEYWORD_METHOD,keywordCheckedAt:at.toISOString(),sourceRanks,keywords:groupsFor(sourceRanks,products,false),forecastKeywords:groupsFor(sourceRanks,products,true),ecommerceKeywords:ecommerceRanking(sourceRanks,products),editorialKeywords:editorialRanking(sourceRanks,products)};
}
