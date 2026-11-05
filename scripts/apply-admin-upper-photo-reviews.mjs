import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {productKeywordIds,productSearchConceptIds} from './keyword-taxonomy.mjs';
import {buildKeywordCatalog} from './search-keywords.mjs';
import {buildStyleTrendBoard} from './style-trend-board.mjs';
import {validateSnapshot} from './validate_catalog.mjs';
import {buildCatalogChunks} from './build-catalog-chunks.mjs';
import {encodeCatalog} from '../public/assets/catalog-wire.mjs';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
// Exact own-product photographs inspected at original resolution. The dark
// contrast model's tan outsole is excluded from its black upper colour.
const decisions=[['ugg-new-1170750-ddc','Brown','#47332d'],['ugg-new-1144032-dyr','Pink','#bb8095'],['ugg-new-1180592-bkmp','Black','#3f3e3c'],['ugg-new-1175301-mby','Green','#989581']];
const request=await read('reports/admin-bulk-recheck-request.json'),baseline=await read(request.baselineDirectory+'/catalog.json');
const ids=new Set(decisions.map(([id])=>id));
assert.ok(baseline.products.every(p=>!ids.has(p.id)),'Only this batch new records may be corrected');
const catalog=await read('public/data/catalog.json'),source=await read('data/catalog-source.json'),reviews=await read('data/product-colour-reviews.json');
for(const [id,label,hex] of decisions){
 const p=catalog.products.find(p=>p.id===id);assert.equal(p?.brand,'UGG');
 const asset=p.presentation.cachedPath,bytes=await fs.readFile('public'+asset);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.split('/').at(-1).split('.')[0]);
 const review={id,brand:p.brand,style:p.style,url:p.url,image:p.image,verified:true,method:'manual-upper-photo-review',checkedAt:new Date().toISOString(),presentationImage:p.presentation.image,cachedPath:asset,colorSwatches:[hex],colorName:label,replaceColorName:true,reason:'Compared the exact original official product photograph; selected the visible main upper, excluding background, outsole and contrast trim.'};
 const at=reviews.products.findIndex(r=>r.id===id);if(at<0)reviews.products.push(review);else reviews.products[at]=review;
 for(const row of [p,source.products.find(row=>row.id===id)]){
  assert.ok(row);assert.equal(row.image,p.image);row.sourceColorway??=row.colorway;
  row.colorway=label;row.bodyColor=hex;row.colorSwatches=[hex];row.colourReview=review;
  row.colorEvidence={method:'reviewed-shoe-upper-photo',image:review.presentationImage,hex,label};
  row.keywordTags=productKeywordIds(row);row.searchConceptIds=productSearchConceptIds(row);
 }
}
const at=catalog.keywordEvaluatedAt??catalog.keywordCheckedAt,checked=catalog.keywordCheckedAt;
Object.assign(catalog,buildKeywordCatalog(catalog.products,catalog.sourceRanks,{now:at}));catalog.keywordCheckedAt=checked;catalog.keywordEvaluatedAt=at;
if(catalog.styleTrendKeywords?.method==='verified-style-board-v1')catalog.styleTrendKeywords=buildStyleTrendBoard(catalog.products,catalog.styleTrendKeywords.observations,{now:at,updated:catalog.styleTrendKeywords.updated,sourceRanks:catalog.sourceRanks});
validateSnapshot(catalog,{watch:await read('data/source-watch.json')});
await fs.writeFile('public/data/catalog.json',JSON.stringify(catalog)+'\n');await fs.writeFile('data/catalog-source.json',JSON.stringify(source)+'\n');
await fs.writeFile('data/product-colour-reviews.json',JSON.stringify(reviews,null,2)+'\n');
await buildCatalogChunks(catalog,'public/data');await fs.writeFile('public/data/catalog-ui.json',JSON.stringify(encodeCatalog(catalog))+'\n');
console.log(JSON.stringify({reviewed:decisions.length,total:catalog.products.length}));
