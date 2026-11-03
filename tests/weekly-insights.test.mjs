import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWeeklySnapshot,insightWeek} from '../scripts/build-weekly-insights.mjs';
import {weeklyInsightMarkup} from '../public/assets/weekly-insights.mjs';
const now=new Date('2026-11-03T05:00:00Z');
const direction={id:'retro',title:'Retro',pattern:'retro',tags:['Retro'],proposals:['idea'],seasons:['27SS'],observation:'Current shared signal',item:'MLB runner',action:'Design hypothesis'};
const products=['Alpha','Bravo','Charlie'].map((name,i)=>({id:'p'+i,brand:'Nike',name:'Retro '+name,productType:'sneaker',style:'SKU'+i,colorway:'White'}));
const base=()=>({now,directions:[direction],products:[...products,{...products[0],id:'colour',colorway:'Black'}],ranks:{boards:[{id:'ranking',label:'Market',checkedAt:now.toISOString(),comparedWith:'2026-10-27',items:[{key:'1',name:'Retro',rank:2,previousRank:4,movement:'up',url:'https://example.org/shoe'}]}]},proposals:{sourceDates:{},ideas:[{id:'idea',season:'27SS',title:'Retro',subtitle:'Runner',download:'/proposals/idea/board.png',references:[{id:'p0',kind:'product',brand:'Nike',name:'Retro Alpha',image:'/proposals/references/abc.jpg',url:'https://example.org/shoe'},{id:'show',kind:'catwalk',brand:'Show',name:'Look',season:'Spring/Summer 2027',image:'/proposals/references/def.jpg',url:'https://example.org/show'}],forecast:[{id:'report',title:'Sneakers S/S27',page:4,url:'https://example.org/report'}]}]}});
test('weekly synthesis requires all four source classes and excludes stale or future rank readings',()=>{
 const s=buildWeeklySnapshot(base());assert.equal(s.cards.length,1);assert.equal(s.cards[0].officialModels,3);assert.equal(s.cards[0].movement.length,1);assert.equal(s.cards[0].movement[0].previousRank,4);
 for(const change of [a=>a.ranks.boards[0].staleSince='2026-10-30',a=>a.ranks.boards[0].checkedAt='2026-09-01',a=>a.ranks.boards[0].checkedAt='2026-12-01',a=>a.proposals.ideas[0].forecast=[],a=>a.proposals.ideas[0].references=a.proposals.ideas[0].references.filter(r=>r.kind!=='catwalk'),a=>a.products=[]]){const input=base();change(input);assert.equal(buildWeeklySnapshot(input).cards.length,0);}
 const prior=base();prior.ranks.boards[0].checkedAt='2026-10-30';assert.equal(buildWeeklySnapshot(prior).cards[0].movement.length,0);
 const first=base();first.ranks.boards[0].comparedWith=null;assert.equal(buildWeeklySnapshot(first).cards[0].movement.length,0);
 assert.deepEqual(insightWeek('2026-11-01'),{start:'2026-10-26',end:'2026-11-01'});assert.deepEqual(insightWeek('2026-11-02'),{start:'2026-11-02',end:'2026-11-08'});
});
test('insight cards distinguish interpretation from evidence and escape source content',()=>{
 const s=buildWeeklySnapshot(base());s.cards[0].title='<script>unsafe</script>';s.cards[0].forecast[0].url='javascript:alert(1)';
 const html=weeklyInsightMarkup(s);assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!html.includes('javascript:'));assert(html.includes('기획 제안'));assert(html.includes('이번 주 랭킹 변화'));assert(html.includes('4위 → 2위'));assert(html.includes('Spring/Summer 2027'));assert(!html.includes('시장 점유율 상승'));
});
