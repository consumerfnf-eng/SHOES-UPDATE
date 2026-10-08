import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {variantGroupKey,uniqueColorVariants,releaseState,kstToday,officialImageUrl} from '../public/assets/catalog-view.mjs';
import {exportTrendModels} from './export-trend-catalog.mjs';
const photoReviews=JSON.parse(await fs.readFile(new URL('../data/product-presentation.json',import.meta.url),'utf8'));

export function prepareTrendImport(payload,catalog,{now=new Date()}={}){
  const captured=Date.parse(payload.generatedAt),age=now.getTime()-captured,today=kstToday(now);
  if(payload.schemaVersion!==1||!Number.isFinite(age)||age<0||age>7*86400000||!Array.isArray(payload.items))throw Error('Invalid or expired trend import');
  const published=new Map(catalog.products.map(p=>[p.id,p])),seen=new Set();
  const eligible=new Set(exportTrendModels(catalog,now,photoReviews).flatMap(m=>m.variants.map(p=>p.id)));
  const items=payload.items.map(item=>{
    if(seen.has(item.modelKey)||!Array.isArray(item.variants)||!item.variants.length||!item.form?.Trend_Keyword)throw Error('Invalid or duplicate model');
    seen.add(item.modelKey);
    if(!Number.isInteger(item.keywordRank)||item.keywordRank<1||item.keywordRank>100||!['complete','provisional_missing_or_partial_sources'].includes(item.keywordRankingStatus))throw Error('Invalid ranking fields');
    if(!Number.isFinite(item.provisionalScore)||item.provisionalScore<0||item.provisionalScore>100.00001||item.keywordRankingStatus!=='complete'&&item.totalTrendScore!==null)throw Error('Invalid score completeness');
    if(item.keywordRankingStatus==='complete'&&(!Number.isFinite(item.totalTrendScore)||item.totalTrendScore<0||item.totalTrendScore>100.00001))throw Error('Missing complete score');
    const variants=item.variants.map(p=>{
      const current=published.get(p.id);
      if(!eligible.has(p.id))throw Error('New/release or exact photo proof missing');
      if(!current||current.brand!==p.brand||current.style!==p.style||current.url!==p.url||current.image!==p.image||current.firstPublishedAt!==p.firstPublishedAt||variantGroupKey(current)!==item.modelKey||releaseState(current,today)!=='released'||!officialImageUrl(current,today))throw Error('Product identity or publication evidence mismatch');
      return current;
    });
    const representative=variants.find(p=>p.id===item.representativeId);
    if(!representative||!['side','three-quarter'].includes(representative.presentation?.view)||representative.presentation.image!==item.form.Image_CDN_URL)throw Error('Representative photo mismatch');
    const description=item.descriptionEvidence;
    if(!['official-catalog','sns-exact-style'].includes(description?.type)||item.productPopularityVerified!==false)throw Error('Unsupported popularity or description claim');
    if(description.type==='official-catalog'&&description.sourceUrl!==representative.url)throw Error('Description source mismatch');
    return {modelKey:item.modelKey,representativeId:item.representativeId,
      form:Object.fromEntries(['Item_Name','Brand','Price','Trend_Keyword','Image_CDN_URL','Color_Hex','Description'].map(k=>[k,String(item.form[k]||'')])),
      trend:{keyword:item.form.Trend_Keyword,rank:item.keywordRank,status:item.keywordRankingStatus,provisionalScore:item.provisionalScore,totalTrendScore:item.totalTrendScore,
        capturedAt:payload.generatedAt,matchBasis:'ranked-keyword-attribute-match',productPopularityVerified:false},
      descriptionEvidence:description,variants,colorVariants:uniqueColorVariants(variants)};
  });
  return {schemaVersion:1,generatedAt:now.toISOString(),sourceCapturedAt:payload.generatedAt,items};
}

export async function importTrendReport({input,directory=path.resolve('.'),apply=false,now=new Date()}){
  const payload=JSON.parse(await fs.readFile(input,'utf8'));
  const catalog=JSON.parse(await fs.readFile(path.join(directory,'public/data/catalog.json'),'utf8'));
  const prepared=prepareTrendImport(payload,catalog,{now});
  const output=path.join(directory,'public/data/comprehensive-trends.json');
  if(apply){const temporary=output+'.tmp';await fs.writeFile(temporary,JSON.stringify(prepared,null,2)+'\n');await fs.rename(temporary,output);}
  return {applied:apply,models:prepared.items.length,variants:prepared.items.reduce((n,i)=>n+i.variants.length,0),output};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const input=process.argv[process.argv.indexOf('--input')+1];
  if(!process.argv.includes('--input')||!input)throw Error('Usage: node scripts/import-trend-report.mjs --input reports/latest/upload_items.json [--apply]');
  console.log(JSON.stringify(await importTrendReport({input,apply:process.argv.includes('--apply')})));
}
