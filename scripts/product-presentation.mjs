import {isOfficialProductUrl,officialEvidenceFor,kstDay} from './curation.mjs';

// Review applies to the exact original asset and variant, so a future collector
// cannot silently replace an approved shoe photograph with a campaign image.
export function productPresentation(product,reviews){
  const row=reviews.products?.find(r=>r.id===product.id&&r.brand===product.brand&&r.style===product.style&&r.originalImage===product.image);
  if(row?.approved===false)return null;
  if(row?.approved===true&&['side','three-quarter'].includes(row.view)&&row.noPerson===true&&row.sourceUrl&&/^https:\/\//.test(row.image))return {...product,
    presentation:{image:row.image,scale:Math.max(1,Math.min(2.7,row.scale||1)),offsetY:Math.max(-45,Math.min(45,row.offsetY||0)),view:row.view,sourceUrl:row.sourceUrl,checkedAt:row.checkedAt,...(isOfficialProductUrl(product.brand,row.sourceUrl)?{officialProductUrl:row.sourceUrl}:{})},colorSwatches:row.colorSwatches||[]};
  // New Balance's standard product side/three-quarter slot is SKU-bound.
  // Prada SLS is the product-only lateral slot, checked against the live
  // Speedrock PDP on 2026-10-07. Require its exact complete style identifier.
  try{
    const image=new URL(product.image),style=product.style||'',asset=image.pathname.split('/').pop(),productPath=new URL(product.url).pathname.toLowerCase();
    const luxurySide=['Prada','Miu Miu'].includes(product.brand)&&image.hostname===(product.brand==='Prada'?'www.prada.com':'www.miumiu.com')&&image.pathname.includes('/'+style+'_SLS.jpg');
    const asicsSide=product.brand==='ASICS'&&image.hostname==='images.asics.com'&&image.pathname.includes('/'+style.replace('-','_')+'_SL_LT_GLB');
    // Kering's DAM names each rendition Small-/Medium-/Large-<code>_X.jpg, and
    // the size prefix is not part of the style, so it has to come off before
    // the code is checked against the product path. Verified on the live
    // Balenciaga PDP 2026-10-30: _X is the lateral view, shoe only.
    const keringCode=asset.replace(/^(?:Small|Medium|Large|Thumbnail)-/i,'').split('_')[0].toLowerCase();
    const keringSide=(product.brand==='Balenciaga'&&image.hostname==='balenciaga.dam.kering.com'&&/_X\.jpg$/.test(asset)||product.brand==='Bottega Veneta'&&image.hostname==='bottega-veneta.dam.kering.com'&&/_A\.jpg$/.test(asset))&&!!keringCode&&productPath.includes(keringCode);
    const pumaSide=product.brand==='PUMA'&&image.hostname==='images.puma.com'&&image.pathname.includes('/global/'+style+'/'+new URL(product.url).searchParams.get('swatch')+'/sv01/');
    // Under Armour's Scene7 renditions are <style>-<colour>_DEFAULT (one shoe,
    // lateral) and _PAIR (both shoes, three-quarter). Opened both on
    // 2026-10-30: plain backdrop, shoe only, no person either way.
    const uaSlot=product.brand==='Under Armour'&&image.hostname==='underarmour.scene7.com'
      &&image.pathname.includes('/Underarmour/'+style+'-')&&/_(DEFAULT|PAIR)$/.test(image.pathname);
    const uaView=uaSlot&&image.pathname.endsWith('_PAIR')?'three-quarter':'side';
    // Dior files its lateral still as <style without the underscore>_SBG_E0n-n.
    // Checked E02-1 and E02-3 on 2026-10-30: the trailing digit changes the
    // crop, not the view.
    const diorSide=product.brand==='Dior'&&image.hostname==='assets.christiandior.com'
      &&image.pathname.includes('/diorprod/'+style.replace(/_/g,'')+'_SBG_E0');
    if((luxurySide||asicsSide||keringSide||pumaSide||uaSlot||diorSide)&&officialEvidenceFor(product,kstDay()))return {...product,presentation:{image:product.image,scale:luxurySide?1.8:keringSide?1.6:1,offsetY:luxurySide||keringSide?-20:0,view:uaSlot?uaView:'side',sourceUrl:product.productEvidenceUrl||product.url,checkedAt:product.lastVerifiedAt,method:'reviewed-official-sku-view-slot'}};
  }catch{}
  try{const image=new URL(product.image);if(product.brand==='New Balance'&&image.hostname==='nb.scene7.com'&&image.pathname.toLowerCase().endsWith('/'+product.style.toLowerCase()+'_nb_02_i'))return {...product,presentation:{image:product.image,scale:1,view:'three-quarter',sourceUrl:product.url,checkedAt:product.lastVerifiedAt,method:'reviewed-official-sku-view-slot'}};}catch{}
  return null;
}
