import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSearchTerm,resolveSearchTerm,matchesSearchTerm,productSearchConceptIds,isFootwearSearchTerm,SEARCH_CONCEPTS,validPublicSearchConcepts} from '../scripts/keyword-taxonomy.mjs';
const shoe=(patch={})=>({id:'shoe',brand:'New Balance',name:'Made in UK 991v1',category:'sneaker',productType:'sneaker',material:'Premium suede upper; rubber outsole',colorway:'COCOA with CASTLEWALL',description:'Retro runner with ENCAP cushioning.',...patch});
test('reviewed Korean/English synonyms, spaces and footwear plurals resolve to the same combined concept',()=>{
 for(const [ko,en]of [['브라운 스니커즈','brown sneakers'],['스웨이드 운동화','suede sneaker'],['메리 제인 스니커즈','Mary Jane sneakers'],['뉴발란스530','New Balance 530'],['푸마 스피드캣','PUMA Speedcat']])assert.equal(resolveSearchTerm(ko).key,resolveSearchTerm(en).key,`${ko} / ${en}`);
 assert.equal(normalizeSearchTerm('Hermès'),'hermes');assert.equal(normalizeSearchTerm('ASICS'),'asics');
 assert.equal(resolveSearchTerm('뉴 발 란 스 530').key,resolveSearchTerm('뉴발란스530').key);
 assert(matchesSearchTerm(shoe(),'브라운스니커즈'));
 assert(matchesSearchTerm(shoe(),'스웨이드 운동화'));
});
test('every part of a composite query must match; article keywords and other colorways cannot supply colors',()=>{
 assert(!matchesSearchTerm(shoe({colorway:'WHITE',sourceSignals:[{keywords:['brown']}]}),'브라운 스니커즈'));
 assert(!matchesSearchTerm(shoe({material:'Synthetic upper'}),'스웨이드 스니커즈'));
 assert(!matchesSearchTerm(shoe({brand:'Nike'}),'뉴발란스 스니커즈'));
 assert(!matchesSearchTerm(shoe({category:'clog',productType:'clog'}),'브라운 스니커즈'));
});
test('brand/model aliases stay specific and numeric tokens cannot match another SKU',()=>{
 const nb530=shoe({name:'530',style:'MR530AA'}),nb327=shoe({name:'327'});
 assert(matchesSearchTerm(nb530,'뉴발란스530'));assert(!matchesSearchTerm(nb327,'뉴발란스530'));
 assert(!matchesSearchTerm(shoe({brand:'Nike',name:'Air Force 1',style:'TEST530-100'}),'530'));
 assert(matchesSearchTerm(shoe({brand:'PUMA',name:'Speedcat OG'}),'스피드캣'));
 assert(!matchesSearchTerm(shoe({brand:'PUMA',name:'Slim court sneaker',description:'Low-profile silhouette'}),'스피드캣'));
 assert(!matchesSearchTerm(shoe({brand:'Onitsuka Tiger',name:'Mexico 66'}),'On'));
 assert(matchesSearchTerm(shoe({brand:'On',name:'Cloud 5'}),'온 러닝'));
 const tampered={...nb530,searchConceptIds:[...productSearchConceptIds(nb530),'brand:nike','color:red']};assert(!matchesSearchTerm(tampered,'나이키'));assert(!matchesSearchTerm(tampered,'레드 스니커즈'));assert(!validPublicSearchConcepts(tampered));
});
test('original terms stay unchanged; unknown phrases only match literal identity',()=>{
 const query='뉴발란스 991V1';assert.equal(resolveSearchTerm(query).original,query);assert(matchesSearchTerm(shoe(),query));
 assert(!matchesSearchTerm(shoe(),'스웨이드 무관한단어'));
 assert(!matchesSearchTerm(shoe({description:'Other models are called Banana Shoe'}),'Banana Shoe'));
 assert(matchesSearchTerm(shoe({name:'Banana Shoe'}),'Banana Shoe'));
});
test('shoe relevance excludes clothing/furniture and ambiguous standalone attributes outside a shoe ranking',()=>{
 assert(isFootwearSearchTerm('뉴발란스530'));assert(isFootwearSearchTerm('미우미우'));assert(isFootwearSearchTerm('브라운 스니커즈'));
 assert(isFootwearSearchTerm('러닝화'));assert(isFootwearSearchTerm('gorpcore'));assert(isFootwearSearchTerm('레트로 러너'));assert(isFootwearSearchTerm('low profile'));
 assert(!isFootwearSearchTerm('브라운'));assert(isFootwearSearchTerm('브라운',{scope:'footwear'}));
 assert(!isFootwearSearchTerm('스웨이드'));assert(!isFootwearSearchTerm('나이키 패딩'));assert(!isFootwearSearchTerm('아디다스 팬츠'));assert(!isFootwearSearchTerm('테이블',{scope:'footwear'}));
 assert(!isFootwearSearchTerm('나이키 바람막이'));assert(!isFootwearSearchTerm('더비슈즈'));
 assert(!isFootwearSearchTerm('원피스'));assert(!isFootwearSearchTerm('하이힐'));
});
test('public concept IDs preserve verified raw attributes after descriptions are shortened',()=>{
 const raw=shoe({name:'Daily trainer',description:'A breathable mesh running shoe',material:'Synthetic upper'}),searchConceptIds=productSearchConceptIds(raw);
 assert(matchesSearchTerm({...raw,description:'스니커즈',searchConceptIds},'메쉬 러닝화'));
 assert.equal(new Set(SEARCH_CONCEPTS.map(x=>x.id)).size,SEARCH_CONCEPTS.length);
});
test('verified explicit collaborators match without changing the primary brand or inferring affiliates',()=>{
 const collab=shoe({brand:'ASICS',name:'Cecilie Bahnsen × ASICS GEL-Kinetic',lastVerifiedAt:'2026-09-28T00:00:00Z',productEvidenceUrl:'https://www.asics.com/us/en-us/product.html'});
 assert(matchesSearchTerm(collab,'Cecilie Bahnsen'));assert(matchesSearchTerm(collab,'세실리에 반센'));assert(matchesSearchTerm(collab,'아식스'));assert.equal(collab.brand,'ASICS');
 assert(matchesSearchTerm({...collab,name:'ASICS in collaboration with Cecilie Bahnsen'},'Cecilie Bahnsen'));
 assert(!matchesSearchTerm({...collab,name:'ASICS GEL-Kinetic',description:'Recommended: Cecilie Bahnsen x ASICS sneakers'},'Cecilie Bahnsen'));
 assert(!matchesSearchTerm({...collab,name:'ASICS sneaker inspired by Cecilie Bahnsen'},'Cecilie Bahnsen'));
 assert(!matchesSearchTerm({...collab,lastVerifiedAt:undefined},'Cecilie Bahnsen'));
 assert(!matchesSearchTerm(shoe({brand:'Jordan',name:'Air Jordan 1'}),'나이키'));
});
