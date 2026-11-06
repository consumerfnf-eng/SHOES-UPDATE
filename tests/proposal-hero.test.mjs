import test from 'node:test';
import assert from 'node:assert/strict';
import {proposalCounts,filterProposals,proposalCardMarkup,proposalPhotoCaption,sourceDateNotes,PROPOSAL_PAGE_SIZE} from '../public/assets/research-brief.mjs';
import {BOARD_SIZE,HERO_RECT,referenceRect,getBoardLayout,jpegPdf,boardHeaderText,boardTextLines} from '../public/assets/board-export.mjs';
import {boardPages,boardAssetEntries} from '../public/assets/board-store.mjs';
import {proposalEntrySource} from '../public/assets/reference-boards.mjs';

import {proposalFixture} from './proposal-hero-fixture.mjs';

test('105 concepts expose actual per-season quotas, independent search and legacy category-free boards',()=>{
 const d=proposalFixture();assert.equal(d.ideas.length,105);assert.equal(PROPOSAL_PAGE_SIZE,12);
 for(const s of d.seasons)assert.deepEqual(proposalCounts(d,s),{total:35,daily:10,feminine:10,active:9,seasonal:6});
 assert.equal(filterProposals(d,{season:'27FW',category:'active'}).length,9);
 assert.equal(filterProposals(d,{season:'28SS',search:'분리형 토캡'}).length,35);
 assert.equal(filterProposals(d,{season:'27SS',search:'Concept 27SS 34'}).length,1);
 assert.equal(filterProposals({schemaVersion:2,ideas:[{season:'27SS',title:'Old'}]},{season:'27SS'}).length,1);
});
test('cards request only small previews and disclose exact source season, claims and six reference roles',()=>{
 const d=proposalFixture(),idea=d.ideas[0],html=proposalCardMarkup(idea,2,d);
 assert.match(html,/<img src="\/proposals\/27ss-0\/preview.webp"/);assert.doesNotMatch(html,/<img[^>]+board.png/);
 assert.match(html,/loading="lazy"/);assert.match(proposalCardMarkup(idea,0,d),/loading="eager"/);
 assert.equal((html.match(/class="proposal-reference-source"/g)||[]).length,6);
 for(const value of ['확인한 페이지의 구체적 주장','확인한 원문 제목','p.4','구조 참고','연결 근거 5','Editorial © Photographer','26FW','이전 시즌 사진','6000'])assert(html.includes(value),value);
 assert.match(proposalPhotoCaption(idea.hero,'28SS'),/26FW.*이전 시즌 사진 · 28SS 기획 참고/);
 assert.doesNotMatch(proposalCardMarkup({...idea,title:'<script>x</script>',pdf:'javascript:x'},0,d),/<script>|href="javascript:/);
});
test('editor import preserves all six notes and provenance, with independent editorial source',()=>{
 const i=proposalFixture().ideas[0],ref=proposalEntrySource(i.references[0]),hero=proposalEntrySource(i.hero,{},true);
 assert.equal(ref.memo,'연결 근거 0');assert.equal(ref.roleLabel,'구조 참고');assert.deepEqual(ref.matchEvidence,{upper:'나일론'});
 assert.equal(hero.kind,'show');assert.equal(hero.sourceSeason,'26FW');assert.equal(hero.credit,'Editorial © Photographer');assert.equal(hero.seasonRelation,'earlier-season');assert.equal(hero.imageUrl,'/fixture-0.png');
 const mlb=proposalEntrySource({...i.references[0],kind:'mlb',original:'/proposals/mlb/abc.jpg'});assert.equal(mlb.kind,'product');assert.equal(mlb.imageUrl,'/proposals/mlb/abc.jpg');assert.equal(mlb.roleLabel,'구조 참고');assert.equal(proposalEntrySource({...i.references[0],kind:'catwalk'}).kind,'show');assert.equal(proposalEntrySource({...i.references[0],kind:'show'}).kind,'show');
 const b={hero:{assetId:'hero'},heroOriginal:{assetId:'original'},entries:i.references.map((r,j)=>({assetId:'ref'+j}))};
 assert.equal(boardPages(b)[0].length,6);assert.equal(boardAssetEntries(b).length,8);
});
test('hero geometry is separate from two by three references, manual boards retain three by two layout',()=>{
 assert.deepEqual(BOARD_SIZE,{width:6000,height:3375});assert.equal(BOARD_SIZE.width/BOARD_SIZE.height,16/9);
 const shared=getBoardLayout({hero:true});assert.deepEqual(shared.hero,HERO_RECT);assert.equal(shared.references.length,6);assert.deepEqual(shared.references[5],referenceRect({hero:true},5));assert.equal(shared.copy.x,1120);assert.equal(getBoardLayout().hero,null);
 assert(HERO_RECT.x+HERO_RECT.width<referenceRect({hero:{}},0).x);
 const hero=Array.from({length:6},(_,i)=>referenceRect({hero:{}},i));
 assert.equal(new Set(hero.map(r=>r.x)).size,2);assert.equal(new Set(hero.map(r=>r.y)).size,3);
 const manual=Array.from({length:6},(_,i)=>referenceRect({},i));assert.equal(new Set(manual.map(r=>r.x)).size,3);assert.equal(new Set(manual.map(r=>r.y)).size,2);
});
test('PDF image dimensions and page ratio derive from real rendered dimensions',async()=>{
 const text=await jpegPdf([{bytes:new Uint8Array([255,216,255,217]),width:6000,height:3375,links:[]}]).text();
 assert.match(text,/\/Width 6000 \/Height 3375/);assert.match(text,/\/MediaBox \[0 0 960 540\]/);assert.doesNotMatch(text,/4800/);
 const custom=await jpegPdf([{bytes:new Uint8Array([1]),width:1600,height:1000}]).text();assert.match(custom,/\/MediaBox \[0 0 960 600\]/);
});

test('source date notes read dates from status receipts without serializing objects or status labels',()=>{
 const note=sourceDateNotes({catalog:{checkedAt:'2026-11-02T09:15:45.115Z',counts:{published:7171},selectionBasis:'official-current-assortment'},keywords:'2026-10-29T12:01:18.605Z',rankings:[{label:'공식 순위',checkedAt:'2026-11-03T04:45:23.310Z',basis:'not a date'}],bad:{status:'pending'},invalid:'not a date'});
 assert.equal(note,'공식 상품 2026-11-02 확인 · 스타일 2026-10-29 확인 · 공식 순위 2026-11-03 확인');
 assert.equal(sourceDateNotes(), '');assert.doesNotMatch(note,/object Object|pending|not a date/);
});

test('reviewed reference frame wins over product presentation; missing frames retain foreground auto-crop',()=>{
 const reference=proposalFixture().ideas[0].references[0],frame={x:.1,y:.3,width:.8,height:.4},productFrame={x:0,y:0,width:1,height:1},product={presentation:{frame:productFrame}};
 assert.deepEqual(proposalEntrySource({...reference,frame},product).frame,frame);
 assert.deepEqual(proposalEntrySource(reference,product).frame,productFrame);
 assert.equal(proposalEntrySource({...reference,cropMode:'auto'},product).frame,undefined,'Explicit auto crop must bypass the legacy catalog frame');
 assert.equal(proposalEntrySource(reference).frame,undefined);
 assert.equal(proposalEntrySource({...reference,frame},product,true).frame,undefined);
});
test('rendered header removes one exact leading project prefix without changing stored project',()=>{
 const board=Object.freeze({season:'27SS',project:'MLB 27SS · FOLD TONGUE TERRACE'});
 assert.equal(boardHeaderText(board),'MLB · 27SS · FOLD TONGUE TERRACE');assert.equal(board.project,'MLB 27SS · FOLD TONGUE TERRACE');
 assert.equal(boardHeaderText({season:'27FW',project:'Custom MLB 27FW · TITLE'}),'MLB · 27FW · Custom MLB 27FW · TITLE');
 assert.equal(boardHeaderText({season:'27SS',project:'MLB 27SS · MLB 27SS · TITLE'}),'MLB · 27SS · MLB 27SS · TITLE');
 assert.equal(boardHeaderText({season:'28SS',project:'MLB 27SS · TITLE'}),'MLB · 28SS · MLB 27SS · TITLE');
});
test('English wraps by word; Hangul and overlong identifiers can wrap by character',()=>{
 const ctx={measureText:t=>({width:[...t].length})};
 assert.deepEqual(boardTextLines(ctx,'Aged Effects',8),['Aged','Effects']);
 assert.deepEqual(boardTextLines(ctx,'Retro Sneakers',9),['Retro','Sneakers']);
 assert.deepEqual(boardTextLines(ctx,'WGSN · p.8 Aged Effects',10),['WGSN · p.8','Aged','Effects']);
 assert.deepEqual(boardTextLines(ctx,'토캡과갑피소재',4),['토캡과갑','피소재']);
 assert.deepEqual(boardTextLines(ctx,'ABCDEFGHIJK',4),['ABCD','EFGH','IJK']);
 assert.deepEqual(boardTextLines(ctx,'갑피 Sneakers 밑창',9),['갑피','Sneakers','밑창']);
 assert.deepEqual(boardTextLines(ctx,'Aged\n\nEffects',9),['Aged','','Effects']);
});

test('reviewed reference labels override malformed legacy catalog color text, including intentional omission',()=>{
 const reference={id:'source',kind:'product',name:'Source',color:'',style:'REVIEWED'},product={colorway:'[![Image 115](https://example.com/image)',style:'LEGACY'};
 assert.equal(proposalEntrySource(reference,product).color,'');assert.equal(proposalEntrySource(reference,product).style,'REVIEWED');
 assert.equal(proposalEntrySource({...reference,color:'White'},product).color,'White');
 const legacy={...reference};delete legacy.color;assert.equal(proposalEntrySource(legacy,{colorway:'Black'}).color,'Black');
});

test('WGSN feed curation is labelled separately from a photographed runway collection',()=>{
 const label=proposalPhotoCaption({credit:'Source · WGSN Fashion Feed',sourceSeason:'WGSN 27SS 피드 분류',seasonRelation:'curated-season'},'28SS');
 assert.match(label,/WGSN 27SS 피드 분류/);assert(!/동일 시즌 출처 사진|이전 시즌 사진/.test(label));
});
