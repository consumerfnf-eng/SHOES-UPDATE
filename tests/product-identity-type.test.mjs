import test from 'node:test';
import assert from 'node:assert/strict';
import {curateProduct,officialEvidenceFor} from '../scripts/curation.mjs';
import {exportRows,EXPORT_COLUMNS} from '../public/assets/export.mjs';

const now='2026-10-06T08:00:00Z',day='2026-10-06';
function product(){
  const p={id:'nike-fixture',brand:'Nike',name:'Experimental sneaker',style:'9876543210123',styleType:'official-product-id',url:'https://www.nike.com/products/experimental-sneaker',image:'https://www.nike.com/cdn/shop/files/experimental.jpg',officialCategory:'Sneakers',description:'A casual lifestyle sneaker with a lightweight cushioned sole.',releaseDate:'2026-09-02',dateEvidence:{verified:true,precision:'day',url:'https://www.nike.com/blogs/news/experimental',verifiedAt:now,excerpt:'Experimental sneaker releases on September 2, 2026.'},productVerifiedAt:now,productEvidenceUrl:'https://www.nike.com/products/experimental-sneaker'};
  const proof={verified:true,brand:p.brand,style:p.style,identifierType:p.styleType,verifiedAt:now,verificationMethod:'reviewed-official-shopify-product-id-color-image'};
  p.officialProductEvidence={...proof,url:p.url};
  p.officialImageEvidence={...proof,url:p.image,sourceUrl:p.url};
  return p;
}
test('official product identifiers remain typed and bound to the exact official product and photo',()=>{
  const p=product(),out=curateProduct(p,day).product;
  assert(out);assert.equal(out.style,p.style);assert.equal(out.styleType,'official-product-id');
  assert.equal(out.officialProductEvidence.identifierType,'official-product-id');
  assert.equal(out.officialImageEvidence.identifierType,'official-product-id');
  assert(officialEvidenceFor(out,day));
  assert(curateProduct({...out,productVerifiedAt:out.lastVerifiedAt},day).product);
  for(const mutate of [
    q=>delete q.officialProductEvidence.identifierType,
    q=>delete q.officialImageEvidence.identifierType,
    q=>q.officialProductEvidence.style='9876543210999',
    q=>q.officialImageEvidence.sourceUrl='https://www.nike.com/products/another',
    q=>q.officialImageEvidence.url='https://www.nike.com/cdn/shop/files/another.jpg'
  ]){
    const invalid=structuredClone(p);mutate(invalid);
    assert.equal(officialEvidenceFor(invalid,day),null);
    assert.equal(curateProduct(invalid,day).reason,'official-product-id-evidence-required');
  }
  const mislabeled=product();delete mislabeled.styleType;
  assert.equal(officialEvidenceFor(mislabeled,day),null,'A platform product ID cannot be presented as a manufacturer style code');
});
test('manufacturer style codes retain their existing behavior and archive export stays at 17 fields',()=>{
  const p=product();delete p.styleType;delete p.officialProductEvidence.identifierType;delete p.officialImageEvidence.identifierType;
  const out=curateProduct(p,day).product;
  assert(out);assert.equal(out.style,p.style);assert.equal(out.styleType,undefined);
  const typed=product(),rows=exportRows([typed]);
  assert.equal(rows[0].length,17);assert.deepEqual(rows[0],EXPORT_COLUMNS.map(([key])=>key));
  assert(!JSON.stringify(rows).includes(typed.style));assert(!JSON.stringify(rows).includes('official-product-id'));
});
