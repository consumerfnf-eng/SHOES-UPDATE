import {isNewListing,isKidsListing} from './new-arrivals.mjs';
import {isOfficialProductUrl} from './curation.mjs';
import {siteBrandGroup} from '../public/assets/site-brand-policy.mjs';

const official=(brand,url)=>typeof url==='string'&&/^https:\/\//.test(url)&&isOfficialProductUrl(brand,url);
export function isAdminNewSource(brand,source){
  if(!official(brand,source?.url)||isKidsListing(source.url))return false;
  const evidence=source.sectionEvidence;
  return isNewListing(source.url)||!!(evidence?.kind==='new-arrivals-navigation'
    &&evidence.targetUrl===source.url&&evidence.contentHash&&official(brand,evidence.url));
}

function footwearRank(url){
  let path;try{const u=new URL(url);path=decodeURIComponent(u.pathname+' '+u.search);}catch{return 0;}
  if(/(?:^|[\s/_.?=&-])(?:sneakers?|trainers?|スニーカー|스니커즈|스니커|baskets)(?=[\s/_.?=&-]|$)/i.test(path))return 2;
  return /(?:^|[\s/_.?=&-])(?:shoes?|footwear|신발|슈즈|シューズ|靴|calzature|scarpe|chaussures|zapatillas)(?=[\s/_.?=&-]|$)/i.test(path)?1:0;
}

export function selectAdminSources(brand,sources=[]){
  const allowed=sources.filter(s=>official(brand,s?.url)&&!isKidsListing(s.url));
  if(siteBrandGroup(brand)!=='LUX')return allowed.filter(s=>isAdminNewSource(brand,s));
  const footwear=allowed.filter(s=>footwearRank(s.url));
  // Keep both genders' broader shoe departments, even beside a sneaker shelf.
  return (footwear.length?footwear:allowed).sort((a,b)=>footwearRank(b.url)-footwearRank(a.url));
}

export function allowAdminListingFollowup(brand,selected,next,parent){
  if(siteBrandGroup(brand)!=='LUX')return true;
  if(!official(brand,next?.url)||isKidsListing(next.url))return false;
  if(!selected.some(s=>footwearRank(s.url)))return true;
  const a=new URL(next.url),b=new URL(parent.url);
  return !!footwearRank(next.url)||a.origin===b.origin&&a.pathname===b.pathname
    ||selected.some(s=>s.url===next.url);
}

export function adminReaderMarkdown(markdown,url){
  let text=String(markdown);
  if(!/^Title:/im.test(text))text='Title: Official listing\n'+text;
  if(!/^URL Source:/im.test(text))text=text.replace(/^(Title:[^\n]*\n?)/i,'$1\nURL Source: '+url+'\n');
  if(!/^Markdown Content:\s*$/im.test(text)){
    // Preserve reader metadata (including redirect/challenge warnings).
    const lines=text.split('\n');let end=0;
    while(end<lines.length&&(!lines[end].trim()||/^(?:Title|URL Source|Final URL|Warning|Published Time):/i.test(lines[end])))end++;
    lines.splice(end,0,'Markdown Content:','');text=lines.join('\n');
  }
  return text;
}
