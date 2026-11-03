import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastSeasons,reportSeason,isSneakerReport,silhouetteKeywords} from '../public/assets/forecast.mjs';
test('Forecast rotates in January and July in Korea and retains the initial window before 2027',()=>{
 assert.deepEqual(forecastSeasons('2026-11-03'),['27SS','27AW','28SS']);
 assert.deepEqual(forecastSeasons('2027-06-30T14:59:59Z'),['27SS','27AW','28SS']);
 assert.deepEqual(forecastSeasons('2027-06-30T15:00:00Z'),['27AW','28SS','28AW']);
 assert.deepEqual(forecastSeasons('2027-12-31T15:00:00Z'),['28SS','28AW','29SS']);
});
test('Only sneaker titles qualify, AW uses its first year, and only requested heading keywords are extracted',()=>{
 assert.equal(isSneakerReport('Footwear Forecast'),false);assert.equal(isSneakerReport('Sneaker Materials Forecast S/S 28'),true);
 assert.equal(reportSeason('Sneakers A/W 27/28'),'27AW');assert.equal(reportSeason('Sneakers S/S 27'),'27SS');
 assert.deepEqual(silhouetteKeywords(['Fashion silhouette: the ballet sneaker','Core updates: the dad sneaker','Materials: mesh','Fashion silhouette: the ballet sneaker']),['the ballet sneaker','the dad sneaker']);
});
