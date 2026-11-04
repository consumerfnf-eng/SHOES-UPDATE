// Scope exclusions use the card's own title/description and decoded product
// path, never the surrounding navigation or words from neighbouring cards.
export function isScopedSneakerCandidate(candidate){
 let pathname='';try{pathname=decodeURIComponent(new URL(candidate.url).pathname);}catch{}
 const shortDescription=String(candidate.description||'').length<250?String(candidate.description||'').replace(/(?:Next|Previous)\s+slide/gi,''):'';
 const text=[candidate.name,candidate.cardDescription,candidate.sourceProductType,pathname].join(' ').replace(/[_-]/g,' ');
 // A short tile title can expose an otherwise unnamed boot. Marketing about
 // laces, insoles or boot inspiration does not turn a named sneaker into one.
 if(candidate.brand!=='Alo'&&!/sneakers?|trainers?|스니커|운동화|러닝화/i.test(shortDescription)&&/\b(?:boots?|mules?|slides?|sandals?|slippers?|clogs?)\b/i.test(shortDescription))return false;
 if(/\b(?:(?:half|quarter|full|1[ -]2)[ -]zip|zip[ -]up|t[ -]shirts?|leggings?|trousers|sweatshirts?|jackets?|hoodies?)\b/i.test(text))return false;
 if(/\bsocks?\b|\b(?:insoles?|shoelaces?|shoe.care|shoe.cleaner)\b|양말|삭스|깔창|신발끈|슈레이스|슈클리너/i.test(text))return false;
 if(/\b(?:kids?|kdz|infants?|toddlers?|preschool|juniors?|youth)\b|키즈|아동|유아/i.test(text))return false;
 if(candidate.brand!=='Alo'&&/\b(?:slides?|sandals?|slippers?|boots?|clogs?|mules?)\b/i.test(text))return false;
 if(!/sneakers?|스니커|운동화|러닝화/i.test(text)&&/\b(?:loafers?|moccasins?|oxfords?|derb(?:y|ies)|boat shoes?|dress shoes?)\b|로퍼|구두/i.test(text))return false;
 if(candidate.brand==='Birkenstock'&&/\b(?:Boston|Arizona|Madrid|Gizeh|Zurich|Kyoto|Tokio|Naples|Lutry)\b/i.test(text))return false;
 if(/\b(?:high|low)[ -]?tops?\b|\bshoes?\b|sneakers?|trainers?|신발|스니커|슈즈|운동화|러닝화/i.test(text))return true;
 return !/\b(?:short.sleeve|long.sleeve|crewneck|pullovers?|sweatshirts?|hooded|tanks?|skirts?|turtleneck|chinos?|hipsters?|polos?|jerseys?|tees?|knitwear|tracksuits?|vests?|beanies?|blouses?|cardigans?|parkas?|sleeveless|shirts?|jackets?|coats?|bags?|wallets?|belts?|trousers|pants|shorts|caps?|hats?|dress(?:es)?|sunglasses|eyewear|earrings?|necklaces?|bracelets?|scarves|sweaters?|hoodies?|tops?|leggings?|bras?|briefs?|trunks?|underwear|boxers?|skorts?)\b|의류|폴로|셔츠|스웻|스웨트|라운드넥|니트|재킷|자켓|팬츠|가방|티셔츠|모자|트렁크|브리프|언더웨어|스웨터|청바지|데님|드로즈|속옷|브래지어|스커트|가디건|니트탑|플리스|집업|바지|상의|반팔|긴팔|조거|레깅스|후디|후드티|맨투맨|원피스|치마|브라(?:렛)?(?:[\s/_-]|$)/i.test(text);
}
