import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {collectForecastKeywords,parseForecastPage} from '../scripts/collect-forecast-keywords.mjs';

const config=JSON.parse(await fs.readFile(new URL('../config/forecast-sources.json',import.meta.url),'utf8'));
const source=config.sources[0],now=new Date('2026-10-01T00:00:00Z');
const body=`<html><nav>Menu</nav><article><h1>${source.title}</h1><time>Jul 18, 2025</time>${source.terms.map(t=>`<h2>${t.label}</h2><p>${t.scope==='footwear-explicit'?'footwear':'category'}</p>`).join('')}</article></html>`;
test('WGSN forecast requires exact dated article headings, season and footwear context',()=>{
  assert.equal(parseForecastPage(body,source).contentHash,createHash('sha256').update(body).digest('hex'));
  for(const invalid of [body.replace('Jul 18, 2025','Jul 18, 2024'),body.replace('S/S 27','S/S 26'),body.replace('<h2>Clay</h2>','Clay'),body.replace('footwear','furniture'),body.replace(/<article>[\s\S]*<\/article>/,'<nav>Clay</nav>')])assert.throws(()=>parseForecastPage(invalid,source));
  assert.throws(()=>parseForecastPage(body,{...source,url:'https://unreviewed.example/'}));
});
test('Reader verifies original WGSN URL and complete public article content',()=>{
  const markdown=`# ${source.title}\nJul 18, 2025\n${source.terms.map(t=>`## ${t.label}\n${t.scope==='footwear-explicit'?'footwear':'category'}`).join('\n')}`;
  assert(parseForecastPage(JSON.stringify({code:200,data:{url:source.alternateUrl,title:source.title,content:markdown}}),source));
  assert.throws(()=>parseForecastPage(JSON.stringify({code:200,data:{url:'https://elsewhere.example/',title:source.title,content:markdown}}),source));
});
test('Successful collection produces five exact unranked forecasts and never current popularity',async()=>{
  let calls=0;const result=await collectForecastKeywords({config,now,auditDir:null,readPublic:async()=>{calls++;return body;}});
  assert.equal(calls,1);assert.equal(result.sourceRanks.length,5);assert.deepEqual(result.sourceRanks.map(s=>s.term),source.terms.map(t=>t.label));
  for(const row of result.sourceRanks){assert.equal(row.rank,null);assert.equal(row.kind,'forecast-keyword');assert.equal(row.scope,'fashion-colour-forecast');assert.equal(row.validUntil,'2027-08-31');assert.equal(row.validityBasis,'season-end-policy');assert.equal(row.capturedAt,now.toISOString());assert.equal(row.verificationMethod,'public-source-fetch');}
  assert.equal(result.forecastStatus[0].automatedStatus,'available');assert(result.forecastStatus.slice(1).every(s=>s.status==='unsupported'));
});
test('Reader fallback keeps the publisher URL in public provenance and preserves proxy retrieval only in audit',async()=>{
  let calls=0;
  const markdown=`# ${source.title}\nJul 18, 2025\n${source.terms.map(t=>`## ${t.label}\n${t.scope==='footwear-explicit'?'footwear':'category'}`).join('\n')}`;
  const result=await collectForecastKeywords({config,now,auditDir:null,readPublic:async url=>{calls++;if(url===source.url)throw Error('HTTP403');assert.equal(url,`https://r.jina.ai/${source.alternateUrl}`);return JSON.stringify({code:200,data:{url:source.alternateUrl,title:source.title,content:markdown}});}});
  assert.equal(calls,2);assert.equal(result.sourceRanks.length,5);
  assert(result.sourceRanks.every(row=>row.sourceUrl===source.url&&row.evidenceUrl===source.url&&row.verificationMethod==='public-source-fetch'));
  assert(!/r\.jina\.ai/.test(JSON.stringify(result)),'Public catalog must never contain the collection proxy URL');
});
test('Automated failure preserves reviewed season evidence without pretending a fresh successful fetch',async()=>{
  let calls=0;const result=await collectForecastKeywords({config,now,auditDir:null,readPublic:async()=>{calls++;throw Error('HTTP403');}});
  assert.equal(calls,2);assert.equal(result.sourceRanks.length,5);assert(result.sourceRanks.every(s=>s.capturedAt===source.reviewedEvidence.verifiedAt&&s.verificationMethod==='reviewed-public-source'&&s.automatedStatus==='unavailable'));
  assert.equal(result.forecastStatus[0].status,'available');assert.equal(result.forecastStatus[0].automatedStatus,'unavailable');
  const noReview=structuredClone(config);delete noReview.sources[0].reviewedEvidence;
  assert.equal((await collectForecastKeywords({config:noReview,now,auditDir:null,readPublic:async()=>{throw Error('HTTP403');}})).sourceRanks.length,0);
});
test('Expired forecast season makes no network requests and broad substitute colour names are rejected',async()=>{
  let calls=0;const result=await collectForecastKeywords({config,now:new Date('2027-08-31T15:00:00Z'),auditDir:null,readPublic:async()=>{calls++;return body;}});
  assert.equal(calls,0);assert.equal(result.sourceRanks.length,0);
  const generic=structuredClone(config);generic.sources[0].terms[0].label='Blue';assert.equal((await collectForecastKeywords({config:generic,now,auditDir:null,readPublic:async()=>body})).sourceRanks.length,0);
});
