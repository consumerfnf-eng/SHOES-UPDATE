// Reconcile the proposal interpretation with the site's existing source snapshots.
// Text matches are inventory context, never a sales or future-demand measurement.
import fs from 'node:fs/promises';
import {prepareCatalog} from '../public/assets/catalog-runtime.mjs';
import {variantGroupKey,filterProducts,kstToday} from '../public/assets/catalog-view.mjs';
import {proposalEvidence} from './build-season-proposals.mjs';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const configPath=process.argv[2]||'data/season-proposals.json',config=await read(configPath);
if(config.schemaVersion!==3)throw Error('Expanded config required');
const [catalog,monthly,ranks,social,catwalk,forecast]=await Promise.all(['catalog','monthly-catalog','rank-boards','trend-keywords','catwalk','forecast'].map(n=>read('public/data/'+n+'.json')));
const today=kstToday(new Date()),runtime=prepareCatalog(catalog,monthly,social,today);
runtime.products=filterProducts(runtime.products,{source:'all',search:'',brands:new Set(),category:'all',release:'released',sort:'newest'},today);
const context={runtime,monthly,ranks,social,keywords:catalog.styleTrendKeywords?.items||[],catwalk};
for(const idea of config.ideas)idea.evidence=proposalEvidence(idea,context);
config.coverage={officialRecords:catalog.products.length,retailRecords:monthly.retail.length,newsletterRecords:monthly.newsletter.length,publishedModels:new Set(runtime.products.map(variantGroupKey)).size,rankItems:ranks.boards.reduce((n,b)=>n+b.items.length,0),styleKeywords:catalog.styleTrendKeywords?.items?.length||0,socialKeywords:social.keywords.length,catwalkLooks:catwalk.looks.length,forecastReports:forecast.reports.length,forecastPages:forecast.reports.reduce((n,r)=>n+r.pages.length,0)};
config.sourceDates={monthly:monthly.publishedAt,keywords:catalog.styleTrendKeywords?.updated,social:social.generatedAt,catwalk:catwalk.builtAt,forecast:forecast.checkedAt,rankings:ranks.boards.map(b=>({label:b.label,checkedAt:b.checkedAt}))};
config.method+=' 공식·리테일·뉴스레터·랭킹·SNS·CATWALK 보유 자료를 함께 대조. 문자 정보 연결 수는 보유 자료의 맥락이며 판매량·미래 수요의 확정 근거가 아님. 각 사진은 표시한 구성 요소의 레퍼런스이며 제안 전체와 동일한 기성 상품을 의미하지 않음.';
await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({ideas:config.ideas.length,coverage:config.coverage}));
