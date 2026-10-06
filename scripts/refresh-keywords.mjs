import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {collectSearchKeywords} from './collect-search-keywords.mjs';
import {publishCurated,readJson,atomicJson} from './publish-curated.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function refreshKeywords({directory=root,now=new Date(),searchCollector=collectSearchKeywords,forecastCollector,editorialCollector,styleCollector,marketCollector}={}){
  forecastCollector??=(await import('./collect-forecast-keywords.mjs')).collectForecastKeywords;
  editorialCollector??=(await import('./collect-editorial-keywords.mjs')).collectEditorialKeywords;
  styleCollector??=(await import('./collect-style-editorials.mjs')).collectStyleEditorials;
  marketCollector??=(await import('./collect-style-market.mjs')).collectStyleMarket;
  const source=await readJson(path.join(directory,'data/catalog-source.json'));
  const [search,forecast,editorial,style,market]=await Promise.all([searchCollector({now}),forecastCollector({now}),editorialCollector({now}),styleCollector({now}),marketCollector({now,previousObservations:source.collection?.styleObservations||[]})]);
  const collection={...source.collection,keywordCheckedAt:new Date(now).toISOString(),sourceRanks:[...(source.collection?.sourceRanks||[]),...search.sourceRanks,...forecast.sourceRanks,...editorial.sourceRanks,...style.sourceRanks],styleObservations:[...(style.observations||[]),...market.observations],styleMarketStatus:market.diagnostics,searchRankStatus:search.searchRankStatus,forecastStatus:forecast.forecastStatus,editorialStatus:[...editorial.editorialStatus,...style.editorialStatus]};
  await atomicJson(path.join(directory,'logs/keyword-refresh-diagnostics.json'),{checkedAt:new Date(now).toISOString(),search:search.diagnostics,forecast:forecast.diagnostics,editorial:editorial.diagnostics,style:style.diagnostics,market:market.diagnostics});
  return publishCurated({directory,now,collection,keywordRefresh:true});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)refreshKeywords().then(result=>console.log(`Keyword refresh complete: ${result.snapshot.styleTrendKeywords.items.length} style trends; ${result.snapshot.forecastKeywords.length} forecasts; ${result.snapshot.products.length} products. Product collection timestamp preserved; no Sheets operation.`)).catch(error=>{console.error(error.message);process.exitCode=1;});
