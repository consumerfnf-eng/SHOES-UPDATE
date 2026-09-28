import {exactDate} from './collect-evidence.mjs';
import {httpUrl} from './curation.mjs';

export const NEW_BALANCE_CALENDAR='https://www.newbalance.com/nb-launches/';
const excludedName=/apparel|tank|legging|dress|pants?|crew|basketball|maxey|sc md-x|spikes?|cleats?|allerdale|1890a/i;
export function parseNewBalanceCalendar(text,source=NEW_BALANCE_CALENDAR,checkedAt=new Date().toISOString()){
  const start=text.search(/(?:^|\n)#{1,3}\s*Upcoming Launches/i);if(start<0)return [];
  const body=text.slice(start).split(/\n#{1,3}\s*More to explore/i)[0],rows=[],seen=new Set();
  let date=null,restock=false,pendingName='';
  for(const raw of body.split('\n')){
    const line=raw.trim();if(!line)continue;
    if(/^#{1,3}\s*(?:Upcoming|In.Stock) Launches/.test(line)){date=null;restock=false;pendingName='';continue;}
    if(/^Back in Stock$/i.test(line)){restock=true;continue;}
    if(/^(?:New|Coming soon|NB Exclusive)$/i.test(line)){restock=false;continue;}
    if(/^\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?$/.test(line)){date=exactDate(line);continue;}
    const link=line.match(/\[([^\]]+)\]\((https:\/\/www\.newbalance\.com\/pd\/[^)]+)\)/);
    if(link){
      const name=/^(?:Shop now|Coming soon)$/i.test(link[1])?pendingName:link[1];
      if(date&&!restock&&name&&!excludedName.test(name)&&!seen.has(link[2])){seen.add(link[2]);rows.push({brand:'New Balance',name,url:link[2],country:'US',releaseDate:date,dateEvidence:{url:source,precision:'day',official:true,verified:true,verifiedAt:checkedAt,region:'US',field:'explicit calendar day/month/year',excerpt:`${name}: official US calendar date ${date}, linked product page.`}});}
      // Consume the date on the first product link, even when a Shop now link is omitted.
      // A later undated tile can never inherit another product's launch date.
      date=null;restock=false;pendingName='';
    }else if(!line.startsWith('#')&&!line.startsWith('!['))pendingName=line;
  }return rows;
}
export function newBalanceProductDetails(text,candidate,checkedAt=new Date().toISOString()){
  const start=text.search(/(?:^|\n)#\s+/);if(start<0)return null;
  const body=text.slice(start).split(/\n#{1,3}\s*(?:You may also|Recommended|Recently viewed|More to explore)/i)[0];
  const name=body.match(/^#\s+(.+)$/m)?.[1]?.trim(),style=body.match(/Style #:\s*([A-Z0-9]+)/)?.[1];
  if(!name||!style||excludedName.test(name))return null;
  const norm=x=>x.toLowerCase().replace(/[^a-z0-9]/g,'');if(norm(name)!==norm(candidate.name))return null;
  const beforeStyle=body.slice(0,body.indexOf('Style #:'));
  if(/formal aesthetic|loafers?|moccasins?|dress shoe|boots?/i.test(beforeStyle))return null;
  const image=[...text.matchAll(/!\[[^\]]*\]\((https:\/\/nb\.scene7\.com\/[^)]+)\)/g)].map(m=>m[1]).find(u=>u.toLowerCase().includes('/'+style.toLowerCase()+'_'));
  if(!httpUrl(image))return null;
  const features=beforeStyle.split(/(?:Excluded from promotions|### Features)/).slice(-1)[0];
  if(!/sneaker|running|trainer|court|ABZORB|ENCAP|FuelCell|Vibram|EVA midsole/i.test(features))return null;
  const description=beforeStyle.split('Excluded from promotions').slice(-1)[0].split('\n').filter(l=>l.length>25&&!l.includes('https://')&&!/^#/.test(l)).join(' ').slice(-2500);
  if(/mary.jane|\bmule\b|ballet/i.test(description))return null; // New hybrids need a reviewed structural record.
  return {...candidate,id:'verified-new-balance-'+style.toLowerCase(),name,style,image,description,colorway:body.match(/^Color:\s*(.+)$/m)?.[1]||'',material:beforeStyle.split('### Material')[1]?.replace(/\*|\n/g,' ').trim()||'',priceLabel:body.match(/\$\d+(?:\.\d{2})?/)?.[0]||'',officialCategory:/Rebel|1080/i.test(name)?'Daily running trainers':'Lifestyle sneakers',productType:'sneaker',productVerifiedAt:checkedAt,productEvidenceUrl:candidate.url};
}
