import {reviewedOfficialType} from './official-type-review.mjs';
// Assemble the 2026-11-03 official expansion from the inventory already read.
//
// The two summaries in logs/20261103 are the whole of the input: one for the
// houses that serve a Shopify products.json feed, one for the houses whose own
// listing pages were rendered. Nothing here fetches anything - every fact in
// the output is read back out of those files, and every product carries the
// listing URL and the content hash of the page it was read from.
//
// Three things this file is careful about, because each of them has published
// a wrong card before:
//
//  1. A size is not a product. A Shopify store lists one shoe once per size,
//     so the only axis that splits a listing into separate products here is a
//     colour or material option. Sizes are collapsed.
//  2. A photograph belongs to the colour it shows. The image for a colour is
//     that colour's variant `featured_image`, or a product image the store
//     itself assigned to that colour's variants - never the first picture in
//     the gallery when the gallery holds several colourways.
//  3. A barcode is not a style code. Every row is identified by the store's
//     own product id plus the colour/material it was split on, declared as
//     `official-product-id`. A Shopify variant barcode is never passed off as
//     a manufacturer style.
//
// Run it with `node scripts/assemble-official-expansion.mjs`. Importing the
// module writes nothing.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {classifyFootwear, officialHybridReview, officialEvidenceFor,
        isOfficialProductUrl, inLatinOrHangul, kstDay, colorwayFromName} from './curation.mjs';
import {canonicalSiteBrand, isSiteBrandAllowed, siteBrandGroup, BRAND_GROUPS}
        from '../public/assets/brand-groups.mjs';

const root = new URL('../', import.meta.url);
const LOG_DIR = 'logs/20261103/';
const SHOPIFY_SUMMARY = LOG_DIR + 'shopify-inventory-summary.json';
const RENDERED_SUMMARY = LOG_DIR + 'nonshopify-inventory-summary.json';
export const OUTPUT_FILE = 'data/official-expansion-20261103.json';
export const BASIS = 'official-expansion-20261103';

const read = file => JSON.parse(fs.readFileSync(new URL(file, root), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
// logs/*-summary.json records Windows paths; the loader must take either.
const logPath = file => String(file || '').replaceAll('\\', '/');

const COLOUR_WORDS = new Set(Object.values(read('config/colour-words.json'))
  .flatMap(list => Array.isArray(list) ? list : []).map(word => String(word).toLowerCase()));
// Shades that only ever appear as a house's own variant word. Kept separate
// from the generated corpus so it is obvious which list a label came from.
const SHADE_MODIFIERS = new Set(['off','light','dark','dirty','pale','deep','antique','polished',
  'washed','soft','shiny','matte','bright','mid','true','cool','warm','jet','clear','multi','mix']);
const MATERIAL_WORDS = new Set(['leather','suede','nylon','nappa','canvas','mesh','velvet','satin',
  'denim','calfskin','lambskin','goatskin','buffalo','patent','shearling','neoprene','sequin',
  'ponyhair','croc','snake','rubber','knit','jersey','polido','fur','sheepskin','textured','metal']);

// Rows worth reviewing at all. The summaries already pre-selected candidates;
// this repeats the question against the whole feed so a pre-filter cannot
// quietly drop a shoe, and keeps apparel out of the review record.
const FOOTWEAR_HINT = /\b(?:sneakers?|trainers?|runners?|shoes?|footwear|boots?|booties|sandals?|slides?|clogs?|slippers?|loafers?|mules?|moccasins?|mocassins?|ballerinas?|ballet|brogues?|derby|derbies|oxfords?|pumps?|heels?|sabot|espadrilles?|slip-?on)\b|스니커|슈즈|신발|운동화|발레|나막신|샌들|부츠|로퍼|뮬|슬리퍼|레이스업/i;
// A shelf the shop itself files as clothing, jewellery or homeware is not a
// footwear shelf, whatever a garment happens to be called: Simone Rocha's
// Ballet Tutu Skirt and Lemaire's Heel Charms both reached the review on a
// footwear word in their names.
const NOT_FOOTWEAR_SHELF = /\b(?:skirts?|dress(?:es)?|tops?|t-?shirts?|shirts?|jackets?|coats?|outerwear|knitwear|trousers?|bottoms?|jeans?|denim|shorts?|bags?|accessor\w*|jewell?ery|hats?|caps?|socks?|belts?|wallets?|scarves|gloves|books?|homeware|furniture|eyewear|fragrance|beauty|blazer)\b/i;
const stripTags = value => String(value || '').replace(/<[^>]*>/g, ' ');
// A description's own lines, which is where a house puts its spec list. The
// block tags are the line breaks: Wales Bonner's "Mary-Jane Sneaker" is one
// <li> of three and the sentence either side of it is not part of it.
const bodyLines = value => String(value || '')
  .replace(/<\/(?:p|li|ul|ol|div|h[1-6]|tr|td|section)>|<br\s*\/?>/gi, '\n')
  .split(/[\n\r]+|(?<=[.!?])\s+/);
const decodeEntities = value => String(value || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const clean = value => decodeEntities(stripTags(value)).replace(/\s+/g, ' ').trim();
const slug = value => String(value || '').toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const words = value => clean(value).split(/[\s/&,|+()]+/).filter(Boolean);

/* ------------------------------------------------------------------ brands */

// The Toga shop serves three labels from one feed. Its own `vendor` field is
// the only statement of which, and the two the catalogue carries are
// registered site brands; TOGA, TOGA TOO and COLLABORATION are other lines
// and have no card to go to.
const VENDOR_LINES = {'TOGA PULLA': 'Toga Pulla', 'TOGA VIRILIS': 'Toga Virilis'};
// `TOGA PULLA SHOE` and `TOGA VIRILIS SHOE LOOK` are the same two labels with
// the shop's own shelf suffix on the end.
const vendorLine = vendor => String(vendor || '').trim().toUpperCase().replace(/\s+SHOE(?:\s+LOOK)?$/, '');

/** The site brand a row belongs to, or '' when the feed names a line the
 *  catalogue does not carry. The summary's brand wins when it is already a
 *  registered site brand - aliased through the site policy, so TOM FORD and
 *  Tom Ford are one house - and the shop's vendor field is read only when it
 *  is not, which is how one Toga feed becomes two brands. */
export function resolveBrand(summaryBrand, vendor) {
  const named = canonicalSiteBrand(summaryBrand);
  if (isSiteBrandAllowed(named)) return named;
  const line = canonicalSiteBrand(VENDOR_LINES[vendorLine(vendor)] || '');
  return isSiteBrandAllowed(line) ? line : '';
}

/* ------------------------------------------------- declared silhouette type */

// A sneaker is a sneaker because the house said so, in its own title, its own
// product type or its own description. "Runner" on its own, "trail shoe" and
// "marathon shoe" are shapes a reader recognises but they are not the house
// declaring a sneaker, and a silhouette that is only ever called a silhouette
// is not one either: Wales Bonner's adidas Gazelle Croc never uses the word
// anywhere in its listing. Those rows are reported as ambiguous, not
// published. "Running shoes" is included because the footwear classifier
// already reads it as sneaker structure, and Lemaire's Soft Runners are
// described with it where the same model's other season says "sneakers".
const SNEAKER_WORD = /\b(?:sneakers?|sneakerina|trainers?|running shoes?)\b|스니커|운동화|러닝화|트레이너/i;
// "Contrast sneaker laces" on a Dries Van Noten Oxford is a lace, not a
// declaration, and four Oxfords reached the review filed as sneakers on it.
const SNEAKER_PART = /\b(?:sneakers?|trainers?)[ -](?:laces?|charms?|chains?|socks?)\b/i;
// Shelf names that say nothing about the shape, so a sneaker word found in the
// title or the description may stand in for them.
const GENERIC_SHELF = /^(?:|shoes?|footwear|shoes? ?&? ?accessories|men's shoes|women's shoes|mens shoes|womens shoes|adidas|asics|crocs|new in)$/i;

/** Where the house declared a sneaker or trainer, with the words it used.
 *  Reads the product type first - that is the shop's own filing - then the
 *  primary title, then the short spec lines of the description, which is
 *  where Wales Bonner writes "Mary-Jane Sneaker" and Toga "low-tech
 *  sneakers". Long prose is read too, but only for the word itself. */
export function sneakerDeclaration({productType = '', title = '', body = ''} = {}) {
  const says = text => SNEAKER_WORD.test(String(text).replace(SNEAKER_PART, ' '));
  const type = clean(productType);
  if (says(type)) return {field: 'product_type', excerpt: type};
  const name = clean(title);
  if (says(name)) return {field: 'title', excerpt: name};
  for (const line of bodyLines(body)) {
    const text = clean(line);
    if (text && text.length <= 80 && says(text)) return {field: 'body_html', excerpt: text};
  }
  const prose = clean(body).replace(SNEAKER_PART, ' ');
  const hit = prose.match(/[^.!?]{0,60}(?:sneakers?|sneakerina|trainers?|running shoes?|스니커|운동화|러닝화|트레이너)[^.!?]{0,40}/i);
  return hit ? {field: 'body_html', excerpt: hit[0].trim()} : null;
}

// Footwear forms the catalogue was not asked for. Used only to sort a refused
// row into "out of scope" rather than "ambiguous", so the list that needs a
// human stays short - never to refuse a row, which the classifier does.
// A dress shoe, a heel or a boot: these the catalogue refuses outright, so
// naming one outranks any sneaker word beside it - a heeled sneaker is a heel.
const REFUSED_FORM = /\b(?:boots?|booties|heels?|heeled|pumps?|stilettos?|slingbacks?|brogues?|derby|derbies|oxfords?|monk[- ]strap|whole ?cut)\b|부츠|힐|펌프스|구두|슬링백/i;
const OTHER_FORM = /\b(?:loafers?|mocasso|moccasins?|mocassins?|mules?|sabots?|clogs?|slippers?|sandals?|espadrilles?|lace up|cowboy|boat shoes?|safety (?:shoe|sandal|boot)|ballerinas?|ballet|flip[- ]?flops?|flats?)\b|로퍼|나막신|사보|모카신|슬리퍼|샌들|레이스업|발레|뮬/i;
// Cues that keep a refused row on the ambiguous list even though something in
// its listing names another form: a tabi runner and a ballet runner are both
// shapes the catalogue may well want, and both were refused only for want of
// the word sneaker. Read from the house's own words, not from "sporty" prose -
// Martine Rose's Sporty Heel is a heel.
const NEAR_SNEAKER = /\bsneakers?\b|\btrainers?\b|\brunners?\b|\btrail shoes?\b|\bmarathon shoes?\b|\btabi\b|\bgrip sole\b|스니커|트레이너|운동화|러닝화/i;

/** The shop's own category for a row. A shelf that names no shape is replaced
 *  by the shape the house declared, so the footwear classifier reads a
 *  statement of form rather than the word "Shoes" - but never over the
 *  product's own title: an Oxford shoe stays an Oxford shoe however its
 *  description describes its laces. */
export function officialCategory(productType, declaration, title = '') {
  const type = clean(productType);
  if (!declaration || !GENERIC_SHELF.test(type)) return type;
  if (declaration.field !== 'title' && (REFUSED_FORM.test(title) || OTHER_FORM.test(title))) return type;
  return /trainer/i.test(declaration.excerpt) && !/sneaker/i.test(declaration.excerpt) ? 'Trainers' : 'Sneakers';
}

/* -------------------------------------------------------- Shopify variants */

const normaliseOption = name => String(name || '').replace(/[_\-]+/g, ' ').trim();
const isSizeOption = name => /\bsizes?\b/i.test(normaliseOption(name));
const isColourOption = name => /\bcolou?rs?\b/i.test(normaliseOption(name));
const isMaterialOption = name => /\b(?:materials?|fabrics?|finish|leathers?)\b/i.test(normaliseOption(name));
const isDefaultTitleOption = option => /^title$/i.test(normaliseOption(option?.name))
  && (option?.values || []).every(value => /^default title$/i.test(String(value)));

/** Split a Shopify listing into the products it actually holds.
 *
 *  Only a colour or material option is a product boundary. Sizes are
 *  collapsed; `Title / Default Title` is no axis at all; and any other
 *  non-size option (the Toga feed carries `linked_item`) is left alone and
 *  reported, because an option nobody has read is not a licence to split.
 *
 *  Returns one group per physical variant, each with the axis values it was
 *  split on and the store's own variants for that group in position order. */
export function splitVariantGroups(product) {
  const options = (product.options || []).filter(option => !isDefaultTitleOption(option));
  const axes = options.filter(option => isColourOption(option.name) || isMaterialOption(option.name));
  const unread = options.filter(option => !axes.includes(option) && !isSizeOption(option.name)
    && (option.values || []).length > 1);
  const variants = [...(product.variants || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
  if (!axes.length) return {groups: [{axis: [], variants}], unread};
  const valueOf = (variant, option) => variant[`option${option.position}`] ?? null;
  const groups = new Map();
  for (const variant of variants) {
    const axis = axes.map(option => ({
      name: clean(option.name),
      kind: isColourOption(option.name) ? 'colour' : 'material',
      value: clean(valueOf(variant, option)),
    }));
    if (axis.some(part => !part.value)) continue;
    const key = axis.map(part => part.value.toLowerCase()).join(' / ');
    if (!groups.has(key)) groups.set(key, {axis, variants: []});
    groups.get(key).variants.push(variant);
  }
  return {groups: [...groups.values()], unread};
}

const imageSrc = image => typeof image === 'string' ? image : image?.src || image?.url || '';

/** The photograph of one colour, bound the way the store bound it.
 *
 *  A variant's own `featured_image` is the store saying "this picture is this
 *  colour". Failing that, a product image whose `variant_ids` hold one of the
 *  group's variants says the same thing. Only when the listing holds a single
 *  physical variant may the gallery's first picture stand in - then there is
 *  no other colour it could be showing. */
export function variantImage(product, group, {single}) {
  const ids = new Set(group.variants.map(variant => variant.id));
  const featured = group.variants.map(variant => imageSrc(variant.featured_image)).find(Boolean);
  const images = [...(product.images || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
  const bound = images.filter(image => (image.variant_ids || []).some(id => ids.has(id)));
  const candidates = [...new Set([featured, ...bound.map(imageSrc),
    ...(single ? images.map(imageSrc) : [])].filter(Boolean))];
  return {image: candidates[0] || '', candidates};
}

/* ---------------------------------------------------------- colour labels */

/** The maximal trailing run of colour words in a phrase, with the shade
 *  modifier in front of it when there is one: "SOFT SNEAKERS LEATHER/NYLON
 *  SILVER/MINT" is silver/mint, and the material in front of it stops the
 *  run. */
function colourTail(phrase) {
  const tokens = words(phrase).filter(token => /^[\p{L}][\p{L}'-]*$/u.test(token));
  let start = tokens.length;
  while (start > 0 && COLOUR_WORDS.has(tokens[start - 1].toLowerCase())) start -= 1;
  if (start === tokens.length) return '';
  while (start > 0 && SHADE_MODIFIERS.has(tokens[start - 1].toLowerCase())) start -= 1;
  return tokens.slice(start).join(' ');
}

/** The leading run of colour words in a phrase: "white mixed nylon nappa
 *  suede" is a colour followed by the materials it is made of. */
function colourHead(phrase) {
  const tokens = words(phrase);
  let end = 0;
  while (end < tokens.length
    && (COLOUR_WORDS.has(tokens[end].toLowerCase()) || SHADE_MODIFIERS.has(tokens[end].toLowerCase()))) {
    end += 1;
  }
  const kept = tokens.slice(0, end);
  return kept.some(token => COLOUR_WORDS.has(token.toLowerCase())) ? kept.join(' ') : '';
}

const materialTail = phrase => words(phrase)
  .filter(token => MATERIAL_WORDS.has(token.toLowerCase())).join(' ');

// A variant label that names the shape or the material is not a colourway.
const FORM_OR_MATERIAL = new RegExp(`${FOOTWEAR_HINT.source}|\\b(?:${[...MATERIAL_WORDS].join('|')})\\b`, 'i');

/** Variant labels the house itself used, in the order they are trusted.
 *
 *  `siblings` is the set of titles the same brand published, which is what
 *  makes the last strategy honest: where several listings share every word of
 *  their title but the last, the store used that word to tell them apart, so
 *  it is that product's variant label whether or not it is a colour anybody
 *  has catalogued. */
export function colourLabel({group, title, handle, body, siblings = new Map()}) {
  const axisColour = group?.axis?.find(part => part.kind === 'colour');
  if (axisColour) return {value: axisColour.value, strategy: 'variant-option', field: axisColour.name};
  const axisMaterial = group?.axis?.find(part => part.kind === 'material');
  if (axisMaterial) return {value: axisMaterial.value, strategy: 'variant-option', field: axisMaterial.name};

  // A Shopify handle that carries the shop's own colour code names the colour
  // right after it: wsn003arlea0080-rlea0080-bk99-black. Lemaire puts the
  // gender first and the fabric reference after: gummy-grip-sneakers-women-
  // bg225-kraft-beige-ll0276. Where that stretch runs long it has picked up
  // the material too, so only its leading colour words are kept.
  const codes = [/-[a-z]{2}\d{2,3}-([a-z][a-z-]{2,30})$/i,
    /-(?:men|women)-(?:[a-z]{2}\d{3}-)?([a-z][a-z-]*?)-(?:ll|fo)\d{4}/i];
  for (const pattern of codes) {
    const hit = String(handle || '').match(pattern);
    if (!hit) continue;
    const value = hit[1].replaceAll('-', ' ');
    const kept = words(value).length <= 4 ? value : colourHead(value);
    if (kept) return {value: kept, strategy: 'handle-colour-code', field: 'handle'};
  }
  // The colour words at the end of the house's own title. The code in front of
  // a pipe is Cecilie Bahnsen's article reference, not part of the name.
  const fromTitle = colourTail(String(title || '').replace(/^[^|]*\|/, ''));
  if (fromTitle) return {value: fromTitle, strategy: 'title-colour-words', field: 'title'};
  // The house's own sentence about the colourway, where the title has none.
  const declared = clean(body).match(/\b(?:presented|finished|available|offered)\s+in\s+([^.;]{2,60})/i);
  if (declared) {
    const value = declared[1].replace(/\s+or\s+.*$/i, '').trim();
    if (words(value).length <= 6) return {value, strategy: 'body-colour-sentence', field: 'body_html'};
  }
  const fromHandle = colourTail(String(handle || '').replaceAll('-', ' '));
  if (fromHandle) return {value: fromHandle, strategy: 'handle-colour-words', field: 'handle'};
  const inPhrase = colorwayFromName(clean(title));
  if (inPhrase && !FORM_OR_MATERIAL.test(inPhrase)) {
    return {value: inPhrase, strategy: 'title-in-phrase', field: 'title'};
  }

  const tokens = words(title);
  for (const tail of [1, 2]) {
    if (tokens.length <= tail) break;
    const stem = tokens.slice(0, -tail).join(' ').toLowerCase();
    const value = tokens.slice(-tail).join(' ');
    // A differing tail is a variant label only if it is not itself the name of
    // the shape: "Women's Paris Trainer" differs from "Paris Trainer" by a
    // word that is the model, not a colour.
    if ((siblings.get(stem)?.size || 0) > 1 && /^[\p{L}][\p{L}\s'-]*$/u.test(value)
      && !FORM_OR_MATERIAL.test(value)) {
      return {value, strategy: 'title-tail-differential', field: 'title'};
    }
  }
  return null;
}

/** Titles a brand published, indexed by the words in front of their tail, so
 *  `colourLabel` can see that three listings differ only in their last word. */
function siblingTitleStems(products) {
  const stems = new Map();
  for (const product of products) {
    const tokens = words(product.title);
    for (const tail of [1, 2]) {
      if (tokens.length <= tail) continue;
      const stem = tokens.slice(0, -tail).join(' ').toLowerCase();
      if (!stems.has(stem)) stems.set(stem, new Set());
      stems.get(stem).add(tokens.slice(-tail).join(' ').toLowerCase());
    }
  }
  return stems;
}

/* ------------------------------------------------------------ small facts */

const GENDER_WORDS = [
  [/\bwomen'?s?\b|\(women\)|\bwomenswear\b|\bladies\b|여성/i, 'Women'],
  [/\bmen'?s?\b|\(men\)|\bmenswear\b|남성/i, 'Men'],
];
function declaredGender(...fields) {
  const text = fields.map(field => clean(field)).join(' ');
  for (const [pattern, gender] of GENDER_WORDS) if (pattern.test(text)) return gender;
  return '';
}

// The market the shelf was read in, when the shop states one. A .com store
// that declares no market is left blank rather than guessed at.
function declaredCountry(url) {
  const text = decodeURIComponent(String(url || ''));
  if (/\/ko-kr\/|\/kor\/ko\/|korea\./i.test(text)) return 'KR';
  if (/\/en-us\/|\/us\/en\//i.test(text)) return 'US';
  try {
    const host = new URL(url).hostname;
    if (/\.fr$/i.test(host)) return 'FR';
    if (/\.jp$/i.test(host)) return 'JP';
  } catch { /* leave the market blank */ }
  return '';
}

// A look page is the house's campaign, not a product. The Toga feed files 262
// of them under SHOES-adjacent vendors with a `linked_item` option in place
// of a size.
const isLookPage = product => /^look$/i.test(clean(product.product_type))
  || /\bLOOK\s?\d+\b/i.test(clean(product.title));

/** Is this listing worth reviewing as footwear?
 *
 *  Three ways in, because a pre-filter that drops a shoe is worse than a
 *  review list with some furniture on it: the summary already picked it, its
 *  own words name a footwear shape, or its description declares a sneaker.
 *  Simone Rocha's adidas Climacool is filed under product type "Adidas" with
 *  an opaque handle and no footwear word anywhere in its title - the summary
 *  caught it and nothing else would have. */
const isFootwearCandidate = (product, preselected = new Set()) => {
  const type = clean(product.product_type);
  if (NOT_FOOTWEAR_SHELF.test(type) && !FOOTWEAR_HINT.test(type)) return false;
  if (preselected.has(product.id)) return true;
  if (FOOTWEAR_HINT.test([product.title, type,
    String(product.handle || '').replaceAll('-', ' ')].join(' '))) return true;
  return !!sneakerDeclaration({productType: type, title: product.title, body: product.body_html});
};

/* ------------------------------------------------------- record assembly */

function evidenceFor(row, {listingUrl, contentHash, at}) {
  const proof = {
    verified: true, brand: row.brand, style: row.style, verifiedAt: at,
    verificationMethod: 'official-new-listing-sku-image', contentHash,
    identifierType: 'official-product-id',
  };
  return {
    arrivalEvidence: {
      verified: true, brand: row.brand, style: row.style, productUrl: row.url,
      kind: 'official-assortment-listing', url: listingUrl, verifiedAt: at,
      excerpt: row.name, contentHash,
    },
    officialProductEvidence: {...proof, url: row.url},
    officialImageEvidence: {...proof, url: row.image, sourceUrl: listingUrl},
  };
}

/** Finish a candidate row: bind its proofs, ask the footwear classifier and
 *  the hybrid review, and refuse anything whose own proofs do not verify.
 *  Pushes to `products` or `excluded` and returns nothing. */
const typeReviewPath=new URL('../data/official-expansion-type-reviews.json',import.meta.url);
const TYPE_REVIEWS=fs.existsSync(typeReviewPath)?JSON.parse(fs.readFileSync(typeReviewPath,'utf8')).products:[];
function admit(row, {listingUrl, contentHash, at, today, declaration, products, excluded}) {
  row=reviewedOfficialType(row,TYPE_REVIEWS);
  if(row.typeReview?.approved===false){excluded.push({brand:row.brand,platform:row.platform,url:row.url,name:row.name,productType:row.officialCategory,reason:'reviewed-not-sneaker',bucket:'out-of-scope',review:row.typeReview});return;}
  if(row.typeReview?.approved)declaration=row.typeEvidence;
  const reject = (reason, extra = {}) => {
    // The house's own title and shelf first: when they name another form the
    // row is out of scope, and only a sneaker-adjacent word in the same
    // breath keeps it on the list a human still has to read.
    const named = `${row.name} ${row.officialCategory}`;
    const all = `${named} ${row.description}`;
    const outOfScope = REFUSED_FORM.test(named) ? true
      : NEAR_SNEAKER.test(named) ? false
      : OTHER_FORM.test(named) ? true
      : (REFUSED_FORM.test(row.description) || OTHER_FORM.test(row.description))
        && !NEAR_SNEAKER.test(all);
    excluded.push({
      brand: row.brand, platform: row.platform, url: row.url, name: row.name,
      productType: row.officialCategory, reason,
      bucket: outOfScope ? 'out-of-scope' : 'ambiguous',
      ...extra,
    });
  };
  if (!row.name) return reject('missing-primary-title');
  if (!inLatinOrHangul(row.name)) return reject('title-not-english-or-korean');
  if (!row.image?.startsWith('https://')) return reject('variant-colour-image-unbound');
  if (!isOfficialProductUrl(row.brand, row.url)) return reject('product-url-not-official-domain');

  // The text the house published about this product: its own title, the shelf
  // it filed it on and its own description. A rendered listing carries no
  // description at all, so for Marni's "발레리나 트레이너" on its Sneakers
  // shelf the shelf is the only statement of construction there is.
  const text = `${row.name} ${row.officialCategory} ${row.description}`;
  const hybrid = officialHybridReview(row, text, at);
  if (hybrid) row.hybridReview = hybrid;
  const type = classifyFootwear(row);
  if (!['sneaker', 'hybrid'].includes(type.category)) {
    return reject(type.reason || type.category || 'footwear-unverified',
      declaration ? {declaredSneaker: declaration.excerpt} : {});
  }
  // Classified in scope, but only the house's own sneaker word admits it. A
  // slip-on with a Vibram sole and no sneaker anywhere in its listing is a
  // shape we cannot name, and it is reported rather than published.
  if (!declaration) return reject('sneaker-form-not-declared-by-house');

  row.footwearCategory = type.category;
  row.id = 'arrival-' + digest(`${row.brand}|${BASIS}|${row.style}`).slice(0, 20);
  Object.assign(row, evidenceFor(row, {listingUrl, contentHash, at}));
  // The proof contract, asked of the finished record rather than assumed.
  if (!officialEvidenceFor(row, today)) return reject('official-proof-did-not-verify');
  products.push(row);
}

/* ----------------------------------------------------------------- Shopify */

/** Every product the Shopify feed of one house holds, reviewed. */
export function shopifyRows(entry, feed, {at, today}) {
  const products = [], excluded = [], notReviewed = [], notes = [];
  // products.json is paged and the pages were stored in order, so the page a
  // product was read from - and therefore the hash its proof cites - is the
  // page whose count covers its index.
  const pages = [];
  let offset = 0;
  for (const page of feed.pages || []) {
    pages.push({...page, from: offset, to: offset + (page.products || 0)});
    offset += page.products || 0;
  }
  const pageOf = index => pages.find(page => index >= page.from && index < page.to) || pages[0];
  // The summary's own candidate ids, honoured alongside this file's sweep.
  const preselected = new Set((entry.candidates || []).map(candidate => candidate.id));
  const candidate = product => isFootwearCandidate(product, preselected);
  const stems = siblingTitleStems((feed.products || []).filter(candidate));

  (feed.products || []).forEach((product, index) => {
    const brand = resolveBrand(entry.brand, product.vendor);
    const title = clean(product.title);
    const base = {brand: brand || entry.brand, platform: 'shopify', name: title,
      url: `${feed.root}/products/${product.handle}`, officialCategory: clean(product.product_type)};
    if (!candidate(product)) {
      notReviewed.push(product.id);
      return;
    }
    if (isLookPage(product)) {
      return excluded.push({...base, reason: 'look-campaign-not-a-product', bucket: 'out-of-scope'});
    }
    if (!brand) {
      return excluded.push({...base, reason: 'vendor-line-not-a-catalogue-brand',
        bucket: 'out-of-scope', vendor: clean(product.vendor)});
    }

    const page = pageOf(index);
    const body = product.body_html || '';
    const declaration = sneakerDeclaration({productType: product.product_type, title, body});
    const category = officialCategory(product.product_type, declaration, title);
    const {groups, unread} = splitVariantGroups(product);
    // An option nobody has read is not a licence to split, and not a reason to
    // refuse the listing either. It is noted so a new axis cannot pass unseen.
    if (unread.length) notes.push({brand, url: base.url, name: title,
      note: 'non-size-option-not-read-as-a-variant-axis',
      option: unread.map(option => clean(option.name)).join(', ')});
    if (!groups.length) {
      return excluded.push({...base, brand, reason: 'no-purchasable-variant', bucket: 'ambiguous'});
    }

    for (const group of groups) {
      const chosen = group.variants[0];
      const {image, candidates} = variantImage(product, group, {single: groups.length === 1});
      const colour = colourLabel({group, title, handle: product.handle, body, siblings: stems});
      const material = group.axis.find(part => part.kind === 'material')?.value || materialTail(title);
      const variantId = [product.id, slug(colour?.value) || slug(material)].filter(Boolean).join(':');
      const row = {
        brand, platform: 'shopify', name: title,
        style: variantId, styleType: 'official-product-id', productVariantId: variantId,
        // The store's own address for the colour that was chosen.
        url: `${feed.root}/products/${product.handle}${chosen ? `?variant=${chosen.id}` : ''}`,
        image, imageCandidates: candidates.map(url => ({url, alt: title})),
        description: clean(body), officialCategory: category,
        colorway: colour?.value || '', colors: [],
        gender: declaredGender(product.product_type, title, product.vendor,
          String(product.handle || '').replaceAll('-', ' ')),
        country: declaredCountry(feed.root),
        firstSeen: at, productVerifiedAt: at, productEvidenceUrl: page.url,
        sourceSignals: [],
        shopifyProductId: product.id,
        variantAxis: group.axis.map(part => ({name: part.name, kind: part.kind, value: part.value})),
        sizesCollapsed: group.variants.length,
        ...(declaration ? {typeEvidence: {...declaration, url: page.url, contentHash: page.hash}} : {}),
        ...(colour ? {colorwayEvidence: {...colour, label: colour.value, url: page.url}} : {}),
      };
      admit(row, {listingUrl: page.url, contentHash: page.hash, at, today, declaration, products, excluded});
    }
  });
  return {products, excluded, notes, notReviewed: notReviewed.length};
}

/* -------------------------------------------------- rendered own listings */

const alnum = value => String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// Korean colour words as the houses print them at the head of a Korean title.
// Kept verbatim in the output: the colourway is the house's own word for it.
const KO_COLOURS = new Set(['블랙','화이트','아이보리','크림','베이지','브라운','카멜','토프','그레이',
  '차콜','네이비','블루','스카이','민트','그린','카키','옐로','옐로우','오렌지','레드','버건디','와인',
  '핑크','퍼플','라벤더','실버','골드','탄','모카','코냑','올리브','세이지','멀티','푸시아','브론즈']);
// Shades and separators that only count in front of or between the colours.
const KO_SHADES = new Set(['오프','다크','라이트','딥','소프트','메탈릭','페일','&']);

/** The colour a Korean title leads with, verbatim: Marni and MM6 both put it
 *  at the head of the name ("베이지 & 블랙 시어링 ..."). Returns '' as soon as
 *  the title starts with anything else, so a model name is never read as a
 *  colourway. */
export function leadingKoreanColour(name) {
  const tokens = clean(name).split(/\s+/).filter(Boolean);
  let end = 0;
  while (end < tokens.length && (KO_COLOURS.has(tokens[end]) || KO_SHADES.has(tokens[end]))) end += 1;
  while (end > 0 && !KO_COLOURS.has(tokens[end - 1])) end -= 1;
  return tokens.slice(0, end).join(' ');
}

// A shelf read off a listing URL arrives lower-cased; the houses print theirs
// capitalised and the field is shown as it is stored.
const titleCase = value => value.replace(/\b\p{Ll}/gu, letter => letter.toUpperCase());

/** The shelf category a rendered listing was read from - the house's own
 *  filing, taken from the last naming segment of the listing URL. */
function shelfCategory(listingUrl) {
  try {
    const parts = decodeURIComponent(new URL(listingUrl).pathname).split('/').filter(Boolean);
    const last = parts.at(-1) || '';
    return /^(?:sneakers?|스니커즈)$/i.test(last) ? 'Sneakers' : titleCase(clean(last.replaceAll('-', ' ')));
  } catch { return ''; }
}

/** One product off a rendered own-listing page. */
function renderedRow(record, {listingUrl, at}) {
  // Marni and MM6 print the shelf after the name: "... 스니커즈 - 스니커즈".
  const raw = clean(record.name);
  const tail = raw.match(/^(.*\S)\s[-–]\s([^-–]{1,24})$/);
  const name = tail ? tail[1] : raw;
  const declaredShelf = tail ? tail[2] : '';
  const shelf = shelfCategory(listingUrl);
  const style = String(record.style || '').trim();
  // Keep only the pictures the listing stamped with this colour's own code,
  // so a hover shot of another colourway cannot become the card.
  const bound = (record.imageCandidates || []).map(candidate => candidate.url).filter(Boolean)
    .filter(url => alnum(url).includes(alnum(style)));
  const image = bound.includes(record.image) ? record.image : bound[0] || '';
  const colorway = leadingKoreanColour(name) || colourTail(name);
  return {
    brand: record.brand, platform: 'official-listing', name,
    style, styleType: 'official-product-id', productVariantId: style,
    url: record.url, image, imageCandidates: bound.map(url => ({url, alt: name})),
    description: '',
    officialCategory: /^(?:sneakers?|스니커즈)$/i.test(declaredShelf) ? 'Sneakers' : declaredShelf || shelf,
    colorway, colors: [],
    gender: declaredGender(decodeURIComponent(listingUrl)),
    country: declaredCountry(record.url) || declaredCountry(listingUrl),
    firstSeen: at, productVerifiedAt: at, productEvidenceUrl: listingUrl,
    sourceSignals: [],
    ...(colorway ? {colorwayEvidence: {value: colorway, label: colorway, strategy: 'title-leading-colour',
      field: 'title', url: listingUrl}} : {}),
  };
}

/** Every product the rendered listings of the non-Shopify houses hold.
 *
 *  A house's shelves overlap - Marni's /여성/슈즈/ holds everything its
 *  /여성/슈즈/스니커즈/ holds - so the most specific shelf is read first and
 *  a product keeps the proof of the shelf it was first seen on. */
export function renderedRows(entries, feeds, {at, today}) {
  const products = [], excluded = [], notReviewed = [];
  const ordered = [...entries].sort((a, b) =>
    Number(/sneaker|스니커/i.test(b.url)) - Number(/sneaker|스니커/i.test(a.url)));
  const seen = new Set();
  for (const entry of ordered) {
    const feed = feeds.get(logPath(entry.file));
    const listingUrl = entry.url;
    // Each product records the stored HTML it was read from, so its proof
    // cites that page's hash rather than the shelf's first page.
    const pageOf = file => (feed?.pages || []).find(page => logPath(page.file) === logPath(file))
      || (feed?.pages || [])[0];
    for (const record of feed?.products || []) {
      const key = `${record.brand}|${record.url}`;
      if (seen.has(key)) continue;
      const brand = resolveBrand(record.brand, '');
      const name = clean(record.name);
      if (!FOOTWEAR_HINT.test(`${name} ${shelfCategory(listingUrl)}`)) {
        notReviewed.push(key);
        seen.add(key);
        continue;
      }
      seen.add(key);
      const base = {brand: brand || record.brand, platform: 'official-listing', url: record.url, name};
      if (!brand) {
        excluded.push({...base, reason: 'listing-brand-not-a-catalogue-brand', bucket: 'out-of-scope'});
        continue;
      }
      const row = renderedRow({...record, brand}, {listingUrl, at});
      const declaration = sneakerDeclaration({productType: row.officialCategory, title: row.name});
      const page = pageOf(record.pageFile);
      const contentHash = record.contentHash || page?.hash || '';
      if (declaration) row.typeEvidence = {...declaration, url: listingUrl, contentHash};
      if (!row.style) {
        excluded.push({...base, reason: 'listing-states-no-product-id', bucket: 'ambiguous'});
        continue;
      }
      if (!contentHash) {
        excluded.push({...base, reason: 'listing-page-hash-missing', bucket: 'ambiguous'});
        continue;
      }
      admit(row, {listingUrl, contentHash, at, today, declaration, products, excluded});
    }
  }
  return {products, excluded, notReviewed: notReviewed.length};
}

/* ------------------------------------------------------------- assembling */

/** Does the brand's configured official source declare assortment semantics?
 *  The expansion reads whole-assortment feeds, so a brand whose config has no
 *  `basis: "assortment"` entry is reported rather than silently treated as if
 *  it had one. */
function assortmentBasis(sources) {
  const basis = new Map();
  for (const [name, list] of Object.entries(sources)) {
    const brand = canonicalSiteBrand(name);
    if (!basis.get(brand)) {
      basis.set(brand, (list || []).some(source => source.basis === 'assortment'));
    }
  }
  return basis;
}

export function assemble({shopify, shopifyFeeds, rendered, renderedFeeds, sources, checkedAt}) {
  const at = checkedAt, today = kstDay(at);
  const products = [], excluded = [], notes = [];
  const perSource = [], notReviewed = {shopify: 0, rendered: 0};

  for (const entry of shopify) {
    const feed = shopifyFeeds.get(logPath(entry.file));
    const result = shopifyRows(entry, feed, {at, today});
    products.push(...result.products);
    excluded.push(...result.excluded);
    notes.push(...result.notes);
    notReviewed.shopify += result.notReviewed;
    perSource.push({
      platform: 'shopify', summaryBrand: entry.brand, file: logPath(entry.file),
      root: feed.root, feedProducts: feed.products.length, summaryProducts: entry.products,
      summaryCandidates: (entry.candidates || []).length, exhausted: entry.exhausted === true,
      error: entry.error || '',
      pages: (feed.pages || []).map(page => ({url: page.url, status: page.status,
        products: page.products, hash: page.hash})),
    });
  }

  const rendered1 = renderedRows(rendered, renderedFeeds, {at, today});
  products.push(...rendered1.products);
  excluded.push(...rendered1.excluded);
  notReviewed.rendered = rendered1.notReviewed;
  for (const entry of rendered) {
    const feed = renderedFeeds.get(logPath(entry.file));
    perSource.push({
      platform: 'official-listing', summaryBrand: entry.brand, file: logPath(entry.file),
      listingUrl: entry.url, feedProducts: (feed?.products || []).length,
      summaryProducts: entry.products, exhausted: entry.exhausted === true, error: entry.error || '',
      pages: (feed?.pages || []).map(page => ({url: page.url, finalUrl: page.finalUrl,
        status: page.status, products: page.products, hash: page.hash, visibleTiles: page.visibleTiles})),
    });
  }

  // One row per physical variant, keyed the way the catalogue keys them.
  const deduped = [...new Map(products.map(row => [`${row.brand}|${row.productVariantId}`, row])).values()];
  const duplicates = products.length - deduped.length;

  const basis = assortmentBasis(sources);
  const brands = [...new Set([...deduped.map(row => row.brand), ...excluded.map(row => row.brand)])].sort();
  // A refused vendor line appears in `brands` so the record shows it was seen;
  // it is not a house this run covered.
  const catalogueBrands = brands.filter(isSiteBrandAllowed);
  const luxBrands = (BRAND_GROUPS.find(group => group.name === 'LUX')?.priority || []);
  const byBrand = brands.map(brand => {
    const rows = excluded.filter(row => row.brand === brand);
    return {
      brand, siteGroup: siteBrandGroup(brand), verified: deduped.filter(row => row.brand === brand).length,
      excluded: rows.filter(row => row.bucket === 'out-of-scope').length,
      ambiguous: rows.filter(row => row.bucket !== 'out-of-scope').length,
      configuredAssortmentSource: basis.get(brand) === true,
    };
  });

  const ambiguous = excluded.filter(row => row.bucket !== 'out-of-scope');
  const reasons = {};
  for (const row of excluded) reasons[row.reason] = (reasons[row.reason] || 0) + 1;

  return {
    schemaVersion: 1,
    checkedAt: at,
    products: deduped,
    excluded,
    coverage: {
      basis: BASIS,
      // What was read, and nothing beyond it. 62 LUX brands are registered on
      // the site; this run looked at the ones these two summaries cover.
      scope: {
        brandsRead: catalogueBrands.length,
        brands: catalogueBrands,
        luxBrandsRegistered: luxBrands.length,
        luxBrandsNotRead: luxBrands.filter(brand => !catalogueBrands.includes(brand)).length,
        nonCatalogueLinesSeen: brands.filter(brand => !isSiteBrandAllowed(brand)),
        claim: 'Covers only the brands listed in scope.brands; it is not a reading of all registered LUX brands.',
      },
      counts: {
        verified: deduped.length,
        reviewed: deduped.length + excluded.length,
        excludedOutOfScope: excluded.length - ambiguous.length,
        ambiguous: ambiguous.length,
        duplicateVariantRowsCollapsed: duplicates,
        feedRowsNotFootwear: notReviewed.shopify + notReviewed.rendered,
        colourwayDeclared: deduped.filter(row => row.colorway).length,
        colourwayUndeclared: deduped.filter(row => !row.colorway).length,
        sizesCollapsed: deduped.reduce((total, row) => total + (row.sizesCollapsed || 0), 0),
        hybrids: deduped.filter(row => row.footwearCategory === 'hybrid').length,
      },
      excludedReasons: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1])),
      // Listings carrying an option this file does not read as a variant axis.
      notes,
      // Every row we looked at and could not name, with the words that made
      // it tempting. These need a human, not a guess.
      ambiguousTitles: ambiguous.map(row => ({brand: row.brand, name: row.name, url: row.url,
        productType: row.productType || '', reason: row.reason,
        declaredSneaker: row.declaredSneaker || ''})),
      missingColourImageBinding: excluded.filter(row => row.reason === 'variant-colour-image-unbound')
        .map(row => ({brand: row.brand, name: row.name, url: row.url})),
      brands: byBrand,
      brandsWithoutConfiguredAssortmentSource: byBrand
        .filter(row => row.siteGroup && !row.configuredAssortmentSource).map(row => row.brand),
      // The input kept whole and separate from the products read out of it,
      // so any row can be traced back to the page and hash it came from.
      sources: perSource,
    },
  };
}

/* ------------------------------------------------------------------- main */

export async function main() {
  const checkedAt = new Date().toISOString();
  const shopify = read(SHOPIFY_SUMMARY), rendered = read(RENDERED_SUMMARY);
  const load = summary => new Map(summary.map(entry =>
    [logPath(entry.file), read(logPath(entry.file))]));
  const output = assemble({
    shopify, shopifyFeeds: load(shopify),
    rendered, renderedFeeds: load(rendered),
    sources: read('config/daily_sources.json'),
    checkedAt,
  });
  await fsp.writeFile(new URL(OUTPUT_FILE, root), JSON.stringify(output, null, 2) + '\n');
  const {counts, scope, brands, brandsWithoutConfiguredAssortmentSource, excludedReasons} = output.coverage;
  console.log(JSON.stringify({
    output: OUTPUT_FILE, counts, scope, excludedReasons,
    brandsWithoutConfiguredAssortmentSource,
    missingColourImageBinding: output.coverage.missingColourImageBinding.length,
    byBrand: Object.fromEntries(brands.map(row =>
      [row.brand, {verified: row.verified, excluded: row.excluded, ambiguous: row.ambiguous}])),
  }, null, 2));
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  await main();
}
