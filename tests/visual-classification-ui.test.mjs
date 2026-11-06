import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as visualModule from '../public/assets/visual-classification.mjs';
import {variantGroupKey, kstToday} from '../public/assets/catalog-view.mjs';

const app = await fs.readFile(new URL('../public/assets/app.mjs', import.meta.url), 'utf8');
const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const hash = n => n.toString(16).padStart(64, '0');
const product = (id, brand, model, image) => ({id, brand, name:model+' Sneaker', modelGroupId:model,
  category:'sneaker', productType:'sneaker', presentation:{cachedPath:`/images/${hash(image)}.webp`}});
const records = [[1,'low-profile'],[2,'low-profile'],[3,'low-profile'],[4,'chunky'],[5,'low-profile'],[6,'chunky']]
  .map(([image,category])=>({imageHash:hash(image),category,source:'model',confidence:0.99,margin:0.8,modelVersion:'ui-fixture-v1'}));
const snapshot = () => ({schemaVersion:1,model:{version:'ui-fixture-v1',sha256:hash(100),encoder:'fixture',validated:true,
  thresholds:Object.fromEntries(visualModule.VISUAL_CATEGORIES.map(c=>[c.id,{minConfidence:0.9,minMargin:0.2}]))},generatedAt:new Date().toISOString(),records:structuredClone(records)});
const rows = () => [
  product('a-white','Nike','Shared',1),product('a-black','Nike','Shared',2),product('a-unclassified','Nike','Shared',9),
  product('b','Prada','Shared',3),product('c','Nike','Chunky Model',4),
  product('d-white','Nike','Conflict',5),product('d-black','Nike','Conflict',6),
  product('e','Nike','Unknown',7),
  {...product('f','Nike','Stale Photo',8),visualClassification:{category:'low-profile'},imageHash:hash(1)},
];

// Exercise the actual UI functions with a small DOM adapter. The import is
// injected so the optional loader has no network or browser dependency in CI.
function uiHarness({payload=snapshot(),responseOk=true,fetcher,api=visualModule,reviews=null,reviewsStatus=404,fullProducts=rows()}={}) {
  const nodes=new Map();
  function node(id){
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'all',disabled:false,attributes:{},
      setAttribute(key,value){this.attributes[key]=value;},querySelector(selector){return node(id+' '+selector);}});
    return nodes.get(id);
  }
  let calls=0,renders=0;const requests=[];
  const sandbox={visualModule:api,variantGroupKey,console,initialProducts:fullProducts,
    fetch:async(url,options)=>{
      requests.push({url,options});
      if(url==='/api/visual-classifications')return {ok:reviewsStatus===200,status:reviewsStatus,json:async()=>reviews};
      if(fetcher)return fetcher(url,options);
      calls++;return {ok:responseOk,json:async()=>payload};
    },
    render:()=>{renders++;},document:{getElementById:node}};
  const core=app.slice(app.indexOf('let visualApi=null'),app.indexOf('function viewSourceMatches'))
    .replace("import('./visual-classification.mjs')",'Promise.resolve(visualModule)');
  const bars=app.slice(app.indexOf('const bar=(label,count,total,swatch)=>{'),app.indexOf('// Two boards'));
  const panel=app.slice(app.indexOf('function renderVisualPanel('),app.indexOf('let renderedRankBoards='));
  assert.ok(core.includes('function ensureVisualData'), 'UI loader section must be present');
  vm.runInNewContext(`const state={silhouette:'all'};let categoryRevision=0,products=initialProducts;const $=id=>document.getElementById(id);
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    ${core}\n${bars}\n${panel}
    globalThis.ui={state,ensureVisualData,visualSilhouetteBadge,visualModelCategories,filterVisualProducts,visualModelRows,renderVisualPanel,
      setProducts:next=>{products=next;syncVisualModelProducts();renderVisualControls();},status:()=>visualDataStatus,revision:()=>visualRevision,categoryRevision:()=>categoryRevision};`,sandbox);
  return {ui:sandbox.ui,node,requests,calls:()=>calls,renders:()=>renders};
}

test('photo silhouette filtering uses accepted exact-photo labels independently of official types',async()=>{
  const h=uiHarness(),products=rows(),before=structuredClone(products);
  await h.ui.ensureVisualData();h.ui.state.silhouette='low-profile';
  assert.deepEqual(Array.from(h.ui.filterVisualProducts(products),p=>p.id),['a-white','a-black','a-unclassified','b']);
  assert.equal(h.ui.filterVisualProducts([products.at(-1)]).length,0,'stale photo/product labels cannot substitute for registry evidence');
  const sibling={...products[0],presentation:{cachedPath:'/images/'+hash(999)+'.webp'}};
  assert.equal(h.ui.filterVisualProducts([sibling]).length,1,'same existing design may inherit a confirmed representative label');
  assert.match(h.ui.visualSilhouetteBadge(sibling),/동일 모델의 확인된 대표 이미지 기준/);
  assert.equal(h.ui.filterVisualProducts(products).some(p=>p.id==='d-white'||p.id==='d-black'),false,'conflicting models receive no majority or per-color category');
  assert.deepEqual(products,before,'filtering must not rewrite source categories or reviews');
  h.ui.state.silhouette='all';assert.equal(h.ui.filterVisualProducts(products),products);
});

test('analysis counts one model per brand, withholds conflicts, and scopes to supplied products',async()=>{
  const h=uiHarness();await h.ui.ensureVisualData();h.ui.renderVisualPanel(rows());
  assert.match(h.node('visual-model-coverage').textContent,/전체 6개 모델 · 분류 3개 · 미분류 2개/);
  const body=h.node('panel-visual-silhouette .panel-body').innerHTML;
  assert.match(body,/로우프로파일/);assert.match(body,/청키/);
  assert.match(body,/>2<small>66\.7%/);assert.match(body,/>1<small>33\.3%/);
  assert.match(h.node('panel-visual-silhouette .panel-note').textContent,/사진별 분류가 다른 1개 모델/);
  h.ui.renderVisualPanel(rows().filter(p=>p.brand==='Prada'));
  assert.match(h.node('visual-model-coverage').textContent,/전체 1개 모델 · 분류 1개/);
  assert.doesNotMatch(h.node('panel-visual-silhouette .panel-body').innerHTML,/청키/);
  h.ui.state.silhouette='low-profile';
  const scoped=rows(),matching=h.ui.filterVisualProducts(scoped);
  h.ui.renderVisualPanel(h.ui.visualModelRows(scoped,matching));
  assert.match(h.node('visual-model-coverage').textContent,/전체 2개 모델 · 분류 2개/);
  assert.doesNotMatch(h.node('panel-visual-silhouette .panel-note').textContent,/사진별 분류가 다른/,
    'conflicting models are withheld from the selected silhouette entirely');
});

test('late supplement registration refreshes the view once and offers only approved category options',async()=>{
  let release,calls=0;
  const h=uiHarness({fetcher:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  const first=h.ui.ensureVisualData(),second=h.ui.ensureVisualData();
  assert.equal(first,second);assert.equal(h.ui.status(),'loading');assert.equal(h.node('silhouette-filter').disabled,true);
  h.ui.renderVisualPanel(rows());assert.equal(h.node('panel-visual-silhouette').hidden,true);assert.equal(h.node('panel-visual-silhouette .panel-body').innerHTML,'');
  release({ok:true,json:async()=>snapshot()});await first;
  assert.equal(calls,1);assert.equal(h.renders(),1);assert.equal(h.ui.revision(),1);
  assert.equal(h.node('silhouette-filter').disabled,false);
  for(const c of visualModule.VISUAL_CATEGORIES)assert.ok(h.node('silhouette-filter').innerHTML.includes(`value="${c.id}"`));
  await h.ui.ensureVisualData();assert.equal(calls,1);
});

test('invalid or unavailable classifications leave the published list intact and show no candidate labels',async()=>{
  for(const payload of [null,{...snapshot(),model:{...snapshot().model,validated:false}},
    {...snapshot(),records:[{...records[0],confidence:0.1}]},
    {...snapshot(),records:[{...records[0],category:'uncertain-candidate'}]}]){
    const h=uiHarness({payload});await h.ui.ensureVisualData();
    assert.equal(h.ui.status(),'unavailable');assert.equal(h.node('silhouette-filter').disabled,true);
    const products=rows();assert.equal(h.ui.filterVisualProducts(products),products);
    h.ui.renderVisualPanel(products);
    assert.equal(h.node('panel-visual-silhouette').hidden,true);assert.equal(h.node('panel-visual-silhouette .panel-body').innerHTML,'');assert.equal(h.node('silhouette-filter-help').textContent,'');
    assert.doesNotMatch(h.node('silhouette-filter').innerHTML,/uncertain-candidate/);
  }
  const h=uiHarness({responseOk:false});await h.ui.ensureVisualData();await h.ui.ensureVisualData();assert.equal(h.calls(),1);
});

test('quality-held empty registry cannot filter away the catalog and exposes no warning panel',async()=>{
  const h=uiHarness({payload:{...snapshot(),model:{...snapshot().model,validated:false},records:[]}});
  await h.ui.ensureVisualData();
  assert.equal(h.ui.status(),'ready','a quality-held release is valid, not a load failure');
  assert.equal(h.node('silhouette-filter').disabled,true);assert.equal(h.node('silhouette-filter-label').hidden,true);
  assert.equal(h.node('silhouette-filter-help').hidden,true);assert.equal(h.node('silhouette-filter-help').textContent,'');
  h.ui.state.silhouette='low-profile';const products=rows();
  assert.equal(h.ui.filterVisualProducts(products),products,'even a stale selection cannot discard products without verified models');
  h.ui.renderVisualPanel(products);assert.equal(h.node('panel-visual-silhouette').hidden,true);
  assert.equal(h.node('panel-visual-silhouette .panel-body').innerHTML,'');assert.equal(h.node('visual-model-coverage').textContent,'');
});

test('explicit owner decision activates controls and panel after an empty quality-held snapshot',async()=>{
  const payload={...snapshot(),model:{...snapshot().model,validated:false},records:[]};
  const reviews={schemaVersion:1,updatedAt:new Date().toISOString(),records:[{imageHash:hash(7),category:'performance',status:'approved'}]};
  const h=uiHarness({payload,reviews,reviewsStatus:200});await h.ui.ensureVisualData();
  assert.equal(h.ui.categoryRevision(),1);assert.equal(h.ui.revision(),2);
  assert.equal(h.node('silhouette-filter').disabled,false);assert.equal(h.node('silhouette-filter-label').hidden,false);
  h.ui.renderVisualPanel(rows());assert.equal(h.node('panel-visual-silhouette').hidden,false);
  assert.match(h.node('panel-visual-silhouette .panel-body').innerHTML,/퍼포먼스/);
  h.ui.state.silhouette='performance';assert.deepEqual(Array.from(h.ui.filterVisualProducts(rows()),p=>p.id),['e']);
  visualModule.useVisualClassificationReviews({schemaVersion:1,records:[]});
});

test('accepted manual visual reviews remain usable without changing official footwear categories',async()=>{
  const payload={...snapshot(),model:{...snapshot().model,validated:false},records:[{
    imageHash:hash(7),category:'ballet-mary-jane',source:'manual',confidence:0.2,modelVersion:'ui-fixture-v1',
  }]};
  const h=uiHarness({payload});await h.ui.ensureVisualData();h.ui.state.silhouette='ballet-mary-jane';
  const products=rows(),before=structuredClone(products);
  assert.deepEqual(Array.from(h.ui.filterVisualProducts(products),p=>p.id),['e']);
  assert.equal(products.find(p=>p.id==='e').productType,'sneaker');assert.deepEqual(products,before);
});

test('protected owner overlay is applied after static registration and refreshes both UI revisions',async()=>{
  const events=[];
  const reviews={schemaVersion:1,updatedAt:new Date().toISOString(),records:[
    {imageHash:hash(1),category:'chunky',status:'approved'},
    {imageHash:hash(4),category:'chunky',status:'excluded'},
  ]};
  const api={...visualModule,
    useVisualClassifications(value){events.push('static');return visualModule.useVisualClassifications(value);},
    useVisualClassificationReviews(value){assert.equal(value,reviews);events.push('reviews');},
  };
  const h=uiHarness({api,reviews,reviewsStatus:200});await h.ui.ensureVisualData();
  assert.deepEqual(events,['static','reviews']);assert.equal(h.ui.status(),'ready');
  assert.equal(h.ui.revision(),2);assert.equal(h.ui.categoryRevision(),1);assert.equal(h.renders(),2);
  const request=h.requests.find(request=>request.url==='/api/visual-classifications');
  assert.equal(request.options.method,'GET');assert.equal(request.options.credentials,'same-origin');
  assert.equal(request.options.cache,'no-store');assert.equal(request.options.body,undefined);
  await h.ui.ensureVisualData();assert.equal(h.requests.filter(r=>r.url==='/api/visual-classifications').length,1);
});

test('qualified background model activates through the protected overlay before owner decisions',async()=>{
  const automatic=snapshot(),events=[];
  const reviews={schemaVersion:1,records:[],automatic};
  const api={...visualModule,
    useVisualClassifications(value){events.push(value===automatic?'automatic':'static');return visualModule.useVisualClassifications(value);},
    useVisualClassificationReviews(value){events.push('owner');assert.equal(value,reviews);},
  };
  const h=uiHarness({payload:{...snapshot(),model:{...snapshot().model,validated:false},records:[]},api,reviews,reviewsStatus:200});
  await h.ui.ensureVisualData();assert.deepEqual(events,['static','automatic','owner']);
  h.ui.state.silhouette='chunky';assert.equal(h.ui.filterVisualProducts(rows()).length,1);
});

test('missing/unavailable or rejected owner overlay quietly retains the accepted static snapshot',async()=>{
  for(const status of [401,404,503]){
    const h=uiHarness({reviewsStatus:status});await h.ui.ensureVisualData();
    assert.equal(h.ui.status(),'ready');assert.equal(h.ui.revision(),1);assert.equal(h.renders(),1);
    h.ui.state.silhouette='low-profile';assert.equal(h.ui.filterVisualProducts(rows()).length,4);
    assert.doesNotMatch(h.node('silhouette-filter-help').textContent,/불러오지 못/);
  }
  const api={...visualModule,useVisualClassificationReviews(){throw Error('Invalid review overlay');}};
  const h=uiHarness({api,reviewsStatus:200,reviews:{records:[{status:'uncertain'}]}});
  await h.ui.ensureVisualData();assert.equal(h.ui.status(),'ready');assert.equal(h.ui.revision(),1);
  h.ui.state.silhouette='chunky';assert.equal(h.ui.filterVisualProducts(rows()).length,1);
  const invalid=uiHarness({payload:null});await invalid.ui.ensureVisualData();
  assert.equal(invalid.requests.filter(r=>r.url==='/api/visual-classifications').length,0,'reviews must not bypass static registration');
});

test('real owner review registry overrides labels/exclusions without admitting unrelated candidates',async()=>{
  const reviews={schemaVersion:1,updatedAt:new Date().toISOString(),records:[
    {imageHash:hash(1),category:'low-profile',status:'excluded'},
    {imageHash:hash(2),category:'low-profile',status:'excluded'},
    {imageHash:hash(7),category:'performance',status:'approved'},
  ]};
  try{
    const h=uiHarness({reviews,reviewsStatus:200});await h.ui.ensureVisualData();
    const products=rows(),before=structuredClone(products);
    h.ui.state.silhouette='low-profile';assert.deepEqual(Array.from(h.ui.filterVisualProducts(products),p=>p.id),['b']);
    h.ui.state.silhouette='performance';assert.deepEqual(Array.from(h.ui.filterVisualProducts(products),p=>p.id),['e']);
    assert.equal(visualModule.visualClassification(products.find(p=>p.id==='f')),null);
    h.ui.state.silhouette='all';assert.equal(h.ui.filterVisualProducts(products),products);assert.deepEqual(products,before);
  }finally{visualModule.useVisualClassificationReviews({schemaVersion:1,records:[]});}
});

test('full prepared design registration supplies a representative label to filtered color/gender subsets only within the existing group',async()=>{
  const representative=product('representative','Nike','Existing Design',1);
  const sibling={...product('women-color','Nike','Existing Design',91),gender:'Women'};
  const otherBrand=product('other-brand','Prada','Existing Design',92);
  const otherModel=product('other-model','Nike','Different Design',93);
  const full=[representative,sibling,otherBrand,otherModel],before=structuredClone(full),registrations=[];
  const api={...visualModule,useVisualModelProducts(products,options){registrations.push(products);return visualModule.useVisualModelProducts(products,options);}};
  const h=uiHarness({api,fullProducts:full});await h.ui.ensureVisualData();h.ui.state.silhouette='low-profile';
  assert.equal(registrations.length,1);assert.equal(registrations[0],full);
  assert.deepEqual(Array.from(h.ui.filterVisualProducts([sibling]),p=>p.id),['women-color']);
  assert.equal(visualModule.visualClassification(sibling).basis,'model-design');
  assert.match(h.ui.visualSilhouetteBadge(sibling),/同一|동일 모델의 확인된 대표 이미지 기준/);
  assert.equal(h.ui.visualSilhouetteBadge(representative),'','direct SHA results do not acquire an inherited-image badge');
  assert.equal(visualModule.visualClassification(otherBrand),null);assert.equal(visualModule.visualClassification(otherModel),null);
  h.ui.renderVisualPanel([sibling]);assert.match(h.node('visual-model-coverage').textContent,/전체 1개 모델 · 분류 1개/);
  h.ui.setProducts(full);assert.equal(registrations.length,1,'the same products/revision need not rebuild again');
  h.ui.setProducts([sibling,otherBrand,otherModel]);assert.equal(registrations.length,2);
  assert.equal(visualModule.visualClassification(sibling),null,'removing the representative removes stale inheritance');
  h.ui.setProducts(full);assert.equal(visualModule.visualClassification(sibling).basis,'model-design');
  try{
    visualModule.useVisualClassificationReviews({schemaVersion:1,records:[{imageHash:hash(91),category:'low-profile',status:'excluded'}]});
    assert.equal(visualModule.visualClassification(sibling),null);assert.equal(h.ui.visualSilhouetteBadge(sibling),'');
  }finally{visualModule.useVisualClassificationReviews({schemaVersion:1,records:[]});}
  assert.deepEqual(full,before);
});

test('conflicting direct SHA labels never create a design fallback or a majority category',async()=>{
  const conflict=[product('one','Nike','Conflict Design',1),product('two','Nike','Conflict Design',2),
    product('three','Nike','Conflict Design',4),product('unclassified','Nike','Conflict Design',94)];
  const full=[...conflict,product('other-valid','Prada','Other Valid Design',3)];
  const h=uiHarness({fullProducts:full});await h.ui.ensureVisualData();h.ui.state.silhouette='low-profile';
  assert.equal(visualModule.visualClassification(full[0]).category,'low-profile','direct SHA evidence remains direct');
  assert.equal(visualModule.visualClassification(full[3]),null);
  assert.equal(h.ui.filterVisualProducts(conflict).length,0);
  assert.equal(h.ui.filterVisualProducts([full[3]]).length,0);
  assert.equal(h.ui.visualSilhouetteBadge(full[3]),'');
});

test('filter controls and analysis cache wiring remain separate from official categories and admission',()=>{
  assert.match(html,/for="silhouette-filter"/);assert.match(html,/id="silhouette-filter" aria-describedby="silhouette-filter-help"/);
  assert.match(html,/id="category-filter"/);assert.match(html,/id="panel-category"/);
  assert.match(app,/state\.category,state\.silhouette,visualRevision/);
  assert.match(app,/renderedAnalysis\.visualRevision===visualRevision/);
  assert.match(app,/filterVisualProducts\(allowed,visualConsensusScope\(\)\.categories\)/);
  assert.match(app,/\['silhouette-filter','silhouette'\]/);
  assert.match(app,/category:'all',silhouette:'all'/);
});

test('browser silhouette interaction, async refresh, reset, mobile layout and failed supplement',
  {skip:process.env.VISUAL_UI_BROWSER!=='1'},async()=>{
  const {chromium}=await import('playwright');
  const {createServer}=await import('node:http');const path=await import('node:path');
  const root=path.resolve('public');const at=new Date().toISOString();
  const products=rows().map((p,n)=>({...p,style:`TEST${n}01`,image:p.presentation.cachedPath,
    presentation:{...p.presentation,image:p.presentation.cachedPath},releaseDate:kstToday(),
    dateEvidence:{verified:true,official:true,precision:'day',url:'https://example.org/release',verifiedAt:at},
    sourceSignals:[],popularity:{},fit:[],colorway:n%2?'Black':'White'}));
  const catalog={schemaVersion:1,publishedAt:at,asOf:kstToday(),products,brands:[{name:'Nike',group:'SPORTS'},{name:'Prada',group:'LUX'}],keywords:[],sourceStatus:{}};
  let visualRequests=0,reviewRequests=0,release,invalid=false,qualityHeld=false,ownerReviews=null;
  let staticStarted;const started=new Promise(resolve=>{staticStarted=resolve;});
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://local');
      if(url.pathname==='/api/visual-classifications'){
        reviewRequests++;
        if(!ownerReviews){res.writeHead(404).end();return;}
        res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(ownerReviews));return;
      }
      if(url.pathname==='/data/visual-classifications.json'){
        visualRequests++;
        if(!invalid&&visualRequests===1){staticStarted();await new Promise(resolve=>{release=resolve;});}
        const value=qualityHeld?{...snapshot(),model:{...snapshot().model,validated:false},records:[]}:snapshot();
        res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(invalid?{...snapshot(),model:{...snapshot().model,validated:false}}:value));return;
      }
      if(url.pathname==='/data/catalog-index.json'){res.writeHead(404).end();return;}
      if(url.pathname==='/data/catalog-ui.json'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(catalog));return;}
      if(url.pathname.startsWith('/data/')){res.writeHead(404).end();return;}
      if(url.pathname.startsWith('/images/')){res.writeHead(200,{'Content-Type':'image/png'}).end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64'));return;}
      const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
      const type={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[path.extname(file)];
      const bytes=await fs.readFile(file);
      res.writeHead(200,{'Content-Type':type||'application/octet-stream'}).end(bytes);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_CHANNEL?{channel:process.env.UI_BROWSER_CHANNEL}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('visual-ui-board-sentinel','keep-existing-board'));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('.product-card').first().waitFor();
    await page.locator('[data-source="analysis"]').click();
    await started;assert.equal(await page.locator('#silhouette-filter-label').isHidden(),true);assert.equal(await page.locator('#panel-visual-silhouette').isHidden(),true);
    assert.ok(release);release();
    await page.waitForFunction(()=>!document.querySelector('#silhouette-filter').disabled);
    await page.waitForFunction(()=>document.querySelector('#visual-model-coverage').textContent.includes('분류 3개'));
    await page.locator('[data-source="all"]').click();
    const base=await page.locator('#result-count').textContent();
    await page.locator('#silhouette-filter').selectOption('low-profile');
    await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='2');
    assert.equal(await page.locator('#category-filter').inputValue(),'all');
    assert.equal(await page.locator('[data-variant="a-unclassified"]').count(),1,'unclassified color stays with its accepted consensus model');
    await page.locator('[data-variant="a-unclassified"]').click();
    assert.equal(await page.locator('.product-card[data-id="a-unclassified"] .visual-design-badge').getAttribute('title'),'동일 모델의 확인된 대표 이미지 기준');
    assert.equal(await page.locator('[data-variant="d-black"],[data-variant="d-white"]').count(),0,'conflicting model must not reappear via model expansion');
    await page.locator('[data-brand-group="LUX"]').click();
    await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='1');
    await page.locator('[data-source="analysis"]').click();
    await page.waitForFunction(()=>document.querySelector('#visual-model-coverage').textContent.includes('전체 1개 모델'));
    await page.locator('#reset-filters').click();assert.equal(await page.locator('#silhouette-filter').inputValue(),'all');
    assert.equal(await page.locator('#result-count').textContent(),base);
    assert.equal(await page.evaluate(()=>localStorage.getItem('visual-ui-board-sentinel')),'keep-existing-board');
    await page.setViewportSize({width:390,height:844});await page.locator('[data-source="analysis"]').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await page.locator('#panel-visual-silhouette .dist-label').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=13));
    assert.equal(visualRequests,1);assert.deepEqual(errors,[]);
    invalid=true;await page.reload();await page.locator('.product-card').first().waitFor();
    await page.waitForFunction(()=>document.querySelector('#silhouette-filter').disabled&&document.querySelector('#silhouette-filter-label').hidden);
    assert.equal(await page.locator('#result-count').textContent(),base);
    invalid=false;ownerReviews={schemaVersion:1,updatedAt:at,records:[
      {imageHash:hash(1),category:'low-profile',status:'excluded'},
      {imageHash:hash(2),category:'low-profile',status:'excluded'},
      {imageHash:hash(7),category:'performance',status:'approved'},
    ]};
    await page.reload();await page.locator('.product-card').first().waitFor();
    await page.waitForFunction(()=>!document.querySelector('#silhouette-filter').disabled);
    await page.locator('#silhouette-filter').selectOption('performance');
    await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='1');
    assert.equal(await page.locator('.product-card[data-id="e"]').count(),1,'reload applies the explicit owner-approved photo label');
    await page.locator('#silhouette-filter').selectOption('low-profile');
    await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='1');
    assert.equal(await page.locator('.product-card[data-id="b"]').count(),1,'owner-excluded labels no longer vote for their model');
    assert.equal(reviewRequests,2,'invalid static snapshots do not load or auto-approve reviews');
    qualityHeld=true;ownerReviews=null;
    await page.reload();await page.locator('.product-card').first().waitFor();
    assert.equal(await page.locator('#result-count').textContent(),base);
    assert.equal(await page.locator('#silhouette-filter-label').isHidden(),true);assert.equal(await page.locator('#silhouette-filter').isDisabled(),true);
    await page.locator('[data-source="analysis"]').click();assert.equal(await page.locator('#panel-visual-silhouette').isHidden(),true);
    assert.equal(await page.locator('#silhouette-filter-help').textContent(),'');
    ownerReviews={schemaVersion:1,updatedAt:at,records:[{imageHash:hash(7),category:'performance',status:'approved'}]};
    await page.reload();await page.locator('.product-card').first().waitFor();
    await page.waitForFunction(()=>!document.querySelector('#silhouette-filter').disabled);
    await page.locator('[data-source="analysis"]').click();await page.locator('#panel-visual-silhouette').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#visual-model-coverage').textContent.includes('분류 1개'));
    await page.locator('[data-source="all"]').click();await page.locator('#silhouette-filter').selectOption('performance');
    await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='1');
    assert.equal(await page.locator('.product-card[data-id="e"]').count(),1);

    assert.deepEqual(errors,[]);
  }finally{if(release)release();await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
