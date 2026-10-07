import {validCalendarDay,calendarShift} from './release-window.mjs';

export function publicationWindow(product) {
  const value=product?.firstPublishedAt;
  if(!value||!Number.isFinite(Date.parse(value)))return null;
  const start=new Date(Date.parse(value)+9*3600000).toISOString().slice(0,10);
  return {start,end:calendarShift(start,3)};
}
export function publicationState(product,today) {
  const window=publicationWindow(product);
  if(!window||!validCalendarDay(today)||window.start>today)return 'invalid';
  return today>=window.end?'expired':'released';
}
// This is assortment evidence, never a claimed launch date.
export function hasArrivalEvidence(product,today) {
  const e=product?.arrivalEvidence;
  if(!e||e.verified!==true||!['new-arrivals-listing','new-badge'].includes(e.kind)||e.brand!==product.brand||e.style!==product.style||e.productUrl!==product.url||!e.excerpt||!e.contentHash)return false;
  try{if(new URL(e.url).protocol!=='https:')return false;}catch{return false;}
  if(!Number.isFinite(Date.parse(e.verifiedAt)))return false;
  const day=new Date(Date.parse(e.verifiedAt)+9*3600000).toISOString().slice(0,10);
  return day<=today&&(!!publicationWindow(product)||day>=calendarShift(today,-3));
}
