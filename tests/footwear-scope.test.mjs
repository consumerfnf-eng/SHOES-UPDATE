import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFootwear} from '../scripts/curation.mjs';
import {footwearTypes,isPublishedFootwear} from '../public/assets/footwear-policy.mjs';
import {categoryMatches} from '../public/assets/catalog-view.mjs';

const base={brand:'Nike',url:'https://www.nike.com/t/example',officialCategory:'Shoes'};
test('six requested types pass structure gates and share browser/publication filters',()=>{
  const rows=[
    {name:'Court sneaker',expected:['sneaker']},
    {name:'Ballerina sneaker',expected:['sneaker','ballet-sneaker']},
    {name:'Mary-Jane sneaker',expected:['sneaker','mary-jane-sneaker']},
    {name:'Mule sneaker',expected:['sneaker','mule-sneaker']},
    {name:'Jelly shoe',description:'Flexible TPU jelly upper with flat rubber sole',expected:['jelly']},
    {name:'Platform shoe',description:'Casual EVA flat platform construction',expected:['platform']},
    {name:'Platform sneaker',expected:['sneaker','platform']}
  ];
  for(const r of rows){const p={...base,...r,hybridReview:{approved:true,url:base.url}};const type=classifyFootwear(p);assert(type.category,r.name+': '+type.reason);Object.assign(p,type);assert(isPublishedFootwear(p));assert.deepEqual(footwearTypes(p),r.expected);for(const key of r.expected)assert(categoryMatches(p,key));}
});
test('dress exclusions win even with sneaker words, category labels and review approvals',()=>{
  for(const name of ['Sneaker loafer','Mary Jane dress shoes','Jelly slingback','Platform heels','Kitten heel sneaker','Wedge heel mule','Platform pump','Leather derby','Ballerina flats','메리제인 구두','슬링백 스니커즈','플랫폼 하이힐'])assert.equal(classifyFootwear({...base,name,productType:'sneaker',hybridReview:{approved:true,url:base.url,sneakerSole:true}}).reason,'excluded-footwear',name);
  assert.equal(classifyFootwear({...base,name:'Casual shoe',category:'loafers',productType:'sneaker'}).reason,'excluded-footwear');
  assert.equal(classifyFootwear({...base,name:'Mary Jane',hybridReview:{approved:true,url:base.url}}).reason,'sneaker-structure-unverified');
  assert.equal(classifyFootwear({...base,name:'Jelly shoe',description:'Jelly upper'}).reason,'flat-structure-unverified');
  assert.equal(classifyFootwear({...base,name:'Jellyfish sneaker'}).category,'sneaker');
  assert(!isPublishedFootwear({category:'sandal',name:'Flat sandal'}));
  assert.equal(classifyFootwear({...base,name:'Platform sandal',description:'Casual rubber outsole and 60mm heel.'}).reason,'flat-platform-unverified');
  for(const name of ['ジェリーパンプス','スリングバック スニーカー','皮鞋','플랫폼 힐'])assert.equal(classifyFootwear({...base,name}).reason,'excluded-footwear');
  assert.equal(classifyFootwear({...base,name:'Running sneaker',description:'A ballerina inspired color scheme.'}).category,'sneaker');
});
