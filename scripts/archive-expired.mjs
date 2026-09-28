import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createSign, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { backupKey,createArchiveStore } from './archive-store.mjs';
import { releaseWindow,releaseState } from '../public/assets/release-window.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CELL_FIELDS = 'userEnteredValue,userEnteredFormat,dataValidation,chipRuns,textFormatRuns,note';
const READ_FIELDS = CELL_FIELDS+',effectiveValue';
const MARKER = 'shoes-archive:v1:';
const CORE_HEADERS = ['season','brand','gender','category','picture','product_name','material','color','image_hex_color','image_url','debug'];
const COUNTRIES = new Set('GL EU AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
export const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu,'').replace(/\([^)]*\)/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const scalar = cell => cell?.userEnteredValue?.stringValue ?? cell?.userEnteredValue?.numberValue ?? cell?.effectiveValue?.stringValue ?? cell?.effectiveValue?.numberValue ?? cell?.formattedValue ?? '';
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}'; return JSON.stringify(value); }
const countryCode = value => ({GLOBAL:'GL',KOREA:'KR',CHINA:'CN',EUROPE:'EU',한국:'KR',중국:'CN',유럽:'EU',글로벌:'GL'}[String(value ?? '').toUpperCase()] || String(value ?? '').toUpperCase());
function brandKey(value, config) { const key = normalize(value); return config.aliases?.[key] || key; }
function http(value) { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol); } catch { return false; } }
export function cutoffDate(now = new Date()) {
  const d = new Date(now.getTime()+9*3600_000), year=d.getUTCFullYear(), month=d.getUTCMonth()-3;
  return new Date(Date.UTC(year,month,Math.min(d.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate()))).toISOString().slice(0,10);
}
export function eligibilityReason(product, now = new Date()) {
  if (product.eligibility?.passed !== true) return 'eligibility-not-verified';
  if (!['sneaker','clog','sandal','platform-sandal','hybrid'].includes(product.category)) return 'excluded-category';
  if (!Array.isArray(product.fit) || !product.fit.some(x=>['MLB','DISCOVERY'].includes(x))) return 'missing-brand-fit';
  if (!releaseWindow(product) || product.releaseStatus !== 'released') return 'unknown-release-date';
  const asOf = new Date(now.getTime()+9*3600_000).toISOString().slice(0,10);
  if (releaseState(product,asOf) !== 'expired') return 'not-expired';
  const e = product.dateEvidence;
  if (!e || e.verified !== true || !['day','month'].includes(e.precision) || !http(e.url) || !e.excerpt || !Number.isFinite(Date.parse(e.verifiedAt))) return 'missing-release-evidence';
  if(!http(product.productEvidenceUrl) || !Number.isFinite(Date.parse(product.lastVerifiedAt))) return 'missing-product-verification';
  if (!product.id || !product.brand || !product.name || !http(product.url) || !http(product.image)) return 'incomplete-product';
  return null;
}
export function parseCsv(text) {
  const rows=[]; let row=[],cell='',quoted=false;
  for (let i=0;i<text.length;i++) { const c=text[i]; if(c==='"') { if(quoted && text[i+1]==='"') {cell+='"';i++;} else quoted=!quoted; } else if(c===','&&!quoted){row.push(cell);cell='';} else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';} else cell+=c; }
  if(quoted) throw new Error('Malformed public CSV');
  if(cell||row.length) {row.push(cell.replace(/\r$/,''));rows.push(row);} return rows;
}
export function schemaFor(snapshot, configSheet) {
  const headers=(snapshot.rows[0] || []).map(c=>String(scalar(c)).trim().toLowerCase());
  for (let i=0;i<CORE_HEADERS.length;i++) {
    if (i===7 && configSheet.blankColorHeader && headers[i]==='') continue;
    if(headers[i]!==CORE_HEADERS[i]) throw new Error(`Header changed: ${configSheet.key} column ${i+1}`);
  }
  for(const header of ['country','release_date','상품코드']) if(headers.filter(h=>h===header).length>1) throw new Error(`Ambiguous ${header} column`);
  return {headers,country:headers.indexOf('country'),releaseDate:headers.indexOf('release_date'),style:headers.indexOf('상품코드')};
}
export function existingBrandLocations(snapshots, config) {
  const index = new Map();
  for(const cfg of config.sheets) for(const row of snapshots[cfg.key]?.rows?.slice(1)||[]) {
    const key=brandKey(scalar(row[1]),config); if(!key || !scalar(row[5])) continue;
    if(!index.has(key)) index.set(key,new Set()); index.get(key).add(cfg.key);
  }
  return index;
}
export function resolveDestination(product, config, existing) {
  const country=countryCode(product.country), key=brandKey(product.brand,config);
  if(!COUNTRIES.has(country)) return {reason:'country-needs-review'};
  const tag=String(product.brand).match(/\(([A-Za-z]{2})\)/)?.[1]?.toUpperCase();
  if(tag && tag!==country) return {reason:'brand-country-conflict'};
  if(key==='ralphlauren') return {key:'athleisure',country,reason:'user-ralph-lauren-override'};
  if(config.contemporaryOverrides.some(b=>brandKey(b,config)===key)) return {key:'domestic',country,reason:'user-contemporary-override'};
  const regionalOverride=(config.regionalOverrides||[]).find(rule=>brandKey(rule.brand,config)===key&&!rule.excludeCountries.includes(country));
  if(regionalOverride) return {key:regionalOverride.destination,country,reason:regionalOverride.reason};
  let locations=[...(existing.get(key)||[])];
  if(country==='CN' && locations.includes('outdoor_china')) return {key:'outdoor_china',country,reason:'existing-china-brand'};
  if(country!=='CN') locations=locations.filter(x=>x!=='outdoor_china');
  if(locations.length===1) return {key:locations[0],country,reason:'existing-brand'};
  if(locations.length>1) {
    const group={outdoor:'outdoor_global',sport:'outdoor_global','아웃도어·스포츠':'outdoor_global',luxury:'luxury','럭셔리':'luxury',athleisure:'athleisure','애슬레저':'athleisure',contemporary:'domestic','컨템포러리':'domestic'}[product.archiveGroup] || product.archiveGroup;
    if(locations.includes(group) && !product.collaboration) return {key:group,country,reason:'existing-brand-context'};
    return {reason:'multiple-existing-files-needs-review',candidates:locations};
  }
  // A brand found only in the Chinese source is not silently assigned a new global file.
  if(existing.has(key)) return {reason:'existing-country-mismatch-needs-review',candidates:[...existing.get(key)]};
  const matches=Object.entries(config.newBrandGroups).filter(([,brands])=>brands.some(b=>brandKey(b,config)===key));
  if(matches.length!==1) return {reason:'unknown-brand-needs-review'};
  return {key:matches[0][0],country,reason:'reviewed-new-brand-classification'};
}
export function productKey(p) { return hash([normalize(p.brand),normalize(p.style||p.name),normalize(p.colorway || (p.colors||[]).map(c=>c.name).join(',')),countryCode(p.country)]).slice(0,32); }
const colorText = p => p.colorway || (p.colors||[]).map(c=>c.name).filter(Boolean).join(', ');
export function duplicateStatus(product,snapshot,config,schema,cfg) {
  const key=productKey(product), targetBrand=brandKey(product.brand,config), targetName=normalize(product.name), targetColor=normalize(colorText(product));
  for(let i=1;i<snapshot.rows.length;i++) {
    const row=snapshot.rows[i];
    if(row.some(c=>c.note===MARKER+key)) {
      const intact=brandKey(scalar(row[1]),config)===targetBrand && String(scalar(row[5]))===product.name && scalar(row[9])===product.image && normalize(scalar(row[7]))===targetColor && scalar(row[3])==='shoe';
      return {status:intact?'already-archived':'archive-marker-mismatch-needs-review',row:i+1};
    }
    if(brandKey(scalar(row[1]),config)!==targetBrand) continue;
    const brandCountry=String(scalar(row[1])).match(/\(([A-Za-z]{2})\)/)?.[1]?.toUpperCase();
    const rowCountry=brandCountry || countryCode(schema.country>=0?scalar(row[schema.country]):'') || cfg.defaultCountry;
    if(rowCountry!==countryCode(product.country)) continue;
    const sameStyle=product.style && schema.style>=0 && normalize(scalar(row[schema.style]))===normalize(product.style);
    const sameName=normalize(scalar(row[5]))===targetName;
    if(!sameStyle&&!sameName) continue;
    const existingColor=normalize(scalar(row[7]));
    if(existingColor && targetColor && existingColor===targetColor) return {status:'existing-product',row:i+1};
    if(scalar(row[9])===product.image) return {status:'existing-product',row:i+1};
    if(!existingColor || !targetColor) return {status:'possible-duplicate-needs-review',row:i+1};
  }
  return null;
}
export function planArchive(products,snapshots,config,now=new Date(),ledger={entries:{}}) {
  const existing=existingBrandLocations(snapshots,config), ready=[],pending=[],skipped=[],seen=new Set();
  for(const product of products) {
    const id=product.id,key=productKey(product), reason=eligibilityReason(product,now);
    if(reason) {pending.push({id,key,reason});continue;}
    const route=resolveDestination(product,config,existing);
    if(!route.key) {pending.push({id,key,...route});continue;}
    const cfg=config.sheets.find(s=>s.key===route.key), snapshot=snapshots[cfg.key], schema=schemaFor(snapshot,cfg);
    if(cfg.readOnly) {pending.push({id,key,reason:'destination-read-only-needs-user-review',destination:cfg.key});continue;}
    const duplicate=duplicateStatus(product,snapshot,config,schema,cfg);
    if(duplicate) {(duplicate.status.includes('review')?pending:skipped).push({id,key,destination:cfg.key,...duplicate});continue;}
    if(ledger.entries?.[key]) {pending.push({id,key,reason:'ledger-requires-reconciliation',state:ledger.entries[key].state});continue;}
    if(seen.has(key)) {skipped.push({id,key,status:'queue-duplicate'});continue;} seen.add(key);
    ready.push({product,key,destination:cfg.key,route,schema});
  }
  return {ready,pending,skipped};
}

function validateCell(value,validation) {
  if(!validation) return;
  const c=validation.condition;
  if(c?.type==='ONE_OF_LIST') { if(!(c.values||[]).some(x=>x.userEnteredValue===String(value??''))) throw new Error('New value does not satisfy existing dropdown'); return; }
  throw new Error(`Validation requires review: ${c?.type||'unknown'}`);
}
function cloneFormat(cell) {
  const format=structuredClone(cell?.userEnteredFormat||{});
  if(format.textFormat) delete format.textFormat.link;
  return format;
}
export function prepareRows(entries,snapshot,cfg) {
  if(snapshot.metadata?.tables?.length) throw new Error('Native table requires manual range review before append');
  const schema=schemaFor(snapshot,cfg);
  // Take a complete shoe exemplar and peer. Do not copy row-specific chips, links or side calculations.
  const candidates=snapshot.rows.slice(1).filter(r=>/^(shoe|shoes|sneaker|sneakers)$/i.test(String(scalar(r[3]))) && scalar(r[1]) && scalar(r[5]));
  const exemplar=candidates.find(r=>r.slice(0,11).every((c,i)=>!c.chipRuns?.length && (!c.userEnteredValue?.formulaValue || i===4)));
  if(!exemplar) throw new Error('No safe native shoe exemplar found; schema review required');
  const peer=candidates.find(r=>r!==exemplar);
  if(!peer) throw new Error('Need two native shoe exemplars before writing');
  for(let i=0;i<11;i++) if(canonical(exemplar[i]?.dataValidation||null)!==canonical(peer[i]?.dataValidation||null)) throw new Error('Conflicting exemplar validation requires review');
  return entries.map(entry=>{
    const p=entry.product, width=Math.max(11,schema.country+1,schema.releaseDate+1,schema.style+1), values=Array.from({length:width},()=>({}));
    const cleanBrand=String(p.brand).replace(/\s*\([A-Za-z]{2}\)/g,'');
    const archiveBrand=schema.country<0&&entry.route.country!==cfg.defaultCountry?`${cleanBrand} (${entry.route.country})`:cleanBrand;
    const hex=(p.colors||[]).map(c=>c.hex).filter(x=>/^#[\dA-Fa-f]{6}$/.test(x||'')).join(' / ');
    // The site's season parser expects a YYYY-MM month. This new row uses its verified release month.
    const raw=[p.releaseDate.slice(0,7),archiveBrand,p.gender||'','shoe',null,p.name,p.material||'',colorText(p),hex,p.image,''];
    if(schema.country>=0) raw[schema.country]=entry.route.country;
    if(schema.releaseDate>=0) raw[schema.releaseDate]=p.releaseDate;
    if(schema.style>=0) raw[schema.style]=p.style||'';
    for(let i=0;i<width;i++) {
      if(raw[i]===undefined) continue;
      validateCell(raw[i],exemplar[i]?.dataValidation);
      const f=cloneFormat(exemplar[i]);
      // Hex swatches encode the old row's color. Regenerate only the new swatch.
      if(i===8) {delete f.backgroundColor;delete f.backgroundColorStyle;if(hex){const h=hex.slice(1,7);f.backgroundColorStyle={rgbColor:{red:parseInt(h.slice(0,2),16)/255,green:parseInt(h.slice(2,4),16)/255,blue:parseInt(h.slice(4,6),16)/255}};}}
      values[i]={userEnteredFormat:f};
      if(exemplar[i]?.dataValidation) values[i].dataValidation=structuredClone(exemplar[i].dataValidation);
      if(i===4) values[i].userEnteredValue={formulaValue:'=IF(INDEX(J:J,ROW())="","",IMAGE(INDEX(J:J,ROW())))'};
      else if(raw[i]!==''&&raw[i]!==null) values[i].userEnteredValue={stringValue:String(raw[i])};
    }
    values[5].note=MARKER+entry.key;
    return {values};
  });
}

function projection(cell) { return Object.fromEntries(CELL_FIELDS.split(',').filter(k=>cell?.[k]!==undefined).map(k=>[k,cell[k]])); }
export function fingerprintRows(rows) { return hash(rows.map(row=>row.map(projection))); }
export function assertExistingPreserved(before,after) {
  for(let r=0;r<before.rows.length;r++) for(let c=0;c<before.rows[r].length;c++) {
    const newRow=after.rows[r]?.some(cell=>String(cell.note||'').startsWith(MARKER));
    const oldRowEmpty=before.rows[r].every(cell=>!cell.userEnteredValue&&!cell.effectiveValue&&!cell.note&&!cell.chipRuns?.length&&!cell.textFormatRuns?.length);
    if(newRow&&oldRowEmpty) continue; // Previously empty tail rows may acquire the complete new record's native format.
    const original=projection(before.rows[r][c]);
    if(Object.keys(original).length && canonical(original)!==canonical(projection(after.rows[r]?.[c]))) throw new Error(`Existing cell changed at row ${r+1}, column ${c+1}; stop and inspect audit, never auto-restore`);
  }
}
function verifyAppended(entries,planned,after) {
  return entries.map((e,i)=>{
    const matches=after.rows.map((row,index)=>({row,index})).filter(x=>x.row.some(c=>c.note===MARKER+e.key));
    if(matches.length!==1) throw new Error(`Append marker count ${matches.length}; no retry permitted for ${e.key}`);
    for(let c=0;c<planned[i].values.length;c++) {
      const wanted=planned[i].values[c], got=matches[0].row[c]||{};
      for(const key of ['userEnteredValue','dataValidation','note']) if(canonical(wanted[key]??null)!==canonical(got[key]??null)) throw new Error(`Appended cell mismatch: ${e.key} column ${c+1}`);
      // APIs can normalize absent fields. Compare each requested format key, not output-only defaults.
      if(!formatMatches(wanted.userEnteredFormat||{},got.userEnteredFormat||{})) throw new Error(`Appended formatting mismatch: ${e.key} column ${c+1}`);
      if(got.chipRuns?.length) throw new Error('Unexpected chip in appended row');
    }
    return {key:e.key,id:e.product.id,row:matches[0].index+1,destination:e.destination,state:'verified'};
  });
}
function formatMatches(expected,actual) {
  if(typeof expected==='number'&&typeof actual==='number')return Math.abs(expected-actual)<1e-6;
  if(expected&&typeof expected==='object')return Object.entries(expected).every(([k,v])=>formatMatches(v,actual?.[k]));
  return expected===actual;
}
async function jsonWrite(file,value) { await fs.mkdir(path.dirname(file),{recursive:true}); const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n');await fs.rename(tmp,file); }
async function readJson(file,fallback) {try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}}
export async function executeArchive({products,config,adapter,apply=false,now=new Date(),ledger={entries:{}},saveLedger=async()=>{},audit=async()=>{throw new Error('Immutable audit store required');}}) {
  const snapshots={}; for(const cfg of config.sheets) snapshots[cfg.key]=await adapter.read(cfg,apply);
  const plan=planArchive(products,snapshots,config,now,ledger);
  const report={schemaVersion:1,generatedAt:now.toISOString(),mode:apply?'apply':'dry-run',status:apply?'success':'dry-run',ready:plan.ready.map(({product,key,destination,route})=>({id:product.id,key,destination,reason:route.reason})),pending:plan.pending,skipped:plan.skipped,appended:[]};
  if(!apply) {report.note='No Sheet writes. Native metadata and formats are verified only during authenticated apply.';report.needsReview=report.pending.length>0;return report;}
  for(const cfg of config.sheets) {
    const entries=plan.ready.filter(e=>e.destination===cfg.key);
    for(let offset=0;offset<entries.length;offset+=config.maxRowsPerWrite||20) {
      let chunk=entries.slice(offset,offset+(config.maxRowsPerWrite||20));
      const before=await adapter.read(cfg,true);
      // Replan from current cells immediately before the append; another person may have added products.
      const fresh=planArchive(chunk.map(e=>e.product),{...snapshots,[cfg.key]:before},config,now,ledger);
      report.pending.push(...fresh.pending);report.skipped.push(...fresh.skipped);
      chunk=fresh.ready.filter(e=>e.destination===cfg.key);
      if(!chunk.length) continue;
      const rows=prepareRows(chunk,before,cfg), transaction=randomUUID();
      await audit(transaction,{config:cfg,snapshot:before,fingerprint:fingerprintRows(before.rows),plannedRows:rows,keys:chunk.map(e=>e.key)});
      for(const e of chunk) ledger.entries[e.key]={state:'pending',transaction,destination:cfg.key,id:e.product.id,startedAt:new Date().toISOString()};
      await saveLedger(ledger); // Must persist before write, including when the subsequent request times out.
      let writeError;
      try { await adapter.append(cfg,rows); } catch(error) { writeError=error; }
      try {
        const after=await adapter.read(cfg,true);
        assertExistingPreserved(before,after);
        const verified=verifyAppended(chunk,rows,after);
        for(const v of verified) ledger.entries[v.key]={...ledger.entries[v.key],...v,verifiedAt:new Date().toISOString(),reconciledAfterError:!!writeError};
        await saveLedger(ledger);
        report.appended.push(...verified);
        snapshots[cfg.key]=after;
      } catch(error) {
        for(const e of chunk) ledger.entries[e.key]={...ledger.entries[e.key],state:'uncertain',reason:error.message};
        await saveLedger(ledger);
        // Never re-send an uncertain transaction and never restore a user's live cells automatically.
        throw new Error(`Archive write unverified (${transaction}); stopped without replay: ${error.message}`);
      }
    }
  }
  report.needsReview=report.pending.length>0;
  if(report.needsReview)report.status='action-required';
  return report;
}

export async function accessToken(env=process.env,{metadataProbe=false}={}) {
  let body;
  if(env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    let account;
    try{account=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);}catch{throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON; credential contents omitted');}
    if(account.type!=='service_account'||!account.private_key||!account.client_email) throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON');
    const iat=Math.floor(Date.now()/1000), b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const scope='https://www.googleapis.com/auth/spreadsheets'+(metadataProbe?' https://www.googleapis.com/auth/drive.metadata.readonly':'');
    const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:account.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600});
    const signature=createSign('RSA-SHA256').update(unsigned).sign(account.private_key,'base64url');
    body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature});
  } else if(env.GOOGLE_OAUTH_CLIENT_ID&&env.GOOGLE_OAUTH_CLIENT_SECRET&&env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    body=new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,refresh_token:env.GOOGLE_OAUTH_REFRESH_TOKEN});
  } else {const e=new Error('Missing unattended Google Sheets credentials; no write attempted. See docs/archive-integration.md');e.code='ARCHIVE_AUTH_MISSING';throw e;}
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body,signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error(`Google authentication failed (HTTP ${response.status}); secret values omitted`);
  return (await response.json()).access_token;
}
function col(index) {let result='';for(let i=index+1;i>0;i=Math.floor((i-1)/26))result=String.fromCharCode(65+(i-1)%26)+result;return result;}
export async function verifyArchiveConnection(config,token,{fetchImpl=fetch}={}) {
  if(!token)throw new Error('Authorized Google token required');
  async function get(url) {
    const response=await fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Read-only connection probe HTTP ${response.status}; metadata permission may require drive.metadata.readonly scope`);
    return response.json();
  }
  const results=[];
  for(const cfg of config.sheets.filter(s=>!s.readOnly)) {
    try {
      const drive=await get(`https://www.googleapis.com/drive/v3/files/${cfg.id}?fields=id,mimeType,trashed,capabilities(canEdit)`);
      if(drive.id!==cfg.id||drive.trashed||drive.mimeType!=='application/vnd.google-apps.spreadsheet')throw new Error('Target is not the expected active native spreadsheet');
      if(drive.capabilities?.canEdit!==true)throw new Error('Service account editor capability is missing or unverified');
      const base=`https://sheets.googleapis.com/v4/spreadsheets/${cfg.id}`;
      const meta=await get(base+'?fields='+encodeURIComponent('sheets(properties,protectedRanges(range,warningOnly,requestingUserCanEdit))'));
      const target=meta.sheets?.find(s=>s.properties.sheetId===cfg.sheetId);
      if(!target||target.properties.title!==cfg.title)throw new Error('Configured target tab has changed');
      const {rowCount,columnCount}=target.properties.gridProperties;
      const range=`'${cfg.title.replace(/'/g,"''")}'!A1:${col(columnCount-1)}${Math.min(3,rowCount)}`;
      const data=await get(base+'?'+new URLSearchParams({ranges:range,fields:`sheets(data(rowData(values(${READ_FIELDS}))))`}));
      schemaFor({rows:(data.sheets?.[0]?.data?.[0]?.rowData||[]).map(r=>r.values||[])},cfg);
      const wholeSheetProtection=(target.protectedRanges||[]).some(p=>!p.warningOnly&&p.requestingUserCanEdit!==true&&p.range?.sheetId===cfg.sheetId&&['startRowIndex','endRowIndex','startColumnIndex','endColumnIndex'].every(k=>p.range[k]===undefined));
      if(wholeSheetProtection)throw new Error('Target tab has whole-sheet protection requiring review');
      results.push({destination:cfg.key,spreadsheetId:cfg.id,status:'verified',canEdit:true,schemaMatches:true,readRange:range});
    } catch(error) {results.push({destination:cfg.key,spreadsheetId:cfg.id,status:'blocked',reason:error.message});}
  }
  return {schemaVersion:1,mode:'verify-connection',generatedAt:new Date().toISOString(),status:results.every(r=>r.status==='verified')?'connection-verified':'blocked-config',writes:0,results};
}
export async function writeRunSummary(report,env=process.env) {
  const pending=report.pending||[],attention=pending.length>0||['blocked-config','failed'].includes(report.status);
  if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`archive_status=${report.status}\narchive_pending=${pending.length}\narchive_attention=${attention}\n`);
  if(env.GITHUB_STEP_SUMMARY) {
    const counts=new Map();for(const item of pending){const reason=item.reason||item.status||'review-required';counts.set(reason,(counts.get(reason)||0)+1);}
    const safe=value=>String(value).replace(/[^A-Za-z0-9_:-]/g,'').slice(0,80)||'unavailable';
    let summary=`\n## SHOES archive\n\nStatus: **${safe(report.status)}**. Verified appended rows: ${(report.appended||[]).length}. Pending review: **${pending.length}**.\n`;
    if(counts.size)summary+='\n| Review reason | Products |\n|---|---:|\n'+[...counts].map(([reason,n])=>`| ${safe(reason)} | ${n} |`).join('\n')+'\n';
    if(pending.length)summary+='\nPending product IDs (first 30): '+pending.slice(0,30).map(p=>'`'+safe(p.id||p.key)+'`').join(', ')+'.\nNo pending product was written to Sheets.\n';
    if(report.mode==='verify-connection')summary+='\nRead-only Google connection probe; no Sheet writes.\n'+report.results.map(r=>`- ${safe(r.destination)}: ${safe(r.status)} (editor capability ${r.canEdit===true?'verified':'unverified'})`).join('\n')+'\n';
    if(attention&&!pending.length)summary+='\nConfiguration or execution needs attention. No raw Sheet data is included here.\n';
    await fs.appendFile(env.GITHUB_STEP_SUMMARY,summary);
  }
}
export function createGoogleAdapter(token) {
  let lastRead=0;
  async function request(url,method='GET',body) {
    // Serialize and pace reads below the per-user quota. Never retry a write.
    if(method==='GET'){const wait=1100-(Date.now()-lastRead);if(wait>0)await new Promise(r=>setTimeout(r,wait));lastRead=Date.now();}
    const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
    if(!response.ok) throw new Error(`Sheets ${method} failed (HTTP ${response.status}); response omitted`);
    return response.json();
  }
  return {
    async read(cfg,native) {
      if(!native || cfg.readOnly) {
        const response=await fetch(`https://docs.google.com/spreadsheets/d/${cfg.id}/export?format=csv&gid=${cfg.sheetId}`,{signal:AbortSignal.timeout(60000)});
        if(!response.ok) throw new Error(`Archive CSV read failed: ${cfg.key} HTTP ${response.status}`);
        return {rows:parseCsv(await response.text()).map(row=>row.map(v=>v?{userEnteredValue:{stringValue:v}}:{})),native:false};
      }
      if(!token) throw new Error('Native read requires authorized token');
      const base=`https://sheets.googleapis.com/v4/spreadsheets/${cfg.id}`;
      const all=await request(base+'?fields='+encodeURIComponent('spreadsheetId,properties,sheets(properties,merges,tables,protectedRanges,basicFilter,conditionalFormats,bandedRanges)'));
      const metadata=all.sheets.find(s=>s.properties.sheetId===cfg.sheetId);
      if(!metadata||metadata.properties.title!==cfg.title) throw new Error(`Target tab changed: ${cfg.key}`);
      const {rowCount,columnCount}=metadata.properties.gridProperties;
      if(rowCount*columnCount>2_000_000) throw new Error('Native snapshot exceeds bounded audit limit; review required');
      const step=Math.max(1,Math.floor(45000/columnCount)),rows=Array.from({length:rowCount},()=>[]);
      for(let start=0;start<rowCount;start+=step) {
        const a1=`'${cfg.title.replace(/'/g,"''")}'!A${start+1}:${col(columnCount-1)}${Math.min(rowCount,start+step)}`;
        const fields=`sheets(data(startRow,startColumn,rowData(values(${READ_FIELDS}))))`;
        const data=await request(base+'?'+new URLSearchParams({ranges:a1,fields}));
        for(const block of data.sheets?.[0]?.data||[]) for(let i=0;i<(block.rowData||[]).length;i++) rows[(block.startRow||0)+i]=block.rowData[i].values||[];
      }
      return {rows,metadata,native:true,capturedAt:new Date().toISOString()};
    },
    async append(cfg,rows) {
      if(cfg.readOnly) throw new Error('Archive destination is read-only');
      if(!token) throw new Error('Write authorization missing');
      // Server-side append resolves the end of existing data atomically; no precomputed row can overwrite concurrent edits.
      return request(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.id}:batchUpdate`,'POST',{requests:[{appendCells:{sheetId:cfg.sheetId,rows,fields:'userEnteredValue,userEnteredFormat,dataValidation,note'}}]});
    }
  };
}
export async function main(argv=process.argv.slice(2)) {
  const flag=name=>argv.includes(name), option=(name,defaultValue)=>{const i=argv.indexOf(name);return i<0?defaultValue:argv[i+1];};
  const queuePath=path.resolve(option('--queue',path.join(ROOT,'data/archive-queue.json'))), reportPath=path.resolve(option('--report',path.join(ROOT,'data/archive-report.json')));
  const ledgerPath=path.join(ROOT,'data/archive-ledger.json'),config=await readJson(path.join(ROOT,'config/archive-sheets.json'));
  if(flag('--verify-connection')) {
    let report;
    try {report=await verifyArchiveConnection(config,await accessToken(process.env,{metadataProbe:true}));}
    catch(error){report={schemaVersion:1,mode:'verify-connection',generatedAt:new Date().toISOString(),status:'blocked-config',writes:0,reason:error.message,results:[]};}
    await jsonWrite(reportPath,report);await writeRunSummary(report);console.log(JSON.stringify(report));return report.status==='connection-verified'?0:2;
  }
  const queue=await readJson(queuePath);
  if(queue.schemaVersion!==1||!Array.isArray(queue.products)) throw new Error('Unsupported archive queue');
  if(!queue.products.length) {const report={schemaVersion:1,generatedAt:new Date().toISOString(),mode:flag('--apply')?'apply':'dry-run',status:'nothing-to-do',appended:[],pending:[]};await jsonWrite(reportPath,report);await writeRunSummary(report);console.log(JSON.stringify(report));return 0;}
  const apply=flag('--apply');
  let token,remoteStore;
  try {if(apply) {
    token=await accessToken();
    remoteStore=createArchiveStore({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,baseSha:process.env.GITHUB_SHA,key:backupKey(process.env.ARCHIVE_BACKUP_KEY),localDirectory:path.join(ROOT,'logs/archive-audit')});
  }} catch(error) {const report={schemaVersion:1,generatedAt:new Date().toISOString(),status:'blocked-config',reason:error.message,queued:queue.products.length,writes:0};await jsonWrite(reportPath,report);await writeRunSummary(report);console.error(error.message);return 2;}
  const lockPath=path.join(ROOT,'data/archive.lock');let lock;
  try {
    if(apply) lock=await fs.open(lockPath,'wx');
    const ledger=apply?await remoteStore.loadLedger():await readJson(ledgerPath,{schemaVersion:1,entries:{}});
    const report=await executeArchive({products:queue.products,config,apply,ledger,adapter:createGoogleAdapter(token),saveLedger:async l=>{
      await remoteStore.saveLedger(l); // Durable encrypted pending state must be verified before Sheet write.
      await jsonWrite(ledgerPath,l);
    },audit:(id,payload)=>remoteStore.audit(id,payload)});
    await jsonWrite(reportPath,report);await writeRunSummary(report);console.log(JSON.stringify({status:report.status,ready:report.ready?.length||0,pending:report.pending.length,appended:report.appended.length}));return 0;
  } catch(error) {const report={schemaVersion:1,status:'failed',reason:error.message,generatedAt:new Date().toISOString()};await jsonWrite(reportPath,report);await writeRunSummary(report);console.error(error.message);return 1;}
  finally {if(lock){await lock.close();await fs.unlink(lockPath);}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) process.exitCode=await main();
