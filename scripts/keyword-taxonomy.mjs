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

// Search labels are never translated. This dictionary is used only to connect equivalent queries and products.
const searchDictionary=JSON.parse(fs.readFileSync(new URL('../config/search-term-dictionary.json',import.meta.url),'utf8'));
const searchBrandPolicy=JSON.parse(fs.readFileSync(new URL('../config/brand-policy.json',import.meta.url),'utf8'));
const singulars={shoes:'shoe',sneakers:'sneaker',trainers:'trainer',clogs:'clog',sandals:'sandal',mules:'mule',platforms:'platform',flatforms:'flatform',runners:'runner'};
export function normalizeSearchTerm(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').normalize('NFC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\b[a-z]+\b/g,w=>singulars[w]||w).replace(/\s+/g,' ');}
const compact=value=>normalizeSearchTerm(value).replaceAll(' ','');
const brandNames=new Map(searchBrandPolicy.brands.map(b=>[compact(b.name),b.name]));
for(const [a,b]of Object.entries(searchBrandPolicy.aliases))brandNames.set(compact(a),b);
const brandName=value=>brandNames.get(compact(value))||value;
function makeSearchConcepts(){
  const entries=searchDictionary.entries.filter(e=>e.kind!=='brand').map(e=>({...e,id:`${e.kind}:${e.id}`}));
  for(const b of searchBrandPolicy.brands.filter(b=>['mandatory','core','conditional'].includes(b.policy))){
    const aliases=[b.name,...Object.entries(searchBrandPolicy.aliases).filter(([,target])=>target===b.name).map(([a])=>a),...searchDictionary.entries.filter(e=>e.kind==='brand'&&e.match.brands.some(x=>brandName(x)===b.name)).flatMap(e=>e.aliases)];
    entries.push({id:`brand:${compact(b.name)}`,kind:'brand',aliases:[...new Set(aliases)],match:{brands:[b.name]}});
  }
  return entries;
}
export const SEARCH_CONCEPTS=makeSearchConcepts();
const searchConceptById=new Map(SEARCH_CONCEPTS.map(e=>[e.id,e]));
const searchAliases=SEARCH_CONCEPTS.flatMap(e=>e.aliases.map(alias=>({alias,key:compact(alias),id:e.id}))).filter(a=>a.key).sort((a,b)=>b.key.length-a.key.length||a.id.localeCompare(b.id));
function textIndex(value){const text=normalizeSearchTerm(value),indices=[];let key='';for(let i=0;i<text.length;i++)if(text[i]!==' '){key+=text[i];indices.push(i);}return{text,key,indices};}
function bounded(index,start,term){
  const finish=start+term.length-1,first=index.indices[start],last=index.indices[finish];
  if(first===undefined||last===undefined)return false;
  if(/[a-z0-9]/.test(term[0])&&/[a-z0-9]/.test(index.text[first-1]||''))return false;
  if(/[a-z0-9]/.test(term.at(-1))&&/[a-z0-9]/.test(index.text[last+1]||''))return false;
  return true;
}
function containsPhrase(text,phrase){const index=textIndex(text),term=compact(phrase);if(!term)return false;for(let at=index.key.indexOf(term);at>=0;at=index.key.indexOf(term,at+1))if(bounded(index,at,term))return true;return false;}
export function resolveSearchTerm(value){
  const index=textIndex(value),ids=[],unmatched=[];let at=0;
  while(at<index.key.length){const match=searchAliases.find(a=>index.key.startsWith(a.key,at)&&bounded(index,at,a.key));
    if(match){ids.push(match.id);at+=match.key.length;continue;}
    const start=at++;while(at<index.key.length&&!searchAliases.some(a=>index.key.startsWith(a.key,at)&&bounded(index,at,a.key)))at++;
    unmatched.push(index.text.slice(index.indices[start],index.indices[at-1]+1));
  }
  const unique=[...new Set(ids)];
  // An exact model already contains its brand constraint. Do not split equivalent model queries into extra groups.
  const modelBrands=new Set(unique.map(id=>searchConceptById.get(id)).filter(e=>e.kind==='model').flatMap(e=>(e.match.brands||[]).map(brandName)));
  const conceptIds=unique.filter(id=>{const e=searchConceptById.get(id);return e.kind!=='brand'||!e.match.brands.some(b=>modelBrands.has(brandName(b)));}).sort();
  const literalTerms=unmatched.flatMap(t=>t.split(' ')).filter(Boolean);
  return {original:String(value||''),normalized:index.text,conceptIds,literalTerms,key:[...conceptIds,...literalTerms.map(t=>'literal:'+compact(t))].sort().join('|')};
}
const fieldText=(p,field)=>field==='colors'?(p.colors||[]).map(c=>typeof c==='string'?c:c.name).join(' '):String(p[field]||'');
function explicitCollaborator(product,brand){
  if(!Number.isFinite(Date.parse(product.productVerifiedAt||product.lastVerifiedAt))||!product.productEvidenceUrl)return false;
  const name=String(product.name||'').replace(/×/g,' x ');
  if(!/\b(?:x|collab(?:oration)?)\b/i.test(name))return false;
  if(/\binspired by\b|\btribute to\b|\brecommended\b|\bin the style of\b/i.test(name))return false;
  const index=textIndex(name),entry=searchConceptById.get(`brand:${compact(brandName(brand))}`);
  for(const alias of entry?.aliases||[]){const term=compact(alias);for(let at=index.key.indexOf(term);at>=0;at=index.key.indexOf(term,at+1)){
    if(!bounded(index,at,term))continue;
    const before=index.text.slice(0,index.indices[at]).trim(),after=index.text.slice(index.indices[at+term.length-1]+1).trim();
    if(/(?:^|\s)x$|(?:^|\s)collab(?:oration)?(?: with)?$/.test(before)||/^(?:x|collab(?:oration)?(?: with)?)(?:\s|$)/.test(after))return true;
  }}
  return false;
}
export function productCollaborationBrands(product){
  return SEARCH_CONCEPTS.filter(e=>e.kind==='brand'&&e.match.brands.some(b=>brandName(b)!==brandName(product.brand)&&explicitCollaborator(product,b))).flatMap(e=>e.match.brands);
}
function matchesConcept(p,entry,themeIds){
  const m=entry.match;
  if(m.brands&&!m.brands.some(b=>brandName(p.brand)===brandName(b)||entry.kind==='brand'&&explicitCollaborator(p,b)))return false;
  if(m.categories&&!m.categories.includes(p.category||p.productType))return false;
  if(m.themeIds&&!m.themeIds.some(id=>themeIds.has(id)))return false;
  if(m.allThemeIds&&!m.allThemeIds.every(id=>themeIds.has(id)))return false;
  if(m.allConditions&&!m.allConditions.every(c=>c.terms.some(term=>c.fields.some(field=>containsPhrase(fieldText(p,field),term)))))return false;
  if(m.fields&&!m.terms.some(term=>m.fields.some(field=>containsPhrase(fieldText(p,field),term))))return false;
  return true;
}
export function productSearchConceptIds(product){
  const themeIds=new Set(product.keywordTags||productKeywordIds(product));
  return SEARCH_CONCEPTS.filter(entry=>matchesConcept(product,entry,themeIds)).map(e=>e.id);
}
const publiclyVerifiableKinds=new Set(['brand','model','category','color']);
export function validPublicSearchConcepts(product){
  const themes=new Set(product.keywordTags||productKeywordIds(product));
  return (product.searchConceptIds||[]).every(id=>{const entry=searchConceptById.get(id);return entry&&(!publiclyVerifiableKinds.has(entry.kind)||matchesConcept(product,entry,themes));});
}
export function matchesSearchTerm(product,term){
  const resolved=typeof term==='string'?resolveSearchTerm(term):term;
  if(!resolved.key)return false;
  const concepts=new Set(product.searchConceptIds||productSearchConceptIds(product));
  if(!resolved.conceptIds.every(id=>concepts.has(id)))return false;
  const themes=new Set(product.keywordTags||productKeywordIds(product));
  if(!resolved.conceptIds.every(id=>{const entry=searchConceptById.get(id);return !publiclyVerifiableKinds.has(entry.kind)||matchesConcept(product,entry,themes);} ))return false;
  const identity=['name','brand','style','colorway','colors','material'].map(field=>fieldText(product,field)).join(' ');
  return resolved.literalTerms.every(term=>containsPhrase(identity,term));
}
export function searchTermAliases(term){const resolved=typeof term==='string'?resolveSearchTerm(term):term;return resolved.conceptIds.length===1&&!resolved.literalTerms.length?[...new Set(searchConceptById.get(resolved.conceptIds[0])?.aliases||[])]:[resolved.original];}
export function isFootwearSearchTerm(term,{scope,products=[]}={}){
  const resolved=typeof term==='string'?resolveSearchTerm(term):term;if(!resolved.key)return false;
  if(searchDictionary.excludedQueryTerms.some(t=>containsPhrase(resolved.original,t)))return false;
  if(['footwear','shoes','sneakers'].includes(scope))return true;
  if(scope==='fashion-colour-forecast'&&!resolved.literalTerms.length&&resolved.conceptIds.length&&resolved.conceptIds.every(id=>searchConceptById.get(id)?.kind==='color'))return true;
  if(resolved.conceptIds.some(id=>searchConceptById.get(id)?.footwearRelevant===true||['brand','model','category','shape','use'].includes(searchConceptById.get(id)?.kind)))return true;
  return products.some(p=>compact(p.style)&&compact(p.style)===compact(resolved.original)||compact(p.name)===compact(resolved.original));
}
// Popularity is a style research view. Keep brand/model aliases for product search,
// but do not turn brand demand, model demand, or a generic shoe category into a style trend.
export function isStyleTrendTerm(term,options={}){
  const resolved=typeof term==='string'?resolveSearchTerm(term):term;
  if(!isFootwearSearchTerm(resolved,options)||resolved.literalTerms.length)return false;
  const concepts=resolved.conceptIds.map(id=>searchConceptById.get(id));
  if(concepts.some(c=>c?.kind==='brand'))return false;
  // A model name can be useful for product matching, but it is never a
  // style-trend keyword. Weekly trends must describe a form, material,
  // colour, pattern or use that can apply across products.
  return concepts.some(c=>['style','shape','material','color','pattern','structure','use','attribute'].includes(c?.kind));
}
