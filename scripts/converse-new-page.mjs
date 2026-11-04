import {createHash} from 'node:crypto';
const decode=s=>String(s||'').replaceAll('&amp;','&').replaceAll('&#39;',"'").replaceAll('&quot;','"');
export function converseNewPage(html,url,{at=new Date().toISOString()}={}){
 if(new URL(url).hostname!=='www.converse.com'||!url.includes('/new-arrivals/'))throw Error('Official Converse New shoes source required');
 const starts=[...html.matchAll(/<div\b[^>]*class="product-tile\s[^"]*"[^>]*data-testid="product-tile-([^"]*)"[^>]*>/g)],hash=createHash('sha256').update(html).digest('hex'),products=[],excluded=[],missing=[];
 for(let i=0;i<starts.length;i++){
  const m=starts[i],block=html.slice(m.index,starts[i+1]?.index||html.length),name=decode(block.match(/class="product-tile__name">\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1]).trim(),productUrl=decode(block.match(/class="product-tile__img-url" href="([^"]+)"/)?.[1]);
  if(!name||!productUrl){missing.push({style:m[1],reason:'product-name-url'});continue;}
  const style=m[1]||new URL(productUrl).searchParams.get('styleNo')||new URL(productUrl).pathname.split('/').at(-1).replace(/\.html$/,'');
  if(/\b(?:kids?|infant|toddler|baby|youth|boots?|slippers?|sandals?|slides?)\b/i.test(name+' '+productUrl)){excluded.push({style,name,reason:'kids-or-non-sneaker'});continue;}
  const isCustom=/Converse By You|Custom/i.test(name);
  const primary=block.match(/<picture[^>]*product-tile__img--main--picture-element[^>]*>([\s\S]*?)<\/picture>/)?.[1]||'';
  const primaryAlt=decode(primary.match(/alt="([^"]+)"/)?.[1]);
  const imageText=[...block.matchAll(/(?:data-srcset|data-src|src)="(https:[^"]+)"/g)].map(m=>decode(m[1])).find(image=>{try{return new URL(image).hostname==='www.converse.com'&&((image.includes(style+'_A_')||/F$/.test(style)&&image.includes(style.slice(0,-1)+'C_A_'))||isCustom&&/\/images\/a_08\//.test(image));}catch{return false;}})||((primaryAlt.toLowerCase().startsWith(name.toLowerCase()))?decode(primary.match(/data-srcset="(https:[^"]+\/images\/a_08\/[^"]+)"/)?.[1]):'');
  if(!imageText){missing.push({style,name,url:productUrl,reason:'SKU-side-image'});continue;}
  const image=new URL(imageText);image.searchParams.set('sw','1000');const alt=decode(block.match(/class="[^"]*product-tile__img--main[^"]*"[^>]*alt="([^"]*)"/)?.[1]),color=alt.toLowerCase().startsWith(name.toLowerCase())?alt.slice(name.length).trim():'',price=block.match(/product-price--sales[^>]*>\s*\$([\d.]+)/)?.[1],master=m[0].match(/data-item-id="([^"]+)"/)?.[1],proof={verified:true,brand:'Converse',style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:hash};
  products.push({id:'converse-new-'+style,sourceTileBinding:{verified:true,style,url:productUrl,image:image.href,contentHash:hash},brand:'Converse',name,style,manufacturerStyle:style,modelGroupId:'converse|'+(master||name.toLowerCase().replace(/[^a-z0-9]/g,'')),url:productUrl,image:image.href,officialCategory:'Sneakers',category:'sneaker',productType:'sneaker',description:name+' sneaker',colorway:color,colors:color?[color]:[],country:'US',gender:/\bWomens?\b/i.test(name)?'Women':'Unisex',priceLabel:price?'USD '+price:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:url,sourceSignals:[],arrivalEvidence:{verified:true,brand:'Converse',style,productUrl,kind:'new-arrivals-listing',url,verifiedAt:at,contentHash:hash,excerpt:name},officialProductEvidence:{...proof,url:productUrl},officialImageEvidence:{...proof,url:image.href,sourceUrl:url}});
 }
 return {products,excluded,missing,total:Number(html.match(/data-testid="plp-results-count">\s*(\d+)/)?.[1])||null,read:starts.length,next:decode(html.match(/data-page-url="([^"]+)"/)?.[1]),url};
}
