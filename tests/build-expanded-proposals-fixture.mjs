// Synthetic provenance for pure validation tests; never a published review record.
import {createHash} from 'node:crypto';
import {proposalFixture} from './proposal-hero-fixture.mjs';
export const reports=[{id:'ss',title:'Sneakers S/S 27',pages:Array(8).fill('/fixture-page.jpg')},{id:'fw',title:'Sneakers A/W 27/28',pages:Array(8).fill('/fixture-page.jpg')},{id:'next',title:'Sneakers S/S 28',pages:Array(8).fill('/fixture-page.jpg')}];
export function reviewedFixture(){
 const d=proposalFixture();
 for(const idea of d.ideas){
  idea.familyKey=idea.id;idea.construction.distinctive+=' '+idea.id;
  idea.tags=['TeamColor','Slim','Nylon'];idea.strategies=['나일론 갑피 적용','팀 컬러 적용','밑창 구조 검토','검증 · 착화감'];
  idea.forecast[0].id={ '27SS':'ss','27FW':'fw','28SS':'next'}[idea.season];
  for(const [i,r] of [idea.hero,...idea.references].entries()){
   r.imageHash=createHash('sha256').update(idea.id+':'+i).digest('hex');r.width=800;r.height=1200;r.reviewStatus='reviewed';r.modelKey=idea.id+':'+i;
  }
 }
 return d;
}
