import assert from 'node:assert/strict';
import {siteBrandGroup} from '../public/assets/site-brand-policy.mjs';
const photoPaths=value=>[...JSON.stringify(value).matchAll(/\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)/g)].map(m=>m[0].slice(1));
export function deferredProductOriginals(catalog,selected,maxFiles,{allowLuxOriginals=false,protectedPaths=[]}={}){
 if(selected.length<=maxFiles)return new Set();
 const {products,...metadata}=catalog,available=new Set(selected),protectedPhotos=new Set([...protectedPaths].map(p=>p.replace(/^\//,'')));
 for(const asset of photoPaths(metadata))protectedPhotos.add(asset);
 for(const product of products){
  for(const asset of photoPaths(product.presentation?.thumbnail||{}))protectedPhotos.add(asset);
  if(siteBrandGroup(product.brand)==='LUX'){
   const {cachedPath,...presentation}=product.presentation||{};
   for(const asset of photoPaths(allowLuxOriginals===true?{...product,presentation}:product))protectedPhotos.add(asset);
  }
 }
 const candidates=groups=>products.filter(p=>groups.includes(siteBrandGroup(p.brand))).map(p=>p.presentation?.cachedPath).filter(p=>/^\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(p||'')).map(p=>p.slice(1));
 // LUX is an explicit last resort, after every eligible SPORTS/CASUAL original.
 const originals=[...new Set([...candidates(['SPORTS','CASUAL']),...(allowLuxOriginals===true?candidates(['LUX']):[])])].filter(p=>available.has(p)&&!protectedPhotos.has(p));
 const needed=selected.length+1-maxFiles;assert(originals.length>=needed,'Deployment budget requires more public product-original capacity; no data or research files will be removed');
 return new Set(originals.slice(0,needed));
}
