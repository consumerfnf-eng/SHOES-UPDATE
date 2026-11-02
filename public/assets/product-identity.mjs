// Model, material/colour variant and retailer listing are different identities.
// In particular, SSENSE's season/brand/category prefix is never a model code.
export const identityFold = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const titleCase = value => value.replace(/\b[a-z]/g, c=>c.toUpperCase());
function boundDesignReview(p){const r=p.designReview;return r?.verified===true&&r.brand===p.brand&&r.style===p.style&&r.url===p.url&&r.image===p.image?r:null;}
function productSlug(p) {
  try {
    const segments=decodeURIComponent(new URL(p.url).pathname).split('/').filter(Boolean);
    let slug=segments.at(-1).replace(/\.html$/,'');
    if(p.brand==='Loewe')slug=segments.at(-2);
    return titleCase(slug.replace(/-(?:S\d{2}[A-Z]{2}\d{4}|(?:OW|OM|OF|LABF)\w*\d)[A-Z0-9]*$/i,'').replaceAll('-',' '));
  } catch { return ''; }
}
export function reviewedDesignName(p) {
  if(boundDesignReview(p)?.modelName)return p.designReview.modelName;
  let name=String(p.name||p.modelName||'').trim();
  if(p.brand==='Chanel') {
    const ref=String(p.url||'').match(/\/p\/(G\d{5})[A-Z0-9]+\//i)?.[1];
    return ref ? `Sneakers ${ref.toUpperCase()}` : '';
  }
  if(p.brand==='Maison Margiela' && /maisonmargiela\.com/.test(p.url||''))name=productSlug(p);
  if(p.brand==='Loewe' && /loewe\.com/.test(p.url||''))name=productSlug(p).replace(/\s+in\s+.+$/i,'');
  if(p.brand==='Off-White' && /off---white\.com/.test(p.url||''))name=productSlug(p);
  if(p.brand==='Dior')return name.replace(/^(?:Dioriviera|DiorAlps)\s+/i,'').match(/^(.+?\b(?:sneakers?|trainers?))\b/i)?.[1]||'';
  if(['Prada','Miu Miu'].includes(p.brand)) {
    const model=name.match(/\b(?:New Balance\s+[xX]\s+Miu Miu\s+530\s+SL(?:\s+Deco['’]?)?|Downtown\s+Bold|Downtown|Court|Collapse|Speedrock|America[’']?s?\s+Cup|Montecarlo|Praxis|Plume|Tyre|Bubble|Gymnasium)\b/i)?.[0];
    if(model)return model+(/\bhigh[ -]top\b/i.test(name)?' High-Top':'')+(/\bhooks\b/i.test(name)?' With Hooks':'');
  }
  if(p.brand==='Valentino Garavani') {
    const model=name.match(/\b(?:One Stud XL|One Stud|Open Royco|Rockstud Untitled|Rockrunner(?:\s+Camouflage)?|Rockstud|Stud Up|Stud One|Freedots|Demivee|Amphibia|VL7N|Open|V-?Light|V-?Logo|V-?Pace)\b/i)?.[0];
    if(model)return model+(/\bhigh[ -]top\b/i.test(name)?' High-Top':'')+' Sneakers';
  }
  if(p.brand==='Celine'&&/[;|]/.test(name))return name.replace(/\s*[;|]\s*.+$/,'');
  if(p.brand==='Golden Goose') {
    const code=String(p.url||'').match(/-cod-(G[MW]F\d{5})\./i)?.[1];
    if(code){
      if(/G[MW]F(?:00115|00116|00211)/i.test(code))return 'Slide High-Top Sneakers';
      const model=(name+' '+(p.officialCategory||'')).match(/(?:Marathon\s*Speed|Super[ -]?Star(?:\s+Ski)?|Ball[ -]?Star(?:\s+Pro)?|Mid[ -]?Star|Stardan(?:\s+LTD)?|True[ -]?Star|Lightstar|마라톤\s*스피드|슈퍼스타|볼스타|스타단(?:\s*LTD)?)/i)?.[0]||'Sneakers';
      const translated={'마라톤스피드':'Marathon Speed','슈퍼스타':'Super-Star','볼스타':'Ball Star','스타단':'Stardan','스타단ltd':'Stardan'}[identityFold(model)];
      if(model!=='Sneakers')return translated||model.replace(/\s+LTD$/i,'');
      return `${model} ${code.replace(/^G[MW]F/i,'F')}`;
    }
  }
  if(p.brand==='Autry')return name.replace(/\s+IN\s+.+$/i,'').replace(/\s+COLOR\s+.+$/i,'');
  if(p.brand==='PANE')return name.replace(/\s+(?:Men|Women)['’]s\b.*$/i,'').replace(/\s+Shoes\b.*$/i,'');
  if(p.brand==='Maison Mihara Yasuhiro') {
    const model=name.match(/["“']([^"”']+)["”']/)?.[1];
    if(model) {
      const sole=/hybrid sole/i.test(name)?'Hybrid Sole':/OG/i.test(name)?'OG Sole':/PAST Sole/i.test(name)?'PAST Sole':/Vulcanize/i.test(name)?'Vulcanize':'';
      const height=name.match(/\b(low[ _-]top|high[ _-]top|mid[ _-]top)\b/i)?.[1]?.replace(/[ _]/g,'-')||'';
      const structure=[...name.matchAll(/\b(platform|wedge|slip-on|mule|loafer|ballet|zip-up)\b/gi)].map(m=>m[1]);
      const partner=name.match(/^(.+?\s+x\s+MMY)\s/i)?.[1]||'';
      const decoration=name.match(/\b(?:studded|embellished)\b/i)?.[0]||'';
      return [partner,model,sole,decoration,...structure,height,'Sneakers'].filter(Boolean).join(' ');
    }
  }
  if(p.brand==='AMIRI') {
    const core=name.split(/\s+[—–-]\s+/)[0];
    return core.replace(/^(?:CRYSTAL|METALLIC)\s+(?=(?:MA[ -]?1|MA SKYLINE|M-TECH)\b)/i,'');
  }
  if(p.brand==='Common Projects') {
    if(/\bAchilles\b/i.test(name)&&!(/\bPremium\b/i.test(name)))return /\bhigh[ -]?top\b/i.test(name)||/\/high-top-sneakers\//.test(p.url||'')?'Original Achilles High-Top Sneakers':'Original Achilles Low Sneakers';
    const model=name.match(/\b(?:Achilles Premium|Premium Skate|Premium Runner|Minimal Runner Seventy|Minimal Runner|Winter Driving|Driving Shoe|Minimal Racer|Retro Classic|BBall Duo|BBall|Piuma|Deck|Tennis Low(?: Top)?)\b/i)?.[0];
    if(model)return model+' Sneakers';
  }
  if(p.brand==='Zegna') {
    const model=name.match(/\b(?:Triple Stitch[™®]?(?:\s+(?:Monte|Vetta))?|232)\b/i)?.[0];
    if(model)return model.replace(/[™®]/g,'')+' Sneakers';
  }
  if(p.brand==='Loro Piana')return name.match(/^(.+?\bSneakers?)\b/i)?.[1]?.replace(/^(?:The Gift of Kings[®]?\s+)/i,'')||'';
  if(p.brand==='Brunello Cucinelli') {
    // The house has unnamed designs described only as "suede sneakers".
    // Their exact factory design, not that generic description, is the card.
    const factory=String(p.style||'').match(/^\d{3}([A-Z0-9]+)C[A-Z0-9]{4}$/)?.[1];
    return factory?`Sneakers ${factory}`:'';
  }
  if(p.brand==='Fendi') {
    const model=name.match(/\bFendi\s+(?:Wave Pulse|Fender|Flow|Force|Match|Wrap)\b/i)?.[0];
    return model?model+(/\bmules?\b/i.test(name)?' Mules':' Sneakers'):name.replace(/\bTrainers?\b/i,'Sneakers');
  }
  if(p.brand==='Lanvin') {
    const model=name.match(/\b(?:High[ -]Top\s+Curb|DBB1\s+Zip|Glen\s+2\.0|New Soccer Lace Up|New Lace Up|Curb|Clay|DBB1|Glen|BUMPR|LNV2|JLA)\b/i)?.[0];
    return model?model+' Sneakers':name.replace(/^Sneakers\s+/i,'').replace(/^&\s*Off[ -]White\s+/i,'');
  }
  if(p.brand==='Off-White') {
    const model=name.match(/\b(?:Be Right Back Trail Low|Be Right Back|End Of Play|Out Of Office|L\/AB Tape Vulcanized)\b/i)?.[0];
    if(model){const line=/Out Of Office/i.test(model)?name.match(/\b(?:Molded|Chunky Varsity|Miles Davis)\b/i)?.[0]||'':'';return [model,line,'Sneakers'].filter(Boolean).join(' ');}
  }
  if(p.brand==='Axel Arigato') {
    if(/\bClean 90\b/i.test(name))return 'Clean 90 Sneaker';
    name=name.replace(/\s+new arrival\b.*$/i,'');
    const half=name.match(/^(.+?(?:Sneaker|Runner))\s+\1\b/i);
    return (half?half[1]:name).replace(/\bSuede\s+(?=Runner\b)/i,'');
  }
  return name!==String(p.modelName||p.name||'').trim()?name:'';
}
export function manufacturerCode(p) {
  if(boundDesignReview(p)?.physicalVariantId)return 'reviewed-variant|'+p.designReview.physicalVariantId;
  if(p.productVariantId)return 'official-variant|'+String(p.productVariantId).normalize('NFC').trim().toLowerCase();
  if(p.styleType==='retailer-product-id'||/^\d{6}[MFU]\d{6}$/.test(p.style||''))return '';
  const raw=p.manufacturerStyle||p.style||'';
  if(p.brand==='Balenciaga') {
    const full=String(raw).match(/\b((?:\d{6}|A[A-Z0-9]{5})W[A-Z0-9]{7,12})\b/i)?.[1];
    if(full)return identityFold(full);
  }
  if(p.brand==='Autry'&&/^([A-Z]{3})[MW](-[A-Z0-9]{4}(?:-\d{4}\.\d_\d{4})?)$/i.test(raw))return identityFold(raw.replace(/^([A-Z]{3})[MW](-)/i,'$1U$2'));
  if(p.brand==='Golden Goose')return identityFold(String(p.url||'').match(/-cod-(G[MW]F\d{5}\.[A-Z0-9]+\.[A-Z0-9]+)\.html/i)?.[1]||raw);
  // Several legacy collectors saved a descriptive slug as style.
  const tail=String(raw).match(/(?:^|-)(S\d{2}[A-Z]{2}\d{4}[A-Z0-9]+)$/i)?.[1];
  const code=tail||raw;
  return /\d/.test(code)?identityFold(code):'';
}
export function samePhysicalVariant(a,b) {
  if(identityFold(a.brand)!==identityFold(b.brand))return '';
  const ac=manufacturerCode(a),bc=manufacturerCode(b);
  if(ac&&bc&&ac===bc)return 'exact-manufacturer-code';
  const ap=a.presentation?.cachedPath||a.image,bp=b.presentation?.cachedPath||b.image;
  if(ap&&ap===bp)return 'exact-product-photo';
  return '';
}
export function preferOfficialVariants(products, audit=[]) {
  const official=products.filter(p=>!p.overlay);
  return products.filter(p=>{
    if(!p.overlay||!String(p.source).startsWith('retail-'))return true;
    const match=official.find(o=>samePhysicalVariant(o,p));
    if(!match)return true;
    audit.push({id:p.id,officialId:match.id,reason:samePhysicalVariant(match,p)});
    return false;
  });
}
