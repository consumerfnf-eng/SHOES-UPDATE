import fs from 'node:fs/promises';
import path from 'node:path';import {createHash} from 'node:crypto';
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
import {gunzipSync} from 'node:zlib';
import {collectOfficialInventory} from './collect-official-inventory.mjs';
import {selectAdminSources,allowAdminListingFollowup,adminReaderMarkdown} from './admin-source-selection.mjs';
import {collectKoreanNewSections,collectKVillageFootwearAudit,collectBlackyakNew} from './collect-korean-new-sections.mjs';
import {collectNikeOfficialNew,readNikeOfficialJson} from './collect-nike-official-new.mjs';
import {collectMiharaOfficial} from './collect-mihara-official.mjs';
import {collectAdidasLiveNew} from './collect-adidas-live-new.mjs';
import {collectCucinelliOfficial,readCucinelliOfficial} from './collect-cucinelli-official.mjs';
import {collectUnderArmourNew} from './collect-underarmour-new.mjs';
import {collectTomFordOfficial} from './collect-tomford-official.mjs';
import {collectOnNew,ON_NEW} from './collect-on-new.mjs';
import {collectLanvinOfficial} from './collect-lanvin-official.mjs';
import {collectSalomonNew,collectSalomonNewVariants,SALOMON_NEW_URL} from './collect-salomon-new.mjs';
import {collectLululemonNew} from './collect-lululemon-new.mjs';
import {collectJacquemusOfficial} from './collect-jacquemus-official.mjs';
import {officialEvidenceFor,kstDay} from './curation.mjs';
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const normalizeUrl=value=>{try{const u=new URL(value);u.hash='';for(const key of [...u.searchParams.keys()])if(/^(utm_|ref$)/.test(key))u.searchParams.delete(key);return u.href.replace(/\/$/,'');}catch{return '';}};
export function adminCoverageExhaustive(result){
 const coverage=Array.isArray(result.coverage)?result.coverage:[result.coverage||{}];
 return result.complete!==false&&result.exhausted!==false&&result.exhaustive!==false&&coverage.length>0&&coverage.every(c=>c.complete!==false&&c.exhaustive!==false&&c.exhausted!==false&&(c.exhaustive===true||c.exhausted===true||Number(c.total)>0&&c.total===c.read));
}
export function validAdminCapture(value,requestedUrl,now){
 const status=value?.status??value?.metadata?.statusCode,stamp=Date.parse(value?.checkedAt),time=+now;
 if(status!==200||!Number.isFinite(stamp)||stamp>time+60000||time-stamp>86400000)return false;
 const addresses=[value.requestedUrl,value.url,value.metadata?.sourceURL,value.metadata?.url].filter(Boolean);
 const key=value=>{try{const u=new URL(normalizeUrl(value));u.hostname=u.hostname.replace(/^www\./,'');u.pathname=u.pathname.replace(/%7c/ig,'|');u.searchParams.sort();return u.href;}catch{return '';}};
 return !!key(requestedUrl)&&addresses.length>0&&addresses.every(url=>key(url)===key(requestedUrl));
}
export function auditCandidates(products,published,brand){
 const urls=new Set(published.filter(p=>p.brand===brand).map(p=>normalizeUrl(p.url))),styles=new Set(published.filter(p=>p.brand===brand).map(p=>String(p.style||'').toLowerCase()));
 return [...new Map(products.filter(p=>p.brand===brand&&!urls.has(normalizeUrl(p.url))&&(!p.style||!styles.has(p.style.toLowerCase()))).map(p=>[normalizeUrl(p.url),{name:p.name,style:p.style||'',url:p.url}])).values()].slice(0,200);
}
export async function auditBrand(brand,{readHtml,now=new Date(),onCollected,onProgress,stateDirectory}={}){
 if(!isSiteBrandAllowed(brand))throw Error('Brand is not in the permitted collection list');
 const sources=await readJson('config/daily_sources.json'),catalog=await readJson('public/data/catalog.json'),at=now.toISOString();
 let cachedIndex=await readJson('reports/admin-rendered-index.json').catch(()=>({}));const cached=new Map();
 const rendered=async url=>{if(cached.has(url))return cached.get(url);if(!cachedIndex[url])cachedIndex=await readJson('reports/admin-rendered-index.json').catch(()=>cachedIndex);const entry=cachedIndex[url];if(!entry||!entry.path.startsWith('logs/admin-rendered/')||now-Date.parse(entry.checkedAt)>86400000)return null;try{const value=JSON.parse(gunzipSync(await fs.readFile(entry.path)));if(!validAdminCapture(value,url,now))return null;cached.set(url,value);return value;}catch{return null;}};
 const stateFile=stateDirectory&&path.join(stateDirectory,createHash('sha256').update(brand).digest('hex')+'.json');
 const oldState=stateFile?await readJson(stateFile).catch(()=>null):null;
 const configurationHash=createHash('sha256').update(JSON.stringify({version:2,sources:sources[brand]})).digest('hex');
 const state=oldState?.brand===brand&&oldState.configurationHash===configurationHash&&now-Date.parse(oldState.checkedAt)<86400000?oldState:null;
 let accumulatedProducts=state?.products||[];
 const saveState=async value=>{if(!stateFile)return;if(Array.isArray(value.products))accumulatedProducts=[...new Map([...accumulatedProducts,...value.products.filter(p=>officialEvidenceFor(p,kstDay(now)))].map(p=>[p.brand+'|'+p.id+'|'+p.url,p])).values()];await fs.mkdir(stateDirectory,{recursive:true});await fs.writeFile(stateFile+'.part',JSON.stringify({...value,...(Array.isArray(value.products)?{products:accumulatedProducts}:{}),brand,checkedAt:at,configurationHash}));await fs.rename(stateFile+'.part',stateFile);};
 const paced=pacedOfficialFetch(),jina=createJinaClient({key:process.env.JINA_API_KEY||'',timeoutMs:20000,anonymousIntervalMs:Number(process.env.ADMIN_ANONYMOUS_INTERVAL_MS||30000),log:()=>{}});
 readHtml??=async url=>{const page=await rendered(url);if(page?.html&&!/veritas-hub\.cafe24\.com\/challenge|please check your access|verify (?:that )?you are human|<title[^>]*>\s*(?:Just a moment|Access Denied)/i.test(page.html))return page.html;const response=await paced(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html'}});if(!response.ok)throw Error('Official source HTTP '+response.status);return response.text();};
 let result,structuredErrors=[];
 const inventory=siteBrandGroup(brand)==='LUX'?(await readJson('config/official-inventory-sources.json')).sources.filter(s=>s.brand===brand||s.brand==='Toga'&&['Toga Pulla','Toga Virilis'].includes(brand)):[];
 const readFeed=async url=>await rendered(url)||await readHtml(url);
 if(inventory.length){const value=await collectOfficialInventory({sources:inventory,read:readFeed,now,concurrency:1,onCheckpoint:async feed=>saveState({phase:'official-feed',feed})});result={products:value.products.filter(p=>p.brand===brand),coverage:value.diagnostics.map(d=>({...d,listingPages:d.pages,total:d.feedProducts,verified:d.verified,exhaustive:d.exhausted,errors:d.error?[d.error]:[],status:d.error?'partial':'checked'}))};}
 else if(['Nike','Jordan'].includes(brand)){
  const read=async url=>{const file='reports/admin-nike-api/'+createHash('sha256').update(url).digest('hex')+'.json';const previous=await readJson(file).catch(()=>null);if(previous?.url===url&&previous.status===200&&Date.now()-Date.parse(previous.checkedAt)<3600000)return previous;
   const response=await readNikeOfficialJson(url);if(response.status===200){try{const data=JSON.parse(response.body);if(Array.isArray(data.productGroupings)||Array.isArray(data.objects)){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({...response,checkedAt:new Date().toISOString()}));}}catch{}}return response;};
  const value=await collectNikeOfficialNew({brands:[brand],read,now,onCheckpoint:async checkpoint=>saveState({phase:'official-nike-api',checkpoint})});
  result={checkedAt:at,products:value.products,coverage:[{brand,pages:value.pages.length,exhaustive:value.exhausted,errors:value.error?[value.error]:[],status:value.error?'failed':'checked'}]};
 }
 else if(brand==='Maison Mihara Yasuhiro')result=await collectMiharaOfficial({readHtml,now,resume:state?.checkpoint,maxDurationMs:480000,maxProductPages:150,onProgress:async progress=>{await saveState(progress);await onProgress?.(progress);}});
 else if(brand==='TOM FORD')result=await collectTomFordOfficial({readHtml,now,resume:state?.checkpoint,onProgress:async progress=>{await saveState(progress);await onProgress?.(progress);}});
 else if(brand==='On')result=await collectOnNew({readHtml,at:(await rendered(ON_NEW))?.checkedAt||at,allowPartial:true});
 else if(brand==='Lanvin')result=await collectLanvinOfficial({now,read:async url=>await rendered(url)||{rawHtml:await readHtml(url),metadata:{statusCode:200,sourceURL:url,url}},onProgress:async progress=>onProgress?.(progress)});
 else if(brand==='Lululemon')result=await collectLululemonNew({now,read:async url=>await rendered(url)||{rawHtml:await readHtml(url),metadata:{statusCode:200,sourceURL:url,url}},onCheckpoint:async checkpoint=>saveState({phase:'lululemon-new',checkpoint})});
 else if(brand==='Jacquemus')result=await collectJacquemusOfficial({now,read:async url=>await rendered(url)||{rawHtml:await readHtml(url),metadata:{statusCode:200,sourceURL:url,url}},onProgress:async progress=>{await saveState(progress);await onProgress?.(progress);}});
 else if(brand==='Salomon'){
  const initialObservedAt=(await rendered(SALOMON_NEW_URL))?.checkedAt;
  const primary=await collectSalomonNew({readHtml,now,initialObservedAt,onProgress:async progress=>onProgress?.(progress)});
  result=primary.products.length?await collectSalomonNewVariants({previous:primary,readHtml,now,onProgress:async progress=>onProgress?.(progress)}):primary;
 }
 else if(brand==='Brunello Cucinelli')result=await collectCucinelliOfficial({now,read:async url=>await rendered(url)||readCucinelliOfficial(url),onProgress:async progress=>{await saveState(progress);await onProgress?.(progress);}});
 else if(brand==='Under Armour')result=await collectUnderArmourNew({now,read:async url=>await rendered(url)||{rawHtml:await readHtml(url),metadata:{statusCode:200,sourceURL:url,url}},onCheckpoint:async checkpoint=>saveState({phase:'underarmour-new',checkpoint})});
 else if(['adidas','Y-3'].includes(brand)){
  const value=await collectAdidasLiveNew({brands:[brand],now,read:async url=>await rendered(url)||{rawHtml:await readHtml(url),metadata:{statusCode:200,sourceURL:url,url}},onCheckpoint:async checkpoint=>saveState({phase:'adidas-live-new',checkpoint})});
  result=value.outputs[brand];
  if(!result&&brand==='adidas'){
   const structured=await collectStructuredNew({brands:[brand],readHtml,now,allowPartial:true});result=structured.outputs[brand];
   if(!result)structuredErrors=structured.errors.length?structured.errors:value.errors;
  }else if(!result)result={products:[],coverage:[{status:'failed',exhaustive:false,errors:value.errors}]};
 }
 else if(brand==='PUMA')result=await collectPumaKoreaNew({readHtml,now});
 else if(brand==='COLUMBIA')result=await collectColumbiaNew({readHtml,now});
 else if(['Umbro','DESCENTE','Le Coq Sportif'].includes(brand))result=await collectDkonNew({brands:[brand],now});
 else if(['ASICS','New Balance','Converse'].includes(brand)){
  const structured=await collectStructuredNew({brands:[brand],readHtml,now,allowPartial:true});result=structured.outputs[brand];if(!result)structuredErrors=structured.errors.length?structured.errors:[{error:'Official New structured collection returned no output'}];
 }else if(brand==='FILA China')result=await collectFilaChina({read:readHtml,now,resume:state?.checkpoint,maxDurationMs:480000,maxProductPages:120,onProgress:async progress=>{await saveState(progress);await onProgress?.(progress);}});
 else if(['K2','DYNAFIT'].includes(brand))result=await collectKVillageFootwearAudit({brands:[brand],now});
 else if(brand==='BLACKYAK')result=await collectBlackyakNew({now});
 else if(['spyder','NEPA'].includes(brand))result=await collectKoreanNewSections({brands:[brand],readHtml,now});
 else if(siteBrandGroup(brand)!=='LUX'&&(sources[brand]||[]).some(s=>/\/collections\//.test(s.url)&&isNewListing(s.url))){
  result=await collectOfficialNewFeeds({sources:{[brand]:sources[brand]},now,read:readFeed,onProgress:()=>{}});
 }
 if(!result){
  const lux=siteBrandGroup(brand)==='LUX',selected=selectAdminSources(brand,sources[brand]);
  if(!selected.length)throw Error('공식 New 수집 경로 설정 점검 필요');
  const read=async input=>{const url=input.replace(/^https:\/\/r\.jina\.ai\//,'');const page=await rendered(url);if(page?.markdown){try{return assertReadableOfficial(adminReaderMarkdown(page.markdown,url));}catch{}}try{return assertReadableOfficial(officialHtmlMarkdown(await readHtml(url),url));}catch{return jina.read('https://r.jina.ai/'+url);}};
  const continuation=state?.phase&&Array.isArray(state.listingPending)&&Array.isArray(state.listingReceipts)?state:null;
  result=await collectNewArrivals({sources:{[brand]:selected},brands:[brand],existing:catalog.products.filter(p=>p.brand===brand),read,readDetails:readHtml,now,maxPagesPerBrand:Number(process.env.ADMIN_MAX_LISTING_PAGES||20),maxDetailMsPerBrand:240000,catalogueBrands:lux?[brand]:[],allowListingFollowup:(next,parent)=>allowAdminListingFollowup(brand,selected,next,parent),filterCandidate:isScopedSneakerCandidate,log:()=>{},
   ...(continuation?{listingSeeds:continuation.listingPending,resumeReceipts:continuation.listingReceipts,carriedPending:continuation.pending||[],candidateOutcomes:continuation.candidateOutcomes||[],skipDiscovery:continuation.listingPending.length===0}:{}),completionProof:true,strictLuxuryTileProofs:true,
   onProgress:async progress=>{await saveState(progress);await onProgress?.(progress);}});
  {const validated=(result.candidateOutcomes||[]).filter(o=>o.outcome==='complete'&&o.product).map(o=>o.product);const merged=new Map([...(continuation?.products||[]),...validated,...result.products].map(p=>[p.brand+'|'+p.id+'|'+p.url,p]));result.products=[...merged.values()];}
  if(structuredErrors.length)result.errors=[...(result.errors||[]),...structuredErrors];
 }
 const coverage=Array.isArray(result.coverage)?result.coverage:[result.coverage||{}],errors=coverage.flatMap(c=>[...(c.errors||[]),...(c.error?[c.error]:[])]).concat(result.errors||[]).map(e=>String(e.error||e.message||e).slice(0,240));
 if(onCollected)await onCollected(result);
 const products=result.products||[],exhaustive=adminCoverageExhaustive(result);
 const failed=!products.length&&(coverage.some(c=>['failed','unavailable'].includes(c.status))||errors.length>0&&!coverage.some(c=>Number(c.pages||c.listingPages)>0));
 const today=new Date(now.getTime()+9*3600000).toISOString().slice(0,10),prepared=prepareCatalog({...catalog,products:catalog.products.filter(p=>p.brand===brand)},null,null,today),published=prepared.products.filter(p=>prepared.officialMatches.get(p.id));
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
