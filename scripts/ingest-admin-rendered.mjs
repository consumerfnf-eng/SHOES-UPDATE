import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {isOfficialProductUrl} from './curation.mjs';

const digest=url=>createHash('sha256').update(url).digest('hex');
// The publication site's allowlist is broader than the older curation POLICY.
// Brand is an optional operator label; official target ownership is mandatory.
const siteGroups=JSON.parse(await fs.readFile(new URL('../config/site-brand-groups.json',import.meta.url),'utf8'));
const knownBrands=[...new Set(siteGroups.groups.flatMap(group=>group.priority))];
const sharedMerchants=new Map([['Toga',['Toga Pulla','Toga Virilis']]]);

export function isOfficialRenderedTarget(owner,url,allowedBrands=knownBrands){
  const children=sharedMerchants.get(owner);
  // This is a source-owner alias, not a publication brand or a rewrite of the
  // receipt. Both permitted sub-brands must independently own this target.
  if(children)return children.every(name=>allowedBrands.includes(name)&&isOfficialProductUrl(name,url));
  return owner?isOfficialProductUrl(owner,url):allowedBrands.some(name=>isOfficialProductUrl(name,url));
}
function provenanceUrl(value){
  if(typeof value!=='string'||!value||value!==value.trim())throw Error('RENDERED_PROVENANCE_URL_INVALID');
  let u;try{u=new URL(value);}catch{throw Error('RENDERED_PROVENANCE_URL_INVALID');}
  if(u.protocol!=='https:'||u.username||u.password)throw Error('RENDERED_PROVENANCE_URL_INVALID');
  return u;
}

export function normalizeRenderedUrl(value){
  const u=provenanceUrl(value);
  u.hash='';
  u.hostname=u.hostname.replace(/^www\./i,'');
  // Decode equivalent path spellings without turning encoded path separators,
  // question marks or ampersands into structure. adidas uses both | and %7C.
  const pathname=u.pathname.replace(/%([a-f0-9]{2})/gi,(escape,hex)=>{
    const char=String.fromCharCode(parseInt(hex,16));
    return /[a-z0-9._~|\-]/i.test(char)?char:escape.toUpperCase();
  }).replace(/\/$/,'');
  for(const key of [...u.searchParams.keys()])if(/^(utm_|ref$)/.test(key))u.searchParams.delete(key);
  // URLSearchParams equates encoded values (+/%20, |/%7C) while preserving
  // every scope-bearing parameter, duplicate and parameter order.
  const query=u.searchParams.toString();
  return u.origin+pathname+(query?'?'+query:'');
}

/** Validate observations as supplied; never replace a contradictory source or
 * final URL with requestedUrl. URL equality preserves path, query and fragment
 * distinctions (canonicalUrl intentionally drops some identity parameters).
 */
export function normalizeRenderedCapture(row,{now=new Date(),maxAgeMs=86400000}={}){
  const metadata=row?.metadata;
  if(!row||typeof row!=='object'||Array.isArray(row)||!metadata||typeof metadata!=='object')throw Error('RENDERED_METADATA_MISSING');
  if(metadata.statusCode!==200||metadata.error||row.error||row.success===false)throw Error('RENDERED_RESPONSE_NOT_SUCCESSFUL');
  const observedSource=metadata.sourceURL??metadata.sourceUrl;
  const observedFinal=metadata.url??metadata.finalURL??metadata.finalUrl;
  const url=row.requestedUrl??metadata.requestedUrl??observedSource;
  const requested=normalizeRenderedUrl(url);
  provenanceUrl(observedSource);provenanceUrl(observedFinal);
  const provenance=[row.requestedUrl,row.requestedURL,row.sourceURL,row.sourceUrl,row.url,row.finalURL,row.finalUrl,
    metadata.sourceURL,metadata.sourceUrl,metadata.requestedUrl,metadata.requestedURL,metadata.url,metadata.finalURL,metadata.finalUrl];
  for(const value of provenance)if(value!==undefined&&normalizeRenderedUrl(value)!==requested)throw Error('RENDERED_PROVENANCE_URL_MISMATCH');
  const official=isOfficialRenderedTarget(row.brand,url);
  if(!official)throw Error('RENDERED_TARGET_NOT_OFFICIAL');
  const checkedAt=row.checkedAt;
  const timestamp=typeof checkedAt==='string'?Date.parse(checkedAt):NaN;
  const iso=typeof checkedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(checkedAt);
  const calendar=iso&&new Date(checkedAt.slice(0,10)+'T00:00:00.000Z');
  const validDay=calendar&&Number.isFinite(calendar.getTime())&&calendar.toISOString().slice(0,10)===checkedAt.slice(0,10);
  const validClock=iso&&Number(checkedAt.slice(11,13))<24&&Number(checkedAt.slice(14,16))<60&&Number(checkedAt.slice(17,19))<60;
  const current=new Date(now).getTime();
  if(!iso||!validDay||!validClock||!Number.isFinite(timestamp)||!Number.isFinite(current)||timestamp>current||current-timestamp>maxAgeMs)throw Error('RENDERED_CHECKED_AT_INVALID_OLD_OR_FUTURE');
  const html=row.rawHtml||row.html;
  if(typeof html!=='string'||!html.trim())throw Error('RENDERED_HTML_MISSING');
  // rawHtml stays available, and html is normalized for existing consumers.
  return {url,row:{...row,html}};
}

/** The mkdir lock covers receipt publication AND full index reconstruction.
 * root is injectable so CLI concurrency can be exercised in a temporary cwd.
 */
export async function ingestRenderedSources({inputs=[],root=process.cwd(),now=new Date(),lockAttempts=300,lockDelayMs=100}={}){
  const resolve=file=>path.resolve(root,file),indexFile=resolve('reports/admin-rendered-index.json');
  const directory=resolve('logs/admin-rendered'),lock=resolve('reports/admin-rendered-index.lock');
  await fs.mkdir(resolve('reports'),{recursive:true});await fs.mkdir(directory,{recursive:true});
  let acquired=false;
  for(let attempt=0;attempt<lockAttempts;attempt++){
    try{await fs.mkdir(lock);acquired=true;break;}
    catch(error){if(error.code!=='EEXIST')throw error;await sleep(lockDelayMs);}
  }
  if(!acquired)throw Error('Rendered source index is busy; retry ingest');
  const rejected=[],retainedNewer=[],recoverySkipped=[];let ingested=0;
  try{
    for(const input of inputs){
      const name=path.basename(input);
      if(!/^admin-rendered-[a-z0-9-]+\.json$/.test(name))throw Error('Unexpected rendered source file');
      const inputFile=resolve('logs/'+name);let normalized;
      try{normalized=normalizeRenderedCapture(JSON.parse(await fs.readFile(inputFile,'utf8')),{now});}
      catch(error){rejected.push({file:name,error:error.code==='ENOENT'?'RENDERED_INPUT_ALREADY_CONSUMED':error.message});continue;}
      const {url,row}=normalized,destination=path.join(directory,digest(url)+'.json.gz');
      let previous;
      try{previous=normalizeRenderedCapture(JSON.parse(gunzipSync(await fs.readFile(destination)).toString('utf8')),{now});}
      catch{/* A missing or invalid receipt is replaced by this validated capture. */}
      if(previous?.url===url&&Date.parse(previous.row.checkedAt)>Date.parse(row.checkedAt)){
        retainedNewer.push({url,checkedAt:previous.row.checkedAt});await fs.unlink(inputFile);continue;
      }
      await fs.writeFile(destination+'.part',gzipSync(JSON.stringify(row)));
      await fs.rename(destination+'.part',destination);await fs.unlink(inputFile);ingested++;
    }
    // Recover entries lost by older concurrent ingests without trusting their
    // stale/truncated index. Bad receipts cannot poison unrelated valid entries.
    const index={};
    for(const file of await fs.readdir(directory)){
      if(!/^[a-f0-9]{64}\.json\.gz$/.test(file))continue;
      try{
        const receipt=path.join(directory,file),{url,row}=normalizeRenderedCapture(JSON.parse(gunzipSync(await fs.readFile(receipt)).toString('utf8')),{now});
        if(file!==digest(url)+'.json.gz')throw Error('RENDERED_RECEIPT_URL_HASH_MISMATCH');
        index[url]={path:'logs/admin-rendered/'+file,checkedAt:row.checkedAt};
      }catch(error){recoverySkipped.push({file,error:error.message});}
    }
    await fs.writeFile(indexFile+'.part',JSON.stringify(index));await fs.rename(indexFile+'.part',indexFile);
    return {index,ingested,rejected,retainedNewer,recoverySkipped};
  }finally{await fs.rmdir(lock);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=await ingestRenderedSources({inputs:process.argv.slice(2)});
  console.log('Live rendered sources cached: '+Object.keys(result.index).length);
  if(result.rejected.length||result.recoverySkipped.length)console.log(JSON.stringify({rejected:result.rejected,recoverySkipped:result.recoverySkipped}));
}
