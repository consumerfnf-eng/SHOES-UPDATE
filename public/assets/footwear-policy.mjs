// The same publication scope is used by the publisher and the browser.
export const FOOTWEAR_TYPES = ['sneaker','ballet-sneaker','mary-jane-sneaker','mule-sneaker','jelly','platform','clog','slipper','loafer','sandal'];
export function footwearTypes(product) {
  // A retail/newsletter collector already classified its own listing against
  // this same list (scripts/monthly/footwear_scope.py), using the retailer's
  // category label as well as the title. Re-deriving it here from the title
  // alone would quietly lose that, so a stated list wins.
  if(Array.isArray(product.footwearTypes)&&product.footwearTypes.length)
    return product.footwearTypes.filter(type=>FOOTWEAR_TYPES.includes(type));
  const category=product.category;
  const text=[product.name,product.officialCategory,product.hybridReview?.approved?product.hybridReview.type:''].filter(Boolean).join(' ');
  const types=[];
  if(category==='sneaker'||category==='hybrid'||category==='jelly'&&product.footwearReview?.sneakerSole===true)types.push('sneaker');
  if(category==='hybrid') {
    if(/ballerin[ae]|ballet|발레리나|발레|バレエ|バレリーナ|芭蕾/i.test(text))types.push('ballet-sneaker');
    if(/mary[ -]?jane|메리제인|メリージェーン|玛丽珍|瑪麗珍/i.test(text))types.push('mary-jane-sneaker');
    if(/\bmules?\b|뮬|ミュール|穆勒/i.test(text))types.push('mule-sneaker');
  }
  if(category==='jelly')types.push('jelly');
  // A clog, a slide, a thong and a slipper each reach a card on their own
  // now rather than only when they happen to be built on a platform.
  if(category==='clog')types.push('clog');
  if(category==='slipper'||category==='platform-slipper')types.push('slipper');
  if(category==='loafer')types.push('loafer');
  if(category==='platform-sandal')types.push('sandal');
  if(['platform-shoe','platform-sandal','platform-slipper'].includes(category)||['sneaker','hybrid','jelly','clog'].includes(category)&&(/\bplatform\b|플랫폼/i.test(text)||product.keywordTags?.includes('platform')))types.push('platform');
  return types;
}
export function isPublishedFootwear(product) { return footwearTypes(product).length>0; }
