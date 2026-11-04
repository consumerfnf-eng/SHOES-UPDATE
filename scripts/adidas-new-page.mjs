import {createHash} from 'node:crypto';
export function adidasNewPage(html,url,{at=new Date().toISOString()}={}){
 const data=html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];if(!data)throw Error('adidas original New page data missing');
 const page=JSON.parse(data).props.pageProps;if(new URL(url).hostname!=='www.adidas.com'||page.taxonomy!=='shoes-new_arrivals'||!Array.isArray(page.products))throw Error('Wrong adidas New shoes source');
 const hash=createHash('sha256').update(html).digest('hex'),products=[],excluded=[];
 for(const row of page.products){
  const {id:style,title:name}=row;if(/\b(?:kids?|infants?|children|youth|junior|toddler|preschool)\b/i.test(row.subTitle)||/\b(?:boots?|cleats?)\b/i.test(name)||/Football|Rugby|Baseball/i.test(row.category)){excluded.push({style,name,reason:'kids-or-cleats'});continue;}
  const image=new URL(row.image);if(image.hostname!=='assets.adidas.com'||!image.pathname.includes('_'+style+'_')||new URL(row.url).hostname!=='www.adidas.com')throw Error('adidas SKU image binding missing '+style);
  image.pathname=image.pathname.replace(/w_\d+,h_\d+/,'w_1000,h_1000');const price=row.priceData?.prices?.find(p=>p.type==='sale')||row.priceData?.prices?.[0];const color=image.pathname.match(new RegExp('_([^_]+)_'+style+'_'))?.[1]||'';
  const proof={verified:true,brand:'adidas',style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:hash};
  products.push({id:'adidas-new-'+style,brand:'adidas',name,style,manufacturerStyle:style,modelGroupId:'adidas|'+row.modelNumber,url:row.url,image:image.href,sourceImageUrl:row.image,officialCategory:row.category+' Sneakers',category:'sneaker',productType:'sneaker',description:name+' — '+row.subTitle,colorway:/white|black|grey|gray|pink|blue|green|beige|brown|yellow|orange|red|purple|silver|gold|navy/i.test(color)?color:'',colors:[],gender:row.subTitle?.split(' ')[0]||'Unisex',country:'US',priceLabel:price?'USD '+price.value:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:url,sourceSignals:[],arrivalEvidence:{verified:true,brand:'adidas',style,productUrl:row.url,kind:'new-arrivals-listing',url,verifiedAt:at,contentHash:hash,excerpt:name},officialProductEvidence:{...proof,url:row.url},officialImageEvidence:{...proof,url:image.href,sourceUrl:url}});
 }
 return {products,excluded,total:page.info.count,read:page.products.length,start:page.info.startIndex,url};
}
