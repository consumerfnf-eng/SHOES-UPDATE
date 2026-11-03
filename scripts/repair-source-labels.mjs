import {reviewedDesignName} from '../public/assets/product-identity.mjs';
export function repairSourceLabels(raw){
 const p={...raw};
 if(p.brand==='K-SWISS'){
  const source=[p.name,p.sourceName].find(s=>/^(\d{5}-\d{3}-[MW])\s*\|\s*/i.test(s||'')),prefix=source?.match(/^(\d{5}-\d{3}-[MW])\s*\|\s*/i);
  if(prefix){
   p.sourceName??=p.name;p.manufacturerStyle=prefix[1].toUpperCase();p.productVariantId=p.manufacturerStyle;
   const parts=source.slice(prefix[0].length).split(/\s*\|\s*/);p.name=parts.shift().trim();p.modelName=p.name;
   if(parts.length){p.colorway=parts.join(' / ');p.colors=[p.colorway];p.colorEvidence={method:'official-title-field',url:p.url,label:p.colorway};}
   p.modelGroupId='kswiss|'+p.name.toLowerCase().replace(/[^a-z0-9]+/g,'');
  }
 }
 if(p.brand==='Alo'&&p.officialProductEvidence?.verified===true){
  try{const u=new URL(p.url),code=u.pathname.match(/\/products\/(a\d{4}u)-/i)?.[1];if(/(?:^|\.)aloyoga\.com$/.test(u.hostname)&&code)p.modelGroupId='alo|'+code.toUpperCase();}catch{}
 }
 const label=p.sourceLabelReview;
 if(label?.verified===true&&label.brand===p.brand&&label.style===p.style&&label.url===p.url&&label.image===p.image){
   p.name=label.name;
   if(label.colorway){p.colorway=label.colorway;p.colorEvidence={method:'official-product-attribute',url:label.url,label:label.colorway,reviewed:true};}
 }
 if(p.brand==='On'){
   try{const u=new URL(p.url);if(/(?:^|\.)on\.com$/i.test(u.hostname)&&u.pathname.includes('/products/')){
     const model=reviewedDesignName(p),leaf=u.pathname.split('/').filter(Boolean).at(-1);
     const colour=leaf.match(/^(.+?)-shoes?-[a-z0-9]+$/i)?.[1]?.replaceAll('-',' ');
     if(colour)p.colorway=colour;
     if(model){p.modelName=model;p.name=model+(colour?' - '+colour:'');}
   }}catch{}
 }
 if(p.brand==='AMIRI')p.name=String(p.name||'').replace(/^(?:women|men)(?:['’]s)?\s*[—–-]\s*/i,'');
 if(p.brand==='Dior')p.name=String(p.name||'').replace(/\$[\d,.]+\s*$/,'').replace(/(Sneakers?)(?=[A-Z])/g,'$1 ').trim();
 if(p.brand==='Alexander McQueen'&&p.officialImageEvidence?.verified===true){
   try{
     const asset=decodeURIComponent(new URL(p.image).pathname).split('/').at(-1).replace(/^(?:Small|Medium|Large|Thumbnail)-/i,'');
     const full=asset.match(/^([A-Z0-9]{6}W[A-Z0-9]{8})_[A-Z]/i)?.[1];
     if(full&&/^[A-Z0-9]{6}W[A-Z0-9]{4}$/i.test(p.style||'')&&full.toUpperCase().startsWith(p.style.toUpperCase())){
       p.manufacturerStyle=full.toUpperCase();
       p.manufacturerStyleEvidence={verified:true,method:'exact-official-product-image-code',url:p.image,code:p.manufacturerStyle};
     }
   }catch{}
 }
 if(p.brand==='Rick Owens'&&p.officialProductEvidence?.verified===true){
   const description=String(p.description||'');
   const colour=description.match(/\bCOLOU?R:\s*(.*?)\s*(?:MATERIAL:|UPPER\b|$)/i)?.[1]?.trim();
   const header=description.split(/\bTHESE\b/i)[0].match(/\bIN\s+(.+)$/i)?.[1];
   if(colour&&colour.length<100){
     p.colorway=colour;
     p.colorEvidence={method:'official-product-attribute',url:p.url,label:colour};
     if(header?.startsWith(colour))p.material=header.slice(colour.length).trim();
   }
 }
 if(p.brand==='Converse'){
   p.name=String(p.name||'').replace(/!\[(?:Image\s*\d+:\s*)?([^\]]+)\]\([^)]*\)/gi,'$1').replace(/^Image\s*\d+:\s*/i,'').trim();
   try{p.name=decodeURIComponent(p.name);}catch{}
 }
 if(p.brand==='Under Armour'){
   const colour=String(p.colorway||'').match(/^(.+?)\s*-\s*\d{3}\s*(?:\(|!?\[|$)/)?.[1]?.trim();
   if(colour){p.colorway=colour;p.colorEvidence={method:'official-product-attribute',url:p.url,label:colour};}
 }
 try{
   const number=new URL(p.url).searchParams.get('product_no');
   if(number&&p.styleType==='official-product-id'&&p.style==='detail'){
     p.style=number;p.productVariantId=number;
     if(p.arrivalEvidence)p.arrivalEvidence={...p.arrivalEvidence,style:number};
     for(const field of ['officialProductEvidence','officialImageEvidence'])if(p[field])p[field]={...p[field],style:number,identifierType:'official-product-id'};
   }
 }catch{}
 return p;
}
