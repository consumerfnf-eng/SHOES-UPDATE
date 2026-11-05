import test from 'node:test';
import assert from 'node:assert/strict';
import {collectStructuredNew} from '../scripts/collect-structured-new.mjs';

const now=new Date('2026-11-05T00:00:00Z');
const asicsTile=(style='1203A537-301')=>`<a data-product-type="Shoes" data-test="product-tile-link-ANA_${style}" href="https://www.asics.com/us/en-us/gel-kayano-14/p/ANA_${style}.html"><button data-test="swatch" title="GEL-KAYANO 14, Silver" data-selected="true"><img src="https://images.asics.com/is/image/asics/${style.replace('-','_')}_SL_LT_GLB" alt="Silver"></button></a>`;
const adidasRow=(id='AB1234')=>({id,title:'Gazelle',subTitle:'Unisex Originals',category:'Originals',modelNumber:'gazelle',image:`https://assets.adidas.com/images/w_600,h_600/Gazelle_Black_${id}_01.jpg`,url:`https://www.adidas.com/us/gazelle/${id}.html`});
const adidasPage=(rows,total=49)=>`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{taxonomy:'shoes-new_arrivals',products:rows,info:{count:total,startIndex:0}}}})}</script>`;
const converseTile=(style='A09801C')=>`<div class="product-tile tile" data-testid="product-tile-${style}"><div class="product-tile__name"><a>Chuck High Top</a></div><a class="product-tile__img-url" href="https://www.converse.com/shop/p/chuck/${style}.html"></a><img src="https://www.converse.com/images/a_08/${style}_A_08.jpg"></div>`;
const nbConfig='var algoliaData = {"applicationID":"fixture","searchApiKey":"public-fixture","productsIndex":"products"};\nalgoliaData.cgid = "new-shoes";';
const nbRow=(style='U990BK6')=>({styleID:style,name:'Made in USA 990',brand:'New Balance',masterID:'990',custom:{productClass:'Shoes',genderDisplay:'Unisex'},pdpLink:'https://www.newbalance.com/pd/990/990.html',image_groups:[{images:[{dis_base_link:`https://nb.scene7.com/is/image/NB/${style}_nb_02_i`}]}]});
const nbFeed=(hits=[nbRow()],extra={})=>({results:[{hits,nbHits:hits.length,nbPages:1,...extra}]});
const fixtures={
 ASICS:{first:`Showing 1 of 2${asicsTile()}<a data-test="plp-load-more" href="https://www.asics.com/us/en-us/sportstyle-new-arrivals/c/aa90000023/?start=1">More</a>`,later:'Showing 1 of 2',style:'1203A537-301',total:2},
 adidas:{first:adidasPage([adidasRow()]),later:adidasPage([]),style:'AB1234',total:49},
 Converse:{first:`<span data-testid="plp-results-count">2</span>${converseTile()}<div data-page-url="?start=21"></div>`,later:'<span data-testid="plp-results-count">2</span>',style:'A09801C',total:2},
 'New Balance':{first:nbConfig,later:nbConfig,style:'U990BK6'},
};

async function collectFixture(t,brand,{allowPartial,blocked=false}={}){
 const fixture=fixtures[brand],reads=[],progress=[];let requests=0;
 if(brand==='New Balance')t.mock.method(globalThis,'fetch',async()=>{
  requests++;
  // The rejected second feed contains a plausible row: it must never leak.
  return {ok:true,json:async()=>requests===1?nbFeed():nbFeed([nbRow('UNPARSED')],{nbHits:2,nbPages:2})};
 });
 const options={brands:[brand],now,onProgress:p=>progress.push(p),readHtml:async url=>{
  reads.push(url);
  if(reads.length===1)return fixture.first;
  if(blocked)throw Error('HTTP 403: later listing blocked');
  return fixture.later;
 }};
 if(allowPartial!==undefined)options.allowPartial=allowPartial;
 return {...await collectStructuredNew(options),reads,progress};
}

for(const brand of Object.keys(fixtures)){
 for(const blocked of [true,false]){
  const failure=blocked?'blocked next page':'pagination mismatch';
  test(`${brand}: ${failure} retains validated rows only with explicit opt-in`,async t=>{
   const result=await collectFixture(t,brand,{allowPartial:true,blocked}),output=result.outputs[brand];
   assert.deepEqual(output.products.map(p=>p.style),[fixtures[brand].style]);
   assert.equal(output.status,'partial');assert.equal(output.coverage.status,'partial');
   assert.equal(output.coverage.exhaustive,false);
   assert.equal(output.coverage.total,null);
   assert.equal(output.coverage.exhaustive===true||output.coverage.exhausted===true||Number(output.coverage.total)>0&&output.coverage.total===output.coverage.read,false);
   assert.equal(output.coverage.pages,blocked||brand==='New Balance'?1:2);
   assert.equal(result.errors.length,1);assert.equal(result.errors[0].status,'partial');
   assert.match(result.errors[0].error,blocked?/403/:/pagination incomplete/);
   assert.deepEqual(output.errors,result.errors);
   assert.deepEqual(output.coverage.errors,[result.errors[0].error]);
   assert.equal(result.progress.at(-1).status,'partial');
   for(const row of output.products){
    assert.equal(row.arrivalEvidence.verified,true);
    assert.equal(row.officialProductEvidence.verified,true);
    assert.equal(row.officialImageEvidence.verified,true);
   }
   if(brand==='New Balance'){
    assert.equal(output.coverage.reportedTotal,null);
    assert.equal(output.coverage.sources.length,1);
    assert.equal(output.coverage.sources[0].total,1);
    assert.match(output.coverage.sources[0].sourceUrl,/\/women\//);
   }else{
    assert.equal(output.coverage.reportedTotal,fixtures[brand].total);
    assert.equal(output.coverage.read,1);
   }
  });
  test(`${brand}: strict default drops all data after ${failure}`,async t=>{
   const result=await collectFixture(t,brand,{blocked});
   assert.deepEqual(result.outputs,{});assert.equal(result.errors.length,1);
   assert.equal(Object.hasOwn(result.errors[0],'status'),false);
   assert.equal(result.reads.length,2);
  });
  test(`${brand}: explicit strict mode drops all data after ${failure}`,async t=>{
   const result=await collectFixture(t,brand,{blocked,allowPartial:false});
   assert.deepEqual(result.outputs,{});assert.equal(result.errors.length,1);
   assert.equal(Object.hasOwn(result.errors[0],'status'),false);
  });
 }
 test(`${brand}: first-page denial cannot produce partial data`,async()=>{
  const result=await collectStructuredNew({brands:[brand],now,allowPartial:true,readHtml:async()=>{throw Error('HTTP 403');}});
  assert.deepEqual(result.outputs,{});assert.deepEqual(result.errors,[{brand,error:'HTTP 403'}]);
 });
}

test('adidas: a parser failure never publishes rows from a partly parsed page',async()=>{
 const html=adidasPage([adidasRow(),{...adidasRow('BAD123'),image:'https://untrusted.example/BAD123.jpg'}]);
 const result=await collectStructuredNew({brands:['adidas'],now,allowPartial:true,readHtml:async()=>html});
 assert.deepEqual(result.outputs,{});assert.match(result.errors[0].error,/SKU image binding/);
});

test('New Balance: an incomplete first feed publishes none of its unparsed hits',async t=>{
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>nbFeed([nbRow()],{nbHits:2,nbPages:2})}));
 const result=await collectStructuredNew({brands:['New Balance'],now,allowPartial:true,readHtml:async()=>nbConfig});
 assert.deepEqual(result.outputs,{});assert.match(result.errors[0].error,/pagination incomplete/);
});

test('ASICS: a denied detail fetch retains listing-validated products only',async()=>{
 const html=`Showing 2 of 2${asicsTile()}<a data-product-type="Shoes" data-test="product-tile-link-ANA_UNBOUND" href="https://www.asics.com/us/en-us/unbound.html"></a>`;
 let reads=0;
 const result=await collectStructuredNew({brands:['ASICS'],now,allowPartial:true,readHtml:async()=>{if(++reads>1)throw Error('HTTP 403');return html;}});
 assert.deepEqual(result.outputs.ASICS.products.map(p=>p.style),['1203A537-301']);
 assert.equal(result.outputs.ASICS.coverage.exhaustive,false);
 assert.equal(result.outputs.ASICS.coverage.reportedTotal,2);
});

test('ASICS: missing source total stays unknown instead of using retained row count',async()=>{
 const result=await collectStructuredNew({brands:['ASICS'],now,allowPartial:true,readHtml:async()=>asicsTile()});
 assert.equal(result.outputs.ASICS.products.length,1);
 assert.equal(result.outputs.ASICS.coverage.total,null);
 assert.equal(result.outputs.ASICS.coverage.exhaustive,false);
});

test('Converse: missing and excluded candidates never become recovered products',async()=>{
 const html=fixtures.Converse.first+converseTile('MISSING').replace('MISSING_A_08','OTHER_A_08')+converseTile('KIDS').replace('Chuck High Top','Kids High Top');
 let reads=0;
 const result=await collectStructuredNew({brands:['Converse'],now,allowPartial:true,readHtml:async()=>{if(++reads>1)throw Error('HTTP 403');return html;}});
 assert.deepEqual(result.outputs.Converse.products.map(p=>p.style),['A09801C']);
 assert.equal(result.outputs.Converse.coverage.reportedTotal,2);
 assert.equal(result.outputs.Converse.coverage.read,3);
 assert.equal(result.outputs.Converse.coverage.exhaustive,false);
});

test('successful strict output is unchanged when partial recovery is enabled',async()=>{
 const options={brands:['adidas'],now,readHtml:async()=>adidasPage([adidasRow()],1)};
 const strict=await collectStructuredNew(options);
 assert.equal(strict.outputs.adidas.products.length,1);assert.deepEqual(strict.errors,[]);
 assert.deepEqual(await collectStructuredNew({...options,allowPartial:true}),strict);
 assert.deepEqual(await collectStructuredNew({...options,allowPartial:false}),strict);
});

test('a blocked continuation cannot look exhaustive even when reported total equals read',async()=>{
 let reads=0;
 const result=await collectStructuredNew({brands:['ASICS'],now,allowPartial:true,readHtml:async()=>{
  if(++reads>1)throw Error('HTTP 403');
  return fixtures.ASICS.first.replace('Showing 1 of 2','Showing 1 of 1');
 }});
 const coverage=result.outputs.ASICS.coverage;
 assert.equal(coverage.read,1);assert.equal(coverage.reportedTotal,1);
 assert.equal(coverage.total,null);assert.equal(coverage.exhaustive,false);
 assert.equal(coverage.exhaustive===true||coverage.exhausted===true||Number(coverage.total)>0&&coverage.total===coverage.read,false);
 assert.equal(result.outputs.ASICS.status,'partial');assert.equal(result.errors[0].status,'partial');
});
