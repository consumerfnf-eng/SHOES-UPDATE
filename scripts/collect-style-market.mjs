import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readPublicSource} from './source-feeds.mjs';
import {styleTopicsInText,validStyleObservations} from './style-trend-board.mjs';

export const CALENDAR_URL='https://www.soleretriever.com/sneaker-release-dates';
const hash=text=>createHash('sha256').update(text).digest('hex');
const excluded=/\b(?:boots?|loafers?|pumps?|heels?|clogs?|slippers?|sandals?)\b|부츠|로퍼|펌프스|구두|플랫슈즈|슬리퍼|샌들|클로그/iu;
export function parseRetailStyles(text,source,{now=new Date()}={}){
  const data=JSON.parse(text),items=[];
  if(source.adapter==='musinsa'&&data.meta?.result==='SUCCESS')for(const item of data.data?.modules?.filter(m=>m.type==='MULTICOLUMN').flatMap(m=>m.items||[])||[]){
    const p=item.onClick?.eventLog?.ga4?.payload;
    if(p?.section_name==='ranking_goods_list'&&p.applied_tab==='ranking_cat'&&String(p.item_category_id)===source.categoryCode)items.push({name:item.info?.productName,id:String(p.item_id),rank:item.image?.rank});
  }
  if(source.adapter==='29cm'&&data.result==='SUCCESS')for(const [i,item]of (data.data?.content||[]).slice(0,100).entries()){
    // The category endpoint includes dress shoes. Only an explicit sneaker/running
    // subcategory is sufficient; a brand name alone never establishes shoe type.
    const categories=item.frontCategoryInfo||[];
    if(categories.some(c=>String(c.category1Code)===source.categoryCode)&&categories.some(c=>/스니커즈|운동화|런닝화|러닝화|스포츠화/.test(JSON.stringify(c))))items.push({name:item.itemName,id:String(item.itemNo),rank:i+1});
  }
  if(!items.length)throw Error('STYLE_RETAIL_SNEAKER_ROWS_UNAVAILABLE');
  const observations=items.filter(i=>typeof i.name==='string'&&!excluded.test(i.name)&&Number.isInteger(i.rank)&&i.rank>0&&i.rank<=100).flatMap(item=>styleTopicsInText(item.name).map(topicId=>({topicId,kind:'retail',sourceId:source.id,sourceUrl:source.url,evidenceId:item.id,itemName:item.name,sourceRank:item.rank,capturedAt:new Date(now).toISOString(),contentHash:hash(text),verified:true})));
  return {observations,itemCount:items.filter(i=>Number.isInteger(i.rank)&&i.rank>0&&i.rank<=100&&!excluded.test(i.name||'')).length};
}
export function parseCalendarStyles(markdown,{now=new Date()}={}){
  if(!/^# Sneaker Release Dates|^Sneaker Release Dates\s*$/m.test(markdown)||!/Releases starting|Upcoming Releases/.test(markdown))throw Error('STYLE_CALENDAR_SCHEMA_UNAVAILABLE');
  const body=markdown.split(/\[\*\*News\*\*\]|^##? News/m)[0],items=[];
  for(const match of body.matchAll(/!\[([^\]]+)\]\([^\n]+\)\s*\n\s*([A-Z][a-z]+ \d{1,2}, 20\d{2})\s*\n\s*([^\n]+)\s*\n\s*\$[^\n]*[•·]\s*([A-Z0-9-]+)/g)){
    const [,alt,date,name,id]=match;if(alt.replace(/^Image \d+:\s*/,'').trim()!==name.trim()||excluded.test(name)||!Number.isFinite(Date.parse(date)))continue;
    items.push({name:name.trim(),id,date:new Date(date+' 00:00:00 GMT').toISOString().slice(0,10)});
  }
  if(!items.length)throw Error('STYLE_CALENDAR_ITEMS_UNAVAILABLE');
  return {itemCount:items.length,observations:validStyleObservations(items.flatMap(item=>styleTopicsInText(item.name).map(topicId=>({topicId,kind:'calendar',sourceId:'sole-retriever',sourceUrl:CALENDAR_URL,evidenceId:item.id,itemName:item.name,releaseDate:item.date,capturedAt:new Date(now).toISOString(),contentHash:hash(markdown),verified:true}))),{now})};
}
export async function collectStyleMarket({now=new Date(),readPublic=readPublicSource,config,previousObservations=[],auditDir=new URL('../logs/research/style-market/',import.meta.url)}={}){
  config??=JSON.parse(await fs.readFile(new URL('../config/signal-sources.json',import.meta.url),'utf8'));
  const results=await Promise.all(config.rankingPages.filter(s=>s.category!=='샌들/슬리퍼').map(async source=>{
    try{const body=await readPublic(source.apiUrl),parsed=parseRetailStyles(body,source,{now});if(auditDir){await fs.mkdir(auditDir,{recursive:true});await fs.writeFile(new URL(`${source.id}-${source.categoryCode}-${hash(body).slice(0,16)}.json`,auditDir),body);}return {...parsed,status:{source:source.id,category:source.category,status:'available',items:parsed.itemCount}};}
    catch(e){return {observations:[],status:{source:source.id,category:source.category,status:'unavailable',reason:e.message}};}
  }));
  let calendar;
  try{
    // Public Reader is a bounded alternative representation, never a CAPTCHA solver.
    const response=await readPublic('https://r.jina.ai/'+CALENDAR_URL,{headers:{Accept:'text/plain'}});
    let body=response;if(response.trim().startsWith('{')){const data=JSON.parse(response);if(data.data?.url!==CALENDAR_URL)throw Error('STYLE_CALENDAR_ORIGIN_MISMATCH');body=data.data.content||'';}
    if(/captcha|security verification|Just a moment/i.test(body))throw Error('STYLE_CALENDAR_ACCESS_LIMITED');
    if(body.startsWith('Title:')&&!body.includes('URL Source: '+CALENDAR_URL+'\n'))throw Error('STYLE_CALENDAR_ORIGIN_MISMATCH');
    if(auditDir){await fs.mkdir(auditDir,{recursive:true});await fs.writeFile(new URL(`calendar-${hash(body).slice(0,16)}.txt`,auditDir),body);}
    calendar=parseCalendarStyles(body,{now});calendar.status={source:'sole-retriever',status:'available',items:calendar.itemCount};
  }catch(e){
    // A previously checked capture can bridge one week, with its ORIGINAL date.
    // It never becomes fresh merely because this scheduled job ran again.
    const observations=validStyleObservations(previousObservations.filter(r=>r.kind==='calendar'&&r.sourceId==='sole-retriever'),{now});
    calendar={observations,status:{source:'sole-retriever',status:observations.length?'recent-verified-capture':'unavailable',reason:e.message,capturedAt:observations[0]?.capturedAt||null}};
  }
  return {observations:[...results.flatMap(r=>r.observations),...calendar.observations],diagnostics:[...results.map(r=>r.status),calendar.status]};
}
