import {isExcludedBrand} from './brand-exclusions.mjs';
import {SITE_BRAND_GROUPS,canonicalSiteBrand,siteBrandGroup,isSiteBrandAllowed} from './site-brand-policy.mjs';
export const BRAND_GROUPS=SITE_BRAND_GROUPS;
export {canonicalSiteBrand,siteBrandGroup,isSiteBrandAllowed};
export function displayBrandGroup(brand){return siteBrandGroup(typeof brand==='string'?brand:brand?.name);}
export function groupedBrands(brands){
 const unique=new Map();
 for(const brand of brands){const name=canonicalSiteBrand(brand.name);if(!isExcludedBrand(name)&&isSiteBrandAllowed(name)&&!unique.has(name))unique.set(name,{...brand,name});}
 return BRAND_GROUPS.map(group=>{const priority=new Map(group.priority.map((name,i)=>[name,i]));return {...group,brands:[...unique.values()].filter(b=>displayBrandGroup(b)===group.name).sort((a,b)=>priority.get(a.name)-priority.get(b.name))};});
}
const rankCache=new Map();
export function brandGroupRank(brand){const key=brand?.name;if(rankCache.has(key))return rankCache.get(key);const name=canonicalSiteBrand(brand?.name),group=BRAND_GROUPS.findIndex(g=>g.name===displayBrandGroup(brand)),priority=BRAND_GROUPS[group]?.priority.indexOf(name)??-1;const rank=Object.freeze({group:group<0?BRAND_GROUPS.length:group,priority:priority<0?Number.MAX_SAFE_INTEGER:priority,name});rankCache.set(key,rank);return rank;}
export function compareByBrandGroup(a,b){const x=brandGroupRank(a),y=brandGroupRank(b);return x.group-y.group||x.priority-y.priority||x.name.localeCompare(y.name,'en');}
