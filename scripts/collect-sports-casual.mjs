import fs from 'node:fs/promises';
import {isScopedSneakerCandidate} from './scoped-new-candidates.mjs';
import {collectStructuredNew} from './collect-structured-new.mjs';
import {collectPumaKoreaNew} from './collect-puma-korea-new.mjs';
import {collectColumbiaNew} from './collect-columbia-new.mjs';
import {collectDkonNew} from './collect-dkon-new.mjs';
import {isNewListing,collectNewArrivals} from './new-arrivals.mjs';
import {collectFilaChina} from './collect-fila-china.mjs';
import {collectOfficialNewFeeds} from './collect-official-new-feeds.mjs';
import {officialHtmlMarkdown} from './official-reader.mjs';
import {createJinaClient} from './jina_client.mjs';
import {SITE_BRAND_GROUPS,siteBrandGroup} from '../public/assets/site-brand-policy.mjs';
const readJson=async(p,fallback)=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const auditDir=process.env.SPORTS_AUDIT_DIR||'logs/sports-casual';
const resumed=process.env.SPORTS_DISCOVERY_CHECKPOINT?await readJson(process.env.SPORTS_DISCOVERY_CHECKPOINT):null;
const sources=await readJson('config/daily_sources.json',{}),source=await readJson('data/catalog-source.json',{products:[]});
for(const [brand,rows] of Object.entries(sources)){if(siteBrandGroup(brand)==='LUX')continue;const focused=rows.filter(s=>isNewListing(s.url)).map(s=>{const copy={...s};delete copy.basis;return copy;});if(focused.length)sources[brand]=focused;}
const brands=SITE_BRAND_GROUPS.filter(g=>g.name!=='LUX').flatMap(g=>g.priority).filter(b=>b!=='FILA China'&&!resumed?.coverage?.some(c=>c.brand===b));
const rendered=new Map();
for(const file of await fs.readdir(auditDir).catch(()=>[])){if(!/^(official-|puma-).*\.json$/.test(file))continue;const name=auditDir+'/'+file,stat=await fs.stat(name);if(Date.now()-stat.mtimeMs>24*3600000)continue;const row=await readJson(name,{});if(row.metadata?.statusCode===200&&row.markdown)rendered.set(row.metadata.sourceURL||row.metadata.url,row);}
const jina=createJinaClient({timeoutMs:20000,key:process.env.JINA_API_KEY||''});
const html=async url=>{if(rendered.get(url)?.html)return rendered.get(url).html;const r=await fetch(url,{signal:AbortSignal.timeout(22000),headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'}});if(!r.ok)throw Error('HTTP '+r.status);return r.text();};
const read=async input=>{const url=input.replace(/^https:\/\/r[.]jina[.]ai\//,'');if(rendered.has(url))return rendered.get(url).markdown;try{return officialHtmlMarkdown(await html(url),url);}catch{return jina.read('https://r.jina.ai/'+url);}};
const pending=(await readJson('data/pending-candidates.json',{candidates:[]})).candidates.filter(p=>brands.includes(p.brand));
const run=await collectNewArrivals({read,readDetails:html,sources,brands,existing:source.products.filter(p=>['SPORTS','CASUAL'].includes(siteBrandGroup(p.brand))),carriedPending:pending,now:new Date(),maxPagesPerBrand:160,maxDetailMsPerBrand:Infinity,initialDiscovery:resumed,filterCandidate:isScopedSneakerCandidate,allowListingFollowup:(next,current)=>{const a=new URL(next.url),b=new URL(current.url);return a.origin===b.origin&&(a.pathname===b.pathname||/Search-(?:UpdateGrid|ShowAjax)/.test(a.pathname)||!/(?:new|신상품|신제품)/i.test(decodeURIComponent(b.pathname)))&&!/clothing|apparel|underwear|swimwear|accessories|bags|socks|softball|baseball|volleyball|boots|sandals/i.test(a.pathname);},onProgress:async snapshot=>{await fs.mkdir(auditDir,{recursive:true});await fs.writeFile(auditDir+'/progress.json',JSON.stringify(snapshot));}});
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

try{const puma=await collectPumaKoreaNew({readHtml:html});await fs.writeFile('data/puma-korea-new.json',JSON.stringify(puma,null,2)+'\n');}catch(e){console.error('PUMA Korea unresolved: '+e.message);}

const structured=await collectStructuredNew({readHtml:html,onProgress:p=>console.log('Structured New '+JSON.stringify(p))});
for(const [brand,data] of Object.entries(structured.outputs)){const file={'ASICS':'asics-complete-new','adidas':'adidas-complete-new','New Balance':'newbalance-complete-new','Converse':'converse-complete-new'}[brand];await fs.writeFile('data/'+file+'.json',JSON.stringify(data,null,2)+'\n');}
await fs.writeFile(auditDir+'/structured-errors.json',JSON.stringify(structured.errors,null,2)+'\n');
try{const columbia=await collectColumbiaNew({readHtml:html});await fs.writeFile('data/columbia-new.json',JSON.stringify(columbia,null,2)+'\n');}catch(e){console.error('COLUMBIA unresolved: '+e.message);}
try{const dkon=await collectDkonNew();await fs.writeFile('data/dkon-new.json',JSON.stringify(dkon,null,2)+'\n');}catch(e){console.error('DKON New unresolved: '+e.message);}
