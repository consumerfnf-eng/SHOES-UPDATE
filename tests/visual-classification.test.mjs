import test from 'node:test';import assert from 'node:assert/strict';
import {useVisualClassifications,useVisualClassificationReviews,useVisualModelProducts,visualClassification,visualImageHash,visualModelDistribution} from '../public/assets/visual-classification.mjs';
const hash=n=>String(n).padStart(64,'0'),product=(n,key='model')=>({id:'p'+n,modelKey:key,presentation:{cachedPath:'/images/'+hash(n)+'.jpg'}});
const snapshot=records=>({schemaVersion:1,model:{version:'test-v1',sha256:'a'.repeat(64),encoder:'test',validated:true,thresholds:{chunky:{minConfidence:.9,minMargin:.2},'low-profile':{minConfidence:.95,minMargin:.3}}},records});
const row=(n,category='chunky',patch={})=>({imageHash:hash(n),category,confidence:.99,margin:.8,source:'model',modelVersion:'test-v1',...patch});
function reset(records=[]){useVisualModelProducts([]);useVisualClassificationReviews({schemaVersion:1,records:[]});useVisualClassifications(snapshot(records));}
test('exact original SHA binds visual labels, not name/code/thumbnail reuse',()=>{
 reset([row(1)]);assert.equal(visualClassification(product(1)).category,'chunky');assert.equal(visualClassification(product(2)),null);
 assert.equal(visualImageHash({...product(1),presentation:{thumbnail:{path:'/images/'+hash(1)+'.webp'}}}),'');
 assert.equal(visualImageHash({...product(1),presentation:{cachedPath:'https://other.example/images/'+hash(1)+'.jpg'}}),'');
});
test('unvalidated model, failed class gates, conflicting snapshots never replace registry',()=>{
 reset([row(1)]);
 for(const value of [snapshot([row(2,'chunky',{confidence:.7})]),snapshot([row(2,'chunky',{margin:.1})]),snapshot([row(2),row(2)]),{...snapshot([row(2)]),model:{...snapshot([]).model,validated:false}},snapshot([row(2,'boot')]),snapshot([row(2,'chunky',{modelVersion:'stale'})])]){
  assert.throws(()=>useVisualClassifications(value));assert.equal(visualClassification(product(1)).category,'chunky');assert.equal(visualClassification(product(2)),null);
 }
});
test('manual decisions override automatic labels and exclusions persist over fresh snapshots',()=>{
 reset([row(1),row(2)]);useVisualClassificationReviews({schemaVersion:1,records:[{imageHash:hash(1),category:'low-profile',status:'approved'},{imageHash:hash(2),category:null,status:'excluded'}]});
 assert.equal(visualClassification(product(1)).source,'manual');assert.equal(visualClassification(product(1)).category,'low-profile');assert.equal(visualClassification(product(2)),null);
 useVisualClassifications(snapshot([row(1),row(2)]));assert.equal(visualClassification(product(2)),null);
 assert.throws(()=>useVisualClassificationReviews({schemaVersion:1,records:[{imageHash:hash(1),category:'injected',status:'approved'}]}));assert.equal(visualClassification(product(1)).category,'low-profile');
});
test('model composition removes color duplicates and withholds conflicting design labels',()=>{
 reset([row(1),row(2),row(3,'low-profile'),row(4),row(5,'low-profile')]);
 const records=[product(1,'A'),product(2,'A'),product(3,'B'),product(4,'C'),product(5,'C'),product(6,'D')];
 const result=visualModelDistribution(records);assert.equal(result.totalModels,4);assert.equal(result.classifiedModels,2);assert.equal(result.conflictedModels,1);
 assert.equal(result.rows.reduce((n,r)=>n+r.count,0),2);assert.ok(result.rows.every(r=>r.share===.5));
 assert.equal(visualModelDistribution(records.slice(0,2)).rows[0].count,1);
});
test('registered design labels retain unclassified colour counterparts and gender subsets',()=>{
 reset([row(1)]);const men={...product(1,'A'),gender:'Men'},women={...product(2,'A'),gender:'Women'};
 useVisualModelProducts([men,women]);assert.equal(visualClassification(women).basis,'model-design');assert.equal(visualClassification(women).imageHash,hash(1));
 assert.equal(visualModelDistribution([women]).classifiedModels,1);
 useVisualClassificationReviews({schemaVersion:1,records:[{imageHash:hash(2),category:null,status:'excluded'}]});assert.equal(visualClassification(women),null);
 useVisualClassificationReviews({schemaVersion:1,records:[{imageHash:hash(2),category:'low-profile',status:'approved'}]});
 assert.equal(visualClassification(product(3,'A')),null);assert.equal(visualModelDistribution([men,women]).conflictedModels,1);
 assert.equal(visualModelDistribution([women]).classifiedModels,0);assert.equal(visualModelDistribution([women]).conflictedModels,1);
});
