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
  // The photograph the brand put on the product itself.
  //
  // Until now a product needed a lateral or three-quarter still, reviewed by
  // hand, and 620 products that had cleared every other gate were waiting on
  // that. Most of them already carry verified evidence that the image was
  // taken from the brand's own new-arrivals tile or its product page - which
  // is to say, it is the picture the brand chose to represent the shoe. That
  // is the thing a reviewer was being asked to confirm.
  //
  // So the angle no longer decides it, and a shoe being worn is fine. What
  // still decides it is whether the shoe can be made out at all, and 619 of
  // these were looked at one by one to find out how often it cannot: nine
  // times. Campaign images where the model is cropped at the thigh, a
  // landscape with a figure the size of a thumbnail, a collage banner. Those
  // nine are recorded as refused in data/product-presentation.json by their
  // exact asset, and a refusal there still wins over everything below.
  //
  // Two conditions are checked here because they can be proved rather than
  // judged. The image must not be the product page itself - 25 Prada records
  // carry their own PDP URL in the image field, which is a collection fault,
  // not a photograph - and it must be https, as everything downstream wants.
  const ownPhotoEvidence = ['official-new-listing-sku-image', 'official-new-arrivals-and-product-page']
    .includes(product.officialImageEvidence?.verificationMethod) && product.officialImageEvidence?.verified === true;
  const ownPhoto = ownPhotoEvidence && /^https:\/\//.test(product.image || '')
    && product.image !== product.url && officialEvidenceFor(product, kstDay());

  try{
    const image=new URL(product.image),style=product.style||'',asset=image.pathname.split('/').pop(),productPath=new URL(product.url).pathname.toLowerCase();
    const luxurySide=['Prada','Miu Miu'].includes(product.brand)&&image.hostname===(product.brand==='Prada'?'www.prada.com':'www.miumiu.com')&&image.pathname.includes('/'+style+'_SLS.jpg');
    const asicsSide=product.brand==='ASICS'&&image.hostname==='images.asics.com'&&image.pathname.includes('/'+style.replace('-','_')+'_SL_LT_GLB');
    // Kering's DAM names each rendition Small-/Medium-/Large-<code>_X.jpg, and
    // the size prefix is not part of the style, so it has to come off before
    // the code is checked against the product path. Verified on the live
    // Balenciaga PDP 2026-10-30: _X is the lateral view, shoe only.
    const keringCode=asset.replace(/^(?:Small|Medium|Large|Thumbnail)-/i,'').split('_')[0].toLowerCase();
    // Balenciaga uses two schemes across its models: the older ones file the
    // lateral as _X, the newer ones as _F. Opened both on 2026-10-30 against
    // Track Trail Laces 800590WTRHK1594 - _F is the lateral still, shoe only,
    // and _A on the same product is the pair of outsoles seen from below,
    // which is what was reaching the cards. _A is the lateral for Bottega
    // Veneta and only for Bottega Veneta.
    const balenciagaAsset=product.brand==='Balenciaga'&&image.hostname==='balenciaga.dam.kering.com';
    const keringSide=(balenciagaAsset&&/_[XF]\.jpg$/.test(asset)||product.brand==='Bottega Veneta'&&image.hostname==='bottega-veneta.dam.kering.com'&&/_A\.jpg$/.test(asset))&&!!keringCode&&productPath.includes(keringCode);
    // A sole is not a representative photograph of a shoe, so it does not
    // fall through to the brand's-own-photo allowance below either.
    if(balenciagaAsset&&/_A\.jpg$/.test(asset))return null;
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
  if(ownPhoto)return {...product,presentation:{image:product.image,scale:1,offsetY:0,view:'product-photo',
    sourceUrl:product.officialImageEvidence.sourceUrl||product.url,checkedAt:product.officialImageEvidence.verifiedAt,
    method:'brand-own-product-photo'}};
  try{const image=new URL(product.image);if(product.brand==='New Balance'&&image.hostname==='nb.scene7.com'&&image.pathname.toLowerCase().endsWith('/'+product.style.toLowerCase()+'_nb_02_i'))return {...product,presentation:{image:product.image,scale:1,view:'three-quarter',sourceUrl:product.url,checkedAt:product.lastVerifiedAt,method:'reviewed-official-sku-view-slot'}};}catch{}
  return null;
}
