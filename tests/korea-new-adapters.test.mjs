import test from 'node:test';import assert from 'node:assert/strict';
import {columbiaNewPage} from '../scripts/columbia-new-page.mjs';
import {dkonNewRows} from '../scripts/collect-dkon-new.mjs';
test('Columbia New badges bind only their own footwear tile and explicit color variants',()=>{
 const url='https://www.columbiakorea.co.kr/product/list.asp?cno=350',html=`<li class="goods " data-code="C76YI2581023"><img src="https://cdn.example/ProductTagImage/TAG_00_New_3.png"><p class="name _v2">공용 헤이지 져니 스니커즈</p><p class="sale">129,000원</p><a data-no='22368' data-code='C76YI2581023' data-img='//assetscdn49.styleship.com/assets/columbia/data/productimages/a/3/C76YI2581023.jpg'></a></li><div data-tot="1"></div>`;
 const d=columbiaNewPage(html,url);assert.equal(d.products.length,1);assert.equal(d.products[0].style,'C76YI2581023');assert.equal(d.products[0].priceLabel,'KRW 129000');assert.equal(columbiaNewPage(html.replace('TAG_00_New_3.png','ordinary.png'),url).products.length,0);assert.equal(columbiaNewPage(html.replace('스니커즈','미드 부츠'),url).products.length,0);
});
test('DKON shared-store rows require the actual brand and athletic shoe source type',()=>{
 const url='https://dk-on.com/DESCENTE/newArrival/productList?page=1&pageSize=100',row={prodCd:'SS123RRN11',prodNm:'이지 슈퍼 엔듀로',colorCd:'WTBK',colorNm:'WHITE / BLACK',classCd:'3',kindCd:'RN',brndNmEn:'Descente',image1:'//img.dk-on.com/product/SS123RRN11_WTBK_N01.JPG',mallSalePrc:129000};
 const opts={brand:'DESCENTE',slug:'DESCENTE',url};assert.equal(dkonNewRows({products:[row]},opts).products.length,1);
 assert.equal(dkonNewRows({products:[{...row,classCd:'4'}]},opts).products.length,0);
 assert.throws(()=>dkonNewRows({products:[{...row,brndNmEn:'Umbro'}]},opts),/brand binding/);
 assert.throws(()=>dkonNewRows({products:[{...row,image1:'//img.dk-on.com/other.jpg'}]},opts),/Unbound/);
});
