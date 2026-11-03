import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveBrand, sneakerDeclaration, officialCategory, splitVariantGroups, variantImage,
        colourLabel, leadingKoreanColour, shopifyRows, renderedRows, assemble, OUTPUT_FILE}
        from '../scripts/assemble-official-expansion.mjs';
import {officialEvidenceFor, classifyFootwear, kstDay} from '../scripts/curation.mjs';

const AT = '2026-11-03T01:00:00.000Z';
const TODAY = kstDay(AT);
const HASH = 'a'.repeat(64);
const logKey = file => String(file).replaceAll('\\', '/');

const sized = (id, colour, size, position, image) => ({
  id, title: `${colour} / ${size}`, option1: colour, option2: size, option3: null,
  sku: String(4573407000000 + position), position, featured_image: image ? {src: image} : null,
});

/** A Toga feed: one sneaker in two colours, a boot, a look page and a line the
 *  catalogue does not carry - the four shapes the real feed holds. */
function togaFeed() {
  const concho = {
    id: 7959779999846, title: 'CONCHO SNEAKERS(MEN)', handle: 'tv262-aj1535',
    vendor: 'TOGA VIRILIS SHOE', product_type: 'SHOES',
    body_html: '<p>TV262-AJ1535 ・Studded low-tech sneakers</p><p>Sole: Synthetic rubber</p>',
    options: [{name: 'Color', position: 1, values: ['White', 'Black']},
      {name: 'Size', position: 2, values: ['41', '42']}],
    variants: [
      sized(1, 'White', '41', 1, 'https://cdn.shopify.com/white.jpg'),
      sized(2, 'Black', '41', 2, 'https://cdn.shopify.com/black.jpg'),
      sized(3, 'White', '42', 3, 'https://cdn.shopify.com/white.jpg'),
      sized(4, 'Black', '42', 4, 'https://cdn.shopify.com/black.jpg'),
    ],
    images: [
      {id: 10, position: 1, variant_ids: [], src: 'https://cdn.shopify.com/gallery.jpg'},
      {id: 11, position: 2, variant_ids: [1, 3], src: 'https://cdn.shopify.com/white.jpg'},
      {id: 12, position: 3, variant_ids: [2, 4], src: 'https://cdn.shopify.com/black.jpg'},
    ],
  };
  const boot = {
    id: 7959779770470, title: 'LACE UP MID BOOTS', handle: 'tv262-boots',
    vendor: 'TOGA VIRILIS SHOE', product_type: 'SHOES',
    body_html: '<p>Leather boots with a synthetic rubber sole.</p>',
    options: [{name: 'Color', position: 1, values: ['Black']},
      {name: 'Size', position: 2, values: ['41']}],
    variants: [sized(5, 'Black', '41', 1, 'https://cdn.shopify.com/boot.jpg')],
    images: [{id: 13, position: 1, variant_ids: [5], src: 'https://cdn.shopify.com/boot.jpg'}],
  };
  const look = {
    id: 8168060354662, title: 'TOGA PULLA SHOE 2026aw LOOK1', handle: 'tp-look1',
    vendor: 'TOGA PULLA SHOE', product_type: 'LOOK', body_html: '<p>Sneakers in look 1</p>',
    options: [{name: 'linked_item', position: 1, values: ['TP262-AJ1515']}],
    variants: [{id: 6, title: 'TP262-AJ1515', option1: 'TP262-AJ1515', position: 1,
      featured_image: {src: 'https://cdn.shopify.com/look.jpg'}}],
    images: [{id: 14, position: 1, variant_ids: [6], src: 'https://cdn.shopify.com/look.jpg'}],
  };
  const otherLine = {
    id: 999, title: 'TOGA TOO SNEAKERS', handle: 'too-sneakers',
    vendor: 'TOGA TOO', product_type: 'SHOES', body_html: '<p>Sneakers.</p>',
    options: [{name: 'Size', position: 1, values: ['41']}],
    variants: [{id: 7, title: '41', option1: '41', position: 1,
      featured_image: {src: 'https://cdn.shopify.com/too.jpg'}}],
    images: [{id: 15, position: 1, variant_ids: [7], src: 'https://cdn.shopify.com/too.jpg'}],
  };
  const products = [concho, boot, look, otherLine];
  return {
    entry: {brand: 'Toga', file: 'logs\\20261103\\toga-shopify-products.json',
      products: products.length, pages: 1, exhausted: true, error: '', candidates: []},
    feed: {brand: 'Toga', root: 'https://int.toga.jp', exhausted: true, error: '', products,
      pages: [{url: 'https://int.toga.jp/products.json?limit=250&page=1', status: 200,
        products: products.length, hash: HASH}]},
  };
}

test('one Toga feed becomes two houses and never the lines the catalogue does not carry', () => {
  assert.equal(resolveBrand('Toga', 'TOGA PULLA SHOE'), 'Toga Pulla');
  assert.equal(resolveBrand('Toga', 'TOGA VIRILIS SHOE LOOK'), 'Toga Virilis');
  assert.equal(resolveBrand('Toga', 'TOGA VIRILIS'), 'Toga Virilis');
  for (const vendor of ['TOGA', 'TOGA TOO', 'COLLABORATION', 'OTHERS', '']) {
    assert.equal(resolveBrand('Toga', vendor), '', vendor);
  }
  // A brand the summary already names wins, aliased through the site policy,
  // and the shop's own vendor field is never read over it.
  assert.equal(resolveBrand('Tom Ford', 'SOME VENDOR'), 'TOM FORD');
  assert.equal(resolveBrand('Cecilie Bahnsen', 'CB X ASICS 2026 DROP 1'), 'Cecilie Bahnsen');
  assert.equal(resolveBrand('Marine Serre', 'MARINE SERRE SARL'), 'Marine Serre');
});

test('a sneaker is declared by the house, and a sneaker lace on an Oxford is not a declaration', () => {
  assert.deepEqual(sneakerDeclaration({productType: 'SNEAKERS', title: 'CBCOSMO'}),
    {field: 'product_type', excerpt: 'SNEAKERS'});
  assert.equal(sneakerDeclaration({productType: 'Shoes', title: 'Suede sneakers'}).field, 'title');
  assert.equal(sneakerDeclaration({productType: 'Footwear', title: 'Jewel Mary Jane',
    body: '<p>The Jewel Mary Jane</p><ul><li>Mary-Jane Sneaker</li><li>Vibram Sole</li></ul>'}).excerpt,
    'Mary-Jane Sneaker');
  assert.equal(sneakerDeclaration({productType: 'Shoes', title: 'Marni 스니커즈'}).field, 'title');
  // The adidas Gazelle Croc on walesbonner.com never says sneaker or trainer.
  assert.equal(sneakerDeclaration({productType: 'Footwear',
    title: 'adidas Originals by Wales Bonner Gazelle Croc',
    body: '<p>The iconic Gazelle silhouette in green croc-embossed leather.</p>'}), null);
  // Four Dries Van Noten Oxfords were filed as sneakers on their laces.
  assert.equal(sneakerDeclaration({productType: 'Shoes', title: 'Leather Oxford shoes',
    body: '<p>Classic Oxford shoes in leather, with contrast sneaker laces.</p>'}), null);
});

test('a shelf that names no shape takes the declared form, but never over the title', () => {
  const declared = {field: 'body_html', excerpt: 'Mary-Jane Sneaker'};
  assert.equal(officialCategory('Footwear', declared, 'Jewel Mary Jane'), 'Sneakers');
  assert.equal(officialCategory('', {field: 'body_html', excerpt: 'The archival BW trainer'},
    'adidas Originals by Wales Bonner BW Pony'), 'Trainers');
  // The shop's own non-generic shelf is left exactly as it filed it.
  assert.equal(officialCategory('MULES', declared, 'SPORTY SNOUT MULE'), 'MULES');
  // And a title that names another form outranks anything in the prose.
  assert.equal(officialCategory('Shoes', {field: 'body_html', excerpt: 'contrast sneaker laces'},
    'Leather Oxford shoes'), 'Shoes');
  assert.equal(officialCategory('Shoes', null, 'DERBIES IN LEATHER'), 'Shoes');
});

test('sizes are collapsed, colour splits, and an option nobody reads splits nothing', () => {
  const {feed} = togaFeed();
  const [concho, , look] = feed.products;
  const split = splitVariantGroups(concho);
  assert.equal(split.groups.length, 2);
  assert.deepEqual(split.groups.map(group => group.axis[0].value), ['White', 'Black']);
  // Two sizes behind each colour, and neither of them is a product.
  assert.deepEqual(split.groups.map(group => group.variants.length), [2, 2]);
  assert.equal(split.unread.length, 0);

  // A single-axis size-only listing is one product.
  const sizeOnly = {options: [{name: 'Size_Shoes', position: 1, values: ['39', '40', '41']}],
    variants: [{id: 1, option1: '39', position: 1}, {id: 2, option1: '40', position: 2},
      {id: 3, option1: '41', position: 3}], images: []};
  assert.equal(splitVariantGroups(sizeOnly).groups.length, 1);
  assert.equal(splitVariantGroups(sizeOnly).groups[0].variants.length, 3);

  // `Title / Default Title` is no axis at all.
  const plain = {options: [{name: 'Title', position: 1, values: ['Default Title']}],
    variants: [{id: 1, option1: 'Default Title', position: 1}], images: []};
  assert.deepEqual(splitVariantGroups(plain).groups[0].axis, []);

  // Toga's `linked_item` is reported rather than split on.
  const unread = splitVariantGroups({...look,
    options: [{name: 'linked_item', position: 1, values: ['A', 'B']}],
    variants: [{id: 1, option1: 'A', position: 1}, {id: 2, option1: 'B', position: 2}]});
  assert.equal(unread.groups.length, 1);
  assert.deepEqual(unread.unread.map(option => option.name), ['linked_item']);

  // A material option is a physical variant just as a colour is.
  const material = {options: [{name: 'Material', position: 1, values: ['Leather', 'Suede']},
      {name: 'Size', position: 2, values: ['41']}],
    variants: [{id: 1, option1: 'Leather', option2: '41', position: 1},
      {id: 2, option1: 'Suede', option2: '41', position: 2}], images: []};
  const materialSplit = splitVariantGroups(material);
  assert.equal(materialSplit.groups.length, 2);
  assert.deepEqual(materialSplit.groups.map(group => group.axis[0].kind), ['material', 'material']);
});

test('a colour gets its own photograph, and the gallery cover is not one of them', () => {
  const {feed} = togaFeed();
  const concho = feed.products[0];
  const [white, black] = splitVariantGroups(concho).groups;
  assert.equal(variantImage(concho, white, {single: false}).image, 'https://cdn.shopify.com/white.jpg');
  assert.equal(variantImage(concho, black, {single: false}).image, 'https://cdn.shopify.com/black.jpg');
  // The unassigned cover shot could be either colourway, so it is not offered.
  for (const group of [white, black]) {
    assert.deepEqual(variantImage(concho, group, {single: false}).candidates
      .filter(url => url.includes('gallery')), []);
  }
  // Without a variant image, a product image the store assigned to that
  // colour's variants still binds.
  const unfeatured = {...concho, variants: concho.variants.map(v => ({...v, featured_image: null}))};
  assert.equal(variantImage(unfeatured, splitVariantGroups(unfeatured).groups[0],
    {single: false}).image, 'https://cdn.shopify.com/white.jpg');
  // Nothing bound and several colourways on the listing: refuse to guess.
  const unbound = {...unfeatured, images: [{id: 10, position: 1, variant_ids: [],
    src: 'https://cdn.shopify.com/gallery.jpg'}]};
  assert.equal(variantImage(unbound, splitVariantGroups(unbound).groups[0], {single: false}).image, '');
  // One physical variant: the gallery's first picture is that variant's.
  assert.equal(variantImage(unbound, splitVariantGroups(unbound).groups[0], {single: true}).image,
    'https://cdn.shopify.com/gallery.jpg');
});

test('colour labels come from the house, in the order they can be trusted', () => {
  const option = {axis: [{name: 'Color', kind: 'colour', value: 'DARK PURPLE'}]};
  assert.deepEqual(colourLabel({group: option, title: 'Suede sneakers', handle: '262-021700-0132'}),
    {value: 'DARK PURPLE', strategy: 'variant-option', field: 'Color'});

  const noAxis = {axis: []};
  // Marine Serre's handle carries the shop's colour code and then its name.
  assert.deepEqual(colourLabel({group: noAxis, title: 'MS RISE TYKO II SNEAKERS',
    handle: 'wsn003arlea0080-rlea0080-bk99-black'}),
    {value: 'black', strategy: 'handle-colour-code', field: 'handle'});
  // Lemaire's puts the fabric reference after the colour, and where that
  // stretch has picked up the material only its colour words are kept.
  assert.equal(colourLabel({group: noAxis, title: 'GUMMY GRIP SNEAKERS IN TRI MATIERES RUMI BEIGE',
    handle: 'gummy-grip-sneakers-women-bg225-kraft-beige-ll0276-tri-matieres-rumi-beige-fo0328'}).value,
    'kraft beige');
  assert.equal(colourLabel({group: noAxis, title: 'SOFT RUNNERS IN MIX NYLON NAPPA SUEDE LEATHER',
    handle: 'soft-runner-women-white-mixed-nylon-nappa-suede-fo0228-ll0216'}).value, 'white');
  // Cecilie Bahnsen states the colour at the end of the title; the article
  // reference in front of the pipe is not part of it, and the material is not
  // the colour either.
  assert.equal(colourLabel({group: noAxis, handle: '3-26ftw30002',
    title: 'CBBLAISE | SOFT SNEAKERS LEATHER/NYLON SILVER/MINT'}).value, 'SILVER MINT');
  assert.equal(colourLabel({group: noAxis, handle: 'blaise-metallic',
    title: 'BLAISE | SNEAKER METALLIC LEATHER PALE BLUE'}).value, 'PALE BLUE');
  // Wales Bonner says it in a sentence instead.
  assert.deepEqual(colourLabel({group: noAxis, title: 'Paris Trainer', handle: 'paris-trainer-3',
    body: '<p>The Paris Trainer  A trainer in nylon and leather, presented in black and dark brown.</p>'}),
    {value: 'black and dark brown', strategy: 'body-colour-sentence', field: 'body_html'});

  // Three listings differing only in their last word: that word is the label.
  const siblings = new Map([['magliano x veja panenka',
    new Set(['titanium', 'taffy', 'amarante'])], ['women s paris', new Set(['trainer'])]]);
  assert.deepEqual(colourLabel({group: noAxis, title: 'Magliano x Veja Panenka Titanium',
    handle: 'magliano-x-veja-panenka-titanium', siblings}),
    {value: 'Titanium', strategy: 'title-tail-differential', field: 'title'});
  // But a differing word that names the shape is the model, not a colour.
  assert.equal(colourLabel({group: noAxis, title: "Women's Paris Trainer",
    handle: 'paris-trainer-7', siblings}), null);
});

test('a Korean title that leads with a colour states one; a model name does not', () => {
  assert.equal(leadingKoreanColour('블랙 시어링 메리 제인 러닝 스니커즈'), '블랙');
  assert.equal(leadingKoreanColour('베이지 & 블랙 시어링 메리 제인 러닝 스니커즈'), '베이지 & 블랙');
  assert.equal(leadingKoreanColour('오프 화이트 나일론 Softy Soccer 스니커즈'), '오프 화이트');
  assert.equal(leadingKoreanColour('MM6 x Salomon XT 스니커즈'), '');
  // A trailing shade modifier with no colour behind it is not a colourway.
  assert.equal(leadingKoreanColour('다크 Softy Soccer 스니커즈'), '');
});

test('a Shopify feed publishes one row per colour, each with its own photograph and proofs', () => {
  const {entry, feed} = togaFeed();
  const {products, excluded, notes} = shopifyRows(entry, feed, {at: AT, today: TODAY});

  assert.equal(products.length, 2);
  assert.deepEqual(products.map(row => row.brand), ['Toga Virilis', 'Toga Virilis']);
  assert.deepEqual(products.map(row => row.colorway), ['White', 'Black']);
  assert.deepEqual(products.map(row => row.image),
    ['https://cdn.shopify.com/white.jpg', 'https://cdn.shopify.com/black.jpg']);
  // The URL points at the colour that was chosen, by its actual variant id.
  assert.deepEqual(products.map(row => row.url),
    ['https://int.toga.jp/products/tv262-aj1535?variant=1',
      'https://int.toga.jp/products/tv262-aj1535?variant=2']);
  // Product id plus colour, declared as the shop's own product identifier.
  assert.deepEqual(products.map(row => row.productVariantId),
    ['7959779999846:white', '7959779999846:black']);
  for (const row of products) {
    assert.equal(row.styleType, 'official-product-id');
    assert.equal(row.style, row.productVariantId);
    // A Shopify variant barcode is never passed off as a factory style code.
    assert.equal('manufacturerStyle' in row, false);
    assert.equal(row.officialProductEvidence.identifierType, 'official-product-id');
    assert.equal(row.officialProductEvidence.verificationMethod, 'official-new-listing-sku-image');
    assert.equal(row.officialImageEvidence.verificationMethod, 'official-new-listing-sku-image');
    assert.equal(row.arrivalEvidence.kind, 'official-assortment-listing');
    // Bound to the API page it was read from, by URL and by content hash.
    assert.equal(row.arrivalEvidence.url, feed.pages[0].url);
    assert.equal(row.arrivalEvidence.contentHash, HASH);
    assert.equal(row.productEvidenceUrl, feed.pages[0].url);
    assert.equal(row.officialImageEvidence.sourceUrl, feed.pages[0].url);
    assert.deepEqual(row.sourceSignals, []);
    assert.equal(row.sizesCollapsed, 2);
    assert.equal(row.gender, 'Men');
    assert.equal(row.country, 'JP');
    // And the whole proof contract, asked of the finished record.
    assert(officialEvidenceFor(row, TODAY), row.productVariantId);
  }

  const reasons = Object.fromEntries(excluded.map(row => [row.name, row.reason]));
  assert.equal(reasons['TOGA PULLA SHOE 2026aw LOOK1'], 'look-campaign-not-a-product');
  assert.equal(reasons['TOGA TOO SNEAKERS'], 'vendor-line-not-a-catalogue-brand');
  assert.equal(reasons['LACE UP MID BOOTS'], 'excluded-footwear');
  for (const row of excluded) assert.equal(row.bucket, 'out-of-scope', row.name);
  assert.deepEqual(notes, []);
});

test('a sneaker sandal needs the declared sneaker sole; a sabot without one is refused', () => {
  const sandal = {
    id: 6831427125350, title: 'METAL SNEAKER SANDALS(MEN)', handle: 'aj664m',
    vendor: 'TOGA VIRILIS SHOE', product_type: 'SHOES',
    body_html: '<p>AJ664M ・With metal strap ・Uses a sneaker sole that also has cushioning properties</p>',
    options: [{name: 'Color', position: 1, values: ['Black']},
      {name: 'Size', position: 2, values: ['41']}],
    variants: [sized(1, 'Black', '41', 1, 'https://cdn.shopify.com/sandal.jpg')],
    images: [{id: 1, position: 1, variant_ids: [1], src: 'https://cdn.shopify.com/sandal.jpg'}],
  };
  const sabot = {...sandal, id: 6831426961510, title: 'EYELET METAL SABOT(MEN)', handle: 'aj665m',
    body_html: '<p>AJ665M ・Eyelet metal sabot in cowhide.</p>'};
  const base = togaFeed();
  const feed = {...base.feed, products: [sandal, sabot]};
  const entry = {...base.entry, products: 2};
  const {products, excluded} = shopifyRows(entry, feed, {at: AT, today: TODAY});
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'METAL SNEAKER SANDALS(MEN)');
  assert.equal(products[0].footwearCategory, 'hybrid');
  assert.equal(products[0].hybridReview.sneakerSole, true);
  assert.equal(classifyFootwear(products[0]).category, 'hybrid');
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].name, 'EYELET METAL SABOT(MEN)');
});

test('a rendered listing keeps only the pictures stamped with that colour code', () => {
  const listingUrl = 'https://www.tomfordfashion.com/en-us/men/shoes/sneakers/';
  const hash = 'b'.repeat(64);
  const asset = name => `https://cdn.media.amplience.net/i/tom_ford/${name}`;
  const dean = {
    brand: 'TOM FORD', name: 'DEAN SNEAKER', style: 'J1645-LCL123C-GNI',
    url: 'https://www.tomfordfashion.com/en-us/dean-sneaker/J1645-LCL123C-GNI.html',
    image: asset('J1645-LCL123C_GNI_APPENDGRID'),
    imageCandidates: [
      {url: asset('J1645-LCL123C_GNI_APPENDGRID'), alt: 'DEAN SNEAKER'},
      // Another colourway's hover shot, and a 32px swatch.
      {url: asset('J1645-LCL123C_NNP_APPENDGRID_HOVER'), alt: 'NNP'},
      {url: asset('LCL123C-NNP?w=32'), alt: 'NNP'},
    ],
    listingUrl, contentHash: hash, pageFile: 'logs\\20261103\\tf.html', ld: {},
  };
  // The house's wider shoe shelf holds the same sneaker again plus a monk
  // strap, and a shelf that names no shape cannot declare one.
  const shoesUrl = 'https://www.tomfordfashion.com/en-us/men/shoes/';
  const shoesHash = 'c'.repeat(64);
  const monkStrap = {...dean, name: 'LEATHER CLAYDON MONK STRAP', style: 'J1600-LCL001L-AAA',
    url: 'https://www.tomfordfashion.com/en-us/claydon/J1600-LCL001L-AAA.html',
    image: asset('J1600-LCL001L_AAA_APPENDGRID'), listingUrl: shoesUrl, contentHash: shoesHash,
    imageCandidates: [{url: asset('J1600-LCL001L_AAA_APPENDGRID'), alt: 'MONK STRAP'}]};
  const entries = [
    {brand: 'TOM FORD', url: shoesUrl, file: 'logs\\20261103\\tf-shoes.json',
      pages: 1, products: 2, exhausted: true, error: ''},
    {brand: 'TOM FORD', url: listingUrl, file: 'logs\\20261103\\tf.json',
      pages: 1, products: 1, exhausted: true, error: ''},
  ];
  const feeds = new Map([
    ['logs/20261103/tf.json', {brand: 'TOM FORD', url: listingUrl,
      exhausted: true, error: '', products: [dean],
      pages: [{url: listingUrl, finalUrl: listingUrl, status: 200, hash,
        file: 'logs\\20261103\\tf.html', visibleTiles: 1, products: 1}]}],
    ['logs/20261103/tf-shoes.json', {brand: 'TOM FORD', url: shoesUrl,
      exhausted: true, error: '', products: [{...dean, listingUrl: shoesUrl,
        contentHash: shoesHash}, monkStrap],
      pages: [{url: shoesUrl, finalUrl: shoesUrl, status: 200, hash: shoesHash,
        file: 'logs\\20261103\\tf-shoes.html', visibleTiles: 2, products: 2}]}],
  ]);

  const {products, excluded} = renderedRows(entries, feeds, {at: AT, today: TODAY});
  // The sneaker is on both shelves and published once, off the shelf that
  // names the shape.
  assert.equal(products.length, 1);
  const row = products[0];
  assert.equal(row.name, 'DEAN SNEAKER');
  assert.equal(row.officialCategory, 'Sneakers');
  assert.equal(row.productVariantId, 'J1645-LCL123C-GNI');
  assert.equal(row.styleType, 'official-product-id');
  assert.equal('manufacturerStyle' in row, false);
  assert.deepEqual(row.imageCandidates.map(candidate => candidate.url),
    [asset('J1645-LCL123C_GNI_APPENDGRID')]);
  assert.equal(row.arrivalEvidence.url, listingUrl);
  assert.equal(row.arrivalEvidence.contentHash, hash);
  assert.equal(row.officialImageEvidence.sourceUrl, listingUrl);
  assert(officialEvidenceFor(row, TODAY));
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].name, 'LEATHER CLAYDON MONK STRAP');
  assert.equal(excluded[0].reason, 'footwear-type-unverified');
  assert.equal(excluded[0].bucket, 'out-of-scope');

  // A Korean tile states its shelf after the name and leads with its colour.
  const marniListing = 'https://www.marni.com/ko-kr/women/shoes/sneakers/';
  const marni = {brand: 'Marni', name: '블랙 시어링 메리 제인 러닝 스니커즈 - 스니커즈',
    style: 'SNZW020602P928200N99',
    url: 'https://www.marni.com/ko-kr/sneakers-SNZW020602P928200N99.html',
    image: 'https://www.marni.com/images/large/SNZW020602_P9282_00N99_F.jpg',
    imageCandidates: [{url: 'https://www.marni.com/images/large/SNZW020602_P9282_00N99_F.jpg'},
      {url: 'https://www.marni.com/images/large/SNZW020602_P9282_ZO559_F.jpg'}],
    listingUrl: marniListing, contentHash: hash, pageFile: 'logs\\20261103\\marni.html', ld: {}};
  const marniEntry = {brand: 'Marni', url: marniListing, file: 'logs\\20261103\\marni.json',
    pages: 1, products: 1, exhausted: true, error: ''};
  const marniFeeds = new Map([['logs/20261103/marni.json', {brand: 'Marni', url: marniListing,
    products: [marni], pages: [{url: marniListing, status: 200, hash,
      file: 'logs\\20261103\\marni.html', products: 1}]}]]);
  const marniRows = renderedRows([marniEntry], marniFeeds, {at: AT, today: TODAY});
  assert.equal(marniRows.products.length, 1);
  assert.equal(marniRows.products[0].name, '블랙 시어링 메리 제인 러닝 스니커즈');
  assert.equal(marniRows.products[0].officialCategory, 'Sneakers');
  assert.equal(marniRows.products[0].colorway, '블랙');
  assert.equal(marniRows.products[0].gender, 'Women');
  // The other colourway's photograph is not this product's.
  assert.deepEqual(marniRows.products[0].imageCandidates.map(candidate => candidate.url),
    ['https://www.marni.com/images/large/SNZW020602_P9282_00N99_F.jpg']);
});

test('assemble reports what it read and claims no more than that', () => {
  const {entry, feed} = togaFeed();
  const output = assemble({
    shopify: [entry], shopifyFeeds: new Map([[logKey(entry.file), feed]]),
    rendered: [], renderedFeeds: new Map(),
    sources: {'Toga Virilis': [{url: 'https://int.toga.jp/', basis: 'assortment'}],
      'Toga Pulla': [{url: 'https://int.toga.jp/'}]},
    checkedAt: AT,
  });
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.checkedAt, AT);
  assert.deepEqual(Object.keys(output), ['schemaVersion', 'checkedAt', 'products', 'excluded', 'coverage']);
  assert.equal(output.products.length, 2);
  assert.equal(output.coverage.counts.verified, 2);
  assert.equal(output.coverage.counts.sizesCollapsed, 4);
  // Only the houses actually read are claimed, against the registered LUX
  // set; the refused Toga line is recorded as seen, not as covered.
  assert.deepEqual(output.coverage.scope.brands, ['Toga Pulla', 'Toga Virilis']);
  assert.equal(output.coverage.scope.brandsRead, 2);
  assert.deepEqual(output.coverage.scope.nonCatalogueLinesSeen, ['Toga']);
  assert.equal(output.coverage.scope.luxBrandsRegistered, 57);
  assert.equal(output.coverage.scope.luxBrandsNotRead, 55);
  assert.match(output.coverage.scope.claim, /not a reading of all registered LUX brands/);
  // A brand whose configured source carries no assortment basis is reported.
  assert.deepEqual(output.coverage.brandsWithoutConfiguredAssortmentSource, ['Toga Pulla']);
  // The input is kept whole beside the products read out of it.
  assert.equal(output.coverage.sources.length, 1);
  assert.equal(output.coverage.sources[0].feedProducts, feed.products.length);
  assert.deepEqual(output.coverage.sources[0].pages,
    [{url: feed.pages[0].url, status: 200, products: 4, hash: HASH}]);
  assert.deepEqual(output.coverage.missingColourImageBinding, []);
  for (const row of output.coverage.ambiguousTitles) assert.ok(row.name);
});

test('the assembled file on disk carries verified proofs and an honest coverage claim', () => {
  if (!fs.existsSync(new URL('../' + OUTPUT_FILE, import.meta.url))) return;
  const output = JSON.parse(fs.readFileSync(new URL('../' + OUTPUT_FILE, import.meta.url), 'utf8'));
  const today = kstDay(output.checkedAt);
  assert.equal(output.schemaVersion, 1);
  assert(output.products.length > 0);
  const seen = new Set();
  for (const row of output.products) {
    assert(officialEvidenceFor(row, today), `${row.brand} ${row.productVariantId}`);
    assert(['sneaker', 'hybrid'].includes(row.footwearCategory), row.name);
    assert.equal(row.styleType, 'official-product-id');
    assert.equal('manufacturerStyle' in row, false, row.name);
    assert.match(row.image, /^https:\/\//);
    assert(row.typeEvidence?.excerpt, row.name);
    const key = `${row.brand}|${row.productVariantId}`;
    assert.equal(seen.has(key), false, key);
    seen.add(key);
  }
  // Every refused row is on the record with a reason and a bucket.
  for (const row of output.excluded) {
    assert(row.reason, JSON.stringify(row));
    assert(['out-of-scope', 'ambiguous'].includes(row.bucket), row.reason);
  }
  const {counts, scope} = output.coverage;
  assert.equal(counts.reviewed, output.products.length + output.excluded.length);
  assert.equal(counts.ambiguous, output.coverage.ambiguousTitles.length);
  assert(scope.brandsRead < scope.luxBrandsRegistered);
  assert(scope.luxBrandsNotRead > 0);
});
