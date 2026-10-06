import fs from 'node:fs';
import { validDay, httpUrl, classifyFootwear, canonicalUrl, brandPolicy, officialHybridReview, sneakerHybridCandidate } from './curation.mjs';

const monthNames = 'January February March April May June July August September October November December'.split(' ');
export function exactDate(text) {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/); if (iso && validDay(iso[1])) return iso[1];
  const month='(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const match=text.match(new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`,'i'));
  const reverse=!match&&text.match(new RegExp(`\\b(\\d{1,2})\\s+${month}\\s+(20\\d{2})\\b`,'i'));
  if(!match&&!reverse)return null;const m=match?match[1]:reverse[2],d=match?match[2]:reverse[1],y=match?match[3]:reverse[3];
  const day = `${y}-${String(monthNames.findIndex(x=>x.slice(0,3).toLowerCase()===m.slice(0,3).toLowerCase())+1).padStart(2,'0')}-${d.padStart(2,'0')}`;
  return validDay(day) ? day : null;
}
export function releaseSentence(text,product) {
  if(!product)return null;
  text=text.split(/\n#{1,3}\s*(?:Related|Recommended|You may also|Recently viewed)/i)[0];
  const parts = text.split(/\n|(?<=[.!?])\s+/).filter(s=>/releases? (?:on|date)|launch(?:es|ing)? (?:on|date)|available (?:starting|from|on)|발매일|출시일/i.test(s));
  const candidates = parts.filter(s=>product.style&&s.toLowerCase().includes(product.style.toLowerCase())||(product.signalAliases||[]).some(a=>a.length>=12&&s.toLowerCase().includes(a.toLowerCase())))
    .map(s=>({day:exactDate(s),excerpt:s.trim().split(/\s+/).slice(0,25).join(' ')})).filter(x=>x.day);
  if (new Set(candidates.map(x=>x.day)).size !== 1) return null;
  return candidates[0];
}
export function parseSalomonCalendar(text, sourceUrl, checkedAt) {
  const out=[];
  for (const block of text.split(/\n\*\s+/)) {
    const heading = block.match(/##\s+\[([^\]]+)\]\((https:\/\/www\.salomon\.com\/[^)]+\/product\/[^)]+)\)/);
    if(!heading) continue;
    const day = exactDate(block.slice(0, heading.index)); if(!day) continue;
    const type = block.slice(heading.index + heading[0].length).split(/\n/).find(x=>/Sneakers|running shoes/i.test(x));
    if(!type || /SNOWCLOG/i.test(heading[1])) continue;
    const image = block.match(/!\[[^\]]*\]\((https:\/\/[^)]+)\)/)?.[1];
    const style = heading[2].split('/').pop();
    out.push({id:`official-salomon-${style.toLowerCase()}`,brand:'Salomon',name:heading[1],style,url:heading[2],image:image||'',productType:'sneaker',officialCategory:type.trim(),
      releaseDate:day,country:'CA',dateEvidence:{url:sourceUrl,precision:'day',official:true,verified:true,verifiedAt:checkedAt,region:'CA',excerpt:`${heading[1]} (${style}) — ${day}, official Canadian launch calendar.`}});
  }
  return out;
}
export function productDetails(text, product) {
  const style = String(product.style || '').toLowerCase();
  const nameParts = product.name.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
  if (!(style && text.toLowerCase().includes(style)) && nameParts.filter(x=>text.toLowerCase().includes(x)).length < Math.min(3,nameParts.length)) return null;
  const body = text.slice(Math.max(0,text.search(/(?:^|\n)# (?!Skip)/)), text.length).split(/\n#{1,3}\s*(?:Related|Recommended|You may also|Recently viewed)/i)[0];
  const heading=body.match(/^#\s+(.+)$/m)?.[1]||'';
  if(nameParts.filter(x=>heading.toLowerCase().includes(x)).length<Math.min(3,nameParts.length))return null;
  if(style&&!body.toLowerCase().includes(style))return null;
  const images=[...body.matchAll(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g)].filter(m=>!/logo|icon|flag|payment/i.test(m[1]+' '+m[2]));
  const image = images.find(m=>style&&m[2].toLowerCase().includes(style))?.[2] || images.find(m=>nameParts.every(x=>m[1].toLowerCase().includes(x)))?.[2] || (product.productVerifiedAt?product.image:'');
  if(!httpUrl(image)) return null;
  const description=body.split(/\n/).filter(s=>s.length>45&&!/https?:\/\/|cookies|privacy|copyright|shipping|returns|sign up|newsletter/i.test(s)).slice(0,12).join(' ').slice(0,3500);
  return {image,description,priceLabel:body.match(/(?:\$|€|£|₩)\s?[\d,.]+/)?.[0]||product.priceLabel||'',productType:product.productType||'sneaker'};
}
export async function collectOfficialEvidence({read,products=[],now=new Date(),maxCandidates=Infinity,log=console.log}) {
  const checkedAt=new Date(now).toISOString(), verified=[], diagnostics=[];
  const source='https://www.salomon.com/en-ca/c/launch-calendar/upcoming';
  try {
    const candidates=parseSalomonCalendar(await read(`https://r.jina.ai/${source}`),source,checkedAt);
    for(const p of candidates) {
      try { const page=await read(`https://r.jina.ai/${p.url}`), details=productDetails(page,p); if(!details) throw Error('Product identity/image not verified');
        verified.push({...p,...details,productVerifiedAt:checkedAt,productEvidenceUrl:p.url});
      } catch(e) { diagnostics.push({url:p.url,error:e.message}); }
    }
  } catch(e) { diagnostics.push({url:source,error:e.message}); }
  const sources=JSON.parse(fs.readFileSync(new URL('../config/daily_sources.json',import.meta.url),'utf8'));
  const incoming=products.filter(p=>{
    const needsHybridReview=sneakerHybridCandidate(p)&&(!p.hybridReview?.approved||p.hybridReview.sneakerSole!==true);
    if(p.dateEvidence?.verified&&!needsHybridReview||!httpUrl(p.url))return false;
    const policy=brandPolicy(p.brand),reason=classifyFootwear(p).reason;
    if(!policy||!['mandatory','core','conditional'].includes(policy.policy)||policy.policy==='conditional'&&!p.modelReview?.approved)return false;
    if(reason==='excluded-footwear')return false;
    const host=new URL(p.url).hostname.replace(/^www\./,'');
    if(!(sources[p.brand]||[]).some(s=>{const h=new URL(s.url).hostname.replace(/^www\./,'');return host===h||host.endsWith('.'+h);}))return false;
    if(!p.style&&!(p.signalAliases||[]).some(a=>a.length>=12)){diagnostics.push({id:p.id,reason:'exact-product-date-identity-required'});return false;}
    return true;
  }).sort((a,b)=>(b.firstSeen||'').localeCompare(a.firstSeen||'')).slice(0,maxCandidates);
  let next=0,completed=0;const pages=new Map();
  const readOnce=url=>{const key=canonicalUrl(url);if(!pages.has(key))pages.set(key,read(`https://r.jina.ai/${url}`));return pages.get(key);};
  log(`Official date verification: ${incoming.length} eligible product identities to check.`);
  async function verifyNext(){while(next<incoming.length){const p=incoming[next++];
    try {
      const page=await readOnce(p.url), release=p.dateEvidence?.verified?null:releaseSentence(page,p), details=productDetails(page,p);
      if(!details||!p.dateEvidence?.verified&&!release) {diagnostics.push({id:p.id,reason:!details?'product-identity-image-not-found':'exact-release-day-not-found'});continue;}
      // An official description can establish the sneaker base of a hybrid.
      // It still needs exact release proof and the separate official photo gate.
      const hybridReview=officialHybridReview(p,details.description,checkedAt);
      const hybrid=hybridReview?{hybridReview}:{};
      const releaseProof=release?{releaseDate:release.day,dateEvidence:{url:p.url,precision:'day',official:true,verified:true,verifiedAt:checkedAt,excerpt:release.excerpt}}:{};
      verified.push({...p,...details,...hybrid,...releaseProof,productVerifiedAt:checkedAt,productEvidenceUrl:p.url});
    } catch(e) {diagnostics.push({id:p.id,error:e.message});}
    finally{completed++;if(completed%25===0||completed===incoming.length)log(`Official date verification: ${completed}/${incoming.length} checked; ${verified.length} verified.`);}
  }}
  // Reader applies one shared rate limit. Parallel workers prevent slow pages from stalling every brand.
  await Promise.all(Array.from({length:4},()=>verifyNext()));
  log(`Official date verification: ${verified.length} qualified records; ${diagnostics.length} held checks.`);
  return {products:verified,diagnostics,checkedAt};
}

export function mergePreserving(existing,incoming) {
  const output=[...existing], ids=new Map(output.map((p,i)=>[p.id,i]));
  for(const p of incoming) {
    const i=ids.get(p.id);
    if(i!==undefined) {
      // Preserve complete old source record alongside verified additions; never blank data on outages.
      const safe=Object.fromEntries(Object.entries(p).filter(([,v])=>v!==undefined&&v!==null&&v!==''));
      const old=output[i];
      if(old.dateEvidence?.verified&&(!p.dateEvidence?.verified||(p.dateEvidence.verifiedAt||'')<(old.dateEvidence.verifiedAt||'')))for(const field of ['releaseDate','dateEvidence'])delete safe[field];
      if(old.productVerifiedAt&&(!p.productVerifiedAt||p.productVerifiedAt<old.productVerifiedAt))for(const field of ['name','brand','style','url','image','description','officialCategory','productType','colorway','country','material','gender','productVerifiedAt','productEvidenceUrl'])delete safe[field];
      output[i]={...output[i],...safe};
    } else {ids.set(p.id,output.length);output.push(p);}
  }
  return output;
}
