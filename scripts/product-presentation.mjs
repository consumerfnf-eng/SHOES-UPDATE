import {isOfficialProductUrl} from './curation.mjs';

// Review applies to the exact original asset and variant, so a future collector
// cannot silently replace an approved shoe photograph with a campaign image.
export function productPresentation(product,reviews){
  const row=reviews.products?.find(r=>r.id===product.id&&r.brand===product.brand&&r.style===product.style&&r.originalImage===product.image);
  if(row?.approved===false)return null;
  if(row?.approved===true&&['side','three-quarter'].includes(row.view)&&row.noPerson===true&&row.sourceUrl&&/^https:\/\//.test(row.image))return {...product,
    presentation:{image:row.image,scale:Math.max(1,Math.min(2.7,row.scale||1)),offsetY:Math.max(-20,Math.min(20,row.offsetY||0)),view:row.view,sourceUrl:row.sourceUrl,checkedAt:row.checkedAt,...(isOfficialProductUrl(product.brand,row.sourceUrl)?{officialProductUrl:row.sourceUrl}:{})},colorSwatches:row.colorSwatches||[]};
  // New Balance's standard product side/three-quarter slot is SKU-bound.
  try{const image=new URL(product.image);if(product.brand==='New Balance'&&image.hostname==='nb.scene7.com'&&image.pathname.toLowerCase().endsWith('/'+product.style.toLowerCase()+'_nb_02_i'))return {...product,presentation:{image:product.image,scale:1,view:'three-quarter',sourceUrl:product.url,checkedAt:product.lastVerifiedAt,method:'reviewed-official-sku-view-slot'}};}catch{}
  return null;
}
