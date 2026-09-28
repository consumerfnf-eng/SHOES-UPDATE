import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isOfficialProductUrl,canonicalUrl} from './curation.mjs';
import {nikeProductDetails} from './official-feeds.mjs';
import {newBalanceProductDetails} from './new-balance-feed.mjs';
import {productDetails} from './collect-evidence.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const decode=x=>String(x||'').replaceAll('&amp;','&').replaceAll('&#x2F;','/').replaceAll('\\/','/');
const hash=x=>createHash('sha256').update(x).digest('hex');
const samePage=(a,b)=>{try{const x=new URL(a),y=new URL(b);return x.origin===y.origin&&decodeURIComponent(x.pathname).replace(/\/$/,'')===decodeURIComponent(y.pathname).replace(/\/$/,'');}catch{return false;}};
function canonicalMatches(product,url){
  if(samePage(url,product.url))return true;
  try{const a=new URL(url),b=new URL(product.url);if(a.origin!==b.origin)return false;
    if(product.brand==='Salomon'&&b.pathname.endsWith('/'+product.style))return a.pathname===b.pathname.slice(0,-product.style.length-1);
    if(product.brand==='PUMA')return a.pathname.split('/').slice(0,4).join('/')===b.pathname.split('/').slice(0,4).join('/')&&a.pathname.split('/').pop()===product.style.split('_')[0]&&b.pathname.split('/').pop()===product.style.split('_')[0];
  }catch{}return false;
}
const sameImage=(a,b)=>{try{const x=new URL(decode(a)),y=new URL(decode(b));if(x.origin!==y.origin)return false;const asset=u=>u.hostname==='images.puma.com'&&u.pathname.includes('/global/')?u.pathname.slice(u.pathname.indexOf('/global/')):u.pathname;return asset(x)===asset(y);}catch{return false;}};
function documentUrl(text){return decode(text.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1]||text.match(/<meta\b[^>]*property=["']og:url["'][^>]*content=["']([^"']+)/i)?.[1]);}
const productNodes=value=>!value||typeof value!=='object'?[]:[...(['Product','ProductGroup'].includes(value['@type'])?[value]:[]),...Object.values(value).flatMap(v=>Array.isArray(v)?v.flatMap(productNodes):productNodes(v))];
export function verifyOfficialPage(product,text,{sourceUrl=product.url,format='html'}={}){
  if(!isOfficialProductUrl(product.brand,sourceUrl)||!samePage(sourceUrl,product.url)||!product.style||!product.image)return null;
  if(format==='html'){
    const canonical=documentUrl(text);if(!canonical||!canonicalMatches(product,canonical))return null;
    if(['Nike','Jordan'].includes(product.brand))try{const p=nikeProductDetails(text,product);if(p&&p.style===product.style&&sameImage(p.image,product.image))return {method:'official-nike-structured-sku-image'};}catch{}
    const nodes=[...text.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m=>{try{return productNodes(JSON.parse(m[1]));}catch{return [];}});
    if(product.brand==='Converse'&&new URL(sourceUrl).hostname==='palmes.co'){
      const group=nodes.find(n=>n['@type']==='ProductGroup'&&norm(n.name)===norm(product.name)&&n.brand?.name==='Converse');
      const variant=group?.hasVariant?.find(v=>sameImage(v.image,product.image));
      if(variant&&product.dateEvidence?.verified===true&&product.dateEvidence.excerpt.includes(product.style))return {method:'official-partner-exact-name-color-image-with-reviewed-style',matchedName:group.name,publisherStyle:variant.sku,externalStyleEvidence:{verified:true,url:product.dateEvidence.url,style:product.style,verifiedAt:product.dateEvidence.verifiedAt}};
    }
    for(const node of nodes){
      const images=[node.image].flat().filter(Boolean).map(i=>typeof i==='object'?i.url:i);
      if(!images.some(i=>sameImage(i,product.image)))continue;
      const sku=norm(node.sku||node.productID||node.mpn),style=norm(product.style);
      const exact=sku===style||sku.startsWith(style)&&/^[0-9]{2,4}$/.test(sku.slice(style.length));
      const puma=product.brand==='PUMA'&&norm(node.model)===norm(product.style.split('_')[0])&&images.some(i=>sameImage(i,product.image)&&i.includes('/'+product.style.replace('_','/')+'/'));
      if(exact||puma)return {method:'official-product-jsonld-sku-image'};
    }
    // Salomon's primary product assets carry the exact full SKU. Require the current
    // main heading plus the same SKU and image in the main product block.
    if(product.brand==='Salomon'){
      const h1=text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,' ')||'';
      const body=text.split(/(?:You may also|Recommended products|Recently viewed)/i)[0];
      const images=decode(body).match(/https:\/\/cdn\.dam\.salomon\.com\/[^"\s<>]+/g)||[];
      if(norm(h1)===norm(product.name)&&body.includes(product.style)&&images.some(i=>sameImage(i,product.image))&&product.image.includes('/'+product.style+'/'))return {method:'official-salomon-main-sku-image'};
    }
  }else{
    const source=text.match(/^URL Source:\s*(.+)$/m)?.[1]?.trim();if(!source||!samePage(source,product.url))return null;
    const candidate={...product,productVerifiedAt:undefined,image:''};
    const details=product.brand==='New Balance'?newBalanceProductDetails(text,candidate):productDetails(text,candidate);
    if(details&&(!details.style||details.style===product.style)&&sameImage(details.image,product.image))return {method:'official-reader-main-sku-image'};
  }
  return null;
}
async function auditPages(directory){
  const folder=path.join(directory,'logs/research'),pages=[];
  for(const base of [folder,path.join(folder,'official-image-audit')])for(const name of await fs.readdir(base).catch(()=>[]))if(/\.(?:html|txt)$/.test(name)){
    const file=path.join(base,name),text=await fs.readFile(file,'utf8'),url=documentUrl(text)||text.match(/^URL Source:\s*(.+)$/m)?.[1]?.trim();if(url)pages.push({file,text,url,format:name.endsWith('.html')?'html':'markdown'});
  }
  return pages;
}
async function nbAudit(product,directory){
  try{
    const folder=path.join(directory,'logs/research'),rows=JSON.parse(await fs.readFile(path.join(folder,'nb-pages-web.json'),'utf8')),images=JSON.parse(await fs.readFile(path.join(folder,'nb-image-urls.json'),'utf8'));
    const i=rows.findIndex(r=>samePage(r.url,product.url));if(i<0||!sameImage(images[i],product.image))return null;
    const r=rows[i],text=r.text,style=product.style;
    if(!text.includes(`Style #: ${style}`)||!text.includes(`†Image: ${product.name}, ${style}†nb.scene7.com`)||!text.includes(`cite${r.imageLink}†Image:`))return null;
    // These saved primary-page and followed-image-link outputs were captured together.
    // Their exact item name, style and image index must all agree; no data/catalog fields are proof.
    return {method:'saved-official-nb-page-and-image-link',text:text+'\n'+images[i],file:path.join(folder,'nb-pages-web.json')};
  }catch{return null;}
}
export async function verifyOfficialProducts({directory=root,now=new Date(),fetcher=fetch,network=true,products}={}){
  products??=JSON.parse(await fs.readFile(path.join(directory,'public/data/catalog.json'),'utf8')).products;
  const checkedAt=new Date(now).toISOString(),audits=await auditPages(directory),patches=[],diagnostics=[],folder=path.join(directory,'logs/research/official-image-audit');await fs.mkdir(folder,{recursive:true});
  let next=0,readerNextAt=0;
  async function read(url,reader){
    if(reader){const wait=Math.max(0,readerNextAt-Date.now());readerNextAt=Math.max(Date.now(),readerNextAt)+2000;if(wait)await new Promise(r=>setTimeout(r,wait));}
    const response=await fetcher(reader?'https://r.jina.ai/'+url:url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'ShoesResearch/1.0 public-product-verification'}});
    if(!response.ok)throw Error(`HTTP ${response.status}`);const text=await response.text();if(text.length>10000000)throw Error('Page exceeds read limit');
    if(!reader&&!samePage(response.url||url,url))throw Error('Product redirected to another page');
    const file=path.join(folder,hash(url+(reader?'reader':'direct')).slice(0,20)+(reader?'.txt':'.html'));await fs.writeFile(file,text);return {text,file,url,format:reader?'markdown':'html'};
  }
  async function worker(){while(next<products.length){const product=products[next++];let proof,page;
    if(!isOfficialProductUrl(product.brand,product.url)){diagnostics.push({id:product.id,brand:product.brand,status:'held',reason:'Official domain not approved'});continue;}
    if(product.brand==='New Balance'){const a=await nbAudit(product,directory);if(a){proof=a;page=a;}}
    if(!proof)for(const a of audits.filter(a=>canonicalMatches(product,a.url))){const p=verifyOfficialPage(product,a.text,{sourceUrl:product.url,format:a.format});if(p){proof=p;page=a;break;}}
    const failures=[];
    if(!proof&&network)for(const reader of [false,true])try{const a=await read(product.url,reader),p=verifyOfficialPage(product,a.text,{sourceUrl:product.url,format:a.format});if(p){proof=p;page=a;break;}failures.push(`${reader?'reader':'direct'}: exact current SKU/image not matched`);}catch(e){failures.push(`${reader?'reader':'direct'}: ${e.message}`);}
    if(proof){const base={verified:true,brand:product.brand,style:product.style,verifiedAt:checkedAt,verificationMethod:proof.method,contentHash:hash(page.text)};
      patches.push({id:product.id,brand:product.brand,style:product.style,officialProductEvidence:{...base,url:product.url,...(proof.externalStyleEvidence?{matchedName:proof.matchedName,publisherStyle:proof.publisherStyle,externalStyleEvidence:proof.externalStyleEvidence}:{})},officialImageEvidence:{...base,url:product.image,sourceUrl:product.url}});
      diagnostics.push({id:product.id,brand:product.brand,status:'verified',method:proof.method,auditFile:path.relative(directory,page.file).replaceAll('\\','/')});
    }else diagnostics.push({id:product.id,brand:product.brand,status:'held',url:product.url,reason:failures.join('; ')||'No matching saved official evidence'});
    if((patches.length+diagnostics.filter(d=>d.status==='held').length)%10===0)console.log(`Official item proof: ${diagnostics.length}/${products.length}; verified ${patches.length}.`);
  }}
  await Promise.all([worker(),worker(),worker()]);
  const result={schemaVersion:1,checkedAt,attempted:products.length,verified:patches.length,products:patches.sort((a,b)=>a.id.localeCompare(b.id)),diagnostics};
  await fs.writeFile(path.join(directory,'logs/research/official-image-refresh.json'),JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)verifyOfficialProducts({network:!process.argv.includes('--audit-only')}).then(r=>console.log(JSON.stringify({attempted:r.attempted,verified:r.verified,byBrand:Object.fromEntries([...new Set(r.diagnostics.map(d=>d.brand))].map(b=>[b,{attempted:r.diagnostics.filter(d=>d.brand===b).length,verified:r.diagnostics.filter(d=>d.brand===b&&d.status==='verified').length}]))}))).catch(e=>{console.error(e.message);process.exitCode=1;});
