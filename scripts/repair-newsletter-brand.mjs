import {SITE_BRAND_GROUPS,canonicalSiteBrand}from'../public/assets/site-brand-policy.mjs';
const names=SITE_BRAND_GROUPS.flatMap(g=>g.priority).sort((a,b)=>b.length-a.length);
export function repairNewsletterBrand(product){
 const title=String(product.name||product.title||'').trim();
 const brand=names.find(name=>title.toLowerCase().startsWith(name.toLowerCase()+"'s")||title.toLowerCase().startsWith(name.toLowerCase()+'’s'));
 if(!brand||canonicalSiteBrand(product.brand)===brand)return product;
 return {...product,brandAsListed:product.brandAsListed||product.brand,brand,brandReview:{method:'headline-explicit-possessive-brand',headline:title,originalBrand:product.brand}};
}
