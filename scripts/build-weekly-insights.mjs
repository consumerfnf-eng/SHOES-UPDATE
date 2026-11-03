import fs from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {prepareCatalog} from '../public/assets/catalog-runtime.mjs';
import {isOverlay,variantGroupKey,kstToday,filterProducts} from '../public/assets/catalog-view.mjs';
const root=new URL('../',import.meta.url);
const read=async p=>JSON.parse(await fs.readFile(new URL(p,root),'utf8'));
const unique=(rows,key)=>[...new Map(rows.map(r=>[key(r),r])).values()];
const text=p=>[p.name,p.fullName,p.material,...(p.keywords||[])].filter(Boolean).join(' ');
export function insightWeek(day){const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);const start=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+6);return {start,end:date.toISOString().slice(0,10)};}
export function buildWeeklySnapshot({directions,products,ranks,proposals,now=new Date()}){
 const asOf=kstToday(now),week=insightWeek(asOf),cards=[];
 for(const direction of directions){
  const re=new RegExp(direction.pattern,'iu');
  const official=unique(products.filter(p=>!isOverlay(p)&&['sneaker','hybrid'].includes(p.productType||p.category)&&re.test(text(p))),variantGroupKey);
  const ranking=ranks.boards.filter(b=>!b.staleSince&&Number.isFinite(Date.parse(b.checkedAt))&&Date.parse(b.checkedAt)<=now.getTime()&&now.getTime()-Date.parse(b.checkedAt)<=14*86400000).flatMap(b=>b.items.filter(p=>re.test(text(p))).map(p=>({...p,board:b.label,boardId:b.id,checkedAt:b.checkedAt,comparedWith:b.comparedWith||null})));
  const ideas=direction.proposals.map(id=>proposals.ideas.find(i=>i.id===id)).filter(Boolean);
  const refs=unique(ideas.flatMap(i=>i.references||[]),r=>r.kind+':'+r.id);
  const runway=refs.filter(r=>r.kind==='catwalk'),forecast=unique(ideas.flatMap(i=>i.forecast||[]),f=>f.id+':'+f.page);
  // Four source classes are required. Photographs are reviewed references,
  // not a measured share of all runway looks. No fabricated weekly growth.
  if(official.length<3||!ranking.length||!runway.length||!forecast.length)continue;
  const officialIds=new Set(official.map(variantGroupKey));
  const productRefs=refs.filter(r=>r.kind==='product'&&products.some(p=>p.id===r.id&&officialIds.has(variantGroupKey(p))));
  const movement=ranking.filter(r=>r.comparedWith&&kstToday(new Date(r.checkedAt))>=week.start&&['new','up','down'].includes(r.movement));
  cards.push({...direction,officialModels:official.length,officialExamples:official.slice(0,4).map(p=>({id:p.id,brand:p.brand,name:p.name,url:p.url,checkedAt:p.lastVerifiedAt||p.verifiedAt||p.arrivalEvidence?.verifiedAt||null})),ranking:unique(ranking,r=>r.boardId+':'+r.key),movement:movement.map(r=>({board:r.board,name:r.name,rank:r.rank,previousRank:r.previousRank||null,movement:r.movement,comparedWith:r.comparedWith,checkedAt:r.checkedAt})),runway,forecast,images:[productRefs[0]||refs.find(r=>r.kind==='product'),runway[0]].filter(Boolean),proposals:ideas.map(i=>({id:i.id,season:i.season,title:i.title,subtitle:i.subtitle,download:i.download}))});
 }
 return {schemaVersion:1,asOf,week,sourceDates:proposals.sourceDates,method:'공식 스니커즈·혼합형 모델을 색상·소재별 중복 없이 집계하고, 정상 수집된 최근 14일 이내 랭킹과 검토한 쇼 레퍼런스·시즌 Forecast를 교차 확인합니다. 상품명·소재의 키워드 연결과 검토 레퍼런스이며 판매량·시장 점유율이 아닙니다. 주간 변화는 이전 집계가 있는 이번 주 랭킹에만 표시합니다.',cards};
}
export async function buildWeeklyInsights({now=new Date()}={}){
 const config=await read('data/weekly-insight-directions.json').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(!config){console.log('Private weekly insight directions absent; no internal research published.');return null;}
 const [catalog,monthly,social,ranks,proposals]=await Promise.all(['public/data/catalog.json','public/data/monthly-catalog.json','public/data/trend-keywords.json','public/data/rank-boards.json','public/data/season-proposals.json'].map(read));
 const runtime=prepareCatalog(catalog,monthly,social,kstToday(now));
 const products=filterProducts(runtime.products,{source:'all',search:'',brands:new Set(),category:'all',release:'released',sort:'newest'},kstToday(now));
 const snapshot=buildWeeklySnapshot({directions:config.directions,products,ranks,proposals,now});
 await fs.writeFile(new URL('public/data/weekly-insights.json',root),JSON.stringify(snapshot)+'\n');
 console.log(`Weekly insights: ${snapshot.cards.length} directions with four-source evidence, ${snapshot.week.start}–${snapshot.week.end}`);return snapshot;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await buildWeeklyInsights();
