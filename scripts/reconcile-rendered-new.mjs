import fs from 'node:fs/promises';
import {isScopedSneakerCandidate} from './scoped-new-candidates.mjs';
import path from 'node:path';
import {collectNewArrivals} from './new-arrivals.mjs';
import {officialHtmlMarkdown} from './official-reader.mjs';
const dir=process.argv[2]||'logs/20261104-new-audit',snapshots=[];
for(const file of await fs.readdir(dir)){if(!/^official-.*\.json$/.test(file))continue;const s=JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));if(s.metadata?.statusCode===200&&s.markdown)snapshots.push(s);}
const cache=new Map(snapshots.map(s=>[s.metadata.sourceURL||s.metadata.url,s]));
const sources={};for(const s of snapshots)(sources[s.brand]??=[]).push({url:s.metadata.sourceURL||s.metadata.url,name:s.brand+' official rendered New'});
const html=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(16000),headers:{'User-Agent':'Mozilla/5.0'}});if(!response.ok)throw Error('HTTP '+response.status);return response.text();};
const source=JSON.parse(await fs.readFile('data/catalog-source.json','utf8'));
const run=await collectNewArrivals({sources,brands:Object.keys(sources),existing:source.products.filter(p=>Object.keys(sources).includes(p.brand)),maxPagesPerBrand:160,maxDetailMsPerBrand:Infinity,filterCandidate:isScopedSneakerCandidate,allowListingFollowup:(next,current)=>{const a=new URL(next.url),b=new URL(current.url);return a.origin===b.origin&&(a.pathname===b.pathname||/Search-(?:UpdateGrid|ShowAjax)/.test(a.pathname));},read:async input=>{const url=input.replace(/^https:\/\/r[.]jina[.]ai\//,'');return cache.get(url)?.markdown||officialHtmlMarkdown(await html(url),url);},readDetails:html,onProgress:async p=>fs.writeFile(path.join(dir,'rendered-progress.json'),JSON.stringify(p))});
await fs.writeFile('data/rendered-official-new.json',JSON.stringify(run,null,2)+'\n');
console.log(JSON.stringify({products:run.products.length,coverage:run.coverage.map(c=>({brand:c.brand,verified:c.verified,candidates:c.candidates,status:c.status}))}));
