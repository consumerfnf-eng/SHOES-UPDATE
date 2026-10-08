import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareTrendImport,importTrendReport} from '../scripts/import-trend-report.mjs';
import {variantGroupKey} from '../public/assets/catalog-view.mjs';
const catalog=JSON.parse(await fs.readFile(new URL('../public/data/catalog.json',import.meta.url)));
const now=new Date('2026-10-08T12:00:00+09:00');
const product=catalog.products.find(p=>p.brand==='ASICS');
const payload=()=>({schemaVersion:1,generatedAt:now.toISOString(),items:[{modelKey:variantGroupKey(product),representativeId:product.id,variants:[product],
 keywordRank:1,keywordRankingStatus:'provisional_missing_or_partial_sources',provisionalScore:80,totalTrendScore:null,productPopularityVerified:false,
 form:{Item_Name:product.name,Brand:product.brand,Price:product.priceLabel,Trend_Keyword:'트레일',Image_CDN_URL:product.presentation.image,Color_Hex:'#abcdef',Description:product.description},descriptionEvidence:{type:'official-catalog',sourceUrl:product.url}}]});
test('trend importer preserves calculated associations, variants and existing catalog without inflating popularity',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trend-import-'));
 try{await fs.mkdir(path.join(dir,'public/data'),{recursive:true});const original=JSON.stringify(catalog);await fs.writeFile(path.join(dir,'public/data/catalog.json'),original);const input=path.join(dir,'input.json');await fs.writeFile(input,JSON.stringify(payload()));
  const dry=await importTrendReport({input,directory:dir,now});assert.equal(dry.applied,false);await assert.rejects(fs.access(dry.output));
  const done=await importTrendReport({input,directory:dir,now,apply:true});const result=JSON.parse(await fs.readFile(done.output));assert.equal(result.items[0].trend.provisionalScore,80);assert.equal(result.items[0].trend.totalTrendScore,null);assert.equal(result.items[0].trend.productPopularityVerified,false);assert.equal(result.items[0].variants[0].id,product.id);assert.equal(await fs.readFile(path.join(dir,'public/data/catalog.json'),'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('trend importer rejects mismatched variant/photo, fabricated popularity and stale snapshot',()=>{
 for(const mutate of [p=>p.items[0].variants=[{...product,style:'WRONG'}],p=>p.items[0].form.Image_CDN_URL='https://example.com/full-person.jpg',p=>p.items[0].productPopularityVerified=true,p=>p.generatedAt='2020-01-01T00:00:00Z']){const p=payload();mutate(p);assert.throws(()=>prepareTrendImport(p,catalog,{now}));}
});
