import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEditorialFeed,readPublicSource} from './source-feeds.mjs';

const explicitTrend=/\b(?:trending|trends?|hottest|most[- ]wanted|most[- ]popular|best[- ]selling|bestsellers?|popular|in[- ]demand)\b|인기|트렌드|유행|베스트셀러/iu;
const excludedContext=/\b(?:forecast|prediction|predicts?|sponsored|advertorial|advertisement|campaign|giveaway|raffle|discount|sale|event|festival|fashion week|runway|pop[- ]up)\b|전망|예측|협찬|광고|캠페인|이벤트|할인|경품|응모/iu;
const footwearContext=/\b(?:sneakers?|shoes?|footwear|trainers?|runners?|clogs?|sandals?|mules?)\b|스니커|운동화|러닝화|슈즈|클로그|샌들/iu;
const escaped=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const literalPattern=phrase=>new RegExp(`(?<![\\p{L}\\p{N}])${escaped(phrase)}(?![\\p{L}\\p{N}])`,'giu');

export function editorialTerms(title,dictionary) {
  if(!explicitTrend.test(title)||excludedContext.test(title)||!footwearContext.test(title))return [];
  if((dictionary.excludedQueryTerms||[]).some(term=>literalPattern(term).test(title)))return [];
  const terms=new Set();
  for(const entry of dictionary.entries||[]) {
    const phrases=[...(entry.aliases||[]),...(entry.kind==='brand'?entry.match?.brands||[]:[])];
    for(const phrase of phrases) {
      if(!phrase||/^\d+$/.test(phrase)||/^on$/i.test(phrase))continue;
      for(const match of title.matchAll(literalPattern(phrase))) {
        if(entry.id==='pane'&&match[0]!=='PANE')continue;
        terms.add(match[0]);
      }
    }
  }
  return [...terms];
}

export async function collectEditorialKeywords({now=new Date(),config,dictionary,readPublic=readPublicSource,auditDir=resolve(fileURLToPath(new URL('../logs/research/editorial-keywords/',import.meta.url)))}={}) {
  config??=JSON.parse(await readFile(new URL('../config/signal-sources.json',import.meta.url),'utf8'));
  dictionary??=JSON.parse(await readFile(new URL('../config/search-term-dictionary.json',import.meta.url),'utf8'));
  const checkedAt=new Date(now).toISOString(),cutoff=new Date(now).getTime()-7*86400000;
  const results=await Promise.all((config.editorialSources||[]).filter(source=>source.feedUrl).map(async source=>{
    const status={platform:source.id,name:source.name,url:source.url,kind:'editorial-keyword',checkedAt};
    try {
      const xml=await readPublic(source.feedUrl,{maxBytes:source.maxBytes||2_000_000});
      const hash=createHash('sha256').update(xml).digest('hex'),snapshotId=`${source.id}:${checkedAt}:${hash.slice(0,16)}`;
      const entries=parseEditorialFeed(xml,source,{now}).filter(entry=>{const stamp=Date.parse(entry.publishedAtInstant);return stamp>=cutoff&&stamp<=new Date(now).getTime();});
      const sourceRanks=entries.flatMap(entry=>editorialTerms(entry.title,dictionary).map(term=>({
        platform:source.id,platformName:source.name,term,rank:null,kind:'editorial-keyword',verified:true,
        sourceUrl:entry.url,evidenceUrl:source.feedUrl,capturedAt:checkedAt,publishedAt:entry.publishedAtInstant,
        rankingPeriod:null,sourceOriginalContext:entry.title.slice(0,240),snapshotId,contentHash:hash,
        rankBasis:'publisher-explicit-current-trend-headline',scope:'footwear'
      })));
      if(auditDir) {
        await mkdir(auditDir,{recursive:true});
        const file=`${source.id.replace(/[^a-z0-9.-]/gi,'_')}-${checkedAt.replace(/[:.]/g,'-')}-${hash.slice(0,16)}.json`;
        try {await writeFile(resolve(auditDir,file),JSON.stringify({schemaVersion:1,sourceUrl:source.feedUrl,checkedAt,contentHash:hash,snapshotId,body:{format:'xml',text:xml}},null,2)+'\n',{flag:'wx'});}
        catch(error){if(error.code!=='EEXIST')throw error;}
      }
      return {sourceRanks,status:{...status,status:'available',count:sourceRanks.length,reason:sourceRanks.length?null:'최근 7일 명시적 슈즈 트렌드 키워드 미확인'},diagnostic:{platform:source.id,status:'fetched',entryCount:entries.length,keywordCount:sourceRanks.length,contentHash:hash}};
    }catch(error){return {sourceRanks:[],status:{...status,status:'unavailable',reason:'공개 매체 키워드 원문 확인 불가'},diagnostic:{platform:source.id,status:'unavailable',reason:error.message}};}
  }));
  return {sourceRanks:results.flatMap(result=>result.sourceRanks),editorialStatus:results.map(result=>result.status),checkedAt,diagnostics:results.map(result=>result.diagnostic)};
}
