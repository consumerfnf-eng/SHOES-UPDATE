import {isScopedSneakerCandidate} from './scoped-new-candidates.mjs';
const badView=/(?:[-_](?:OUT|OUTSOLE|BT)(?:[-_.?/]|$)|[-_]TOP(?:[./?]|$)|top\s+view|outsole|bottom\s+view|Nav_|navigation|header|banner|campaign|lifestyle|lookbook|FW\d{2}_Q\d)/i;
export function reviewScopedNew(products){
 const accepted=[],held=[],repaired=[];
 for(const input of products){const p=structuredClone(input);
  if(!isScopedSneakerCandidate(p)){held.push({id:p.id,brand:p.brand,name:p.name,reason:'primary-name-path-non-sneaker'});continue;}
  const tokens=[p.manufacturerStyle,p.style,...new URL(p.url).searchParams.values()].filter(t=>t&&String(t).length>=5).map(t=>String(t).toLowerCase());
  const own=i=>tokens.some(t=>(i.url||'').toLowerCase().includes(t));
  const choices=(p.imageCandidates||[]).map(i=>typeof i==='string'?{url:i}:i).filter(i=>!/\.html(?:[?/#]|$)/i.test(i.url||'')&&!badView.test(i.url+' '+(i.alt||''))&&own(i));
  const tile=p.sourceTileBinding,hasTileBinding=tile?.verified===true&&tile.style===p.style&&tile.url===p.url&&tile.image===p.image&&tile.contentHash===p.arrivalEvidence?.contentHash;
  const uaShoeSlot=url=>p.brand!=='Under Armour'||new RegExp('/Underarmour/'+p.style+'-[^/]+_(?:DEFAULT|PAIR)(?:[?]|$)','i').test(url||'');
  const requiresBound=['Converse','Under Armour'].includes(p.brand)&&!hasTileBinding,bad=badView.test(p.image||'')||requiresBound&&!own({url:p.image})||!uaShoeSlot(p.image);
  if(bad){const safe=choices.filter(i=>uaShoeSlot(i.url)),next=safe.find(i=>/[-_](?:000|045|SL|SIDE|DEFAULT)(?:[-_.?\/]|$)|_nb_02_i|sv01/i.test(i.url))||safe[0];if(!next){held.push({id:p.id,brand:p.brand,name:p.name,reason:'selected-photo-banner-lifestyle-or-outsole',url:p.url});continue;}
   const before=p.image;p.image=next.url;p.officialImageEvidence={...p.officialImageEvidence,url:p.image};repaired.push({id:p.id,brand:p.brand,before,image:p.image});
  }
  accepted.push(p);
 }
 return {products:accepted,held,repaired};
}
