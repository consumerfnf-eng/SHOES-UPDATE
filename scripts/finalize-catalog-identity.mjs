import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {reviewedDesignName,preferOfficialVariants,identityFold,manufacturerCode} from '../public/assets/product-identity.mjs';
import {unifyVariantGroups,groupProductVariants,variantGroupName,variantColorLabel} from '../public/assets/catalog-view.mjs';
import {buildKeywordCatalog} from './search-keywords.mjs';
import {buildStyleTrendBoard} from './style-trend-board.mjs';
import {productPresentation} from './product-presentation.mjs';
const root=new URL('../',import.meta.url);
const read=async(path,fallback)=>{try{return JSON.parse(await fs.readFile(new URL(path,root),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
export async function finalizeCatalogIdentity() {
  const c=await read('public/data/catalog.json',{}),m=await read('public/data/monthly-catalog.json',{schemaVersion:2,retail:[],newsletter:[],sources:{}});
  const supplement=await read('data/common-projects-retail.json',{products:[]});
  const bally=await read('data/bally-regional-retail.json',{products:[]});
  supplement.products.push(...bally.products);
  const photos=await read('data/product-photo-analysis.json',{photos:{}});
  const designReviews=await read('data/product-variant-reviews.json',{products:[]});
  const presentationReviews=await read('data/product-presentation.json',{products:[]});
  const ballyRefreshed=bally.schemaVersion===1&&Array.isArray(bally.pages)&&bally.pages.length>0;
  const byId=new Map(m.retail.filter(p=>!ballyRefreshed||p.source!=='retail-bally-uae').map(p=>[p.id,p]));
  for(const p of supplement.products)byId.set(p.id,productPresentation(p,presentationReviews)||p);
  m.retail=[...byId.values()];
  for(const p of supplement.products){const e=p.availabilityEvidence;m.sources[p.source]={label:p.retailer,listingUrl:e.listingUrl,checkedAt:e.verifiedAt,basis:'current-assortment'};}
  let correctedNames=0, inferredColours=0;
  const officialDropped=[];
  // Kering collectors can save the same full colour/material SKU as a slug,
  // a short canonical URL and a selectable listing. Preserve the best PDP.
  const balenciaga=new Map();
  const score=p=>(/sneakers for|\|.*balenciaga/i.test(p.name)?-10:0)+(/^(?:\d{6}|A[A-Z0-9]{5})W[A-Z0-9]+$/i.test(p.style)?2:0)+(['side','three-quarter'].includes(p.presentation?.view)?1:0);
  for(const p of c.products.filter(p=>p.brand==='Balenciaga')) {
    const code=manufacturerCode(p);if(!code)continue;
    const old=balenciaga.get(code);if(!old){balenciaga.set(code,p);continue;}
    const [keep,drop]=score(p)>score(old)?[p,old]:[old,p];
    balenciaga.set(code,keep);officialDropped.push({id:drop.id,officialId:keep.id,brand:p.brand,code,reason:'exact-official-full-manufacturer-code'});
  }
  const officialDropIds=new Set(officialDropped.map(p=>p.id));
  c.products=c.products.filter(p=>!officialDropIds.has(p.id));
  for(const p of [...c.products,...m.retail]) {
    const design=designReviews.products.find(r=>r.verified&&r.id===p.id&&r.brand===p.brand&&r.style===p.style&&r.url===p.url&&r.image===p.image);
    if(design)p.designReview=design;
    if(p.modelName===p.name&&!p.modelGroupId)delete p.modelName;
    const reviewed=reviewedDesignName(p);
    if(reviewed&&reviewed!==p.modelName){p.modelName=reviewed;correctedNames++;}
    const a=photos.photos[p.presentation?.image||p.image];
    p.colorway=String(p.colorway||'').replace(/(?:OWIA|OMIA|OF|LABF)\d[A-Z0-9]*/gi,'').trim();
    const materialOnly=/^(?:(?:and|monochrome|mixed|fibers?|full|grain|grained|calfskin|lambskin|leather|suede|nubuck|nylon|mesh|technical|fabric|metallic|dino|snake|effect|felt|nappa|faux|fur|velvet|canvas|cotton|wool|cashmere|wish|sneakers?)\b[\s®™&/.,'-]*)+$/i.test(p.colorway||'');
    if(materialOnly)p.colorway='';
    if(p.brand==='Golden Goose'&&String(p.colorway).includes(p.name))p.colorway='';
    if(a&&!a.needsReview){
      const cached=p.presentation?.image===a.presentation.image?p.presentation?.cachedPath:'';
      p.presentation={...p.presentation,...a.presentation,...(cached?{cachedPath:cached}:{})};
      p.bodyColor=a.bodyColor;p.photoHash=a.photoHash;
      if(!p.colorway||/미표기|미확인|unknown|not (?:specified|available)|^image\b/i.test(p.colorway)||p.colorEvidence?.method==='upper-image-analysis'&&p.colorEvidence.image===(p.presentation.image||p.image)){
        p.colorway=a.colorName;p.colorEvidence={method:'upper-image-analysis',image:p.presentation.image||p.image,hex:a.bodyColor,label:a.colorName};inferredColours++;
      }
    }
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
  const officialHistory=[...new Map([...(prior.officialSourceDuplicatesRemoved||[]),...officialDropped].map(d=>[d.id,d])).values()];
  if(c.sourceStatus?.counts)c.sourceStatus.counts.published=c.products.length;
  {
    const checked=c.keywordCheckedAt;
    Object.assign(c,buildKeywordCatalog(c.products,c.sourceRanks,{now:c.keywordEvaluatedAt||checked}));
    c.keywordCheckedAt=checked;
    if(c.styleTrendKeywords?.method==='verified-style-board-v1')c.styleTrendKeywords=buildStyleTrendBoard(c.products,c.styleTrendKeywords.observations,{now:c.keywordEvaluatedAt||checked,updated:c.styleTrendKeywords.updated,sourceRanks:c.sourceRanks});
  }
  const report={schemaVersion:1,officialVariants:c.products.length,retailVariants:m.retail.length,officialDuplicatesRemoved:duplicateHistory,
    officialSourceDuplicatesRemoved:officialHistory,
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
