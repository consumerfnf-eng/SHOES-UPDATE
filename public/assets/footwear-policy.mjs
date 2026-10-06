// The same publication scope is used by the publisher and the browser.
export const FOOTWEAR_TYPES = ['sneaker','ballet-sneaker','mary-jane-sneaker','mule-sneaker','jelly','platform'];
export function footwearTypes(product) {
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
  if(['platform-shoe','platform-sandal'].includes(category)||['sneaker','hybrid','jelly','clog'].includes(category)&&(/\bplatform\b|플랫폼/i.test(text)||product.keywordTags?.includes('platform')))types.push('platform');
  return types;
}
export function isPublishedFootwear(product) { return footwearTypes(product).length>0; }
