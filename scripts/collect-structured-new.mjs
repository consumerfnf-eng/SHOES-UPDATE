import {asicsNewPage,asicsNewDetail} from './asics-new-page.mjs';
import {adidasNewPage} from './adidas-new-page.mjs';
import {newBalanceNewRecords} from './new-balance-new-feed.mjs';
import {converseNewPage} from './converse-new-page.mjs';
import {pacedOfficialFetch} from './official-reader.mjs';
export async function collectStructuredNew({readHtml,now=new Date(),onProgress=()=>{},brands=['ASICS','adidas','New Balance','Converse'],allowPartial=false}={}){
 const at=now.toISOString(),fetchOfficial=pacedOfficialFetch(),outputs={},errors=[];
 const json=async(url,options)=>{const r=await fetchOfficial(url,options);if(!r.ok)throw Error('HTTP '+r.status);return r.json();};
 for(const brand of brands.filter(b=>['ASICS','adidas','New Balance','Converse'].includes(b))){let validatedResult;try{
  let result;
  if(brand==='ASICS'){
   const products=[],excluded=[],missing=[],seen=new Set();let url='https://www.asics.com/us/en-us/sportstyle-new-arrivals/c/aa90000023/',total;
   let parsedPages=0;validatedResult=()=>({products:[...products],coverage:{total:Number.isFinite(total)?total:null,read:products.length+excluded.length+missing.length,pages:parsedPages}});
   while(url&&!seen.has(url)&&seen.size<100){seen.add(url);const html=await readHtml(url),page=asicsNewPage(html,url,{at});total??=Number(html.match(/Showing \d+ of (\d+)/)?.[1]);products.push(...page.products);excluded.push(...page.excluded);
    parsedPages++;
    for(const candidate of page.missing){const detailHtml=await readHtml(candidate.url),title=detailHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g,'').trim();const color=detailHtml.match(/"color"\s*:\s*"([^"]+)"/)?.[1]||'';const row=asicsNewDetail(candidate,{html,metadata:{sourceURL:url}},{html:detailHtml,markdown:title?'# '+title+'\nColor\n'+color:'',metadata:{statusCode:200,description:title}},{at});if(row)products.push(row);else missing.push(candidate);}
    url=html.match(/<a[^>]*data-test="plp-load-more"[^>]*href="([^"]*)"/)?.[1]?.replaceAll('&amp;','&');
   }
   if(!total||products.length+excluded.length+missing.length!==total)throw Error('ASICS New pagination incomplete');result={checkedAt:at,products,excluded,missing,coverage:{total,read:products.length+excluded.length+missing.length,pages:seen.size}};
  }else if(brand==='adidas'){
   const pages=[],seen=new Set();let start=0,total;
   validatedResult=()=>({products:pages.flatMap(p=>p.products),coverage:{total:total??null,read:seen.size,pages:pages.length}});
   do{const url='https://www.adidas.com/us/shoes-new_arrivals?sort=newest-to-oldest'+(start?'&start='+start:'');const page=adidasNewPage(await readHtml(url),url,{at});total??=page.total;pages.push(page);for(const row of [...page.products,...page.excluded])seen.add(row.style);start+=48;}while(start<total&&pages.length<100);
   if(seen.size!==total)throw Error('adidas source changed or New pagination incomplete');result={checkedAt:at,products:pages.flatMap(p=>p.products),excluded:pages.flatMap(p=>p.excluded),coverage:{total,read:seen.size,pages:pages.length}};
  }else if(brand==='Converse'){
   const products=[],excluded=[],missing=[],seen=new Set();let url='https://www.converse.com/shop/new-arrivals/f/shoes?srule=Newest-to-Oldest&start=0&sz=21',total;
   let parsedPages=0;validatedResult=()=>({products:[...new Map(products.map(p=>[p.style,p])).values()],coverage:{total:total??null,read:new Set([...products,...excluded,...missing].map(p=>p.style)).size,pages:parsedPages}});
   while(url&&!seen.has(url)&&seen.size<100){seen.add(url);const page=converseNewPage(await readHtml(url),url,{at});total??=page.total;products.push(...page.products);excluded.push(...page.excluded);missing.push(...page.missing);parsedPages++;url=page.next?new URL(page.next,url).href:null;}
   const unique=new Set([...products,...excluded,...missing].map(p=>p.style));
   if(!total||unique.size!==total)throw Error('Converse New pagination incomplete');
   result={checkedAt:at,products:[...new Map(products.map(p=>[p.style,p])).values()],excluded,missing,coverage:{total,read:unique.size,pages:seen.size}};
  }else{
   const pages=[];
   validatedResult=()=>({products:[...new Map(pages.flatMap(p=>p.products).map(p=>[p.style,p])).values()],coverage:{pages:pages.length,sources:pages.map(p=>({...p.coverage}))}});
   for(const gender of ['women','men']){const sourceUrl='https://www.newbalance.com/'+gender+'/featured/new-arrivals/',html=await readHtml(sourceUrl),settingsText=html.match(/var algoliaData = (\{[^\n]*\});/)?.[1],categoryId=html.match(/algoliaData.cgid = "([^"]+)"/)?.[1];if(!settingsText||!categoryId)throw Error('New Balance public catalog configuration unavailable');const settings=JSON.parse(settingsText),params=new URLSearchParams({filters:`categoryPageId:"${categoryId}" AND NOT onlineFrom > ${Math.floor(now.getTime()/1000)}`,hitsPerPage:'1000',page:'0',ruleContexts:JSON.stringify(['category']),clickAnalytics:'false'});
    const data=await json('https://'+settings.applicationID+'-dsn.algolia.net/1/indexes/*/queries',{method:'POST',headers:{'Content-Type':'application/json','X-Algolia-Application-Id':settings.applicationID,'X-Algolia-API-Key':settings.searchApiKey,Origin:'https://www.newbalance.com',Referer:'https://www.newbalance.com/'},body:JSON.stringify({requests:[{indexName:settings.productsIndex,params:params.toString()}]})});pages.push(newBalanceNewRecords(data,{sourceUrl,categoryId,at}));}
   result={checkedAt:at,products:[...new Map(pages.flatMap(p=>p.products).map(p=>[p.style,p])).values()],excluded:pages.flatMap(p=>p.excluded),missing:pages.flatMap(p=>p.missing),coverage:pages.map(p=>p.coverage)};
  }
  outputs[brand]=result;onProgress({brand,products:result.products.length});
 }catch(e){
  // Only parser-returned rows are recoverable; never salvage a failed parse or
  // infer a total from the number of products retained. Keep strict mode atomic.
  const partial=allowPartial===true&&/\b403\b|pagination incomplete|source changed/.test(e.message)?validatedResult?.():null;
  if(partial?.products.length){
   const error={brand,error:e.message,status:'partial'};
   // A source-reported count is not proof of complete coverage after failure.
   // Keep it separately so consumers cannot infer completion from total===read.
   outputs[brand]={...partial,checkedAt:at,status:'partial',errors:[error],coverage:{...partial.coverage,reportedTotal:partial.coverage.total??null,total:null,exhaustive:false,status:'partial',errors:[e.message]}};
   errors.push(error);onProgress({brand,products:partial.products.length,error:e.message,status:'partial'});
  }else{errors.push({brand,error:e.message});onProgress({brand,error:e.message});}
 }}
 return {outputs,errors,checkedAt:at};
}
