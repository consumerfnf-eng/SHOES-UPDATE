import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeCatalog,encodeCatalogV1,encodeCatalogV2,decodeCatalog} from '../public/assets/catalog-wire.mjs';
test('dictionary encoding preserves evidence, unknown nested fields and literal reference-like strings',()=>{
 const long='https://brand.example.org/products/full-manufacturer-code-and-colour';
 const snapshot={schemaVersion:1,strings:['a user field'],payload:{wireFormat:'user data'},products:Array.from({length:8},(_,i)=>({id:String(i),url:long,image:long,brand:'Example',style:'CODE',extra:{url:long,text:['~0','~~escape','~not-a-reference','한글',null,-20,false,{},[]]},officialProductEvidence:{verified:true,brand:'Example',style:'CODE',url:long}}))};
 const wire=encodeCatalog(snapshot);assert.equal(wire.wireFormat,'catalog-ui-v3');
 assert.deepEqual(decodeCatalog(JSON.parse(JSON.stringify(wire))),snapshot);
 assert(JSON.stringify(wire).length<JSON.stringify(encodeCatalogV1(snapshot)).length);
 assert.deepEqual(decodeCatalog(encodeCatalogV1(snapshot)),snapshot,'previous deployments remain readable');
 assert.deepEqual(decodeCatalog(encodeCatalogV2(snapshot)),snapshot);
});
test('malformed dictionary references are rejected rather than silently losing product fields',()=>{
 for(const value of ['~9','~no-such-reference'])assert.throws(()=>decodeCatalog({wireFormat:'catalog-ui-v2',strings:['one'],payload:{products:[{name:value}]}}));
 assert.throws(()=>decodeCatalog({wireFormat:'catalog-ui-v2',strings:[12],payload:{}}));
});
test('a small catalogue without interned strings preserves literal tildes and undefined object fields',()=>{
 const value={products:[{id:'~1',name:'~~literal',optional:undefined,coordinates:[0,-20,null]}]};
 assert.deepEqual(decodeCatalog(JSON.parse(JSON.stringify(encodeCatalog(value)))),value);
 assert.throws(()=>decodeCatalog({wireFormat:'catalog-ui-v3',strings:[],shapes:[['name']],payload:[1]}));
});
