import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../public/admin/app.mjs',import.meta.url),'utf8');
const batch=(remaining=2,job=null)=>({id:'priority-20261106-v1',title:'우선 검수 96개',total:96,reviewed:96-remaining,approved:92-remaining,excluded:4,remaining,job});
const record=(n=1,patch={})=>({imageHash:n.toString(16).padStart(64,'0'),modelVersion:'fixture-model',revision:0,
  status:'review-needed',reviewRole:'train',category:'chunky',confidence:.99,margin:.8,alternatives:[{category:'boot',score:.8}],
  products:[{id:'p'+n,brand:'Nike',name:'Review Sneaker '+n,modelKey:'model-'+n}],...patch});

function harness(){
  const nodes=new Map(),node=id=>{
    if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,disabled:false,value:'',max:1});return nodes.get(id);
  };
  const body=source.slice(source.indexOf('const visualCategories='),source.indexOf('// Visual review interactions.'));
  const sandbox={node,console};
  vm.runInNewContext(`const $=node,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const count=n=>String(n||0),date=v=>v||'—';
    ${body}
    globalThis.ui={validVisualBatch,visualCardMarkup,visualJobSummary,visualCanTrain,renderVisualBatch,
      set:(batch,mode='priority',flags={})=>{visualPriorityBatch=batch;visualBatch=mode;visualLoading=!!flags.loading;visualSaving=!!flags.saving;visualTraining=!!flags.training;}};`,sandbox);
  return {ui:sandbox.ui,node};
}

test('blind and test-role photos never expose predictions or preselect a guessed category',()=>{
  const {ui}=harness();
  for(const patch of [{blindReview:true,reason:'secret model guess boot'},{reviewRole:'test'}]){
    const markup=ui.visualCardMarkup(record(1,patch),0);
    assert.match(markup,/분류 기준 확인용 사진/);assert.match(markup,/<option value="" selected>분류를 선택하세요/);
    assert.doesNotMatch(markup,/모델 제안|99\.0%|80\.0%|secret model guess/);
    assert.match(markup,/data-visual-action="approved"[^>]*disabled/);
    assert.doesNotMatch(markup,/value="chunky" selected/);
  }
});

test('nonblind suggestions stay below the explicit decision, with no automatic selection',()=>{
  const {ui}=harness(),markup=ui.visualCardMarkup(record(),0);
  assert.match(markup,/<option value="" selected>/);
  assert.ok(markup.indexOf('data-visual-action="approved"')<markup.indexOf('모델 제안 참고'));
  assert.match(markup,/정확도와 다름/);
  const reviewed=ui.visualCardMarkup(record(1,{review:{status:'approved',category:'sandal'}}),0);
  assert.match(reviewed,/value="sandal" selected/);
  assert.match(markup,/퍼포먼스 · 축구\/육상/);
  const legacy=ui.visualCardMarkup(record(1,{reviewRole:undefined,reason:'unverified role hint'}),0);
  assert.doesNotMatch(legacy,/모델 제안|99\.0%|unverified role hint/,'missing role metadata cannot leak a blind prediction through the all-candidates view');
});

test('completion request requires authoritative complete counts and only failed jobs allow retry',()=>{
  const {ui,node}=harness();
  for(const input of [null,{...batch(0),total:0},batch(1),{...batch(0),reviewed:95}]){
    ui.set(input);assert.equal(ui.visualCanTrain(),false);ui.renderVisualBatch();assert.equal(node('visual-train-request').disabled,true);
  }
  ui.set(batch(0));assert.equal(ui.visualCanTrain(),true);ui.renderVisualBatch();
  assert.equal(node('visual-progress').value,96);assert.equal(node('visual-progress').max,96);
  assert.match(node('visual-remaining').textContent,/남은 검수 0개/);
  for(const status of ['queued','running','completed','held','unknown']){ui.set(batch(0,{id:'job',status}));assert.equal(ui.visualCanTrain(),false,status);}
  ui.set(batch(0,{id:'job',status:'failed'}));assert.equal(ui.visualCanTrain(),true);
  for(const flag of ['loading','saving','training']){ui.set(batch(0),'priority',{[flag]:true});assert.equal(ui.visualCanTrain(),false,flag);}
  ui.set(batch(0),'all');assert.equal(ui.visualCanTrain(),false);ui.renderVisualBatch();assert.equal(node('visual-training').hidden,true);
});

test('job labels report actual backend states and safe summaries, not assumed deployment',()=>{
  const {ui,node}=harness();
  for(const [status,label]of [['queued','대기'],['running','진행 중'],['completed','작업 완료'],['held','결과 보류'],['failed','작업 실패']]){
    ui.set(batch(0,{id:'job-1',status}));ui.renderVisualBatch();assert.ok(node('visual-train-job').textContent.includes(label));
    assert.doesNotMatch(node('visual-train-job').textContent,/전체.*반영 완료|배포 완료/);
  }
  const text=ui.visualJobSummary({result:{message:'작업 결과 확인',releasedCategories:['performance','unknown'],evaluation:{ownerSplitCounts:{train:48,calibration:24,test:24},test:{n:24,accuracy:.75}}}});
  assert.match(text,/퍼포먼스 · 축구\/육상/);assert.doesNotMatch(text,/unknown/);assert.match(text,/별도 확인 24/);assert.match(text,/75\.0%/);
});

test('category help keeps spikes/cleats distinct from ordinary runners and mules distinct from slip-ons',()=>{
  assert.match(source,/축구화의 스터드·육상화의 스파이크 등 전용 경기 구조/);
  assert.match(source,/일반 러닝화는 레트로 테크 러너로 검토/);
  assert.match(source,/복고 러너부터 현대적인 메시 러닝화까지/);
  assert.match(source,/뒤꿈치가 닫힌 슬립온/);
  assert.match(source,/농구화·캔버스 하이탑과 구분/);
  assert.match(harness().ui.visualCardMarkup(record(1,{products:[{brand:'Nike',name:'<img src=x onerror=alert(1)>'}]}),0),/&lt;img/);
});

test('priority review browser: explicit blind decisions, progress, zoom, pending removal and truthful training states',
  {skip:process.env.VISUAL_PRIORITY_UI_BROWSER!=='1'},async()=>{
  const {chromium}=await import('playwright'),{createServer}=await import('node:http'),path=await import('node:path');
  const root=path.resolve('public'),requests=[],reviews=new Map();let job=null;
  const priority=[record(1,{blindReview:true,reviewRole:'test',reason:'secret model guess boot'}),record(2,{reviewRole:'train'})];
  const all=Array.from({length:400},(_,i)=>record(i+1));
  const progress=()=>{const saved=priority.map(r=>reviews.get(r.imageHash)).filter(Boolean),approved=90+saved.filter(r=>r.status==='approved').length,excluded=4+saved.filter(r=>r.status==='excluded').length;return {...batch(),approved,excluded,reviewed:approved+excluded,remaining:96-approved-excluded,job};};
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://local');const parts=[];for await(const part of req)parts.push(part);const body=Buffer.concat(parts).toString();
    requests.push({path:url.pathname,query:Object.fromEntries(url.searchParams),method:req.method,body:body?JSON.parse(body):null,csrf:req.headers['x-csrf-token']});
    const json=value=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
    try{
      if(url.pathname==='/api/admin/session')return json({csrf:'owner-fixture',expires:Math.floor(Date.now()/1000)+3600});
      if(url.pathname==='/api/admin/status')return json({brands:[],jobs:[],activeJobs:[],generatedAt:new Date().toISOString(),workflowUrl:'https://example.org/workflow'});
      if(url.pathname==='/api/admin/visual-classifications/review'){
        const value=JSON.parse(body);assert.equal(req.headers['x-csrf-token'],'owner-fixture');
        assert.ok(['approved','excluded'].includes(value.status));if(value.status==='approved')assert.ok(value.category);
        reviews.set(value.imageHash,{status:value.status,category:value.category,reviewedAt:new Date().toISOString(),revision:1});return json({saved:true});
      }
      if(url.pathname==='/api/admin/visual-classifications/train'){
        assert.equal(progress().remaining,0);assert.deepEqual(JSON.parse(body),{batchId:'priority-20261106-v1'});assert.equal(req.headers['x-csrf-token'],'owner-fixture');
        job={id:'training-fixture',status:'queued'};return json({job});
      }
      if(url.pathname==='/api/admin/visual-classifications'){
        const isPriority=url.searchParams.get('batch')==='priority',status=url.searchParams.get('status'),page=Number(url.searchParams.get('page')||1),brand=url.searchParams.get('brand');
        const records=(isPriority?priority:all).map(r=>({...r,review:reviews.get(r.imageHash)||null,revision:reviews.has(r.imageHash)?1:0}))
          .filter(r=>(!status||(r.review?.status||r.status)===status)&&(!brand||r.products.some(p=>p.brand===brand)));
        return json({schemaVersion:1,page,pageSize:20,total:records.length,stats:{'review-needed':records.length},records:records.slice((page-1)*20,page*20),...(isPriority?{batch:progress()}:{}),model:{version:'fixture-model',encoder:'CLIP',validated:false},updatedAt:new Date().toISOString()});
      }
      if(url.pathname.startsWith('/api/admin/visual-image/'))return res.writeHead(200,{'Content-Type':'image/png'}).end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64'));
      const file=path.resolve(root,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));
      if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
      const bytes=await fs.readFile(file),type={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[path.extname(file)];res.writeHead(200,{'Content-Type':type||'application/octet-stream'}).end(bytes);
    }catch(error){if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));else res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_CHANNEL?{channel:process.env.UI_BROWSER_CHANNEL}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/admin/`);
    await page.locator('#message').filter({hasText:'관리자 전용 인증'}).waitFor();
    assert.equal(requests.filter(r=>r.path==='/api/admin/visual-classifications').length,0);
    await page.locator('#visual-review-open').click();await page.locator('.visual-card').nth(1).waitFor();
    assert.equal(requests.filter(r=>r.path==='/api/admin/visual-classifications').at(-1).query.batch,'priority');
    assert.equal(requests.filter(r=>r.path==='/api/admin/visual-classifications').at(-1).query.status,'review-needed');
    assert.equal(await page.locator('#visual-category-0').inputValue(),'');assert.equal(await page.locator('[data-visual-index="0"][data-visual-action="approved"]').isDisabled(),true);
    const first=await page.locator('.visual-card').first().innerText();assert.match(first,/분류 기준 확인용 사진/);assert.doesNotMatch(first,/모델 제안|99\.0%|secret model guess/);
    assert.equal(await page.locator('#visual-train-request').isDisabled(),true);assert.match(await page.locator('#visual-remaining').textContent(),/2개/);
    await page.locator('[data-visual-photo="0"]').click();await page.locator('#visual-photo-dialog').waitFor({state:'visible'});
    await page.locator('#visual-zoom-in').click();assert.equal(await page.locator('#visual-zoom-value').textContent(),'150%');await page.keyboard.press('Escape');
    await page.locator('#visual-category-0').selectOption('performance');await page.locator('[data-visual-index="0"][data-visual-action="approved"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.visual-card').length===1);
    assert.match(await page.locator('#visual-remaining').textContent(),/1개/);assert.equal(await page.locator('#visual-train-request').isDisabled(),true);
    assert.equal(requests.filter(r=>r.path.endsWith('/review'))[0].body.category,'performance');
    assert.equal(await page.locator('#visual-category-0').inputValue(),'');
    await page.locator('[data-visual-action="excluded"]').click();await page.waitForFunction(()=>document.querySelectorAll('.visual-card').length===0);
    await page.waitForFunction(()=>!document.querySelector('#visual-train-request').disabled);
    assert.match(await page.locator('#visual-progress-count').textContent(),/96 \/ 96/);
    assert.equal(requests.filter(r=>r.path.endsWith('/review'))[1].body.category,null);
    await page.locator('#visual-train-request').click();await page.locator('#visual-train-job').filter({hasText:'추가 학습 대기'}).waitFor();
    assert.equal(await page.locator('#visual-train-request').isDisabled(),true);
    for(const [status,text]of [['running','진행 중'],['completed','작업 완료'],['held','결과 보류'],['failed','작업 실패']]){
      job={...job,status,result:{message:'안전한 결과 요약',releasedCategories:[],evaluation:{ownerSplitCounts:{train:48,calibration:24,test:24}}}};
      await page.locator('#visual-refresh').click();await page.locator('#visual-train-job').filter({hasText:text}).waitFor();
      assert.equal(await page.locator('#visual-train-request').isDisabled(),status!=='failed');
      assert.doesNotMatch(await page.locator('#visual-train-job').textContent(),/배포 완료/);
    }
    assert.match(await page.locator('#visual-train-summary').textContent(),/별도 확인 24/);
    await page.locator('[data-visual-batch="all"]').click();await page.locator('.visual-card').nth(19).waitFor();
    assert.equal(requests.filter(r=>r.path==='/api/admin/visual-classifications').at(-1).query.batch,undefined);
    assert.equal(await page.locator('#visual-training').isHidden(),true);
    await page.locator('#visual-category-help>summary').click();assert.match(await page.locator('#visual-definitions').innerText(),/일반 러닝화는 레트로 테크 러너로/);
    for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at '+width);}
    assert.equal(requests.filter(r=>r.path.endsWith('/train')).length,1,'no automatic retraining after completion/hold');assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
