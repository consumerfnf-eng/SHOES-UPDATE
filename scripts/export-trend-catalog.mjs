// Share the site's grouping and regenerate presentation from trusted reviews.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {groupProductVariants,variantGroupKey,variantGroupName,uniqueColorVariants,officialImageUrl,officialProductUrl,releaseState,kstToday} from '../public/assets/catalog-view.mjs';
import {isPublishedFootwear} from '../public/assets/footwear-policy.mjs';
import {hasArrivalEvidence} from '../public/assets/publication-window.mjs';
import {releaseWindow,calendarShift} from '../public/assets/release-window.mjs';
import {productPresentation} from './product-presentation.mjs';

export function verifiedRecentRelease(product,today) {
  const proof=product.dateEvidence,window=releaseWindow(product),checked=Date.parse(proof?.verifiedAt);
  return proof?.verified===true&&!!window&&Number.isFinite(checked)&&kstToday(new Date(checked))<=today
    &&typeof proof.excerpt==='string'&&!!proof.excerpt.trim()&&/^https?:\/\//.test(proof.url||'')
    &&window.start>=calendarShift(today,-3)&&window.end<=today;
}

export function exportTrendModels(catalog,now,reviews) {
  const today=kstToday(new Date(now));
  const eligible=(catalog.products||[]).filter(p=>{
    if(releaseState(p,today)!=='released'||!isPublishedFootwear(p)||!officialImageUrl(p,today)||!officialProductUrl(p,today)
      ||!(hasArrivalEvidence(p,today)||verifiedRecentRelease(p,today)))return false;
    // An explicit negative/incomplete person/view review outranks automatic slots.
    const exactReview=reviews.products?.find(r=>r.id===p.id&&r.brand===p.brand&&r.style===p.style&&r.originalImage===p.image);
    if(exactReview&&(exactReview.approved!==true||exactReview.noPerson!==true||!['side','three-quarter'].includes(exactReview.view)))return false;
    const reviewed=productPresentation(p,reviews)?.presentation;
    return !!reviewed&&['side','three-quarter'].includes(reviewed.view)
      &&p.presentation?.image===reviewed.image&&p.presentation?.view===reviewed.view;
  });
  return groupProductVariants(eligible).map(group=>({modelKey:variantGroupKey(group[0]),name:variantGroupName(group[0]),
    variants:group,colorVariants:uniqueColorVariants(group),allVariantIds:group.map(p=>p.id)}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  let input='';for await(const chunk of process.stdin)input+=chunk;
  const {catalog,now}=JSON.parse(input);
  const reviews=JSON.parse(await fs.readFile(new URL('../data/product-presentation.json',import.meta.url),'utf8'));
  process.stdout.write(JSON.stringify(exportTrendModels(catalog,now,reviews)));
}
