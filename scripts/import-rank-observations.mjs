// Import ranks actually observed on the retailer's selected category page.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {withMovement,departures} from './collect-rank-boards.mjs';
export async function importRankObservations(file,output='data/rank-boards.json'){
 const data=JSON.parse(await fs.readFile(file,'utf8')),stored=JSON.parse(await fs.readFile(output,'utf8'));
 const checkedAt=data.checkedAt||(await fs.stat(file)).mtime.toISOString();
 for(const [key,id,label,basis] of [
  ['musinsa','musinsa-sneaker-ranking','무신사 스니커즈 랭킹','스니커즈 · 전체 성별·연령 · 실시간 · 스토어 공식 순위 (판매량 수치는 미공개)'],
  ['cm','29cm-sneakers-best','29CM 스니커즈 BEST','여성슈즈 > 스니커즈 · 실시간 인기순(POPULARITY) · 판매수량 순위와 구분'],
 ]){
  const observation=data[key];if(!observation)continue;
  assert.equal(observation.items.length,15,'Exactly fifteen native ranks are required');
  assert.deepEqual(observation.items.map(r=>r.rank),Array.from({length:15},(_,i)=>i+1));
  assert.equal(new Set(observation.items.map(r=>r.key)).size,15);
  for(const item of observation.items)assert.ok(item.brand&&item.name&&/^https:\/\//.test(item.url));
  const index=stored.boards.findIndex(b=>b.id===id),before=stored.boards[index];
  const previous=before?.items?.length?{checkedAt:before.checkedAt,ranks:Object.fromEntries(before.items.map(r=>[r.key,r.rank]))}:null;
  const board={id,label,retailer:key==='cm'?'29CM':'Musinsa',basis,sourceUrl:observation.url,checkedAt,size:15,observationMethod:'reviewed-dom',comparedWith:previous?.checkedAt||null,items:withMovement(observation.items,previous),departed:departures(observation.items,previous)};
  if(index<0)stored.boards.push(board);else stored.boards[index]=board;
 }
 stored.checkedAt=checkedAt;await fs.writeFile(output,JSON.stringify(stored,null,2)+'\n');
 return stored;
}
if(process.argv[1]?.endsWith('import-rank-observations.mjs'))console.log((await importRankObservations(process.argv[2])).boards.map(b=>({id:b.id,items:b.items.length})));
