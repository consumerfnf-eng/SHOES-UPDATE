import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {readJson,publishCurated} from './publish-curated.mjs';
import {isOfficialProductUrl,classifyFootwear} from './curation.mjs';

// Import the reviewed expansion only. Existing LUX houses keep their source rows.
export async function importLuxExpansion(){
  const config=await readJson('config/lux-brand-expansion.json');
  const input=await readJson('data/lux-expansion-assortment.json');
  const added=new Set(config.addedToLux);
  if(input.failed?.length)throw Error('Resolve expansion verification failures before publishing');
  if(input.products.length<400)throw Error('Incomplete reviewed expansion snapshot');
  const ids=new Set();
  for(const p of input.products){
    if(!added.has(p.brand)||ids.has(p.id)||!isOfficialProductUrl(p.brand,p.url)||!p.arrivalEvidence?.verified||!p.officialImageEvidence?.verified||!['sneaker','hybrid','mule-sneaker','ballet-sneaker','mary-jane-sneaker'].includes(classifyFootwear(p).category))throw Error('Invalid expansion product: '+p.id);
    ids.add(p.id);
  }
  const source=await readJson('data/catalog-source.json');
  const replaced=source.products.filter(p=>added.has(p.brand));
  await fs.mkdir('logs/backups',{recursive:true});
  await fs.writeFile('logs/backups/lux-expansion-source-before.json',JSON.stringify(source));
  // Old policy-excluded rows include dead Bally global URLs; retain the backup,
  // then replace just these houses with the current, explicitly verified set.
  source.products=source.products.filter(p=>!added.has(p.brand));
  await fs.writeFile('data/catalog-source.json',JSON.stringify(source,null,2)+'\n');
  const coverage=config.addedToLux.map(brand=>({brand,checkedAt:input.checkedAt,verified:input.products.filter(p=>p.brand===brand).length,status:brand==='Goyard'?'no-official-sneaker-found':brand==='Bally'?'regional-retail-current-assortment':'reviewed-current-assortment',exhaustive:false,scope:'Configured regional sneaker shelves and observed pagination; not a worldwide inventory guarantee'}));
  try{
    const result=await publishCurated({incoming:input.products,collection:{...source.collection,checkedAt:input.checkedAt,coverage:[...(source.collection?.coverage||[]).filter(p=>!added.has(p.brand)),...coverage]}});
    console.log(JSON.stringify({imported:input.products.length,replacedUnpublishedSourceRows:replaced.length,published:result.snapshot.products.length,newPublished:result.snapshot.products.filter(p=>added.has(p.brand)).length}));
    return result;
  }catch(error){await fs.copyFile('logs/backups/lux-expansion-source-before.json','data/catalog-source.json');throw error;}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await importLuxExpansion();
