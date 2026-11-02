import {createHash} from 'node:crypto';
import {readJson,atomicJson,publishCurated} from './publish-curated.mjs';
import {isOfficialProductUrl} from './curation.mjs';
const manifest=await readJson('data/cucinelli-official-assortment.json'),products=new Map(),excluded=[],pages=[];
if(manifest.brand!=='Brunello Cucinelli')throw Error('CUCINELLI_MANIFEST_BRAND');
for(const snapshot of manifest.snapshots){
 if(snapshot.loadedCards!==snapshot.advertisedTotal||!isOfficialProductUrl(manifest.brand,snapshot.source))throw Error('CUCINELLI_PAGE_INCOMPLETE');
 const contentHash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 pages.push({url:snapshot.source,loaded:snapshot.loadedCards,advertisedTotal:snapshot.advertisedTotal,uniqueProducts:snapshot.products.length});
 for(const row of snapshot.products){
  if(!row.url.includes('/shoes/sneakers/')){excluded.push({style:row.style,reason:'not-in-official-sneaker-category'});continue;}
  if(!isOfficialProductUrl(manifest.brand,row.url)||!row.url.includes(row.style)||!row.image?.includes(row.style)||new URL(row.image).hostname!=='media.brunellocucinelli.com')throw Error('CUCINELLI_CARD_IMAGE_UNBOUND: '+row.style);
  const checkedAt=snapshot.checkedAt;
  const p={id:'cucinelli-'+row.style.toLowerCase(),brand:manifest.brand,name:row.name,style:row.style,styleType:'official-product-id',url:row.url,image:row.image,colorway:row.colorway,colors:[],gender:row.gender==='Man'?'Men':'Women',country:'AE',officialCategory:'Sneakers',description:row.alt,
   firstSeen:checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:snapshot.source,
   arrivalEvidence:{verified:true,brand:manifest.brand,style:row.style,productUrl:row.url,kind:'official-assortment-listing',url:snapshot.source,verifiedAt:checkedAt,contentHash,excerpt:'Official rendered sneaker card: '+row.name+' '+row.colorway},sourceSignals:[]};
  const proof={verified:true,brand:manifest.brand,style:row.style,identifierType:'official-product-id',verifiedAt:checkedAt,verificationMethod:'official-new-listing-sku-image',contentHash};
  p.officialProductEvidence={...proof,url:p.url};p.officialImageEvidence={...proof,url:p.image,sourceUrl:snapshot.source};products.set(p.style,p);
 }
}
const progress={checkedAt:new Date().toISOString(),products:[...products.values()],coverage:[{brand:manifest.brand,responses:pages.length,verified:products.size,errors:[],truncated:false,pages}],pending:[]};
await atomicJson('logs/cucinelli-assortment-progress.json',progress);
await atomicJson('data/cucinelli-assortment-report.json',{checkedAt:progress.checkedAt,pages,verifiedSneakers:products.size,excluded,scope:'Rendered official UAE men and women shoe listings; other regions and undisplayed variants are not independently reconciled'});
if(process.argv.includes('--publish')){const result=await publishCurated({incoming:progress.products});console.log('Cucinelli published snapshot',result.snapshot.products.length);}
console.log(`Cucinelli: ${products.size} official sneaker cards, ${excluded.length} non-sneaker records excluded.`);
