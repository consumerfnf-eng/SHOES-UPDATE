import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {readShopifyInventory} from './collect-official-inventory.mjs';import {shopifyRows} from './assemble-official-expansion.mjs';
import {SITE_BRAND_GROUPS} from '../public/assets/site-brand-policy.mjs';import {isNewListing} from './new-arrivals.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex'),plain=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
export function aloNewRows(feed,{at,today}){
 const rows=[];let offset=0;const pageByIndex=[];for(const page of feed.pages){for(let i=0;i<page.products;i++)pageByIndex[offset++]=page;}
 for(const [index,p] of feed.products.entries()){
  const type=String(p.product_type||''),description=plain(p.body_html),isBoot=/^Accessories:Shoes:Boots$/i.test(type)&&/platform/i.test(description);
  if(!isBoot&&!/^Accessories:Shoes:(?:Sneakers|Slippers|Slides)$/i.test(type))continue;
  const variants=p.variants||[],colours=[...new Set(variants.map(v=>v.option1).filter(Boolean))];if(colours.length!==1||!variants.some(v=>v.available))continue;
  const image=p.images?.[0]?.src;if(!/^https:\/\/cdn\.shopify\.com\//.test(image||''))continue;
  const code=new URL(image).pathname.split('/').at(-1).match(/^(A\d{4}U)_(\d{2,5})_/i),model=code?.[1]?.toUpperCase(),colourCode=code?.[2];
  if(!model||!variants.every(v=>!v.sku||v.sku.toUpperCase().startsWith(model)))continue;
  const style=model+colourCode;if(!variants.every(v=>!v.sku||v.sku.toUpperCase().startsWith(style)))continue;
  const url=feed.root+'/products/'+p.handle,listing=pageByIndex[index],proof={verified:true,brand:'Alo',style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:listing.hash};
  const row={id:'alo-new-'+p.id,brand:'Alo',name:p.title,style,manufacturerStyle:style,productVariantId:String(p.id),modelGroup:'alo|'+model,modelGroupId:'alo|'+model,url,image,description,officialCategory:type,productType:isBoot?'platform-shoe':/loafer/i.test(p.title)?'loafer':/(?:Slippers|Slides)$/i.test(type)?'slipper':'sneaker',colorway:colours[0],colors:[colours[0]],gender:'Unisex',country:'KR',priceLabel:'KRW '+variants[0].price,productVerifiedAt:at,productEvidenceUrl:listing.url,firstSeen:at,sourceSignals:[],sizesCollapsed:variants.length,
   arrivalEvidence:{verified:true,brand:'Alo',style,productUrl:url,kind:'new-arrivals-listing',url:listing.url,verifiedAt:at,excerpt:p.title,contentHash:listing.hash},officialProductEvidence:{...proof,url},officialImageEvidence:{...proof,url:image,sourceUrl:listing.url},typeEvidence:{field:'product_type and body_html',excerpt:type+' — '+description,url:listing.url,contentHash:listing.hash}};
  if(isBoot)row.footwearReview={approved:true,brand:'Alo',style,url,type:'platform-boot',platform:true,checkedAt:at,method:'official-new-collection-platform-description'};
  rows.push(row);
 }return rows;
}
export function satisfyNewRows(feed,{at}){
 let offset=0;const pageByIndex=[];for(const page of feed.pages)for(let i=0;i<page.products;i++)pageByIndex[offset++]=page;
 return feed.products.flatMap((p,index)=>{
  if(p.product_type!=='Shoes'||!/^TheROCKER$|^ADIZERO ADIOS(?: PRO EVO 2)? SATISFY$/i.test(p.title))return[];
  const colours=[...new Set(p.variants.map(v=>v.option1).filter(Boolean))];if(colours.length!==1||!p.variants.some(v=>v.available))return[];
  const image=p.images?.[0]?.src;if(!/^https:\/\/cdn\.shopify\.com\//.test(image||''))return[];
  const style=String(p.id),url=feed.root+'/products/'+p.handle,page=pageByIndex[index],proof={verified:true,brand:'SATISFY',style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',identifierType:'official-product-id',contentHash:page.hash};
  return[{id:'satisfy-new-'+p.id,brand:'SATISFY',name:p.title,modelGroupId:'satisfy|'+p.title.toLowerCase().replace(/[^a-z0-9]+/g,''),style,styleType:'official-product-id',productVariantId:style,url,image,category:'sneaker',productType:'sneaker',officialCategory:p.product_type,description:plain(p.body_html),colorway:colours[0],colors:[colours[0]],gender:'Unisex',sizesCollapsed:p.variants.length,productVerifiedAt:at,productEvidenceUrl:page.url,firstSeen:at,sourceSignals:[],typeEvidence:{field:'reviewed-shoe-construction',excerpt:'Official Shoes department; reviewed closed athletic shoe, sole and upper',url:page.url,contentHash:page.hash},arrivalEvidence:{verified:true,brand:'SATISFY',style,productUrl:url,kind:'new-arrivals-listing',url:page.url,verifiedAt:at,excerpt:p.title,contentHash:page.hash},officialProductEvidence:{...proof,url},officialImageEvidence:{...proof,url:image,sourceUrl:page.url}}];
 });
}
export async function collectOfficialNewFeeds({sources,now=new Date(),read,onProgress=console.log}={}){
 sources??=JSON.parse(await fs.readFile('config/daily_sources.json','utf8'));
 const allowed=SITE_BRAND_GROUPS.filter(g=>g.name!=='LUX').flatMap(g=>g.priority),jobs=[];
 for(const brand of allowed){const seen=new Set();for(const s of sources[brand]||[]){const u=new URL(s.url),match=u.pathname.match(/^(.*?)\/collections\/([^/]+)/);if(!match||!isNewListing(s.url)||/clothing/.test(u.pathname)||brand==='Alo'&&!match[1].includes('ko-kr'))continue;const root=u.origin+match[1]+'/collections/'+match[2];if(seen.has(root))continue;seen.add(root);jobs.push({brand,root,productRoot:u.origin+match[1]});}}
 const products=[],coverage=[],feeds=[];let cursor=0;const at=now.toISOString(),today=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
 await Promise.all(Array.from({length:3},async()=>{while(cursor<jobs.length){const job=jobs[cursor++],feed=await readShopifyInventory(job,{read,maxPages:30});feeds.push(feed);const productFeed={...feed,root:job.productRoot};let rows;
  if(job.brand==='Alo')rows=aloNewRows(productFeed,{at,today});else{rows=shopifyRows({brand:job.brand},productFeed,{at,today}).products;for(const p of rows){p.arrivalEvidence={...p.arrivalEvidence,kind:'new-arrivals-listing'};}if(job.brand==='SATISFY')rows=[...rows,...satisfyNewRows(productFeed,{at,today})];}
  // Explicit non-sneaker departments outrank a sneaker word in marketing
  // prose (or "sneaker socks" in a title). Preserve the exact source type.
  const sourceProducts=new Map(feed.products.map(p=>[p.id,p]));
  rows=rows.filter(p=>{const source=sourceProducts.get(p.shopifyProductId),type=source?.product_type||'';p.sourceProductType=type||p.officialCategory;return job.brand==='Alo'||!/(?:socks?|sandals?|slippers?|slides?|accessor|miscellaneous|잡화|양말|부츠)/i.test(type);});
  products.push(...rows);const result={brand:job.brand,url:job.root,products:feed.products.length,verified:rows.length,exhausted:feed.exhausted,error:feed.error,pages:feed.pages.length};coverage.push(result);onProgress(result);
 }}));
 return{schemaVersion:1,checkedAt:at,products:[...new Map(products.map(p=>[p.brand+'|'+p.productVariantId,p])).values()],coverage,feeds};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await collectOfficialNewFeeds();await fs.mkdir('logs/20261103/board-work/new-feeds',{recursive:true});await fs.writeFile('logs/20261103/board-work/new-feeds/feeds.json',JSON.stringify(r.feeds));delete r.feeds;await fs.writeFile('data/official-new-feeds.json',JSON.stringify(r,null,2)+'\n');console.log('Verified '+r.products.length+' official New variants');}
