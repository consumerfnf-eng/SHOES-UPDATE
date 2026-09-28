import {exactDate,productDetails} from './collect-evidence.mjs';
import {validDay,httpUrl} from './curation.mjs';
export function nikeState(html) {const json=html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];if(!json)throw Error('Nike structured launch data missing');return JSON.parse(JSON.parse(json).props.pageProps.initialState);}
export function parseNikeLaunch(html,source,checkedAt) {
  const s=nikeState(html),p=s.product,rows=[];
  for(const [id,launch]of Object.entries(p.launchViews?.data?.items||{})) {
    const shoe=p.products?.data?.items[id],date=launch.startEntryDate?.slice(0,10);
    if(!shoe||shoe.productType!=='FOOTWEAR'||!validDay(date))continue;
    const thread=Object.values(p.threads?.data?.items||{}).find(t=>t.productId===id||t.productIds?.includes(id));if(!thread?.seo?.slug)continue;
    const url=`https://www.nike.com/launch/t/${thread.seo.slug}`;
    rows.push({id:`official-nike-${shoe.styleColor.toLowerCase()}`,brand:/jordan/i.test(shoe.title)?'Jordan':'Nike',name:shoe.title,style:shoe.styleColor,url,image:shoe.imageSrc,
      productType:'sneaker',officialCategory:shoe.subtitle,releaseDate:date,country:'US',gender:shoe.genders?.join('/'),priceLabel:`${shoe.currency} ${shoe.currentPrice}`,
      dateEvidence:{url:source,precision:'day',official:true,verified:true,verifiedAt:checkedAt,region:'US',field:'launchViews.startEntryDate',productId:id,excerpt:`${shoe.styleColor} official launch entry opens ${launch.startEntryDate}.`}});
  }
  return rows;
}
export function nikeProductDetails(html,candidate) {
  const s=nikeState(html),p=s.product.products.data.items,c=Object.values(p).find(p=>p.styleColor===candidate.style);
  const thread=Object.values(s.product.threads.data.items).find(t=>t.productId===c?.id||t.productIds?.includes(c?.id));
  const card=thread?.cards?.find(c=>c.actions?.some(a=>a.product?.styleColor===candidate.style));
  if(!c||!card||!card.description?.includes(candidate.style)||!httpUrl(c.imageSrc))return null;
  return {...candidate,name:c.title,image:c.imageSrc,description:card.description,colorway:card.title||'',productEvidenceUrl:candidate.url,productVerifiedAt:candidate.dateEvidence.verifiedAt};
}
const decode=s=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'");
export function parseAsicsCalendar(html,source,checkedAt) {
  const out=[];
  for(const m of html.matchAll(/<a\b[^>]*href="([^"]+\/p\/[^"?]+\.html)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const body=m[2],date=exactDate(body.replace(/<[^>]*>/g,' '));if(!date)continue;
    const name=body.match(/<strong>([\s\S]*?)<\/strong>/)?.[1]?.replace(/<[^>]*>/g,'').trim();if(!name)continue;
    const url=new URL(decode(m[1]),source).href,style=url.match(/ANA_([A-Z0-9-]+)/)?.[1];if(!style)continue;
    const image=decode(body.match(/<img[^>]*src="([^"]+)"/)?.[1]||'');
    out.push({id:`official-asics-${style.toLowerCase()}`,brand:'ASICS',name,style,url,image,productType:'sneaker',officialCategory:'Sportstyle sneakers',releaseDate:date,country:'US',dateEvidence:{url:source,precision:'day',official:true,verified:true,verifiedAt:checkedAt,region:'US',excerpt:`${name} (${style}), official launch ${date}.`}});
  }return out;
}
export async function collectStructuredFeeds({fetchHtml=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(`Source HTTP ${r.status}`);return r.text();},read,now=new Date()}) {
  const at=new Date(now).toISOString(),products=[],diagnostics=[];
  try {const source='https://www.nike.com/launch',rows=parseNikeLaunch(await fetchHtml(source),source,at);
    for(const p of rows){try{const full=nikeProductDetails(await fetchHtml(p.url),p);if(full)products.push(full);else diagnostics.push({id:p.id,reason:'Nike exact SKU not verified'});}catch(e){diagnostics.push({id:p.id,error:e.message});}}
  }catch(e){diagnostics.push({source:'Nike SNKRS',error:e.message});}
  try {const source='https://www.asics.com/us/en-us/releases/',rows=parseAsicsCalendar(await fetchHtml(source),source,at);
    for(const p of rows){try{const details=productDetails(await read(`https://r.jina.ai/${p.url}`),p);if(details)products.push({...p,...details,productVerifiedAt:at,productEvidenceUrl:p.url});else diagnostics.push({id:p.id,reason:'ASICS exact SKU/image not verified'});}catch(e){diagnostics.push({id:p.id,error:e.message});}}
  }catch(e){diagnostics.push({source:'ASICS releases',error:e.message});}
  return {products,diagnostics};
}
