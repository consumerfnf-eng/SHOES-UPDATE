import {reportSeason} from '../public/assets/forecast.mjs';
export const SEASON_QUOTAS={daily:10,feminine:10,active:9,seasonal:6};
const canonical=v=>String(v||'').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
export function validateExpandedProposals(config,reports,{requireReview=true}={}){
 if(config.schemaVersion!==3||!Array.isArray(config.ideas))throw Error('Expected expanded proposal schema 3');
 const ids=new Set(),families=new Set(),structures=new Set(),anchors=new Set(),heroes=new Set(),sets=new Set();
 for(const season of ['27SS','27FW','28SS']){
  const rows=config.ideas.filter(i=>i.season===season);
  if(rows.length<35)throw Error('35 concepts required: '+season);
  for(const [category,count]of Object.entries(SEASON_QUOTAS))if(rows.filter(i=>i.category===category).length<count)throw Error('Category quota: '+season+' '+category);
 }
 for(const idea of config.ideas){
  if(!/^[a-z0-9-]+$/.test(idea.id)||ids.has(idea.id))throw Error('Duplicate/invalid concept id');ids.add(idea.id);
  const family=canonical(idea.familyKey),structure=['last','upper','closure','sole','distinctive'].map(k=>canonical(idea.construction?.[k])).join('|');
  if(!family||families.has(family)||structure.split('|').some(k=>!k)||structures.has(structure))throw Error('Repeated design construction: '+idea.id);
  families.add(family);structures.add(structure);
  if(!idea.mlbFit?.reason||!idea.insight||idea.tags?.length<3||idea.strategies?.length<4)throw Error('Incomplete MLB concept: '+idea.id);
  if(/[\u3040-\u30ff\u4e00-\u9fff]/u.test(JSON.stringify([idea.title,idea.subtitle,idea.insight,idea.strategies,idea.tags])))throw Error('Only Korean/English copy: '+idea.id);
  if(idea.references?.length!==6||!idea.hero)throw Error('One hero and six references required: '+idea.id);
  const refs=idea.references, hashes=refs.map(r=>r.imageHash),refset=[...hashes].sort().join('|');
  if(hashes.some(h=>!h)||new Set(hashes).size!==6||hashes.includes(idea.hero.imageHash)||sets.has(refset))throw Error('Repeated reference photos: '+idea.id);sets.add(refset);
  const primary=refs[0].modelKey;if(!primary||anchors.has(primary))throw Error('Repeated primary design: '+idea.id);anchors.add(primary);
  if(!idea.hero.imageHash||heroes.has(idea.hero.imageHash))throw Error('Repeated hero photo: '+idea.id);heroes.add(idea.hero.imageHash);
  for(const ref of [idea.hero,...refs]){
   if(!/^https:\/\//.test(ref.url||'')||!ref.credit||!ref.image||!ref.original||Math.min(ref.width||0,ref.height||0)<200)throw Error('Invalid photo provenance/resolution: '+idea.id);
   if(requireReview&&ref.reviewStatus!=='reviewed')throw Error('Photo not visually reviewed: '+idea.id);
  }
  if(!idea.hero.sourceSeason||Math.min(idea.hero.width,idea.hero.height)<700)throw Error('Hero source season/size: '+idea.id);
  for(const f of idea.forecast||[]){const r=reports.find(r=>r.id===f.id);if(!r||reportSeason(r.title)!==idea.season.replace('FW','AW')||!Number.isInteger(f.page)||f.page<1||f.page>r.pages.length||!f.claim||!f.heading)throw Error('Wrong/missing forecast page claim: '+idea.id);}
  if(!idea.forecast?.length)throw Error('Forecast evidence required: '+idea.id);
 }
 return {concepts:ids.size,uniquePrimaryDesigns:anchors.size,uniqueHeroPhotos:heroes.size};
}
