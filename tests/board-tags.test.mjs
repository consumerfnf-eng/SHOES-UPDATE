import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestBoardTags} from '../public/assets/board-tags.mjs';
import {sourceCredit} from '../public/assets/board-export.mjs';
const context={keywords:[{label:'레트로',englishLabel:'Retro',aliases:['슬림 레트로']}],ideas:[{title:'SLIM RETRO',pattern:'slim|슬림',tags:['LowProfile','TeamColor']}]};
test('project tags use matching database vocabulary, ignore generic project titles',()=>{
 assert.deepEqual(suggestBoardTags('MLB 27SS Slim Retro',context),['#레트로','#LowProfile','#TeamColor']);
 assert.deepEqual(suggestBoardTags('MLB 27SS',context),[]);
 assert.deepEqual(suggestBoardTags('Unknown Exploration',context),[]);
});
test('visible source credit omits homepage addresses while preserving brand/season',()=>{
 assert.equal(sourceCredit({brand:'Dior',kind:'product',color:'White',sourceUrl:'https://www.dior.com/product'}),'Dior · White');
 assert.equal(sourceCredit({brand:'Miu Miu',kind:'show',sourceSeason:'27SS',sourceUrl:'https://wgsn.com/photo'}),'Miu Miu · 27SS');
});
