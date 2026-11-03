export function isAllowedFeedLook(look,excluded=['HeeledPump'],globalExcluded=['slingback','WedgeHeels']){
 const feed=(look.collection||look.shelf)==='fashion-feed';
 const blocked=new Set([...globalExcluded,...(feed?excluded:[])].map(s=>String(s).normalize('NFKC').replace(/^#/,'').toLowerCase()));
 const tags=(look.hashtags||[]).flatMap(t=>String(t).normalize('NFKC').split(/[\s,]+/)).map(t=>t.replace(/^#/,'').toLowerCase());
 return !tags.some(t=>blocked.has(t));
}
export function runwayFirst(looks){return [...looks].sort((a,b)=>Number((a.collection||a.shelf)==='fashion-feed')-Number((b.collection||b.shelf)==='fashion-feed'));}
