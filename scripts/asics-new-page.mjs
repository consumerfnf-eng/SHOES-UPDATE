import {createHash} from 'node:crypto';
const decode=s=>String(s||'').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&#39;',"'");
export function asicsNewDetail(candidate,listing,detail,{at=new Date().toISOString()}={}){
 const code=candidate.style.replace('-','_'),name=detail.markdown?.match(/^#\s+(.+)$/m)?.[1]?.trim(),url=candidate.url;
 if(!listing.html.includes('product-tile-link-ANA_'+candidate.style)||detail.metadata?.statusCode!==200||!name||!(new URL(url).pathname.replace(/[^a-z0-9]/gi,'').toLowerCase().includes(name.replace(/[^a-z0-9]/gi,'').toLowerCase())))return null;
 const observed=(detail.html.match(/https:\/\/images[.]asics[.]com\/is\/image\/asics\/[^"\s<>]+/g)||[]).find(image=>image.includes('/'+code+'_SL_LT_GLB'));
 if(!observed)return null;
 const image=new URL(decode(observed));image.search='wid=1000&hei=1000&fmt=webp';const sourceUrl=listing.metadata.sourceURL||listing.metadata.url,hash=createHash('sha256').update(listing.html).digest('hex'),style=candidate.style,color=detail.markdown.match(/\nColor\s*\n\s*([^\n]+)/)?.[1]?.trim()||'';
 const proof={verified:true,brand:'ASICS',style,verifiedAt:at,verificationMethod:'official-new-arrivals-and-product-page',contentHash:createHash('sha256').update(detail.html).digest('hex')};
 return {id:'asics-new-'+style,brand:'ASICS',name,style,manufacturerStyle:style,modelGroupId:'asics|'+name.toLowerCase().replace(/[^a-z0-9]/g,''),url,image:image.href,colorway:color,colors:color?[color]:[],officialCategory:'Sportstyle Shoes',category:'sneaker',productType:'sneaker',description:detail.metadata.description||name,country:'US',gender:'Unisex',priceLabel:detail.metadata['product:price:amount']?'USD '+detail.metadata['product:price:amount']:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:url,sourceSignals:[],arrivalEvidence:{verified:true,brand:'ASICS',style,productUrl:url,kind:'new-arrivals-listing',url:sourceUrl,verifiedAt:at,contentHash:hash,excerpt:name},officialProductEvidence:{...proof,url},officialImageEvidence:{...proof,url:image.href,sourceUrl:url}};
}
export function asicsNewPage(html,url,{at=new Date().toISOString()}={}){
 if(new URL(url).hostname!=='www.asics.com'||!url.includes('new-arrivals'))throw Error('Official ASICS New source required');
 const hash=createHash('sha256').update(html).digest('hex'),starts=[...html.matchAll(/<a\b[^>]*data-test="product-tile-link-([^"]+)"[^>]*>/g)],products=[],excluded=[],missing=[];
 for(let i=0;i<starts.length;i++){
  const m=starts[i],tag=m[0],block=html.slice(m.index,starts[i+1]?.index||html.length),style=m[1].replace(/^ANA_/,''),code=style.replace('-', '_'),productUrl=decode(tag.match(/href="([^"]+)"/)?.[1]);
  if(!/data-product-type="Shoes"/.test(tag)){excluded.push({style,reason:'non-shoe-source-type'});continue;}
  const swatches=[...block.matchAll(/<button\b([^>]*data-test="swatch"[^>]*)>([\s\S]*?)<\/button>/g)];
  const own=swatches.find(s=>/data-selected="true"/.test(s[1])&&s[2].includes('/'+code+'_'));
  const imageMatch=own?.[2].match(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/),title=decode(own?.[1].match(/(?:title|aria-label)="([^"]+)"/)?.[1]);
  const name=title?.replace(/,\s*[^,]+$/,'').trim();
  if(!imageMatch||!name){missing.push({style,url:productUrl,reason:'selected-SKU-image-not-bound'});continue;}
  if(/PRE-SCHOOL|GRADE SCHOOL|TODDLER|INFANT|KIDS|\bGS\b|\bPS\b/i.test(name+' '+block.slice(-500))||/^1204|^1014|^1104/.test(style)){excluded.push({style,name,reason:'kids-sizing'});continue;}
  const image=new URL(decode(imageMatch[1]));image.search='wid=1000&hei=1000&fmt=webp';
  const proof={verified:true,brand:'ASICS',style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:hash},color=decode(imageMatch[2]),price=tag.match(/data-unit-price="([^"]+)"/)?.[1];
  products.push({id:'asics-new-'+style,brand:'ASICS',name,style,manufacturerStyle:style,modelGroupId:'asics|'+name.toLowerCase().replace(/[^a-z0-9]/g,''),url:productUrl,image:image.href,officialCategory:'Sportstyle Shoes',category:'sneaker',productType:'sneaker',description:name+' Sportstyle sneakers',colorway:color,colors:[color],gender:tag.match(/data-product-gender="([^"]+)"/)?.[1]||'Unisex',country:'US',priceLabel:price?'USD '+price:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:url,sourceSignals:[],arrivalEvidence:{verified:true,brand:'ASICS',style,productUrl,kind:'new-arrivals-listing',url,verifiedAt:at,contentHash:hash,excerpt:name},officialProductEvidence:{...proof,url:productUrl},officialImageEvidence:{...proof,url:image.href,sourceUrl:url}});
 }
 return {products,excluded,missing,total:starts.length,url,hash};
}
