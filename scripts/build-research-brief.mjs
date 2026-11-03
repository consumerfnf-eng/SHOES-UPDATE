import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {prepareCatalog} from '../public/assets/catalog-runtime.mjs';
import {isOverlay,variantGroupKey,variantGroupName,kstToday} from '../public/assets/catalog-view.mjs';
import {priceKrw,RATE_NOTE} from '../public/assets/analysis.mjs';
import {siteBrandGroup} from '../public/assets/site-brand-policy.mjs';
import {buildStyleTrendBoard,styleTopicsInText} from './style-trend-board.mjs';
import {forecastSeasons,reportSeason,silhouetteKeywords} from '../public/assets/forecast.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const read=async file=>JSON.parse(await fs.readFile(path.join(ROOT,file),'utf8'));
const optional=async(file,fallback)=>read(file).catch(e=>{if(e.code==='ENOENT')return fallback;throw e;});
const goodUrl=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export function weekKey(date){const d=new Date(kstToday(date)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-d.getUTCDay());return d.toISOString().slice(0,10);}
export function recordResearchWeek(history,snapshot,scope){
 const out=structuredClone(history||{schemaVersion:1,series:{}});out.series??={};const weeks=out.series[scope]||[];
 out.series[scope]=[...weeks.filter(w=>w.week!==snapshot.week),snapshot].sort((a,b)=>a.week.localeCompare(b.week)).slice(-52);return out;
}
export function fourWeekChange(weeks,id){
 const usable=(weeks||[]).slice(-4);
 if(usable.length<4)return {ready:false,weeks:usable.length,needs:4};
 for(let i=1;i<usable.length;i++)if(Date.parse(usable[i].week)-Date.parse(usable[i-1].week)!==7*86400000)return {ready:false,weeks:usable.length,needs:4,reason:'연속된 관측 주가 부족합니다'};
 if(usable.some(w=>!(w.models>0)||!Number.isFinite(w.topics?.[id])))return {ready:false,weeks:usable.length,needs:4};
 const first=usable[0],last=usable.at(-1);return {ready:true,weeks:4,firstShare:first.topics[id]/first.models,lastShare:last.topics[id]/last.models,percentagePoints:100*(last.topics[id]/last.models-first.topics[id]/first.models)};
}
export function referencePrices(products){
 const groups=new Map();for(const p of products){if(siteBrandGroup(p.brand)==='LUX')continue;const value=priceKrw(p);if(value==null)continue;const key=variantGroupKey(p);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(value);}
 const values=[...groups.values()].map(prices=>[...new Set(prices)].sort((a,b)=>a-b)[Math.floor((new Set(prices).size-1)/2)]).sort((a,b)=>a-b);
 if(!values.length)return {models:0,note:'가격 근거가 없어 목표 가격을 생성하지 않았습니다.'};
 const q=f=>values[Math.floor((values.length-1)*f)];return {models:values.length,p25:q(.25),median:q(.5),p75:q(.75),note:'SPORTS·CASUAL 관측 모델별 가격의 중앙 50% 구간. 목표 판매가가 아니며 원가·마진 검토가 필요합니다.',rateNote:RATE_NOTE};
}
export async function buildResearchBrief({now=new Date()}={}){
 const catalog=await read('public/data/catalog.json'),overlay=await read('public/data/monthly-catalog.json');
 const previous=catalog.styleTrendKeywords||{};
 const observed=(previous.items||[]).flatMap(k=>k.evidence||[]);
 const updated=observed.map(e=>e.capturedAt).filter(t=>Number.isFinite(Date.parse(t))).sort().at(-1)||previous.updated;
 const board=buildStyleTrendBoard(catalog.products,observed,{now,updated});
 catalog.styleTrendKeywords={...previous,method:board.method,updated,items:board.items};
 // Keep publication-time validation and the visible keyword board on one basis.
 await fs.writeFile(path.join(ROOT,'public/data/catalog.json'),JSON.stringify(catalog)+'\n');
 const runtime=prepareCatalog(catalog,overlay,null,kstToday(now));
 const official=runtime.products.filter(p=>!isOverlay(p)),models=new Set(official.map(variantGroupKey)).size;
 const plans=await read('config/research-proposals.json');
 const ranks=await optional('public/data/rank-boards.json',{boards:[]});
 const catwalk=await optional('public/data/catwalk.json',{looks:[]});
 const forecast=await optional('public/data/forecast.json',{reports:[]});
 const scope=createHash('sha256').update(JSON.stringify({grain:'published-official-model-v1',brands:catalog.brands.map(b=>({name:b.name,group:siteBrandGroup(b.name)})).sort((a,b)=>a.name.localeCompare(b.name)),topicsVersion:1})).digest('hex').slice(0,20);
 const counts=Object.fromEntries(board.items.map(k=>[k.id,runtime.keywordViews.get(k.id)?.count||0]));
 const current={week:weekKey(now),asOf:kstToday(now),models,topics:counts};
 const history=recordResearchWeek(await optional('data/research-history.json',{schemaVersion:1,series:{}}),current,scope);
 await fs.writeFile(path.join(ROOT,'data/research-history.json'),JSON.stringify(history)+'\n');
 const activeSeasons=forecastSeasons(now);
 const ideas=board.items.slice(0,5).map(keyword=>{
  const topic=keyword.id.replace(/^style-/,''),ids=runtime.keywordViews.get(keyword.id)?.ids||new Set();
  const matched=official.filter(p=>ids.has(p.id));
  const sources=[...new Map(keyword.evidence.filter(e=>goodUrl(e.sourceUrl)).map(e=>[e.sourceUrl,{url:e.sourceUrl,kind:e.kind,source:e.sourceId,capturedAt:e.capturedAt,publishedAt:e.publishedAt||e.releaseDate||null}])).values()];
  const ranking=(ranks.boards||[]).filter(b=>b.observationMethod==='reviewed-dom'&&!b.staleSince&&Date.parse(now)-Date.parse(b.checkedAt)>=0&&Date.parse(now)-Date.parse(b.checkedAt)<=7*86400000).flatMap(b=>(b.items||[]).filter(p=>styleTopicsInText(p.name||'').includes(topic)).map(p=>({rank:p.rank,name:p.name,url:p.url,board:b.label,basis:b.basis,checkedAt:b.checkedAt})));
  const visuals=(catwalk.looks||[]).filter(l=>styleTopicsInText((l.hashtags||[]).join(' ')).includes(topic));
  const future=forecast.reports.filter(r=>activeSeasons.includes(reportSeason(r.title))&&silhouetteKeywords(r.headings||[]).some(h=>styleTopicsInText(h).includes(topic))).map(r=>({title:r.title,url:r.url,season:reportSeason(r.title)}));
  const samples=[...new Map(matched.map(p=>[variantGroupKey(p),p])).values()].slice(0,4).map(p=>({id:p.id,brand:p.brand,name:variantGroupName(p),url:p.url,image:p.presentation?.thumbnail?.path||p.presentation?.cachedPath}));
  return {id:keyword.id,rank:keyword.rank,label:keyword.label,englishLabel:keyword.englishLabel,models:counts[keyword.id],sources,independentDomains:new Set(sources.map(s=>new URL(s.url).hostname.replace(/^www\./,''))).size,ranking,visuals:visuals.length,future,samples,prices:referencePrices(matched),change:fourWeekChange(history.series[scope],keyword.id),plan:plans.plans[keyword.id]||null};
 });
 const output={schemaVersion:1,asOf:kstToday(now),generatedAt:now.toISOString(),evidenceCapturedAt:updated,week:current.week,scope:{id:scope,grain:'model',models,description:'게시된 LUX·SPORTS·CASUAL 공식 카탈로그 모델. 색상 변형은 한 번만 집계하며 리테일·기사 목록은 공급 집계에서 제외합니다.'},planVersion:plans.version,ideas,method:'기존 스타일 선정 기준의 TOP 5 → 출처 근거 → 분석가 해석 → 기획 가설 → 검증. 판매량·시장점유율은 추정하지 않습니다.'};
 await fs.writeFile(path.join(ROOT,'public/data/research-brief.json'),JSON.stringify(output)+'\n');return output;
}
if(process.argv[1]?.endsWith('build-research-brief.mjs')){const b=await buildResearchBrief();console.log({ideas:b.ideas.length,models:b.scope.models,week:b.week});}
