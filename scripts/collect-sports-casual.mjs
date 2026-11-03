import fs from 'node:fs/promises';
import {collectNewArrivals} from './new-arrivals.mjs';
import {collectFilaChina} from './collect-fila-china.mjs';
import {collectOfficialNewFeeds} from './collect-official-new-feeds.mjs';
import {officialHtmlMarkdown} from './official-reader.mjs';
import {createJinaClient} from './jina_client.mjs';
import {SITE_BRAND_GROUPS,siteBrandGroup} from '../public/assets/site-brand-policy.mjs';
const readJson=async(p,fallback)=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const sources=await readJson('config/daily_sources.json',{}),source=await readJson('data/catalog-source.json',{products:[]});
const brands=SITE_BRAND_GROUPS.filter(g=>g.name!=='LUX').flatMap(g=>g.priority).filter(b=>b!=='FILA China');
const jina=createJinaClient({timeoutMs:20000,key:process.env.JINA_API_KEY||''});
const html=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(22000),headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'}});if(!r.ok)throw Error('HTTP '+r.status);return r.text();};
const read=async url=>{try{return officialHtmlMarkdown(await html(url),url);}catch{return jina.read('https://r.jina.ai/'+url);}};
const pending=(await readJson('data/pending-candidates.json',{candidates:[]})).candidates.filter(p=>brands.includes(p.brand));
const run=await collectNewArrivals({read,readDetails:html,sources,brands,existing:source.products.filter(p=>['SPORTS','CASUAL'].includes(siteBrandGroup(p.brand))),carriedPending:pending,now:new Date(),maxPagesPerBrand:16,maxDetailMsPerBrand:90000});
await fs.writeFile('data/sports-casual-new.json',JSON.stringify(run,null,2)+'\n');
const fila=await collectFilaChina({read:html,onProgress:p=>console.log('FILA China '+JSON.stringify(p))});
const designs=await readJson('data/fila-china-design-reviews.json',{products:[]}),photos=await readJson('data/fila-china-photo-reviews.json',{products:[]});
for(const p of fila.products){
 const design=designs.products.find(r=>r.verified&&r.code===p.modelGroup.split('|')[1]&&r.sourceName===p.sourceName);if(design)p.modelGroup=design.modelGroup;
 const photo=photos.products.find(r=>r.verified&&r.style===p.style&&r.url===p.url&&(p.imageCandidates?.includes(r.image)||r.image===p.image));if(photo){p.image=photo.image;p.officialImageEvidence={...p.officialImageEvidence,url:p.image};}
}
await fs.writeFile('data/fila-china-new.json',JSON.stringify(fila,null,2)+'\n');
const newFeeds=await collectOfficialNewFeeds({sources});delete newFeeds.feeds;
await fs.writeFile('data/official-new-feeds.json',JSON.stringify(newFeeds,null,2)+'\n');
console.log(JSON.stringify({sportsCasual:run.products.length,filaChina:fila.products.length,coverage:run.coverage.map(r=>({brand:r.brand,status:r.status})),filaErrors:fila.errors}));
