export function validCalendarDay(day){return /^\d{4}-\d{2}-\d{2}$/.test(day||'')&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day;}
export function calendarShift(day,delta){
  if(!validCalendarDay(day)||!Number.isInteger(delta))throw Error('Invalid calendar shift');
  const [y,m,d]=day.split('-').map(Number),first=new Date(Date.UTC(y,m-1+delta,1));
  first.setUTCDate(Math.min(d,new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate()));return first.toISOString().slice(0,10);
}
export function releaseWindow(product){
  const value=product?.releaseDate,precision=product?.dateEvidence?.precision||'day';
  let range;
  if(precision==='day'&&validCalendarDay(value))range={start:value,end:value,precision,label:value};
  else if(precision==='month'&&product?.dateEvidence?.verified===true&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value||'')){
    const [y,m]=value.split('-').map(Number),end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
    range={start:value+'-01',end,precision,label:value};
  }else return null;
  if(product.verifiedReleaseWindow&&(product.verifiedReleaseWindow.start!==range.start||product.verifiedReleaseWindow.end!==range.end))return null;
  return range;
}
import {publicationState,hasArrivalEvidence} from './publication-window.mjs';
export function releaseState(product,asOf){
  if(product?.firstPublishedAt)return publicationState(product,asOf);
  if(validCalendarDay(asOf)&&hasArrivalEvidence(product,asOf))return 'released';
  if(!validCalendarDay(asOf))return 'invalid';const range=releaseWindow(product);if(!range)return 'invalid';
  const cutoff=calendarShift(asOf,-3);
  if(range.end<cutoff)return 'expired';
  if(range.start<cutoff)return 'uncertain';
  if(range.end<=asOf)return 'released';
  if(range.precision==='month')return 'uncertain';
  return range.start<=calendarShift(asOf,3)&&product.dateEvidence?.official===true?'upcoming':'uncertain';
}
export function releaseSortKey(product){return product.firstPublishedAt?.slice(0,10)||product.arrivalEvidence?.verifiedAt?.slice(0,10)||releaseWindow(product)?.start||'';}
