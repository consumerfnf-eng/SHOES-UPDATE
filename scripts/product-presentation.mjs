import {isOfficialProductUrl,officialEvidenceFor,kstDay} from './curation.mjs';

// Review applies to the exact original asset and variant, so a future collector
// cannot silently replace an approved shoe photograph with a campaign image.
export function productPresentation(product,reviews){
  const row=reviews.products?.find(r=>r.id===product.id&&r.brand===product.brand&&r.style===product.style&&r.originalImage===product.image);
  if(row?.approved===false)return null;
  if(row?.approved===true&&['side','three-quarter'].includes(row.view)&&row.noPerson===true&&row.sourceUrl&&/^https:\/\//.test(row.image))return {...product,
    presentation:{image:row.image,scale:Math.max(1,Math.min(2.7,row.scale||1)),offsetY:Math.max(-20,Math.min(20,row.offsetY||0)),view:row.view,sourceUrl:row.sourceUrl,checkedAt:row.checkedAt,...(isOfficialProductUrl(product.brand,row.sourceUrl)?{officialProductUrl:row.sourceUrl}:{})},colorSwatches:row.colorSwatches||[]};
  // New Balance's standard product side/three-quarter slot is SKU-bound.
  // Prada SLS is the product-only lateral slot, checked against the live
  // Speedrock PDP on 2026-10-07. Require its exact complete style identifier.
  try{
    const image=new URL(product.image),style=product.style||'',asset=image.pathname.split('/').pop(),productPath=new URL(product.url).pathname.toLowerCase();
    const luxurySide=['Prada','Miu Miu'].includes(product.brand)&&image.hostname===(product.brand==='Prada'?'www.prada.com':'www.miumiu.com')&&image.pathname.includes('/'+style+'_SLS.jpg');
    const asicsSide=product.brand==='ASICS'&&image.hostname==='images.asics.com'&&image.pathname.includes('/'+style.replace('-','_')+'_SL_LT_GLB');
    const keringSide=(product.brand==='Balenciaga'&&image.hostname==='balenciaga.dam.kering.com'&&/_X\.jpg$/.test(asset)||product.brand==='Bottega Veneta'&&image.hostname==='bottega-veneta.dam.kering.com'&&/_A\.jpg$/.test(asset))&&productPath.includes(asset.split('_')[0].toLowerCase());
    const pumaSide=product.brand==='PUMA'&&image.hostname==='images.puma.com'&&image.pathname.includes('/global/'+style+'/'+new URL(product.url).searchParams.get('swatch')+'/sv01/');
    if((luxurySide||asicsSide||keringSide||pumaSide)&&officialEvidenceFor(product,kstDay()))return {...product,presentation:{image:product.image,scale:luxurySide?1.8:keringSide?1.6:1,offsetY:luxurySide||keringSide?-20:0,view:'side',sourceUrl:product.productEvidenceUrl||product.url,checkedAt:product.lastVerifiedAt,method:'reviewed-official-sku-view-slot'}};
  }catch{}
  try{const image=new URL(product.image);if(product.brand==='New Balance'&&image.hostname==='nb.scene7.com'&&image.pathname.toLowerCase().endsWith('/'+product.style.toLowerCase()+'_nb_02_i'))return {...product,presentation:{image:product.image,scale:1,view:'three-quarter',sourceUrl:product.url,checkedAt:product.lastVerifiedAt,method:'reviewed-official-sku-view-slot'}};}catch{}
  return null;
}
