import assert from 'node:assert/strict';
import {siteBrandGroup} from '../public/assets/site-brand-policy.mjs';
export function deferredProductOriginals(catalog,selected,maxFiles){
 if(selected.length<=maxFiles)return new Set();
 const available=new Set(selected),protectedPaths=new Set(catalog.products.flatMap(p=>[p.presentation?.thumbnail?.path,...(siteBrandGroup(p.brand)==='LUX'?[...JSON.stringify(p).matchAll(/\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)/g)].map(m=>m[0]):[])].filter(Boolean)).map(p=>p.slice(1)));
 const originals=[...new Set(catalog.products.filter(p=>['SPORTS','CASUAL'].includes(siteBrandGroup(p.brand))).map(p=>p.presentation?.cachedPath).filter(p=>/^\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(p||'')).map(p=>p.slice(1)))].filter(p=>available.has(p)&&!protectedPaths.has(p));
 const needed=selected.length+1-maxFiles;assert(originals.length>=needed,'Deployment budget requires more public product-original capacity; no data or research files will be removed');
 return new Set(originals.slice(0,needed));
}
