import {decodeCatalog} from './catalog-wire.mjs';
import {prepareCatalog} from './catalog-runtime.mjs';
let snapshot,overlay=null,trends=null;
const read=async url=>{const response=await fetch(url);if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();};
async function load({catalog,manifest,today}){
 snapshot=catalog;let failed=false;
 const supplemental=Promise.allSettled([read('../data/monthly-catalog.json'),read('../data/trend-keywords.json')]);
 const chunks=manifest.chunks.slice(1);
 for(let at=0;at<chunks.length;at+=6){
  const result=await Promise.allSettled(chunks.slice(at,at+6).map(async chunk=>{const url=new URL(chunk.url.replace(/^\.\//,''),new URL('../',self.location.href));const value=decodeCatalog(await read(url));if(value.products.length!==chunk.count)throw Error('Incomplete brand chunk');return value.products;}));
  for(const row of result){if(row.status==='fulfilled')snapshot.products.push(...row.value);else failed=true;}
  self.postMessage({type:'progress',count:snapshot.products.length});
 }
 const supplements=await supplemental;
 if(supplements[0].status==='fulfilled')overlay=supplements[0].value;else failed=true;
 if(supplements[1].status==='fulfilled')trends=supplements[1].value;
 self.postMessage({type:'ready',trends,prepared:prepareCatalog(snapshot,overlay,trends,today),failed});
}
self.onmessage=event=>{
 const message=event.data;
 const task=message.type==='load'?load(message):Promise.resolve().then(()=>self.postMessage({type:'ready',trends,prepared:prepareCatalog(snapshot,overlay,trends,message.today),failed:false}));
 task.catch(error=>self.postMessage({type:'error',message:error.message}));
};
