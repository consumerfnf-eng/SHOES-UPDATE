import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFootwear,officialHybridReview} from '../scripts/curation.mjs';
import {collectOfficialEvidence} from '../scripts/collect-evidence.mjs';
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

test('all reviewed sneaker mixtures publish without a fixed silhouette allowlist',()=>{
  for(const name of ['Sandal sneaker','Clog sneaker','Espadrille sneaker','Fisherman sneaker','Open hybrid sneaker','샌들 스니커즈','クロッグ スニーカー','凉鞋 运动鞋']){
    const raw={...base,name};
    assert.equal(classifyFootwear(raw).reason,'hybrid-review-required',name);
    const hybridReview=officialHybridReview(raw,'An open casual upper combined with a cushioned sneaker outsole.','2026-10-06T08:00:00Z');
    const p={...raw,hybridReview};
    assert.equal(classifyFootwear(p).category,'hybrid',name);
    Object.assign(p,classifyFootwear(p));
    assert(isPublishedFootwear(p),name);assert(categoryMatches(p,'sneaker'),name);
  }
  const unknown={...base,name:'Unusual construction',hybridReview:{approved:true,sneakerSole:true,url:base.url,type:'reviewed experimental form'}};
  assert.equal(classifyFootwear(unknown).category,'hybrid');
  assert.equal(classifyFootwear({...unknown,hybridReview:{...unknown.hybridReview,url:'https://example.com/shoe'}}).reason,'footwear-type-unverified');
  assert.equal(officialHybridReview({...base,name:'Sandal sneaker',url:'https://example.com/shoe'},'A cushioned sneaker sole.'),null);
  assert.equal(officialHybridReview({...base,name:'Sandal'},'Flexible leather straps and a flat sole.'),null);
  assert.equal(officialHybridReview({...base,name:'Summer clog'},'A design inspired by the colors of running shoes and sporting heritage.'),null);
  assert(officialHybridReview({...base,name:'Summer clog'},'The lightweight upper is mounted on a sneaker outsole with cushioning.'));
  assert.equal(classifyFootwear({...base,name:'Summer clog',description:'Vented EVA upper for summer.'}).category,'clog');
  assert.equal(classifyFootwear({...base,name:'Retro running sneaker',description:'A sandal-inspired palette.'}).category,'sneaker');
});

test('regional hybrid names keep the same product filters',()=>{
  for(const [name,filter] of [['バレエ スニーカー','ballet-sneaker'],['メリージェーン スニーカー','mary-jane-sneaker'],['穆勒 运动鞋','mule-sneaker']]){
    const p={...base,name,hybridReview:{approved:true,url:base.url,sneakerSole:true}};
    Object.assign(p,classifyFootwear(p));
    assert.equal(p.category,'hybrid');assert(categoryMatches(p,filter));
  }
});

test('hybrid structure collection preserves an already verified release date',async()=>{
  const product={...base,id:'review-sandal',name:'Open sandal sneaker',style:'HYB001',releaseDate:'2026-09-03',dateEvidence:{verified:true,precision:'day',url:'https://www.nike.com/launch/HYB001',verifiedAt:'2026-09-04T00:00:00Z',excerpt:'HYB001 launched September 3, 2026.'}};
  const result=await collectOfficialEvidence({products:[product],now:'2026-10-06T08:00:00Z',log:()=>{},read:async url=>{
    if(url.includes('salomon.com'))throw Error('No fixture calendar');
    return '# Open sandal sneaker\nStyle HYB001\n![Open sandal sneaker](https://static.nike.com/HYB001.jpg)\nThe sandal upper uses a lightweight breathable construction over a cushioned sneaker sole.';
  }});
  assert.equal(result.products.length,1);
  const row=result.products[0];
  assert.deepEqual(row.dateEvidence,product.dateEvidence);assert.equal(row.releaseDate,product.releaseDate);
  assert.equal(classifyFootwear(row).category,'hybrid');assert(row.hybridReview.sneakerSole);
  assert.equal(row.officialProductEvidence,undefined);assert.equal(row.officialImageEvidence,undefined);
});
