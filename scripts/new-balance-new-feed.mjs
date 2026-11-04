import {createHash} from 'node:crypto';
export function newBalanceNewRecords(response,{sourceUrl,categoryId,at=new Date().toISOString()}={}){
 const data=response.results?.[0];if(!data||data.nbHits!==data.hits?.length||data.nbPages>1)throw Error('New Balance New pagination incomplete');
 if(new URL(sourceUrl).hostname!=='www.newbalance.com'||!sourceUrl.includes('new-arrivals'))throw Error('Official New category required');
 const hash=createHash('sha256').update(JSON.stringify(response)).digest('hex'),products=[],excluded=[],missing=[];
 for(const row of data.hits){
  const style=row.styleID,details=row.styleData?.[style];
  if(row.custom?.productClass!=='Shoes'||row.custom?.footwearCleatType||/kids|infant|children|toddler|grade.?school/i.test(row.name+' '+row.custom?.genderDisplay)){excluded.push({style,name:row.name,reason:'non-sneaker-or-kids'});continue;}
  if(details?.sellableFrom>Date.parse(at)/1000||/coming soon/i.test(details?.badge||'')){excluded.push({style,name:row.name,reason:'official-upcoming-sale-start'});continue;}
  const observed=row.image_groups?.flatMap(g=>g.images||[]).map(i=>i.dis_base_link).filter(Boolean).find(image=>{try{return new URL(image).hostname==='nb.scene7.com'&&decodeURIComponent(image).toLowerCase().includes('/'+style.toLowerCase()+'_nb_02_i');}catch{return false;}});
  if(!observed||row.brand!=='New Balance'||!row.pdpLink?.startsWith('https://www.newbalance.com/')){missing.push({style,name:row.name,reason:'SKU-image-or-brand-binding'});continue;}
  const image=new URL(observed);image.search='wid=1000&hei=1000&fmt=webp';const url=new URL(row.pdpLink);url.searchParams.set('dwvar_'+row.masterID+'_style',style);const proof={verified:true,brand:'New Balance',style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:hash},colors=[row.custom.colorName||[]].flat().filter(Boolean);
  products.push({id:'newbalance-new-'+style,brand:'New Balance',name:row.name,style,manufacturerStyle:style,modelGroupId:'newbalance|'+row.name.toLowerCase().replace(/[^a-z0-9]/g,''),url:url.href,image:image.href,sourceImageUrl:observed,officialCategory:'Sneakers',category:'sneaker',productType:'sneaker',description:row.short_description||row.name,colorway:colors.join(' / '),colors,material:row.custom.primaryMaterial||'',gender:row.custom.genderDisplay||'Unisex',country:'US',priceLabel:details?.price?.USD?'USD '+details.price.USD:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:sourceUrl,sourceSignals:[],arrivalEvidence:{verified:true,brand:'New Balance',style,productUrl:url.href,kind:'new-arrivals-listing',url:sourceUrl,verifiedAt:at,contentHash:hash,excerpt:row.name},officialProductEvidence:{...proof,url:url.href},officialImageEvidence:{...proof,url:image.href,sourceUrl},newSourceCategoryId:categoryId});
 }
 return {products,excluded,missing,coverage:{total:data.nbHits,read:data.hits.length,sourceUrl,categoryId}};
}
