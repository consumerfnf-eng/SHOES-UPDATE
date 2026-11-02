import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readJson,atomicJson,publishCurated} from './publish-curated.mjs';
import {canonicalUrl,isOfficialProductUrl,classifyFootwear} from './curation.mjs';

// Public rendered cards are saved separately from local browser download receipts.
// No browser session data or credentials belong in the catalogue manifest.
const manifest=await readJson('data/autry-official-assortment.json');
if(manifest.brand!=='Autry')throw Error('AUTRY_MANIFEST_BRAND');
const cache=await readJson('data/photo-cache.json'),products=new Map(),excluded=[],pages=[];
const receiptArg=process.argv.indexOf('--receipts');
if(receiptArg>=0){
 const receipts=await readJson(process.argv[receiptArg+1]);
 const allowedImages=new Set(manifest.snapshots.flatMap(s=>s.products.map(p=>p.image)));
 for(const asset of receipts.assets){
  if(!allowedImages.has(asset.url))continue;
  const bytes=await fs.readFile(asset.path);
  const extension=bytes[0]===255&&bytes[1]===216?'jpg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
  if(!extension||bytes.length>8_000_000)throw Error('AUTRY_UNSUPPORTED_PHOTO: '+asset.url);
  const sha256=createHash('sha256').update(bytes).digest('hex'),path=`/images/${sha256}.${extension}`;
  await fs.writeFile('public'+path,bytes);
  cache.images[asset.url]={path,sha256,sourceUrl:asset.url,checkedAt:receipts.checkedAt,acquisition:'official-rendered-image-download'};
  if(cache.unavailable)delete cache.unavailable[asset.url];
 }
 await atomicJson('data/photo-cache.json',cache);
}
for(const snapshot of manifest.snapshots){
 if(snapshot.products.length!==snapshot.advertisedTotal||!isOfficialProductUrl('Autry',snapshot.source))throw Error('AUTRY_PAGE_INCOMPLETE');
 const contentHash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 pages.push({url:snapshot.source,loaded:snapshot.products.length,advertisedTotal:snapshot.advertisedTotal});
 for(const row of snapshot.products){
  if(!isOfficialProductUrl('Autry',row.url)||new URL(row.image).hostname!=='static.autry-usa.com'||!row.image.includes('_'+row.id+'_')||!row.url.endsWith('-'+row.id+'.html')||!row.style||row.category!=='sneakers')throw Error('AUTRY_CARD_IMAGE_UNBOUND: '+row.id);
  const checkedAt=snapshot.checkedAt;
  const p={id:'arrival-'+createHash('sha256').update('Autry|'+canonicalUrl(row.url)).digest('hex').slice(0,20),brand:'Autry',name:row.name,style:row.style,styleType:'official-product-id',url:row.url,image:row.image,colors:[],gender:row.gender==='MAN'?'Men':'Women',country:'KR',officialCategory:'Sneakers',description:row.displayName,
   firstSeen:checkedAt,productVerifiedAt:checkedAt,productEvidenceUrl:snapshot.source,
   arrivalEvidence:{verified:true,brand:'Autry',style:row.style,productUrl:row.url,kind:'official-assortment-listing',url:snapshot.source,verifiedAt:checkedAt,contentHash,excerpt:'Official rendered sneaker card: '+row.displayName},sourceSignals:[]};
  const proof={verified:true,brand:'Autry',style:row.style,identifierType:'official-product-id',verifiedAt:checkedAt,verificationMethod:'official-new-listing-sku-image',contentHash};
  p.officialProductEvidence={...proof,url:p.url};p.officialImageEvidence={...proof,url:p.image,sourceUrl:snapshot.source};
  const type=classifyFootwear(p);
  // Preserve hybrid candidates for the publisher's individually reviewed evidence.
  // An unreviewed mule is held by publication, not silently discarded here.
  if(type.reason!=='hybrid-review-required'&&!['sneaker','hybrid','ballet-sneaker','mary-jane-sneaker','mule-sneaker'].includes(type.category)){excluded.push({id:row.id,name:row.name,url:row.url,reason:type.reason||type.category||'outside-sneaker-scope'});continue;}
  products.set(p.id,p);
 }
}
const checkedAt=new Date().toISOString();
const missingPhotos=[...products.values()].filter(p=>!cache.images[p.image]).map(p=>({id:p.id,url:p.url,image:p.image}));
const progress={checkedAt,products:[...products.values()],coverage:[{brand:'Autry',responses:pages.length,verified:products.size,errors:[],truncated:false,pages}],pending:[]};
await atomicJson('logs/autry-assortment-progress.json',progress);
await atomicJson('data/autry-assortment-report.json',{checkedAt,pages,verifiedSneakers:products.size,excluded,missingPhotos,scope:'Official Korean adult women and men sneaker listings; other regions and undisplayed variants are not independently reconciled'});
if(process.argv.includes('--publish')){const result=await publishCurated({incoming:progress.products});console.log('Autry published snapshot',result.snapshot.products.length);}
console.log({verified:products.size,excluded:excluded.length,missingPhotos:missingPhotos.length});
