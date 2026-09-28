import fs from 'node:fs';

export const KEYWORD_THEMES=JSON.parse(fs.readFileSync(new URL('../config/keyword-taxonomy.json',import.meta.url),'utf8')).themes;
const normalized=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s_/#-]+/g,' ').trim();
const aliases=new Map(KEYWORD_THEMES.flatMap(t=>[t.id,t.label,...t.aliases].map(a=>[normalized(a),t.id])));
for(const [alias,id]of Object.entries({'레트로 러닝':'retro-runner','로우 프로파일':'low-profile','플랫폼':'platform','메쉬':'mesh-sheer','트레일':'trail-gorpcore','클로그':'clog','메리제인 스니커즈':'mary-jane'}))aliases.set(normalized(alias),id);
export function canonicalKeyword(value){return aliases.get(normalized(value));}

const patterns={
  'ballet-hybrid':/sneakerina|ballet|ballerina|발레/i,
  'low-profile':/low.profile|low.slung|slim (?:silhouette|profile|sneaker)|sleek silhouette|speedcat|taekwondo|로우 프로파일|태권도/i,
  'retro-runner':/retro (?:runner|running|trainer)|archive (?:runner|sneaker|trainer)|(?:70s|80s|90s|2000s|y2k).{0,25}(?:running|runner)|vintage (?:runner|jogger)|레트로 러너|빈티지 조거/i,
  'character-collaboration':/pok[eé]mon|\bx\s+one piece\b|\b(?:anime|manga|luffy|gomu gomu)\b.{0,20}one piece|one piece.{0,25}\b(?:collection|collaboration|anime|manga|luffy|gomu gomu)\b|hello kitty|disney|pixar|snoopy|peanuts|sanrio|marvel|spider.man|harry potter|dragon ball|naruto|character collaboration|franchise collaboration|캐릭터 콜라보|포켓몬|원피스/i,
  'mesh-sheer':/\bmesh\b|\bsheer\b|메쉬|메시 어퍼/i,
  'metallic-silver':/metallic.{0,15}silver|silver.{0,15}metallic|pure silver|메탈릭 실버/i,
  'red-crimson':/\b(?:red|crimson|cherry|burgundy|wine)\b|레드|버건디/i,
  'brown':/\b(?:brown|chocolate|coffee|cocoa|mocha|espresso)\b|브라운|초콜릿/i,
  'sneaker-mule':/\bmules?\b|\bsmules?\b|스니커 뮬|스니커뮬/i,
  'animal-print':/animal print|cow print|leopard|cheetah|zebra print|snake.?skin|애니멀 프린트|카우 프린트|레오파드/i,
  'jelly':/\bjelly\b|젤리/i,
  'trail-gorpcore':/gorpcore|trail|approach shoe|technical (?:sneaker|shoe)|고프코어|트레일/i,
  'suede':/\bsuede\b|스웨이드/i,
  'recovery-sandal':/sandal|flip.flop|샌들|조리/i,
  'clog':/\bclogs?\b|클로그/i,
  'canvas':/\bcanvas\b|캔버스/i,
  'skate-y2k':/\bskate(?:r|boarding)?\b|\by2k\b|checkerboard|nike sb|스케이트|스케이터/i,
  'platform':/\bplatform\b|\bflatform\b|플랫폼/i,
  'mary-jane':/mary.jane|메리.?제인/i,
  'satin-velvet':/\bsatin\b|\bvelvet\b|새틴|벨벳/i,
  'sculptural-upper':/sculptural|sculpted.upper|스컬프처 어퍼/i
};
export function keywordIdsFromText(text){return KEYWORD_THEMES.filter(t=>patterns[t.id]?.test(String(text||''))).map(t=>t.id);}
export function productKeywordIds(raw){
  // Called before public copy is reduced: these are verified product facts, never navigation or unrelated cards.
  const facts=[raw.name,raw.description,raw.officialCategory,raw.material,raw.colorway,...(raw.colors||[]).map(c=>typeof c==='string'?c:c.name)].join(' ');
  const ids=new Set(keywordIdsFromText(facts));
  const colorFacts=[raw.name,raw.material,raw.colorway,...(raw.colors||[]).map(c=>typeof c==='string'?c:c.name)].join(' ');
  for(const value of [...(raw.keywordTags||[]),...(raw.sourceSignals||[]).flatMap(s=>s.keywords||[])]){const id=canonicalKeyword(value);if(id)ids.add(id);}
  for(const id of ['red-crimson','brown','metallic-silver'])if(!patterns[id].test(colorFacts))ids.delete(id);
  const platformIdentity=/\b(?:platform|flatform)\b|플랫폼/i.test([raw.name,raw.officialCategory].join(' '));
  const platformStructure=/\b(?:platform|flatform)\s+(?:shoes?|sneakers?|sandals?|soles?)\b|\b(?:raised|elevated|stacked|thick)\s+(?:platform|flatform)\b|플랫폼\s*(?:솔|밑창|슈즈|스니커즈|샌들)/i.test(raw.description||'');
  if(!platformIdentity&&!platformStructure)ids.delete('platform');
  return KEYWORD_THEMES.filter(t=>ids.has(t.id)).map(t=>t.id);
}
