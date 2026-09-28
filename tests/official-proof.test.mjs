import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyOfficialPage} from '../scripts/verify-official-products.mjs';
import {classifyFootwear} from '../scripts/curation.mjs';
const p={brand:'adidas',name:'Court sneaker',style:'AA001',url:'https://www.adidas.com/us/court/AA001.html',image:'https://assets.adidas.com/AA001.jpg'};
const page=(sku='AA001',image=p.image,url=p.url)=>`<link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({'@type':'Product',name:p.name,sku,image:[image]})}</script>`;
test('official proof requires current primary SKU-image pair, rejects mismatched page and cannot use raw fallback',()=>{
 assert(verifyOfficialPage(p,page()));assert.equal(verifyOfficialPage(p,page('OTHER')),null);assert.equal(verifyOfficialPage(p,page('AA001','https://assets.adidas.com/other.jpg')),null);
 assert.equal(verifyOfficialPage(p,page('AA001',p.image,'https://www.adidas.com/us/other/OTHER.html')),null);
 assert.equal(verifyOfficialPage({...p,productVerifiedAt:'2026-09-28'},`URL Source: ${p.url}\n# Court sneaker\nAA001\nNo actual image.`,{format:'markdown'}),null);
});
test('Gucci Drip description metaphor exception is limited to the reviewed exact official SKU',()=>{
 const p={brand:'Gucci',name:"Men's Drip sneaker",style:'A00A2SFAGMQ9656',officialCategory:'Sneakers',url:'https://www.gucci.com/us/en/pr/men/shoes-for-men/sneakers-for-men/mens-drip-sneaker-p-A00A2SFAGMQ9656',description:'A sneaker with the slip-on ease of a loafer.'};p.footwearReview={approved:true,type:'sneaker',brand:p.brand,style:p.style,url:p.url};
 assert.equal(classifyFootwear(p).category,'sneaker');assert.equal(classifyFootwear({...p,style:'OTHER'}).reason,'excluded-footwear');assert.equal(classifyFootwear({...p,name:'Classic loafer'}).reason,'excluded-footwear');assert.equal(classifyFootwear({...p,footwearReview:null}).reason,'excluded-footwear');
});
