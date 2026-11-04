import {createHash} from 'node:crypto';
export function columbiaNewPage(html,url,{at=new Date().toISOString()}={}){
 if(new URL(url).hostname!=='www.columbiakorea.co.kr'||new URL(url).searchParams.get('cno')!=='350')throw Error('Official Columbia footwear source required');
 const products=[],excluded=[],tiles=[...html.matchAll(/<li class="goods [\s\S]*?<\/li>/g)],hash=createHash('sha256').update(html).digest('hex');
 for(const {0:block} of tiles){if(!block.includes('ProductTagImage/TAG_00_New_3.png'))continue;
  const name=block.match(/<p class="name _v2">([^<]+)/)?.[1],price=block.match(/<p class="sale">([\d,]+)원/)?.[1]?.replaceAll(',','');
  // Plain boots and winter/mid boots are not sneakers. Keep an explicit
  // sneaker or an adult low-cut athletic/hiking shoe from the footwear list.
  if(!name||/미드|부츠|샌들|슬리퍼|슬라이드|키즈|아동/.test(name)||!/스니커|픽프릭|크레스트우드|로우|러닝|하이크|하이킹/.test(name)){excluded.push({name,reason:'not-confirmed-adult-low-athletic-shoe'});continue;}
  const chips=[...block.matchAll(/<a\b[^>]*data-no=["'](\d+)["'][^>]*data-code=["']([^"']+)["'][^>]*data-img=["']([^"']+)["'][^>]*>/g)];
  const group=block.match(/data-code="([^"]+)"/)?.[1];
  for(const [,pno,style,asset] of chips){if(!asset.includes('/'+style+'.jpg'))continue;
   const productUrl='https://www.columbiakorea.co.kr/product/view.asp?pno='+pno,image=new URL(asset,'https://www.columbiakorea.co.kr').href;
   const proof={verified:true,brand:'COLUMBIA',style,verifiedAt:at,verificationMethod:'official-new-listing-sku-image',contentHash:hash};
   products.push({id:'columbia-new-'+style,brand:'COLUMBIA',name,style,manufacturerStyle:style,modelGroupId:'columbia|'+group,url:productUrl,image,officialCategory:'스니커즈 / 신발',category:'sneaker',productType:'sneaker',description:name+' · 공식 신발 카테고리 New 배지 확인',country:'KR',gender:/여성/.test(name)?'Women':/남성/.test(name)?'Men':'Unisex',colorway:'',colors:[],priceLabel:price?'KRW '+price:'',firstSeen:at,productVerifiedAt:at,productEvidenceUrl:url,sourceSignals:[],arrivalEvidence:{...proof,productUrl,kind:'new-badge',url,excerpt:name+' · New'},officialProductEvidence:{...proof,url:productUrl},officialImageEvidence:{...proof,url:image,sourceUrl:url}});
  }
 }
 return {products:[...new Map(products.map(p=>[p.style,p])).values()],excluded,styles:tiles.map(m=>m[0].match(/data-code="([^"]+)"/)?.[1]).filter(Boolean),read:tiles.length,total:Number(html.match(/data-tot="(\d+)"/)?.[1])||null};
}
