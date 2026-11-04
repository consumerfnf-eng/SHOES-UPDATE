import fs from 'node:fs/promises';import {pathToFileURL} from 'node:url';
import {pacedOfficialFetch} from './official-reader.mjs';import {columbiaNewPage} from './columbia-new-page.mjs';
export async function collectColumbiaNew({readHtml,at=new Date().toISOString()}={}){
 const fetchOfficial=pacedOfficialFetch();readHtml??=async url=>{const r=await fetchOfficial(url);if(!r.ok)throw Error('HTTP '+r.status);return r.text();};
 const products=[],excluded=[],codes=new Set(),styles=new Set();let total;
 for(let page=1;page<=100;page++){const url='https://www.columbiakorea.co.kr/product/list.asp?cno=350&page='+page,result=columbiaNewPage(await readHtml(url),url,{at});total??=result.total;products.push(...result.products);excluded.push(...result.excluded);
  const htmlCount=result.read;for(const style of result.styles)styles.add(style);console.log('COLUMBIA page '+page+': '+htmlCount+' tiles');
  // All pages are read, including non-New tiles, to prove full pagination.
  const key=result.products.map(p=>p.style).join('|');if(key&&codes.has(key))throw Error('Columbia pagination repeated');if(key)codes.add(key);
  if(total&&page*20>=total){if(styles.size!==total)throw Error('Columbia source count differs from unique tiles');return {checkedAt:at,products:[...new Map(products.map(p=>[p.style,p])).values()],excluded,coverage:{total,read:styles.size,pages:page,exhausted:true}};}
  if(!htmlCount)throw Error('Columbia list ended before its total');
 }throw Error('Columbia page limit reached');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await collectColumbiaNew();await fs.writeFile('data/columbia-new.json',JSON.stringify(r,null,2)+'\n');console.log('DONE '+r.products.length);}
