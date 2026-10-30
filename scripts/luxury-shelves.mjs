// A maison's shop is not a New section, and for most of them there is no New
// section to find.
//
// Saint Laurent does not keep one: ysl.com carries the collection it is
// selling now, and a shoe leaves the site when the season does. The same is
// true of Zegna, whose /us-en/new-in/ is fifteen pages of campaign imagery
// with one "Sneakers" link out of it, and of Loro Piana and Brunello
// Cucinelli, whose only reachable page is the home page. Reading those shops
// for cards carrying a NEW badge reads them for something they never print,
// which is why eleven maisons reported zero shoes a week while selling them.
//
// So the question is asked the other way round: does this shop show only what
// it currently sells? If it does, its sneaker shelf *is* its new arrivals and
// every shoe on it is collected. If that cannot be established - the shop has
// an outlet, an archive, a past-season section - the shelf is read newest
// first instead, and the three-month publication window decides the rest,
// with the release date taken from the retail index rather than from a page
// the brand never dated.
//
// The determination is made by scripts/classify-luxury-shelf.mjs, which
// records where it read it and what it saw. Nothing here guesses: a brand
// with no determination keeps the behaviour it had.

/** The maisons this rule covers.
 *
 *  Not `group === 'luxury'`: Chanel, Fendi, Givenchy, Valentino, McQueen,
 *  Margiela, Rick Owens, Jil Sander, Lanvin, AMIRI and Off-White are filed as
 *  contemporary in the brand policy - that grouping is about where a shoe sits
 *  on the page - but their shops behave exactly like the luxury group's and
 *  every one of them returned zero shoes for the same reason.
 */
export const LUXURY_MAISONS=new Set(['Louis Vuitton','Miu Miu','Prada','Gucci','Dior','Balenciaga','Celine',
  'Saint Laurent','Hermès','Moncler','Bottega Veneta','Loewe','The Row','Loro Piana','Brunello Cucinelli','Zegna',
  'Chanel','Fendi','Givenchy','Valentino Garavani','Alexander McQueen','Maison Margiela','Rick Owens','Jil Sander',
  'Lanvin','AMIRI','Off-White']);

export function isLuxuryMaison(brand){return LUXURY_MAISONS.has(brand);}

/** Words a shop uses for the parts of itself that are not this season. */
export const ARCHIVE_MARKERS=/\b(?:outlet|clearance|final sale|last chance|past season|previous season|archive sale|pre[- ]?owned|second ?hand|vintage|end of season)\b|아웃렛|이전 시즌|아카이브 세일/i;
/** Words a shop puts on the control that sorts its shelf newest first. */
export const LATEST_MARKERS=/\b(?:newest|latest|new in|new arrivals?|most recent|recently added|newest first|date[, ]?new(?:est)? to old)\b|최신|신상품순|신상순|新着/i;

/** The sneaker shelves a shop offers, from the links on a page it served.
 *
 *  A shelf is a category, so the shelf word has to be the *last* thing in the
 *  path - /us-en/shoes/sneakers/, not /us-en/p/triple-stitch-sneaker/ABC.html
 *  and not /us-en/shoes/sneakers/care-guide. Matching the word anywhere found
 *  235 "shelves" on zegna.com and 125 on maisonmargiela.com, nearly all of
 *  them individual shoes, which would have spent the whole page budget on
 *  sixteen arbitrary products.
 */
const SHELF_WORD=/^(?:sneakers?|trainers?|footwear|shoes|스니커즈|신발|슈즈|calzature|scarpe|chaussures|baskets|zapatillas|靴|スニーカー)$/i;
const NOT_SHELF=/\b(?:care|guide|size|sizing|repair|story|heritage|gift|service|appointment|how-to|faq)\b/i;
/** A store's locale segment, where its paths begin with one. */
const LOCALE_SEGMENT=/^(?:[a-z]{2}[-_][a-z]{2}|[a-z]{2})$/i;
const localeOf=pathname=>{const first=pathname.split('/').filter(Boolean)[0]||'';return LOCALE_SEGMENT.test(first)?first.toLowerCase():'';};

export function sneakerShelfLinks(links,{origin,pageUrl='',limit=6}){
  // Every maison runs the same shelf in thirty countries and links them all
  // from its locale switcher. zegna.com offered at-de, at-en, au-en, au-zh,
  // be-en and be-fr before us-en, which is the page we were reading: eight
  // shelves, none of them the one in front of us. Keep the locale we are
  // reading in when there is one.
  let wanted='';try{wanted=localeOf(new URL(pageUrl).pathname);}catch{}
  const seen=new Map();
  for(const l of links){
    if(l.image)continue;
    let u;try{u=new URL(l.url);}catch{continue;}
    if(u.origin!==origin)continue;
    // A fragment is the same shelf scrolled to its grid, and a query string is
    // the same shelf paginated or re-sorted - ?page=2, ?pageNumber=1&sort=featured,
    // ?LABSNEAKERSMAN=1. The collection follows a shelf's own pagination
    // (listingFollowups), and the newest-first ordering is recorded separately
    // in `latest`, so the shelf itself is the bare path.
    u.hash='';u.search='';
    const path=decodeURIComponent(u.pathname).replace(/\/+$/,'');
    if(NOT_SHELF.test(path))continue;
    const last=path.split('/').pop()||'';
    // Shopify and Salesforce collections name the shelf in the last segment
    // with a gender or season in front of it: /collections/women-sneakers,
    // /ca/shop-women/shoes/sneakers.
    const tail=last.split('-').pop()||'';
    if(!SHELF_WORD.test(last)&&!SHELF_WORD.test(tail))continue;
    if(!seen.has(path))seen.set(path,u.href);
  }
  let entries=[...seen.entries()];
  if(wanted){
    const own=entries.filter(([path])=>localeOf(path)===wanted);
    if(own.length)entries=own;
  }
  // Sneaker shelves before the broader shoe shelves: this catalogue is about
  // sneakers, and a shop's whole shoe department is nine parts heels.
  return entries
    .sort((a,b)=>Number(/sneaker|trainer|스니커/i.test(b[0]))-Number(/sneaker|trainer|스니커/i.test(a[0]))||a[0].localeCompare(b[0]))
    .slice(0,limit).map(([,href])=>href);
}

/** The shelf URL that sorts newest first, where the page offers one. */
export function latestSortUrl(links,shelfUrl){
  let base;try{base=new URL(shelfUrl);}catch{return '';}
  for(const l of links){
    if(l.image||!LATEST_MARKERS.test(l.label))continue;
    let u;try{u=new URL(l.url,shelfUrl);}catch{continue;}
    // Same shelf, differently ordered - not a different shelf that happens to
    // be called "New In".
    if(u.origin===base.origin&&u.pathname===base.pathname&&u.search&&u.search!==base.search)return u.href;
  }
  return '';
}

/** The source entries a maison's shelf determination adds to the collection.
 *
 *  `catalogue` takes every shoe on the shelf. `catalogue-latest` takes the
 *  same shelf read newest first and leaves the dating to the publication
 *  window. A brand with no determination adds nothing.
 */
export function luxuryShelfSources(brand,record){
  if(!record||!isLuxuryMaison(brand))return [];
  const basis=record.basis==='current-season-only'?'catalogue':'catalogue-latest';
  const shelves=record.basis==='current-season-only'?record.shelves||[]
    :(record.shelves||[]).map(url=>record.latest?.[url]||url);
  return [...new Set(shelves)].map(url=>({url,name:`${brand} Official sneaker shelf (${basis})`,basis,
    ...(record.evidence?{shelfEvidence:record.evidence}:{})}));
}

/** The collection's sources with every maison's determined shelf folded in. */
export function withLuxuryShelves(sources,basisFile={}){
  const out={...sources};
  for(const [brand,record] of Object.entries(basisFile.brands||{})){
    const extra=luxuryShelfSources(brand,record);
    if(!extra.length)continue;
    const have=new Set((out[brand]||[]).map(s=>s.url));
    out[brand]=[...(out[brand]||[]),...extra.filter(s=>!have.has(s.url))];
  }
  return out;
}
