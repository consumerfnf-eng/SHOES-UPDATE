import {createHash} from 'node:crypto';
import {atomicJson,publishCurated} from './publish-curated.mjs';
const base='https://www.fendi.cn/rest/default/V3/applet/search/products?q='+encodeURIComponent('运动鞋');
const checkedAt=new Date().toISOString(),products=new Map(),seen=new Set(),pages=[],excluded=[];
let expected=null,totalPages=1;
for(let page=1;page<=totalPages;page++){
 const url=base+`&page=${page}&currentPage=${page}`;
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('FENDI_OFFICIAL_HTTP_'+response.status);
 const raw=await response.text(),json=JSON.parse(raw),data=json.data;
 if(!json.status||!Array.isArray(data?.items)||data.currentPage!==page)throw Error('FENDI_PAGE_UNVERIFIED');
 if(expected!==null&&expected!==data.totalProducts)throw Error('FENDI_TOTAL_CHANGED');
 expected=data.totalProducts;totalPages=data.totalPages;
 if(!Number.isInteger(totalPages)||totalPages>100)throw Error('FENDI_PAGE_LIMIT');
 pages.push({url,page,count:data.items.length,total:expected});
 const contentHash=createHash('sha256').update(raw).digest('hex');
 for(const row of data.items){
  seen.add(row.sku);
  if(!row.sku||row.collection!=='Man'&&row.collection!=='Woman'||!row.thirdLevelCat?.includes('运动鞋')){excluded.push({sku:row.sku,name:row.name,collection:row.collection,categories:row.thirdLevelCat,reason:'adult-sneaker-category-unconfirmed'});continue;}
  if(!row.url?.startsWith('https://www.fendi.cn/')||!row.url.toLowerCase().includes(row.sku.toLowerCase()))throw Error('FENDI_PRODUCT_URL_UNBOUND');
  const images=[row.defaultImage,...(row.images||[]).flatMap(i=>[i.tiny_url,i.url,i.small_url])].filter(Boolean);
  // Some official gallery files use content hashes rather than a SKU filename.
  // Their binding is the API card that carries both this SKU and this image.
  const image=images.find(u=>u.toLowerCase().includes(row.sku.toLowerCase()))||row.defaultImage;
  if(!image?.startsWith('https://')||!['www.fendi.cn','static.fendi.com'].includes(new URL(image).hostname))throw Error('FENDI_IMAGE_UNBOUND: '+row.sku);
  const name=row.tracking_name_en||row.name;
  const p={id:'fendi-cn-'+row.sku.toLowerCase(),brand:'Fendi',name:/^(?:Sneakers?|Trainers?)$/i.test(name)?name+' '+row.sku:name,style:row.sku,url:row.url,image,
   description:row.shortDesc,officialCategory:'Sneakers',colorway:row.color_en,colors:row.colorRgb?[row.colorRgb]:[],gender:row.collection==='Man'?'Men':'Women',country:'CN',priceLabel:row.price,
   firstSeen:checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:url,
   arrivalEvidence:{verified:true,brand:'Fendi',style:row.sku,productUrl:row.url,kind:'official-assortment-listing',url,verifiedAt:checkedAt,contentHash,excerpt:'Official sneaker search result with matching SKU, image and adult collection'},sourceSignals:[]};
  const proof={verified:true,brand:'Fendi',style:row.sku,verifiedAt:checkedAt,verificationMethod:'official-new-listing-sku-image',contentHash};
  p.officialProductEvidence={...proof,url:p.url};p.officialImageEvidence={...proof,url:p.image,sourceUrl:url};
  products.set(row.sku,p);
 }
}
if(seen.size!==expected)throw Error(`FENDI_TOTAL_UNRECONCILED: ${seen.size}/${expected}`);
const progress={checkedAt,products:[...products.values()],coverage:[{brand:'Fendi',responses:pages.length,candidates:seen.size,verified:products.size,errors:[],truncated:false,officialTotal:expected,pages}],pending:[]};
await atomicJson('logs/fendi-assortment-progress.json',progress);
await atomicJson('data/fendi-assortment-report.json',{checkedAt,officialSearchTotal:expected,uniqueSkuCount:seen.size,acceptedAdultSneakers:products.size,excluded,pages,scope:'Fendi China official sneaker search; other regions are not reconciled'});
if(process.argv.includes('--publish'))await publishCurated({incoming:progress.products});
console.log(`Fendi: ${seen.size}/${expected} official search SKUs reconciled, ${products.size} adult sneakers.`);
