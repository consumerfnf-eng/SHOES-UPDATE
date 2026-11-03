import {validCalendarDay,calendarShift} from './release-window.mjs';

// Only these authorities can establish a first release. Retailer registration,
// upload/listedAt/publishedAt/firstDetected timestamps, new-arrivals or
// current-assortment placement, Shopify published_at and image paths are
// listing signals, never release proof.
const AUTHORITIES=new Set(['brand-official','retailer-explicit-first-release']);
const REISSUE_TEXT=/\b(?:re[ -]?issue|re[ -]?release|re[ -]?stock|back\s*in\s*stock|re[ -]?edition|re[ -]?run|relaunch)\b|재발매|재입고|리이슈|복각/i;
const REISSUE_FLAGS=['isRestock','restock','isReissue','reissue','isRerelease','rerelease','reRelease','backInStock','isRetro','isReEdition'];
const REISSUE_TEXT_FIELDS=['releaseType','release_type','type','basis','name','title','label','note','description','headline'];

const text=value=>typeof value==='string'?value:'';
const brandKey=value=>text(value).trim().toLowerCase().replace(/\s+/g,' ');
const styleKey=value=>text(value).trim().toUpperCase().replace(/\s+/g,'');
const flagged=source=>!!source&&REISSUE_FLAGS.some(flag=>source[flag]===true);
const markedText=source=>!!source&&REISSUE_TEXT_FIELDS.some(field=>REISSUE_TEXT.test(text(source[field])));
const httpsUrl=value=>{try{const u=new URL(text(value));return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&!/\s/.test(value);}catch{return false;}};

function verdict(eligible,reason,releaseDate,cutoff){return {eligible,reason,releaseDate:releaseDate||null,cutoff};}

export function retailReleaseEligibility(product,today){
  if(!validCalendarDay(today))throw Error('Invalid today');
  const cutoff=calendarShift(today,-3);
  if(!product||typeof product!=='object')return verdict(false,'release-date-unverified',null,cutoff);

  const evidence=product.releaseEvidence;
  if(!evidence||typeof evidence!=='object')return verdict(false,'release-date-unverified',null,cutoff);
  if(evidence.verified!==true||evidence.firstRelease!==true||evidence.kind!=='first-release')
    return verdict(false,'release-date-unverified',null,cutoff);
  if(!validCalendarDay(evidence.date))return verdict(false,'release-date-unverified',null,cutoff);
  if(!AUTHORITIES.has(evidence.authority))return verdict(false,'release-evidence-unauthoritative',null,cutoff);
  if(!httpsUrl(evidence.url)||!httpsUrl(evidence.productUrl)||evidence.productUrl!==product.url)
    return verdict(false,'release-evidence-mismatch',null,cutoff);
  if(!brandKey(product.brand)||brandKey(evidence.brand)!==brandKey(product.brand))
    return verdict(false,'release-evidence-mismatch',null,cutoff);

  // Colourway-specific proof: the evidence must name this exact style code.
  const style=styleKey(product.manufacturerStyle||product.style);
  if(!style||styleKey(evidence.style)!==style)return verdict(false,'release-evidence-mismatch',null,cutoff);

  // A restock/reissue is not a first release, however recent its listing.
  if(flagged(product)||flagged(evidence)||markedText(product)||markedText(evidence))
    return verdict(false,'release-restock-or-reissue',null,cutoff);

  // An older original release outranks the evidence date it was re-proven on.
  let releaseDate=evidence.date;
  const original=[product.originalReleaseDate,evidence.originalReleaseDate].filter(validCalendarDay).sort()[0];
  if(validCalendarDay(original)&&original<releaseDate)releaseDate=original;

  if(releaseDate>today)return verdict(false,'release-date-in-future',releaseDate,cutoff);
  if(releaseDate<cutoff)return verdict(false,'release-outside-three-calendar-months',releaseDate,cutoff);
  return verdict(true,'release-verified-within-three-calendar-months',releaseDate,cutoff);
}

export default retailReleaseEligibility;
