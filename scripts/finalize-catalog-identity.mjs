import {productKeywordIds,productSearchConceptIds} from './keyword-taxonomy.mjs';
import {repairNewsletterBrand} from './repair-newsletter-brand.mjs';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {reviewedDesignName,preferOfficialVariants,identityFold,manufacturerCode} from '../public/assets/product-identity.mjs';
import {unifyVariantGroups,groupProductVariants,variantGroupName,variantColorLabel,kstToday,productAudience} from '../public/assets/catalog-view.mjs';
import {canonicalSiteBrand,isSiteBrandAllowed,siteBrandGroup} from '../public/assets/site-brand-policy.mjs';
import {retailPublicationEligibility} from '../public/assets/retail-release-policy.mjs';
import {restoreRetailSnapshot} from './restore-retail-snapshot.mjs';
import {buildKeywordCatalog} from './search-keywords.mjs';
import {buildStyleTrendBoard} from './style-trend-board.mjs';
import {productPresentation} from './product-presentation.mjs';
import {isExcludedBrand} from '../public/assets/brand-exclusions.mjs';
import {repairSourceLabels} from './repair-source-labels.mjs';
import {normalizeDisplayLanguage} from './normalize-display-language.mjs';
import {canonicalBrand} from './curation.mjs';
const root=new URL('../',import.meta.url);
const read=async(path,fallback)=>{try{return JSON.parse(await fs.readFile(new URL(path,root),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
export async function finalizeCatalogIdentity() {
  const c=await read('public/data/catalog.json',{}),m=await read('public/data/monthly-catalog.json',{schemaVersion:2,retail:[],newsletter:[],sources:{}});
  const rawRetail=await read('data/retail-source.json',{products:[]});
  const rawById=new Map(rawRetail.products.map(p=>[p.id,p]));
  for(const p of m.retail)if(!rawById.has(p.id))rawById.set(p.id,p);
  await fs.writeFile(new URL('data/retail-source.json',root),JSON.stringify({schemaVersion:1,products:[...rawById.values()]},null,2)+'\n');
  m.retail=restoreRetailSnapshot(m.retail,rawRetail.products,await read('config/retail-restoration.json',{}));
  const photos=await read('data/product-photo-analysis.json',{photos:{}});
  const photoAttributes=await read('data/official-photo-attributes.json',{products:[]});
  const colourReviews=await read('data/product-colour-reviews.json',{products:[]});
  const cache=await read('data/photo-cache.json',{images:{}});
  const designReviews=await read('data/product-variant-reviews.json',{products:[]});
  const presentationReviews=await read('data/product-presentation.json',{products:[]});
  m.retail=m.retail.filter(p=>!isExcludedBrand(p.brand)).map(p=>productPresentation(p,presentationReviews)||p);
  for(const p of [...m.retail,...(m.newsletter||[])]){
    const canonical=canonicalBrand(p.brand);
    if(canonical!==p.brand){p.brandAsListed??=p.brand;p.brand=canonical;}
  }
  m.newsletter=(m.newsletter||[]).map(repairNewsletterBrand).filter(p=>!isExcludedBrand(p.brand));
  c.products=c.products.filter(p=>!isExcludedBrand(p.brand));
  const siteRemoved=[];
  for(const p of [...c.products,...m.retail,...m.newsletter]){
    const canonical=canonicalSiteBrand(p.brand);
    if(canonical!==p.brand){
      p.brandAsListed??=p.brand;p.brand=canonical;
      for(const field of ['arrivalEvidence','officialProductEvidence','officialImageEvidence','dateEvidence','productPageEvidence','styleEvidence','hybridReview','modelReview','sourceLabelReview'])if(p[field]?.brand&&canonicalSiteBrand(p[field].brand)===canonical)p[field]={...p[field],brand:canonical};
    }
    if(!isSiteBrandAllowed(p.brand))siteRemoved.push({id:p.id,brand:p.brand,reason:'site-brand-excluded'});
  }
  c.products=c.products.filter(p=>isSiteBrandAllowed(p.brand));
  m.retail=m.retail.filter(p=>isSiteBrandAllowed(p.brand));
  m.newsletter=m.newsletter.filter(p=>isSiteBrandAllowed(p.brand));
  const releaseRemoved=m.retail.map(p=>({id:p.id,brand:p.brand,...retailPublicationEligibility(p,kstToday())})).filter(p=>!p.eligible);
  m.retail=m.retail.filter(p=>retailPublicationEligibility(p,kstToday()).eligible);
  const scopePrior=await read('data/publication-scope-review.json',{});
  const siteRemovalHistory=[...new Map([...(scopePrior.siteRemovalHistory||scopePrior.siteRemoved||[]),...siteRemoved].map(p=>[p.id,p])).values()];
  const retailReleaseRemovalHistory=[...new Map([...(scopePrior.retailReleaseRemovalHistory||scopePrior.retailReleaseRemoved||[]),...releaseRemoved].map(p=>[p.id,p])).values()];
  await fs.writeFile(new URL('data/publication-scope-review.json',root),JSON.stringify({checkedAt:new Date().toISOString(),siteRemoved,retailReleaseRemoved:releaseRemoved,siteRemovalHistory,retailReleaseRemovalHistory},null,2)+'\n');
  c.brands=[...new Map((c.brands||[]).map(b=>{const name=canonicalSiteBrand(b.name);return [name,{...b,name,siteGroup:siteBrandGroup(name)}];})).values()].filter(b=>isSiteBrandAllowed(b.name));
  for(const key of Object.keys(m.sources||{}))if(key==='retail-bally-uae')delete m.sources[key];
  let correctedNames=0, inferredColours=0;
  const officialDropped=[];
  // Kering collectors can save the same full colour/material SKU as a slug,
  // a short canonical URL and a selectable listing. Preserve the best PDP.
  for(const p of c.products){const review=designReviews.products.find(r=>r.verified&&r.id===p.id&&r.brand===p.brand&&r.style===p.style&&r.url===p.url&&r.image===p.image);if(review)p.designReview=review;}
  const balenciaga=new Map();
  const score=p=>(/sneakers for|\|.*balenciaga/i.test(p.name)?-10:0)+(/^(?:\d{6}|A[A-Z0-9]{5})W[A-Z0-9]+$/i.test(p.style)?2:0)+(['side','three-quarter'].includes(p.presentation?.view)?1:0);
  for(const p of c.products.filter(p=>p.brand==='Balenciaga')) {
    const code=manufacturerCode(p);if(!code)continue;
    const old=balenciaga.get(code);if(!old){balenciaga.set(code,p);continue;}
    const [keep,drop]=score(p)>score(old)?[p,old]:[old,p];
    keep.alternateOfficialUrls=[...new Set([...(keep.alternateOfficialUrls||[]),...(drop.alternateOfficialUrls||[]),drop.url].filter(url=>url&&url!==keep.url))];
    for(const field of ['firstSeen','firstPublishedAt'])if(drop[field]&&(!keep[field]||drop[field]<keep[field]))keep[field]=drop[field];
    balenciaga.set(code,keep);officialDropped.push({id:drop.id,officialId:keep.id,brand:p.brand,code,reason:'exact-official-full-manufacturer-code'});
  }
  const officialDropIds=new Set(officialDropped.map(p=>p.id));
  c.products=c.products.filter(p=>!officialDropIds.has(p.id));
  // A full physical-variant code together with the exact same photograph
  // proves duplicate official records, including regional punctuation variants.
  // A shared model prefix or approximate image similarity proves neither.
  const exactOfficial=new Map(),redundant=new Set();
  for(const p of c.products){
    const code=manufacturerCode(p),photo=p.presentation?.cachedPath||p.presentation?.image||p.image;
    if(!code||!photo)continue;
    const key=JSON.stringify(code.startsWith('reviewed-variant|')?[p.brand,code]:[p.brand,code,photo]);
    const prior=exactOfficial.get(key);
    if(!prior){exactOfficial.set(key,p);continue;}
    const [keep,drop]=productAudience(p)==='women'&&productAudience(prior)!=='women'?[p,prior]:[prior,p];
    exactOfficial.set(key,keep);
    keep.alternateOfficialUrls=[...new Set([...(keep.alternateOfficialUrls||[]),...(drop.alternateOfficialUrls||[]),drop.url].filter(url=>url&&url!==keep.url))];
    for(const field of ['firstSeen','firstPublishedAt'])if(drop[field]&&(!keep[field]||drop[field]<keep[field]))keep[field]=drop[field];
    redundant.add(drop.id);officialDropped.push({id:drop.id,officialId:keep.id,brand:p.brand,code,reason:code.startsWith('reviewed-variant|')?'reviewed-same-physical-variant':'exact-official-variant-code-and-product-photo'});
  }
  c.products=c.products.filter(p=>!redundant.has(p.id));
  for(const p of [...c.products,...m.retail]) {
    Object.assign(p,normalizeDisplayLanguage(repairSourceLabels(p)));
    const design=designReviews.products.find(r=>r.verified&&r.id===p.id&&r.brand===p.brand&&r.style===p.style&&r.url===p.url&&r.image===p.image);
    if(design)p.designReview=design;
    if(p.modelName===p.name&&!p.modelGroupId)delete p.modelName;
    const reviewed=reviewedDesignName(p);
    if(reviewed&&reviewed!==p.modelName){p.modelName=reviewed;correctedNames++;}
    const attribute=photoAttributes.products.find(r=>r.verified&&r.id===p.id&&r.brand===p.brand&&r.style===p.style&&r.url===p.url&&r.image===p.image&&r.presentationImage===(p.presentation?.image||p.image));
    if(attribute){p.sourceColorway??=p.colorway;p.colorway=attribute.colorway;p.colorSwatches=attribute.colorSwatches;p.colorEvidence={method:'official-product-attribute',url:attribute.sourceUrl,label:attribute.colorway,contentHash:attribute.contentHash};}
    const a=photos.photos[p.presentation?.image||p.image];
    p.colorway=String(p.colorway||'').replace(/(?:OWIA|OMIA|OF|LABF)\d[A-Z0-9]*/gi,'').trim();
    if(p.brand==='Louis Vuitton'&&/^1[A-Z0-9]{5}$/i.test(p.style||'')&&String(p.colorway).toLowerCase()===p.style.replace(/[^a-z]/gi,'').toLowerCase())p.colorway='';
    const materialOnly=/^(?:(?:and|monochrome|mixed|fibers?|full|grain|grained|calfskin|lambskin|leather|suede|nubuck|nylon|mesh|technical|fabric|metallic|dino|snake|effect|felt|nappa|faux|fur|velvet|canvas|cotton|wool|cashmere|wish|sneakers?)\b[\s®™&/.,'-]*)+$/i.test(p.colorway||'');
    if(materialOnly||/^(?:lo|croc|pony)$/i.test(p.colorway))p.colorway='';
    if(p.brand==='Golden Goose'&&String(p.colorway).includes(p.name))p.colorway='';
    if(a&&!a.needsReview){
      const cached=(p.presentation?.image||p.image)===a.presentation.image?p.presentation?.cachedPath:'';
      p.presentation={...p.presentation,...a.presentation,...(cached?{cachedPath:cached}:{})};
      p.bodyColor=a.bodyColor;p.photoHash=a.photoHash;
      if(!p.colorway||/미표기|미확인|unknown|not (?:specified|available)|^image\b/i.test(p.colorway)||p.colorEvidence?.method==='upper-image-analysis'&&p.colorEvidence.image===(p.presentation.image||p.image)){
        p.colorway=a.colorName;p.colorEvidence={method:'upper-image-analysis',image:p.presentation.image||p.image,hex:a.bodyColor,label:a.colorName};inferredColours++;
      }
    }
    const colour=colourReviews.products.find(r=>r.verified&&r.id===p.id&&r.brand===p.brand&&r.style===p.style&&r.url===p.url&&r.image===p.image&&r.presentationImage===(p.presentation?.image||p.image));
    if(colour){p.colorSwatches=colour.colorSwatches;p.colourReview=colour;if(colour.colorName&&(colour.replaceColorName===true||/^(?:black|white|brown|blue|grey|gray|yellow|green|red|purple|silver|gold|블랙|화이트|브라운|블루|그레이|레드|그린)$/i.test(p.colorway))){p.sourceColorway??=p.colorway;p.colorway=colour.colorName;p.colorEvidence={method:'reviewed-shoe-upper-photo',image:colour.presentationImage,hex:colour.colorSwatches[0],label:colour.colorName};}}
    const cached=cache.images[p.presentation?.image||p.image];
    if(cached?.path)p.presentation={image:p.image,view:'product-photo',scale:1,...p.presentation,cachedPath:cached.path};
    p.keywordTags=productKeywordIds(p);p.searchConceptIds=productSearchConceptIds(p);
  }
  const dropped=[];
  const decisions=await read('data/reviewed-retail-duplicates.json',{products:[]});
  m.retail=m.retail.filter(p=>{
    const decision=decisions.products.find(d=>d.verified&&d.retailId===p.id&&d.brand===p.brand&&d.retailStyle===p.style&&d.retailUrl===p.url&&d.retailImage===p.image);
    const official=decision&&c.products.find(o=>o.id===decision.officialId&&o.brand===decision.brand&&o.style===decision.officialStyle&&o.url===decision.officialUrl&&o.image===decision.officialImage);
    if(!official)return true;
    dropped.push({id:p.id,officialId:official.id,reason:decision.method});return false;
  });
  const both=[...c.products,...m.retail.map(p=>({...p,overlay:true}))];
  const keep=new Set(preferOfficialVariants(both,dropped).map(p=>p.id));
  m.retail=m.retail.filter(p=>keep.has(p.id));
  unifyVariantGroups(both.filter(p=>keep.has(p.id)));
  const groups=groupProductVariants(both.filter(p=>keep.has(p.id)));
  const prior=await read('data/product-identity-audit.json',{});
  const duplicateHistory=[...new Map([...(prior.officialDuplicatesRemoved||[]),...dropped].map(d=>[d.id,d])).values()];
  const officialDuplicateHistory=[...new Map([...(prior.officialSourceDuplicateHistory||prior.officialSourceDuplicatesRemoved||[]),...officialDropped].map(d=>[d.id,d])).values()];
  const currentOfficialIds=new Set(c.products.map(p=>p.id));
  const officialHistory=officialDuplicateHistory.filter(p=>!currentOfficialIds.has(p.id));
  if(c.sourceStatus?.counts)c.sourceStatus.counts.published=c.products.length;
  {
    const checked=c.keywordCheckedAt;
    Object.assign(c,buildKeywordCatalog(c.products,c.sourceRanks,{now:c.keywordEvaluatedAt||checked}));
    c.keywordCheckedAt=checked;
    if(c.styleTrendKeywords?.method==='verified-style-board-v1')c.styleTrendKeywords=buildStyleTrendBoard(c.products,c.styleTrendKeywords.observations,{now:c.keywordEvaluatedAt||checked,updated:c.styleTrendKeywords.updated,sourceRanks:c.sourceRanks});
  }
  const report={schemaVersion:1,officialVariants:c.products.length,retailVariants:m.retail.length,officialDuplicatesRemoved:duplicateHistory,
    officialSourceDuplicatesRemoved:officialHistory,officialSourceDuplicateHistory:officialDuplicateHistory,
    models:groups.map(g=>({brand:g[0].brand,name:variantGroupName(g[0]),ids:g.map(p=>p.id),variants:g.map(p=>({id:p.id,style:p.manufacturerStyle||p.style,color:variantColorLabel(p)}))}))};
  const {checkedAt:previousCheck,...previous}=prior;
  report.checkedAt=JSON.stringify(previous)===JSON.stringify(report)?previousCheck:new Date().toISOString();
  await fs.writeFile(new URL('data/product-identity-audit.json',root),JSON.stringify(report,null,2)+'\n');
  // Pages rejects individual files above 25 MiB. Formatting is not data.
  await fs.writeFile(new URL('public/data/catalog.json',root),JSON.stringify(c)+'\n');
  await fs.writeFile(new URL('public/data/monthly-catalog.json',root),JSON.stringify(m)+'\n');
  console.log(`Identity audit: ${correctedNames} model names, ${inferredColours} inferred upper colours, ${dropped.length} proven official/retail duplicates removed`);
  return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await finalizeCatalogIdentity();
