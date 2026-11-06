import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {reviewedFixture as proposalFixture,reports} from './build-expanded-proposals-fixture.mjs';
import {validateExpandedConfig,expandedBoardFields,expandedPublicFile,buildExpandedProposals,assertProposalAssetSize,MAX_PROPOSAL_ASSET_BYTES,SEASON_JPEG_SIZE,createExpandedRenderer} from '../scripts/build-expanded-proposals.mjs';
import {validateProposalConfig} from '../scripts/build-season-proposals.mjs';

test('expanded config validates 105 source-complete ideas and exact category quotas through legacy router',()=>{
 const fixture=proposalFixture();assert.equal(validateExpandedConfig(fixture,reports).ideas,105);assert.equal(validateProposalConfig(fixture,reports).ideas,105);
 const short=structuredClone(fixture);short.ideas.pop();assert.throws(()=>validateExpandedConfig(short,reports),/105/);
 const quota=structuredClone(fixture);quota.ideas[0].category='active';assert.throws(()=>validateExpandedConfig(quota,reports),/quota/);
 const repeated=structuredClone(fixture);repeated.ideas[1].id=repeated.ideas[0].id;assert.throws(()=>validateExpandedConfig(repeated,reports),/Duplicate/);
 const duplicateTitle=structuredClone(fixture);duplicateTitle.ideas[35].title=duplicateTitle.ideas[0].title;assert.throws(()=>validateExpandedConfig(duplicateTitle,reports),/concept title/);
 const hero=structuredClone(fixture);delete hero.ideas[0].hero.sourceSeason;assert.throws(()=>validateExpandedConfig(hero,reports),/Hero source/);
 const forecast=structuredClone(fixture);delete forecast.ideas[0].forecast[0].claim;assert.throws(()=>validateExpandedConfig(forecast,reports),/forecast/);
 const wrong=structuredClone(fixture);wrong.ideas[0].references[0].original='https://example.org/image.jpg';assert.throws(()=>validateExpandedConfig(wrong,reports),/same-origin/);
 const pending=structuredClone(fixture);pending.ideas[0].hero.reviewStatus='candidate';assert.throws(()=>validateExpandedConfig(pending,reports),/not visually reviewed/);
 const season=structuredClone(fixture);season.ideas[0].forecast[0].id='fw';assert.throws(()=>validateExpandedConfig(season,reports),/forecast page/);
});
test('static boardCopy overrides exactly, including blank text; fallback retains editable wording',()=>{
 const idea=proposalFixture().ideas[0],legacy=expandedBoardFields(idea);
 assert.equal(legacy.insight,idea.insight);assert.match(legacy.application,/나일론 갑피 적용/);assert.match(legacy.memo,/MLB 적합 근거 · MLB 컬러 적용/);
 const copy={insight:'짧은 인사이트',application:'첫 줄\n둘째 줄',memo:''},result=expandedBoardFields({...idea,boardCopy:copy});
 for(const key of Object.keys(copy))assert.equal(result[key],copy[key]);assert.equal(idea.insight,'확인한 근거로 제안');
 const strategy=expandedBoardFields({...idea,strategies:['갑피 적용','검증 · 착화감'],targetPrice:149000});
 assert.equal(strategy.application,'갑피 적용');assert.match(strategy.memo,/목표가 가설 · 149,000원\n검증 · 착화감/);
});
test('public asset resolution rejects traversal, credentials, remote URLs and encoded separators',()=>{
 const root=path.resolve('public');assert.equal(expandedPublicFile(root,'/proposals/mlb/a.jpg'),path.join(root,'proposals/mlb/a.jpg'));
 for(const url of ['//evil/a.jpg','https://a.example/a.jpg','/../secret','/%2e%2e/secret','/images/%5c..%5csecret','/a.jpg?x=1','/a.jpg#x'])assert.throws(()=>expandedPublicFile(root,url));
});
test('schema 3 defaults to validation only, without resolving images or starting Chromium',async()=>{
 const output=await buildExpandedProposals({config:proposalFixture(),reports,publicRoot:path.resolve('nonexistent-fixture-root'),onProgress:()=>{}});
 assert.equal(output.rendered,false);assert.equal(output.ideas,105);assert.deepEqual(output.boardSize,{width:6000,height:3375});
});
test('season JPEG recipe is bounded; Cloudflare guard rejects the 24 MiB boundary',()=>{
 assert.deepEqual(SEASON_JPEG_SIZE,{width:3000,height:1687,quality:.86});
 assert.doesNotThrow(()=>assertProposalAssetSize(MAX_PROPOSAL_ASSET_BYTES-1,'fixture'));
 assert.throws(()=>assertProposalAssetSize(MAX_PROPOSAL_ASSET_BYTES,'fixture'),/below 24 MiB/);
});

test('candidate preview mode requires a separate private output directory',async()=>{
 await assert.rejects(()=>createExpandedRenderer({previewOnly:true}),/Private previewDir/);
 await assert.rejects(()=>createExpandedRenderer({previewOnly:true,previewDir:path.resolve('public/proposals/pilot')}),/outside the public root/);
});
