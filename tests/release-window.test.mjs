import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseWindow,releaseState,releaseSortKey,calendarShift} from '../public/assets/release-window.mjs';
const month=(releaseDate,patch={})=>({releaseDate,dateEvidence:{precision:'month',verified:true},...patch});
test('verified month keeps month label and exact interval without inventing a release day',()=>{
 assert.deepEqual(releaseWindow(month('2026-08')),{start:'2026-08-01',end:'2026-08-31',precision:'month',label:'2026-08'});
 assert.equal(releaseWindow(month('2024-02')).end,'2024-02-29');assert.equal(releaseSortKey(month('2026-08')),'2026-08-01');
 assert.equal(releaseWindow(month('2026-13')),null);assert.equal(releaseWindow(month('2026-08',{dateEvidence:{precision:'month',verified:false}})),null);
 assert.equal(releaseWindow(month('2026-08',{verifiedReleaseWindow:{start:'2026-08-02',end:'2026-08-31'}})),null);
});
test('month window entirely inside is released, partial overlap or future is held, entirely before cutoff is expired',()=>{
 assert.equal(releaseState(month('2026-07'),'2026-09-28'),'released');assert.equal(releaseState(month('2026-06'),'2026-09-28'),'uncertain');assert.equal(releaseState(month('2026-05'),'2026-09-28'),'expired');
 assert.equal(releaseState(month('2026-09'),'2026-09-28'),'uncertain');assert.equal(releaseState(month('2026-10'),'2026-09-28'),'uncertain');
 assert.equal(releaseState(month('2026-06'),'2026-09-30'),'uncertain');assert.equal(releaseState(month('2026-06'),'2026-10-01'),'expired');
 assert.equal(calendarShift('2026-05-31',-3),'2026-02-28');
});
test('exact-day release and official upcoming behavior is unchanged',()=>{
 const p={releaseDate:'2026-06-28',dateEvidence:{precision:'day',verified:true,official:true}};
 assert.equal(releaseState(p,'2026-09-28'),'released');assert.equal(releaseState({...p,releaseDate:'2026-06-27'},'2026-09-28'),'expired');
 assert.equal(releaseState({...p,releaseDate:'2026-12-28'},'2026-09-28'),'upcoming');assert.equal(releaseState({...p,releaseDate:'2026-12-29'},'2026-09-28'),'uncertain');
});
