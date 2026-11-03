import test from 'node:test';
import assert from 'node:assert/strict';
import {weekKey,recordResearchWeek,fourWeekChange,referencePrices} from '../scripts/build-research-brief.mjs';
import {validateReviewBoard,mergeReviewBoards,briefExportHtml} from '../public/assets/research-brief.mjs';
import {isAllowedFeedLook} from '../public/assets/research-policy.mjs';
import {composeSnapshot} from '../scripts/build-catwalk-snapshot.mjs';
test('HeeledPump is excluded from feed collection and composition, while runway remains intact',()=>{
 assert.equal(isAllowedFeedLook({collection:'fashion-feed',hashtags:['#Suede','#HeeledPump']}),false);
 assert.equal(isAllowedFeedLook({collection:'fashion-feed',hashtags:[' #heeledpump ']}),false);
 assert.equal(isAllowedFeedLook({collection:'runway',hashtags:['#HeeledPump']}),true);
 assert.equal(isAllowedFeedLook({collection:'fashion-feed',hashtags:['#HeeledSandal']}),true);
 const result=composeSnapshot([{season:'Spring/Summer 2027',collection:'fashion-feed',looks:[{id:'bad',hashtags:['#HeeledPump']},{id:'good',hashtags:['#Sneakers']}]},{season:'Spring/Summer 2027',looks:[{id:'runway',hashtags:['#HeeledPump']}]}]);
 assert.deepEqual(result.snapshot.looks.map(l=>l.id).sort(),['good','runway']);
});
test('weekly model history needs four consecutive observations in the same cohort',()=>{
 assert.equal(weekKey(new Date('2026-11-01T00:00:00+09:00')),'2026-11-01');
 let history;
 for(const [i,week] of ['2026-10-11','2026-10-18','2026-10-25','2026-11-01'].entries())history=recordResearchWeek(history,{week,models:100,topics:{suede:10+i*10}},'scope');
 assert.equal(fourWeekChange(history.series.scope.slice(0,3),'suede').ready,false);
 assert.equal(fourWeekChange(history.series.scope,'suede').percentagePoints,30.000000000000004);
 assert.equal(fourWeekChange([history.series.scope[0],...history.series.scope.slice(2),{week:'2026-11-08',models:100,topics:{suede:20}}],'suede').ready,false);
 history=recordResearchWeek(history,{week:'2026-11-01',models:200,topics:{suede:40}},'scope');
 assert.equal(history.series.scope.length,4,'Repeat builds replace the same week');
 assert.equal(Math.round(fourWeekChange(history.series.scope,'suede').percentagePoints),10,'Compare model shares instead of raw counts');
 history=recordResearchWeek(history,{week:'2026-11-01',models:300,topics:{suede:30}},'new-scope');
 assert.equal(fourWeekChange(history.series['new-scope'],'suede').ready,false);
});
test('review imports validate, preserve newer records, and exports escape notes',()=>{
 const row={stage:'sample',metric:'actual',baseline:'A/B',result:'<script>alert(1)</script>',decision:'pending',updatedAt:'2026-11-03T01:00:00Z'};
 const valid=validateReviewBoard({schemaVersion:1,records:{'style-suede:v1':row}});
 assert.throws(()=>validateReviewBoard({schemaVersion:1,records:{x:row}}));
 assert.throws(()=>validateReviewBoard({schemaVersion:1,records:{'style-suede:v1':{...row,result:99}}}));
 assert.deepEqual(mergeReviewBoards(valid,{'style-suede:v1':{...row,updatedAt:'2026-11-02T00:00:00Z'}}),valid);
 const html=briefExportHtml({asOf:'2026-11-03',scope:{models:100,description:'Official'},planVersion:1,ideas:[{id:'style-suede',rank:1,label:'Suede',models:10,independentDomains:1,sources:[],change:{ready:false,weeks:1}}]},valid);
 assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('1/4'));
 assert.equal(referencePrices([]).models,0);
});
