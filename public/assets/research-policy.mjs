export function isAllowedFeedLook(look,excluded=['HeeledPump']){
 if((look.collection||look.shelf)!=='fashion-feed')return true;
 const blocked=new Set(excluded.map(s=>String(s).normalize('NFKC').replace(/^#/,'').toLowerCase()));
 const tags=(look.hashtags||[]).flatMap(t=>String(t).normalize('NFKC').split(/[\s,]+/)).map(t=>t.replace(/^#/,'').toLowerCase());
 return !tags.some(t=>blocked.has(t));
}
