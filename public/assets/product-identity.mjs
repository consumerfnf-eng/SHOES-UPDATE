// Model, material/colour variant and retailer listing are different identities.
// In particular, SSENSE's season/brand/category prefix is never a model code.
export const identityFold = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
// identityFold decomposes Hangul into Jamo, so a composed Korean key written
// in this file never matches it. A lookup keyed on Korean words folds this way.
const wordFold = value => String(value || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
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
/** The design slot of a Rick Owens SKU: line, design, material, colour. */
const rickOwensDesign = style => String(style||'').match(/^[A-Z]{2}\d{2}(F\d{4})_[A-Z0-9]+_[A-Z0-9]+$/i)?.[1]?.toUpperCase()||'';
// Colour words that stand at the end of a 23.65 title. Shade modifiers and
// pattern words (DOTTY, 도트) are deliberately absent: "FEROA 플리플랍 DOTTY
// BLACK" is the dotted FEROA in black, and the dots are the design.
const SHOP_COLOR_WORD=/^(?:black|white|offwhite|ivory|cream|beige|brown|chocolate|mocha|charcoal|grey|gray|navy|blue|green|olive|khaki|red|burgundy|wine|pink|purple|violet|yellow|orange|gold|silver|tan|camel|sand|taupe|stone|mint|coral|chacoal|블랙|검정|화이트|흰색|아이보리|크림|베이지|브라운|초콜릿|초콜렛|모카|차콜|그레이|회색|네이비|블루|파랑|그린|초록|올리브|카키|레드|빨강|버건디|와인|핑크|퍼플|보라|옐로우|노랑|오렌지|골드|실버|탄|카멜|샌드|토프|민트)$/i;
// 23.65 publishes its catalogue through a shop template that appends the
// image's alt text after a dash - "스니커즈 BLACK - 블랙 컬러가 돋보이는
// 스니커즈 제품" - repeats the model name as the colourway's name, and sells
// the same model again as a "1+1" bundle. Each spelling was its own card.
// The title is split once, into the model it names and the colour it ends in.
function shopTitleParts(brand, value) {
  if(brand!=='23.65')return {model:'',color:''};
  let base=String(value||'').split(/\s+[-–—]\s+/)[0]
    .replace(/^23\.65\s+/,'')
    .replace(/\s*\b1\s*\+\s*1\b(?:\s*프로모션)?/gi,' ')
    // "DONKEY MULE 스니커즈 -BEIGE" hangs the colour off a bare dash.
    .replace(/\s+[-–—](?=\S)/g,' ')
    .replace(/\s{2,}/g,' ').trim();
  const words=base.split(/\s+/).filter(Boolean),color=[];
  while(words.length>1&&SHOP_COLOR_WORD.test(words.at(-1)))color.unshift(words.pop());
  // "23.65 너티 모카신 너티 베이지" names the colourway after the model, so a
  // trailing repeat of the model's first word belongs to the colour.
  while(words.length>1&&words.at(-1).toLowerCase()===words[0].toLowerCase())color.unshift(words.pop());
  let model=words.join(' ');
  // The house writes the category on either side of the model ("스니커즈 V",
  // "V 스니커즈"), and 29CM drops it entirely ("메리노" for "메리노 슈즈").
  // It is the category, so it is not what tells two of its shoes apart.
  // 모카신, 플리플랍 and 슬립온 are silhouettes and stay.
  model=model.replace(/^(스니커즈|스니커|슈즈|운동화)\s+(\S.*)$/,'$2 $1');
  const bare=model.replace(/\s*(?:스니커즈|스니커|슈즈|운동화)$/,'').trim();
  return {model:bare||model,color:color.join(' ')};
}
/** A colour a shop wrote only into the title, for the houses whose titles
 *  were read for it. No other brand's name is mined for a colour. */
export function titleColorLabel(p) {
  return shopTitleParts(p?.brand,p?.name||'').color;
}
export function reviewedDesignName(p) {
  if(boundDesignReview(p)?.modelName)return p.designReview.modelName;
  let name=String(p.name||p.modelName||'').trim();
  if(p.brand==='On') {
    try {
      const u=new URL(p.url),segments=u.pathname.split('/').filter(Boolean),at=segments.indexOf('products');
      if(/(?:^|\.)on\.com$/i.test(u.hostname)&&at>=0&&segments[at+1]) {
        let model=segments[at+1].replace(/-\d[a-z]{2}\d{3,5}$/i,'');
        if(/^(?:mens|womens|unisex)$/.test(segments[at+2]||''))model=model.replace(/-(?:m|w|u)$/i,'');
        return titleCase(model.replaceAll('-',' '));
      }
    }catch{}
  }
  if(p.brand==='23.65') {
    const core=name.match(/\b(?:AROA|CORE|V2|V3|V4|V5|V6|SORD|RECOVERY|MOZZI|MULTI)\b/i)?.[0];
    if(core)return core.toUpperCase()+' '+(/slip[ -]?on|슬립온/i.test(name)?'Slip-On':'Sneakers');
    const read=shopTitleParts(p.brand,name);
    if(read.model)return read.model;
  }
  if(p.brand==='Rick Owens') {
    // rickowens.eu titles a listing with its own SKU: "DS02F6800_BMC_911 |
    // SNEAKS". The slots are line, design, material and colour, and the words
    // after the bar are the house's name for the design. Thirteen of the
    // fifteen listings that share design, material and colour across the DS02
    // and DU02 lines are the same photograph and the same photoHash, so the
    // four leading characters are the line and the F-number is the design the
    // card stands for. Every one of the 50 F-numbers carries exactly one of
    // the 30 names, so neither is guessed at from the other.
    const design=rickOwensDesign(p.manufacturerStyle||p.style);
    const label=String(p.name||'').match(/\|\s*(\S.*?)\s*$/)?.[1];
    if(design&&label)return titleCase(label.toLowerCase().replace(/[®™]/g,'').replace(/\s+/g,' ').trim())+' '+design;
  }
  if(p.brand==='Gucci'&&/^(?:men|women)(?:['’]s)?$/i.test(name)) {
    // Three listings reach the collector named only "Men's". The house's own
    // product slug says which shoe it is.
    const slug=productSlug({...p,brand:'Gucci'}).replace(/\s+P\s+[A-Z0-9]+$/i,'').replace(/^(?:Mens?|Womens?)\s+/i,'');
    if(slug.replace(/[^\p{L}]+/gu,'').length>=3)return slug;
  }
  if(p.brand==='Louis Vuitton') {
    try{const segments=decodeURIComponent(new URL(p.url).pathname).split('/').filter(Boolean);const model=segments.find(s=>/-nvprod\d+v$/i.test(s));if(model)return titleCase(model.replace(/-nvprod\d+v$/i,'').replaceAll('-',' '));}catch{}
  }
  if(p.brand==='Tory Burch')return name.split(/\s+-\s+/)[0];
  if(p.brand==='Celine')return name.split(/\s+-\s+|\s*[;|]\s*/)[0].replace(/\s+in\s+.+$/i,'');
  if(p.brand==='Converse') {
    try{let slug=new URL(p.url).pathname.match(/\/shop\/p\/([^/]+)/)?.[1];if(slug)return titleCase(slug.replaceAll('-',' '));}catch{}
  }
  if(p.brand==='Burberry') {
    const core=name.match(/\b(?:Knight Runner|Harrow|Eclipse|Matrix|Terrace|Set|Union|Regis)\b/i)?.[0];
    if(core)return core+' Sneakers';
    if(/\bcheck\b/i.test(name))return 'Check Sneakers '+String(p.style||'');
  }
  if(p.brand==='Versace') {
    const core=name.match(/\b(?:Greca Court|La Greca|Biggie Basket|Trigreca|Odissea|Mercury|Galaxia|Goliath|Icaro|Greca)\b/i)?.[0];
    if(core)return core+(/\bplatform\b/i.test(name)?' Platform':'')+' Sneakers';
  }
  if(p.brand==='Balmain') {
    const core=name.match(/\b(?:Racing Mid[ -]Top|Racing Low|Racer 45|B-Court|B-East|B-Bold|Unicorn|Swan)\b/i)?.[0];
    if(core)return core+(/\btennis\b/i.test(name)?' Tennis':'')+' Sneakers';
  }
  if(p.brand==='Coach') {
    try{const slug=decodeURIComponent(new URL(p.url).pathname).split('/products/')[1]?.split('/')[0];const model=slug?.match(/^(.+?\b(?:sneakers?|runner))\b/i)?.[1];if(model)return titleCase(model.replaceAll('-',' '));}catch{}
  }
  if(p.brand==='Bally') {
    const model=name.match(/^([A-Za-z]{3,})(?:\s*-\s*[A-Za-z]+)*\s*-\s*Sneakers?$/i)?.[1];
    if(model&&!/^(?:Low|High|Men|Women|Leather|Bally|Lace|Slip)$/i.test(model)){
      // Sonney court and runner constructions are different, despite the shared name.
      if(/^Sonney$/i.test(model))return 'Sonney '+(/Sonney-B/i.test(name)?'Court':'Runner')+' Sneakers';
      if(/^Roget$/i.test(model)&&/\/quest-msk0ez/i.test(p.url||''))return 'Quest Sneakers';
      return titleCase(model)+' Sneakers';
    }
  }
  if(p.brand==='Christian Louboutin') {
    if(/\bLouis Junior\b/i.test(name)&&!/Canopy/i.test(name))return 'Louis Junior '+(/high[ -]top/i.test(name)?'High-Top ':'')+'Sneakers';
    const core=name.match(/\b(?:Bsktball 1 Retro|Bsktball 1 Perla|Bsktball 1|Chambelisneak|Eleonora Flex|Eleonora|F\.A\.V(?: Fique A Vontade)?|Loubishark|Louis Jr(?: Spikes)? Canopy|Mara Open|Mara|Retero|Seavaste 2|SK VI|So Flo Uomo|So Flo(?: Perla)?|St Louis CL|St Louis|Tactical Skate|TCT Hiker|The Butterfly|Trailnrun)\b/i)?.[0];
    if(core)return core.replace(/ Spikes| Perla(?=\s*$)/gi,m=>/^So Flo/i.test(core)?'':m).replace(/Louis Jr(?: Spikes)? Canopy/i,'Louis Jr Canopy')+(/high[ -]top/i.test(name)?' High-Top':'')+' Sneakers';
  }
  if(p.brand==='Jimmy Choo') {
    try{
      let model=decodeURIComponent(new URL(p.url).pathname).split('/').filter(Boolean).at(-2);
      const terms={'다이아몬드':'Diamond','라이트':'Light','맥시':'Maxi','플렉스':'Flex','레트로':'Retro','써니':'Sunny','뮬':'Mule','런':'Run','하이탑':'High-Top','벨레스':'Veles','플로렌트':'Florent'};
      for(const [ko,en] of Object.entries(terms))model=model.replaceAll(ko,en);
      model=model.replace(/-(?:m|f)(?=-|$)/gi,'').replaceAll('-',' ');
      if(/^(?:Diamond|Sunny|Veles|Florent)\b/i.test(model))return titleCase(model)+' Sneakers';
    }catch{}
  }
  if(p.brand==='Ferragamo') {
    try{const model=decodeURIComponent(new URL(p.url).pathname).split('/').at(-1).match(/^(.+)-\d{6}--\d+$/)?.[1];if(model)return titleCase(model.replaceAll('-',' '))+' Sneakers';}catch{}
  }
  if(p.brand==='MCM') {
    const core=name.match(/^(.+?\bSneakers?)\b/i)?.[1];
    if(core)return core;
    if(/^Skywander Lo\b/i.test(name))return 'Skywander Lo Sneakers';
  }
  if(p.brand==='Kenzo') {
    const model=name.match(/['“]([^'”]+)['”]/)?.[1];
    if(model)return model+(/high[ -]?top/i.test(name)?' High-Top':/low[ -]?top/i.test(name)?' Low-Top':/slip[ -]?on/i.test(name)?' Slip-On':'')+' Sneakers';
  }
  if(p.brand==='Stella McCartney'&&/^Sneak[ -]?Elyse/i.test(name))return 'Sneak Elyse Trainers';
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
    if(!/[a-z]/i.test(name)){try{name=decodeURIComponent(new URL(p.url).pathname).split('/').at(-1).replace(/^product-/,'').replace(/-[A-Z0-9]+_[A-Z0-9]+$/,'').replaceAll('-',' ');}catch{}}
    const model=name.match(/\b(?:One Stud XL|One Stud|Open Royco|Rockstud Untitled|Rockrunner(?:\s+Camouflage)?|Rockstud|Stud Up|Stud One|Freedots|Demivee|Amphibia|VL7N|Open|V-?Light|V-?Logo|V-?Pace)\b/i)?.[0];
    if(model)return model+(/\bhigh[ -]top\b/i.test(name)?' High-Top':'')+' Sneakers';
  }
  if(p.brand==='Celine'&&/[;|]/.test(name))return name.replace(/\s*[;|]\s*.+$/,'');
  if(p.brand==='Golden Goose') {
    const code=String(p.url||'').match(/-cod-(G[MW]F\d{5})\./i)?.[1];
    if(code){
      if(/G[MW]F(?:00115|00116|00211)/i.test(code))return 'Slide High-Top Sneakers';
      const model=(name+' '+(p.officialCategory||'')).match(/(?:Marathon\s*Speed|Marathon|Super[ -]?Star(?:\s+Ski)?|Ball[ -]?Star(?:\s+Pro)?|Mid[ -]?Star(?:\s+Ski)?|Dad[ -]?Star|Running\s*Sole|Old\s*School|Pure[ -]?Star|Stardan(?:\s+LTD)?|True[ -]?Star|Lightstar|마라톤\s*스피드|마라톤|슈퍼[ -]?스타(?:\s*스키)?|미드[ -]?스타(?:\s*스키)?|대드[ -]?스타|(?:런닝|러닝)솔|올드스쿨|퓨어스타|볼스타|스타단(?:\s*LTD)?)/i)?.[0]||'Sneakers';
      const translated={'마라톤스피드':'Marathon Speed','마라톤':'Marathon','슈퍼스타':'Super-Star','슈퍼스타스키':'Super-Star Ski','미드스타':'Mid Star','미드스타스키':'Mid Star Ski','대드스타':'Dad Star','런닝솔':'Running Sole','러닝솔':'Running Sole','올드스쿨':'Old School','퓨어스타':'Purestar','볼스타':'Ball Star','스타단':'Stardan','스타단ltd':'Stardan'}[wordFold(model)];
      // "볼스타" is the family, not the shoe: nine article codes reached one
      // card under it, among them GMF00916 and GMF00804, whose uppers are
      // built differently. Without a design review to say which of them are
      // one shoe, the house's own article number is what the card stands for,
      // exactly as the unnamed designs below already do. The M/W letter is
      // the size run and is dropped, so a men's and a women's listing of one
      // article meet on one card.
      const design=code.replace(/^G[MW]F/i,'F');
      if(model!=='Sneakers')return `${translated||model.replace(/\s+LTD$/i,'')} ${design}`;
      return `${model} ${design}`;
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
    const core=name.replace(/^(?:women|men)(?:['’]s)?\s*[—–-]\s*/i,'').split(/\s+[—–-]\s+/)[0];
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
// A number the shop carries in its own query string is where the listing sits
// in the shop's table, not the house's article number: 23.65 reaches the
// collector as ?product_no=1854, and reading that as a factory variant drew
// one chip per listing for a model sold in three colours. Only an all-digit
// code is judged this way - Ferragamo's 784502 and Burberry's item codes are
// all digits too, but their own URLs do not echo them - and the test is the
// product's own URL, so nothing is assumed about the shop.
function shopListingPointer(p, code) {
  const value=String(code||'').trim();
  if(!/^\d+$/.test(value))return false;
  try { for(const held of new URL(p.url).searchParams.values())if(held===value)return true; } catch {}
  return false;
}
export function manufacturerCode(p) {
  if(boundDesignReview(p)?.physicalVariantId)return 'reviewed-variant|'+p.designReview.physicalVariantId;
  // These shops publish a model-level article and select its physical colour
  // in the PDP URL. Tracking/category parameters never identify a variant.
  const colourParameter={'The North Face':'color',PUMA:'swatch',Crocs:'cid',Lululemon:'color'}[p.brand];
  if(colourParameter||p.brand==='Under Armour'){
    try{
      const params=new URL(p.url).searchParams;
      const colour=colourParameter?params.get(colourParameter):[...params].find(([key])=>/^dwvar_.+_color$/i.test(key))?.[1];
      if(colour&&p.style)return identityFold(p.manufacturerStyle||p.style)+'|colour|'+identityFold(colour);
    }catch{}
  }
  const listedStyle=p.manufacturerStyle||p.style||'';
  if(p.productVariantId&&!shopListingPointer(p,p.productVariantId)&&(/^\d+$/.test(p.productVariantId)||identityFold(p.productVariantId)!==identityFold(listedStyle)))return 'official-variant|'+String(p.productVariantId).normalize('NFC').trim().toLowerCase();
  if(p.styleType==='retailer-product-id'||/^\d{6}[MFU]\d{6}$/.test(p.style||''))return '';
  const raw=p.manufacturerStyle||p.style||'';
  if(p.brand==='Balenciaga') {
    const full=String(raw).match(/\b((?:\d{6}|A[A-Z0-9]{5})W[A-Z0-9]{7,12})\b/i)?.[1];
    if(full)return identityFold(full);
  }
  if(p.brand==='Autry'&&/^([A-Z]{3})[MW](-[A-Z0-9]{4}(?:-\d{4}\.\d_\d{4})?)$/i.test(raw))return identityFold(raw.replace(/^([A-Z]{3})[MW](-)/i,'$1U$2'));
  if(p.brand==='Golden Goose') {
    const full=String(p.url||'').match(/-cod-(G[MW]F\d{5}\.[A-Z0-9]+\.[A-Z0-9]+)\.html/i)?.[1]||raw;
    // GMF00117.F005821.10361 and GWF00117.F005821.10361 state the same
    // article, the same material and the same colour; only the size run
    // differs, so they are one colourway and one chip. A different material
    // or colour slot keeps them apart, as it should.
    return identityFold(String(full).replace(/^G[MW]F/i,'GUF'));
  }
  if(p.brand==='Rick Owens') {
    // The DS02 and DU02 lines of one design/material/colour are the same
    // photograph in 13 of the 15 cases the catalogue holds.
    const variant=String(raw).match(/^[A-Z]{2}\d{2}(F\d{4}_[A-Z0-9]+_[A-Z0-9]+)$/i)?.[1];
    if(variant)return identityFold(variant);
  }
  // Several legacy collectors saved a descriptive slug as style.
  const tail=String(raw).match(/(?:^|-)(S\d{2}[A-Z]{2}\d{4}[A-Z0-9]+)$/i)?.[1];
  const code=tail||raw;
  if(shopListingPointer(p,code))return '';
  return /\d/.test(code)&&String(code).trim().length>=3?identityFold(code):'';
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
  const byCode=new Map(),byPhoto=new Map(),order=new Map();
  products.forEach((p,index)=>{if(p.overlay)return;order.set(p,index);const brand=identityFold(p.brand),code=manufacturerCode(p),photo=p.presentation?.cachedPath||p.image;if(code&&!byCode.has(brand+'|'+code))byCode.set(brand+'|'+code,p);if(photo&&!byPhoto.has(brand+'|'+photo))byPhoto.set(brand+'|'+photo,p);});
  return products.filter(p=>{
    if(!p.overlay||!String(p.source).startsWith('retail-'))return true;
    const brand=identityFold(p.brand),code=manufacturerCode(p),photo=p.presentation?.cachedPath||p.image;
    const matches=[code&&byCode.get(brand+'|'+code),photo&&byPhoto.get(brand+'|'+photo)].filter(Boolean);
    const match=matches.sort((a,b)=>order.get(a)-order.get(b))[0];
    if(!match)return true;
    audit.push({id:p.id,officialId:match.id,reason:samePhysicalVariant(match,p)});
    return false;
  });
}
