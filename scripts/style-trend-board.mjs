import fs from 'node:fs';
import {matchesSearchTerm,resolveSearchTerm} from './keyword-taxonomy.mjs';
import {calendarShift,validCalendarDay} from '../public/assets/release-window.mjs';

export const STYLE_TOPICS=JSON.parse(fs.readFileSync(new URL('../config/style-trend-board.json',import.meta.url),'utf8')).topics;
const day=value=>new Date(new Date(value).getTime()+9*3600000).toISOString().slice(0,10);
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export function styleTopicsInText(text){return STYLE_TOPICS.filter(t=>new RegExp(t.pattern,'iu').test(text)).map(t=>t.id);}
export function validStyleObservations(rows=[],{now=new Date()}={}){
  const stamp=new Date(now).getTime(),today=day(now),cutoff=calendarShift(today,-3),unique=new Map();
  for(const row of rows){
    const age=stamp-Date.parse(row.capturedAt);
    if(row.verified!==true||!STYLE_TOPICS.some(t=>t.id===row.topicId)||!safeUrl(row.sourceUrl)||!row.sourceId||!row.evidenceId||!Number.isFinite(age)||age<0||age>7*86400000)continue;
    if(row.kind==='editorial'){
      if(!Number.isFinite(Date.parse(row.publishedAt))||Date.parse(row.publishedAt)>stamp||day(row.publishedAt)<cutoff)continue;
    }else if(row.kind==='calendar'){
      const delta=Date.parse(row.releaseDate)-Date.parse(today);
      if(!validCalendarDay(row.releaseDate)||Math.abs(delta)>30*86400000||!row.itemName)continue;
    }else if(row.kind==='retail'||row.kind==='search'){
      if(!Number.isInteger(row.sourceRank)||row.sourceRank<1||row.sourceRank>100||!row.itemName)continue;
    }else continue;
    const key=[row.topicId,row.kind,row.sourceId,row.evidenceId].join('|'),prior=unique.get(key);
    if(!prior||Date.parse(row.capturedAt)>Date.parse(prior.capturedAt)||row.capturedAt===prior.capturedAt&&row.sourceRank<prior.sourceRank)unique.set(key,row);
  }
  return [...unique.values()].sort((a,b)=>a.topicId.localeCompare(b.topicId)||a.kind.localeCompare(b.kind)||a.sourceId.localeCompare(b.sourceId)||a.evidenceId.localeCompare(b.evidenceId));
}
export function searchStyleObservations(rows=[]){
  return rows.filter(r=>r.verified&&r.kind==='search-rank'&&['musinsa','29cm'].includes(r.platform)).flatMap(r=>{
    const query=resolveSearchTerm(r.term);
    // Style/color words inside an unrelated clothing search must not become shoe demand.
    if(query.literalTerms.length||query.conceptIds.some(id=>id.startsWith('brand:')))return [];
    const key=query.conceptIds.filter(id=>!id.startsWith('category:')).join('|');
    return STYLE_TOPICS.filter(t=>t.queries.some(q=>resolveSearchTerm(q).key===key)).map(t=>({topicId:t.id,kind:'search',sourceId:r.platform,sourceUrl:r.sourceUrl,evidenceId:r.term,itemName:r.term,sourceRank:r.rank,capturedAt:r.capturedAt,verified:true}));
  });
}
export function buildStyleTrendBoard(products,observations=[],{now=new Date(),updated=new Date(now).toISOString(),sourceRanks=[]}={}){
  const valid=validStyleObservations([...observations,...searchStyleObservations(sourceRanks)],{now});
  const items=STYLE_TOPICS.flatMap(topic=>{
    const evidence=valid.filter(row=>row.topicId===topic.id);if(!evidence.length)return [];
    const channels=[...new Set(evidence.map(r=>r.kind))];
    const sourceCount=new Set(evidence.map(r=>r.sourceId)).size;
    const editorialCount=new Set(evidence.filter(r=>r.kind==='editorial').map(r=>r.sourceUrl)).size;
    const retailCount=evidence.filter(r=>r.kind==='retail').length,calendarCount=evidence.filter(r=>r.kind==='calendar').length;
    const best=new Map();for(const row of evidence.filter(r=>['retail','search'].includes(r.kind))){const key=row.kind+'|'+row.sourceId;best.set(key,Math.min(best.get(key)||Infinity,row.sourceRank));}
    const rankSignal=[...best.values()].reduce((sum,rank)=>sum+1/rank,0);
    const productIds=products.filter(p=>topic.queries.some(q=>matchesSearchTerm(p,q))).map(p=>p.id).sort();
    return [{id:'style-'+topic.id,keywordType:'style',label:topic.label,englishLabel:topic.englishLabel,aliases:topic.queries,productIds,matchedProductCount:productIds.length,sourceCount,editorialCount,retailCount,calendarCount,channels,rankSignal,evidence}];
  }).sort((a,b)=>b.sourceCount-a.sourceCount||b.editorialCount-a.editorialCount||b.rankSignal-a.rankSignal||b.calendarCount-a.calendarCount||a.id.localeCompare(b.id));
  return {method:'verified-style-board-v1',updated,observations:valid,items:items.map((k,i)=>({...k,rank:i+1}))};
}
