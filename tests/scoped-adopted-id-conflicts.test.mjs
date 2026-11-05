import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {scopedSportsMerge} from '../scripts/publish-sports-casual.mjs';
import {scopedVariantConflict,dedupeScopedPrepared} from '../scripts/scoped-prepared.mjs';
import {curateCatalog,officialEvidenceFor} from '../scripts/curation.mjs';

const at='2026-11-05T08:00:00.000Z',today='2026-11-05';
function fila({id='filachina-f12m642104fwa',style='F12M642104FWA',goods='869975',variant='6591903'}={}){
  const brand='FILA China',url=`https://www.fila.com.cn/goods-${goods}.html?id_pa=${variant}`,image='https://img.fishfay.com/shopgoods/shared-official-photo.jpg';
  const proof={verified:true,brand,style,verifiedAt:at,verificationMethod:'official-fila-china-product-json',contentHash:`proof-${goods}-${variant}`};
  const raw={id,brand,name:'Fir Chunky Sneakers',style,manufacturerStyle:style,productVariantId:`${goods}:${variant}`,url,image,officialCategory:'Sneakers',productVerifiedAt:at,productEvidenceUrl:url,firstSeen:at,sourceSignals:[],
    officialProductEvidence:{...proof,url},officialImageEvidence:{...proof,url:image,sourceUrl:url},arrivalEvidence:{...proof,kind:'new-arrivals-listing',url:'https://www.fila.com.cn/new-arrivals/',productUrl:url,excerpt:'Official new sneaker variant'}};
  const c=curateCatalog([raw],{now:new Date(at)});assert.equal(c.snapshot.products.length,1);
  const p=c.snapshot.products[0];return {raw,p:{...p,presentation:{image,cachedPath:'/images/'+'a'.repeat(64)+'.jpg'},scopedNewReview:{verified:true,brand,style,url,image,checkedAt:at}}};
}
const options={today,at,includeLux:true,allowedBrands:['FILA China','Merrell']};

test('misleading historical FILA ID keeps its old A/F variant; a distinct verified PDP gets a stable new ID',()=>{
  const old=fila({style:'F12M642166FWA',goods:'869976',variant:'6591925'}),fresh=fila();
  assert.equal(old.p.id,fresh.p.id);assert.equal(scopedVariantConflict(old.p,fresh.p),true);
  const catalog={products:[old.p],brands:[]},source={products:[old.raw]},before=structuredClone({catalog,source,fresh});
  const out=scopedSportsMerge(catalog,source,[fresh.p],[fresh.raw],options);
  assert.equal(out.report.added.length,1);assert.equal(out.report.refreshed.length,0);assert.equal(out.report.held.length,0);
  assert.deepEqual(out.snapshot.products[0],old.p);assert.deepEqual(out.source.products[0],old.raw);
  const added=out.snapshot.products[1],raw=out.source.products[1];
  assert.notEqual(added.id,old.p.id);assert.match(added.id,/^filachina-f12m642104fwa-pdp-[a-f0-9]{20}$/);assert.equal(raw.id,added.id);
  assert.equal(added.style,'F12M642104FWA');assert.equal(added.productVariantId,'869975:6591903');assert.equal(added.url,fresh.p.url);
  assert.ok(officialEvidenceFor(added,today));assert.ok(officialEvidenceFor(raw,today));assert.deepEqual({catalog,source,fresh},before);
  assert.equal(out.report.identityConflicts[0].resolution,'distinct-verified-official-pdp');
  const again=scopedSportsMerge(out.snapshot,out.source,[fresh.p],[fresh.raw],options);
  assert.equal(again.report.added.length,0);assert.equal(again.report.refreshed.length,1);assert.equal(again.report.refreshed[0].id,added.id);
  assert.deepEqual(again.snapshot.products,out.snapshot.products);assert.deepEqual(again.source.products,out.source.products);
});

test('SPORTS publication also binds disambiguated raw IDs to the new variant rather than the occupied ID',()=>{
  const old=fila({style:'T12M643342FBV',goods:'910298',variant:'6873082'}),fresh=fila({style:'T12M643342ABV',goods:'914134',variant:'6904490'});
  const out=scopedSportsMerge({products:[old.p],brands:[]},{products:[old.raw]},[fresh.p],[fresh.raw],{today,at});
  assert.equal(out.source.products.length,2);assert.equal(out.source.products[1].id,out.snapshot.products[1].id);
  assert.equal(out.source.products[1].productVariantId,'914134:6904490');assert.deepEqual(out.source.products[0],old.raw);
});

test('a conflicting adopted ID cannot publish an unverified replacement',()=>{
  const old=fila({style:'F12M642166FWA',goods:'869976',variant:'6591925'}),fresh=fila();fresh.p.officialProductEvidence.verified=false;
  const out=scopedSportsMerge({products:[old.p],brands:[]},{products:[old.raw]},[fresh.p],[fresh.raw],options);
  assert.equal(out.report.added.length,0);assert.equal(out.report.refreshed.length,0);assert.equal(out.report.held.length,1);
  assert.deepEqual(out.snapshot.products,[old.p]);assert.deepEqual(out.source.products,[old.raw]);
});

test('two conflicting incoming colors sharing an ID still fail closed before ambiguous raw binding',()=>{
  const a=fila(),b=fila({variant:'6591904'});
  assert.throws(()=>dedupeScopedPrepared([a.p,b.p],{today}),/different products|different color/);
});

test('a deterministic ID collision is held rather than overwriting another board record',()=>{
  const old=fila({style:'F12M642166FWA',goods:'869976',variant:'6591925'}),fresh=fila();
  const once=scopedSportsMerge({products:[old.p],brands:[]},{products:[old.raw]},[fresh.p],[fresh.raw],options);
  const occupied={...fila({id:once.snapshot.products[1].id,goods:'999999',variant:'9999999',style:'F12MOTHER001'}).p};
  const out=scopedSportsMerge({products:[old.p,occupied],brands:[]},{products:[old.raw]},[fresh.p],[fresh.raw],options);
  assert.equal(out.report.added.length,0);assert.equal(out.report.held[0].reason,'conflicting-disambiguated-official-pdp-id');assert.deepEqual(out.snapshot.products,[old.p,occupied]);
});

const root=new URL('../',import.meta.url),read=async path=>JSON.parse(await fs.readFile(new URL(path,root),'utf8'));
test('actual 3972-cache conflicts: Merrell resolves its exact other-color ID and seven FILA variants remain separate',async t=>{
  let data;try{data=await Promise.all(['.secrets/admin-followup-before/catalog.json','.secrets/admin-followup-before/catalog-source.json','reports/admin-rechecked-cached.json','reports/admin-rechecked-raw.json'].map(read));}catch(e){if(e.code==='ENOENT'){t.skip('Local publication input is unavailable');return;}throw e;}
  const [base,source,cached,raw]=data,byId=new Map(base.products.map(p=>[p.id,p]));
  const inputs=dedupeScopedPrepared(cached.products,{today}).filter(p=>byId.has(p.id)&&scopedVariantConflict(byId.get(p.id),p));
  assert.equal(inputs.length,8);assert.equal(inputs.filter(p=>p.brand==='FILA China').length,7);
  const merrell=inputs.find(p=>p.brand==='Merrell');assert.equal(merrell.id,'live-a6a650f3d0fc4e40');
  assert.match(merrell.url,/J00005166$/);assert.match(byId.get(merrell.id).url,/J00005167$/);
  const keptIds=new Set([...inputs.map(p=>p.id),'arrival-0151943f6f957f181583']);
  const catalog={products:base.products.filter(p=>keptIds.has(p.id)),brands:[]},oldSource={products:source.products.filter(p=>keptIds.has(p.id))};
  const accepted=raw.products.filter(p=>inputs.some(q=>q.id===p.id));assert.equal(accepted.length,8);
  const out=scopedSportsMerge(catalog,oldSource,inputs,accepted,options);
  assert.equal(out.report.added.length,7);assert.equal(out.report.refreshed.length,1);assert.equal(out.report.held.length,0);assert.equal(out.report.identityConflicts.length,8);
  assert.equal(out.report.refreshed[0].id,'arrival-0151943f6f957f181583');
  for(const input of inputs)assert.deepEqual(out.snapshot.products.find(p=>p.id===input.id),byId.get(input.id),'historical board ID must keep its original variant');
  for(const item of [...out.report.added,...out.report.refreshed]){
    const p=out.snapshot.products.find(p=>p.id===item.id),r=out.source.products.find(p=>p.id===item.id);
    assert.ok(r);assert.equal(r.style,p.style);assert.equal(r.url,p.url);assert.equal(r.productVariantId,p.productVariantId);
    assert.ok(officialEvidenceFor(p,today));assert.ok(officialEvidenceFor(r,today));
  }
  const again=scopedSportsMerge(out.snapshot,out.source,inputs,accepted,options);assert.equal(again.report.added.length,0);
  assert.equal(again.snapshot.products.length,out.snapshot.products.length);assert.equal(new Set(again.source.products.map(p=>p.id)).size,again.source.products.length);
});
