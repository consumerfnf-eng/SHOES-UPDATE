import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {siteBrandGroup,isSiteBrandAllowed} from '../public/assets/site-brand-policy.mjs';
import {prepareCatalog} from '../public/assets/catalog-runtime.mjs';
import {collectNewArrivals,isNewListing} from './new-arrivals.mjs';
import {isScopedSneakerCandidate} from './scoped-new-candidates.mjs';
import {collectPumaKoreaNew} from './collect-puma-korea-new.mjs';
import {collectColumbiaNew} from './collect-columbia-new.mjs';
import {collectDkonNew} from './collect-dkon-new.mjs';
import {collectStructuredNew} from './collect-structured-new.mjs';
import {collectFilaChina} from './collect-fila-china.mjs';
import {collectOfficialNewFeeds} from './collect-official-new-feeds.mjs';
import {officialHtmlMarkdown,pacedOfficialFetch,assertReadableOfficial} from './official-reader.mjs';
import {createJinaClient} from './jina_client.mjs';
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const normalizeUrl=value=>{try{const u=new URL(value);u.hash='';for(const key of [...u.searchParams.keys()])if(/^(utm_|ref$)/.test(key))u.searchParams.delete(key);return u.href.replace(/\/$/,'');}catch{return '';}};
export function auditCandidates(products,published,brand){
 const urls=new Set(published.filter(p=>p.brand===brand).map(p=>normalizeUrl(p.url))),styles=new Set(published.filter(p=>p.brand===brand).map(p=>String(p.style||'').toLowerCase()));
 return [...new Map(products.filter(p=>p.brand===brand&&!urls.has(normalizeUrl(p.url))&&(!p.style||!styles.has(p.style.toLowerCase()))).map(p=>[normalizeUrl(p.url),{name:p.name,style:p.style||'',url:p.url}])).values()].slice(0,200);
}
export async function auditBrand(brand,{readHtml,now=new Date()}={}){
 if(!isSiteBrandAllowed(brand))throw Error('Brand is not in the permitted collection list');
 const sources=await readJson('config/daily_sources.json'),catalog=await readJson('public/data/catalog.json'),at=now.toISOString();
 const paced=pacedOfficialFetch(),jina=createJinaClient({key:process.env.JINA_API_KEY||'',timeoutMs:20000});
 readHtml??=async url=>{const response=await paced(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html'}});if(!response.ok)throw Error('Official source HTTP '+response.status);return response.text();};
 let result;
 if(brand==='PUMA')result=await collectPumaKoreaNew({readHtml,now});
 else if(brand==='COLUMBIA')result=await collectColumbiaNew({readHtml,now});
 else if(['Umbro','DESCENTE','Le Coq Sportif'].includes(brand))result=await collectDkonNew({brands:[brand],now});
 else if(['ASICS','adidas','New Balance','Converse'].includes(brand)){
  const structured=await collectStructuredNew({brands:[brand],readHtml,now});result=structured.outputs[brand];if(!result)throw Error(structured.errors.map(e=>e.error).join('; ')||'Official New collection failed');
 }else if(brand==='FILA China')result=await collectFilaChina({read:readHtml,now});
 else if((sources[brand]||[]).some(s=>/\/collections\//.test(s.url)&&isNewListing(s.url))){
  result=await collectOfficialNewFeeds({sources:{[brand]:sources[brand]},now,onProgress:()=>{}});
 }else{
  const lux=siteBrandGroup(brand)==='LUX',selected=(sources[brand]||[]).filter(s=>lux||isNewListing(s.url));
  if(!selected.length)throw Error('공식 New 수집 경로 설정 점검 필요');
  const read=async input=>{const url=input.replace(/^https:\/\/r\.jina\.ai\//,'');try{return assertReadableOfficial(officialHtmlMarkdown(await readHtml(url),url));}catch(error){if(!process.env.JINA_API_KEY)throw error;return jina.read('https://r.jina.ai/'+url);}};
  result=await collectNewArrivals({sources:{[brand]:selected},brands:[brand],existing:catalog.products.filter(p=>p.brand===brand),read,readDetails:readHtml,now,maxPagesPerBrand:60,maxDetailMsPerBrand:120000,catalogueBrands:lux?[brand]:[],filterCandidate:isScopedSneakerCandidate,log:()=>{}});
 }
 const coverage=Array.isArray(result.coverage)?result.coverage:[result.coverage||{}],errors=coverage.flatMap(c=>[...(c.errors||[]),...(c.error?[c.error]:[])]).concat(result.errors||[]).map(e=>String(e.error||e.message||e).slice(0,240));
 const products=result.products||[],exhaustive=coverage.length>0&&coverage.every(c=>c.exhaustive===true||c.exhausted===true||Number(c.total)>0&&c.total===c.read);
 const failed=coverage.some(c=>['failed','unavailable'].includes(c.status))&&!products.length;
 const today=new Date(now.getTime()+9*3600000).toISOString().slice(0,10),prepared=prepareCatalog(catalog,null,null,today),published=prepared.products.filter(p=>prepared.officialMatches.get(p.id));
 return {status:failed?'failed':exhaustive&&!errors.length?'completed':'partial',checkedAt:at,listingPages:coverage.reduce((n,c)=>n+(Number(c.pages||c.listingPages)||0),0)||Number(result.pages?.length)||0,verified:products.length,discovered:coverage.reduce((n,c)=>n+(Number(c.candidates||c.total||c.read)||0),0)||products.length,exhaustive,errors,candidates:auditCandidates(products,published,brand)};
}
export async function pollAdminQueue(){
 const key=process.env.ADMIN_RUNNER_KEY;if(!key)throw Error('ADMIN_RUNNER_KEY is not configured');
 const call=async(action,payload={})=>{const response=await fetch('https://shoes-update-internal.pages.dev/api/admin/runner/'+action,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Monitoring API HTTP '+response.status);return response.json();};
 const {job}=await call('claim');if(!job){console.log('No requested administrator audits');return;}
 let report;const log=console.log,warn=console.warn;
 // This repository's workflow log is public; operational findings stay in D1.
 console.log=()=>{};console.warn=()=>{};
 try{report=await auditBrand(job.brand);}catch(error){report={status:'failed',checkedAt:new Date().toISOString(),listingPages:0,verified:0,discovered:0,exhaustive:false,candidates:[],errors:[String(error.message).slice(0,240)]};}finally{console.log=log;console.warn=warn;}
 const runUrl=process.env.GITHUB_RUN_ID?'https://github.com/consumerfnf-eng/SHOES-UPDATE/actions/runs/'+process.env.GITHUB_RUN_ID:null;
 await call('complete',{id:job.id,lease:job.lease,report,runUrl});
 console.log('Administrator audit finished; results are available in the protected dashboard.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await pollAdminQueue();
