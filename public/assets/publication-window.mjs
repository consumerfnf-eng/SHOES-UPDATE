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
//
// `catalogue-listing` is the weakest of the three and says the least: the
// product is on the brand's own shelf on the day we read it. For a brand with
// no New section and nothing on its site but what it currently sells, that is
// the whole of what can be known, and it is what the card says - 목록 확인,
// never a release date.
//
// `catalogue-latest-listing` says even less: the shelf was read newest first,
// but we have not established that the shop holds only this season. It is
// taken on the same terms and leaned on no harder - what keeps those records
// honest is the three-month window and the retail launch index, not this
// evidence.
export const ARRIVAL_KINDS=['new-arrivals-listing','new-badge','catalogue-listing','catalogue-latest-listing'];
export function hasArrivalEvidence(product,today) {
  const e=product?.arrivalEvidence;
  if(!e||e.verified!==true||!ARRIVAL_KINDS.includes(e.kind)||e.brand!==product.brand||e.style!==product.style||e.productUrl!==product.url||!e.excerpt||!e.contentHash)return false;
  try{if(new URL(e.url).protocol!=='https:')return false;}catch{return false;}
  if(!Number.isFinite(Date.parse(e.verifiedAt)))return false;
  const day=new Date(Date.parse(e.verifiedAt)+9*3600000).toISOString().slice(0,10);
  return day<=today&&(!!publicationWindow(product)||day>=calendarShift(today,-3));
}
