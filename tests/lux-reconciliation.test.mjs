import test from'node:test';import assert from'node:assert/strict';import{reconcileLux}from'../scripts/reconcile-lux-publication.mjs';
test('a publication audit retains unknown types and source gaps separately from verified sneaker omissions',()=>{
 const p={id:'shoe',brand:'Prada',name:'Court sneakers',category:'sneaker',url:'https://www.prada.com/us/en/p/shoe/ABC123'};
 const unknown={id:'perfume',brand:'Prada',name:'Perfume',url:'https://www.prada.com/us/en/p/perfume/DEF456'};
 const r=reconcileLux({brands:[{name:'Prada',group:'luxury'}],products:[]},{products:[p,unknown],pending:[{brand:'Prada',candidate:{}}]},{held:[{id:'perfume',reason:'footwear-type-unverified'}]}).brands[0];
 assert.equal(r.missing.length,1);assert.equal(r.unclassified.length,1);assert.equal(r.pending,1);assert.equal(r.scopeComplete,false);
});

test('a visual scope exclusion applies only to the exact brand, SKU and official URL',()=>{
 const p={id:'mule',brand:'Prada',name:'Leather mules',style:'ABC123',url:'https://www.prada.com/us/en/p/mule/ABC123'};
 const review={held:[{id:p.id,reason:'hybrid-review-required'}]};const evidence={products:[{...p,verified:true,outOfScope:true,reason:'reviewed-dress-mule'}]};const input={brands:[{name:'Prada',group:'luxury'}],products:[]};
 assert.equal(reconcileLux(input,{products:[p]},review,evidence).brands[0].excluded.length,1);
 assert.equal(reconcileLux(input,{products:[{...p,style:'OTHER'}]},review,evidence).brands[0].missing.length,1);
});
