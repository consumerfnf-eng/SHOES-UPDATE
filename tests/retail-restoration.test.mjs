import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {restoreRetailSnapshot} from '../scripts/restore-retail-snapshot.mjs';
import {isRestoredRetail,retailPublicationEligibility,retailReleaseEligibility} from '../public/assets/retail-release-policy.mjs';
import {isExcludedBrand} from '../public/assets/brand-exclusions.mjs';
import {isLuxuryMaison} from '../scripts/luxury-shelves.mjs';
const row={id:'old',brand:'Nike',style:'AB1234-001',url:'https://shop.example/item',image:'https://shop.example/photo.jpg',source:'retail-ssense',listedAt:'2024-01-01'};
const policy={schemaVersion:1,snapshotId:'retail-restored-20261103',productIds:['old']};
test('only approved snapshot identities restore, without fabricating a first-release date',()=>{
 const rows=restoreRetailSnapshot([], [row,{...row,id:'new'}],policy);
 assert.equal(rows.length,1);assert.equal(rows[0].listedAt,row.listedAt);
 assert.equal(rows[0].releaseEvidence,undefined);assert.equal(rows[0].releaseDate,undefined);
 assert.equal(retailPublicationEligibility(rows[0],'2026-11-03').eligible,true);
 assert.equal(retailReleaseEligibility(rows[0],'2026-11-03').eligible,false);
 assert.equal(retailPublicationEligibility({...row,id:'new'},'2026-11-03').eligible,false);
 assert.equal(restoreRetailSnapshot(rows,[row],policy).length,1);
 for(const field of ['id','brand','style','url','image'])assert.equal(isRestoredRetail({...rows[0],[field]:'changed'}),false,field);
});
test('five removed brands stay absent from collection config and cannot be restored',()=>{
 const banned=['Common Projects','Bally','Martine Rose','Vivienne Westwood','Marc Jacobs'];
 assert(isExcludedBrand('커먼프로젝트'));assert(isExcludedBrand('비비안 웨스트우드'));assert.equal(isExcludedBrand('나이키'),false);
 const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'));
 for(const brand of banned){
  assert(isExcludedBrand(brand));assert.equal(isLuxuryMaison(brand),false);
  assert.equal(read('config/brand-policy.json').brands.some(b=>b.name===brand),false);
  assert.equal(read('config/daily_sources.json')[brand],undefined);
  assert.equal(read('config/official-inventory-sources.json').sources.some(b=>b.brand===brand),false);
  assert.equal(restoreRetailSnapshot([], [{...row,brand}],policy).length,0);
 }
});
test('authorized restoration is exactly the approved 1939 identities from the preserved 3191 archive',()=>{
 const read=f=>JSON.parse(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'));
 const archive=read('data/retail-source.json').products,p=read('config/retail-restoration.json');
 assert.equal(archive.length,3191);assert.equal(p.productIds.length,1939);
 assert.deepEqual(new Set(restoreRetailSnapshot([],archive,p).map(r=>r.id)),new Set(p.productIds));
});
