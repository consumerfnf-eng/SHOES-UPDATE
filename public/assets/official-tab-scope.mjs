import {siteBrandGroup} from './site-brand-policy.mjs';
import {footwearTypes} from './footwear-policy.mjs';
import {hasArrivalEvidence} from './publication-window.mjs';
import {calendarShift,releaseWindow,validCalendarDay} from './release-window.mjs';

// LUX eligibility remains the existing official-product/image/released gate.
// Other permitted groups require sneaker classification and a New listing or
// an officially verified launch entirely inside the last three calendar months.
export function officialTabScope(product,today){
 const group=siteBrandGroup(product.brand);if(group==='LUX')return true;
 const label=[product.name,product.url].join(' ');
 const aloExtra=product.brand==='Alo'&&(['slipper','loafer'].includes(product.category)||['platform-slipper','platform-shoe'].includes(product.category)&&/Accessories:Shoes:(?:Slides|Slippers)$/i.test(product.officialCategory||'')||product.category==='platform-shoe'&&product.footwearReview?.type==='platform-boot'&&product.footwearReview?.approved===true);
 if(!aloExtra&&/\b(?:toolbox|duffel|backpack|socks?|slides?|sandals?|slippers?|boots?|(?:steel|alumin(?:um|ium))[- ]?toe|work|performance tech mesh)\b|슬리퍼|샌들|가방|양말|안전화/i.test(label)||product.brand==='norda'&&/\/008-/.test(product.url||'')||product.brand==='Nike'&&/\bMind 001\b/i.test(label))return false;
 if(!['SPORTS','CASUAL'].includes(group)||!validCalendarDay(today)||!aloExtra&&!footwearTypes(product).some(t=>t==='sneaker'||t.endsWith('-sneaker')))return false;
 const cutoff=calendarShift(today,-3),arrival=product.arrivalEvidence;
 const checked=Number.isFinite(Date.parse(arrival?.verifiedAt))?new Date(Date.parse(arrival.verifiedAt)+9*3600000).toISOString().slice(0,10):'';
 if(['new-arrivals-listing','new-badge'].includes(arrival?.kind)&&hasArrivalEvidence(product,today)&&checked>=cutoff&&checked<=today)return true;
 const range=releaseWindow(product),proof=product.dateEvidence;
 return !!(range&&proof?.verified===true&&proof.official===true&&range.start>=cutoff&&range.end<=today);
}
