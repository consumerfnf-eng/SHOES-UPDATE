"""Focused ranking/export boundaries; fixtures are never publication evidence."""
import copy
import json
import subprocess
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import pandas as pd
from shoe_trends.ranking import prepare_observations, reconcile_source_statuses, calculate_ranking, CHANNELS

NOW = datetime(2026, 10, 8, 9, tzinfo=timezone.utc)
TOPICS = [{"id": "ballet", "label": "ballet", "pattern": "ballet"}]


def status(channel, **patch):
    return dict(source_type=channel, source_id=channel, status="ok", captured_at=NOW.isoformat(), record_count=0) | patch


def row(channel="internal", **patch):
    return dict(source_type=channel, source_id=channel, source_url="https://example.com/a", item_url="https://example.com/a",
                captured_at=NOW.isoformat(), published_at=NOW.isoformat(), rank=1, keyword="ballet", text="ballet") | patch


class RankingContractTests(unittest.TestCase):
    def test_stale_rows_do_not_become_complete_zero_and_inputs_are_preserved(self):
        records = [row()] + [row(c, captured_at=(NOW-timedelta(days=8)).isoformat()) for c in CHANNELS[1:]]
        obs, raw = prepare_observations(records, TOPICS, NOW)
        states = [status(c, record_count=1) for c in CHANNELS]
        original = copy.deepcopy((states, raw))
        effective = reconcile_source_statuses(states, raw, NOW)
        result = calculate_ranking(obs, effective).iloc[0]
        self.assertTrue(pd.isna(result.Total_Trend_Score))
        self.assertEqual(result.Evidence_Coverage, .2)
        self.assertEqual((states, raw), original)
        self.assertEqual(effective[1]["collection_status"], "ok")

    def test_status_freshness_bounds_and_stale_status_cannot_use_fresh_rows(self):
        obs, raw = prepare_observations([row()], TOPICS, NOW)
        for capture in (None, "bad", (NOW+timedelta(seconds=1)).isoformat(), (NOW-timedelta(days=7, seconds=1)).isoformat()):
            effective = reconcile_source_statuses([status("internal", captured_at=capture)], raw, NOW)
            self.assertEqual(effective[0]["status"], "unavailable")
            self.assertTrue(calculate_ranking(obs, effective).empty)
        effective = reconcile_source_statuses([status("internal", captured_at=(NOW-timedelta(days=7)).isoformat())], raw, NOW)
        self.assertEqual(effective[0]["status"], "ok")

    def test_real_zero_and_no_keyword_are_complete_but_catalog_metadata_is_ignored(self):
        obs, raw = prepare_observations([row(), row("sns", keyword="", text="unmatched")], TOPICS, NOW)
        states = [status(c) for c in CHANNELS] + [status("internal", source_id="internal-catalog", status="unavailable")]
        effective = reconcile_source_statuses(states, raw, NOW)
        result = calculate_ranking(obs, effective).iloc[0]
        self.assertEqual(result.Ranking_Status, "complete")
        self.assertEqual(result.SNS_Score, 0)
        self.assertEqual(result.Total_Trend_Score, 20)
        self.assertFalse(effective[-1]["ranking_eligible"])
        catalog_only = reconcile_source_statuses([status("internal", source_id="internal-catalog")], [], NOW)
        self.assertNotEqual(calculate_ranking(obs, catalog_only).iloc[0].Ranking_Status, "complete")

    def test_partial_rejections_remain_partial_and_duplicates_are_harmless(self):
        good = row("sns")
        obs, raw = prepare_observations([good, good, row("sns", item_url="https://example.com/old", captured_at="2026-01-01T00:00:00Z")], TOPICS, NOW)
        effective = reconcile_source_statuses([status("sns")], raw, NOW)
        self.assertEqual(effective[0]["status"], "partial")
        self.assertEqual(calculate_ranking(obs, effective).iloc[0].SNS_Sampled_Posts, 1)
        self.assertEqual(reconcile_source_statuses([status("sns")], raw[:2], NOW)[0]["status"], "ok")


class ExportContractTests(unittest.TestCase):
    def test_exact_photo_new_proof_and_lossless_variants(self):
        script = r"""
import assert from 'node:assert/strict';
import {exportTrendModels} from './scripts/export-trend-catalog.mjs';
const now='2026-10-08T09:00:00Z',at='2026-10-07T00:00:00Z';
const make=(id,style,color)=>{
  const url='https://www.nike.com/t/test/'+style,image='https://static.nike.com/'+style+'.jpg';
  return {id,style,brand:'Nike',name:'Ballet sneaker',category:'sneaker',colorway:color,url,image,firstPublishedAt:at,
    officialProductEvidence:{verified:true,brand:'Nike',style,url,verifiedAt:at},
    officialImageEvidence:{verified:true,brand:'Nike',style,url:image,sourceUrl:url,verifiedAt:at},
    arrivalEvidence:{verified:true,brand:'Nike',style,productUrl:url,kind:'new-arrivals-listing',url:'https://www.nike.com/new',excerpt:'New',contentHash:'fixture',verifiedAt:at},
    presentation:{image,view:'side'}};
};
const a=make('a','SKU001','White'),b=make('b','SKU002','White'),c=make('c','SKU003','Red');
const reviews={products:[a,b,c].map(p=>({id:p.id,brand:p.brand,style:p.style,originalImage:p.image,image:p.image,approved:true,noPerson:true,view:'side',sourceUrl:p.url,checkedAt:at}))};
const run=(products,review=reviews)=>exportTrendModels({products},now,review);
const models=run([a,b,c]);
assert.equal(models.length,1);assert.equal(models[0].variants.length,3);assert.equal(models[0].colorVariants.length,2);
assert.deepEqual(models[0].allVariantIds,models[0].variants.map(p=>p.id));
assert.equal(run([{...a,presentation:{image:'https://example.com/full-body.jpg',view:'side'}}]).length,0);
assert.equal(run([{...a,image:'https://static.nike.com/replaced.jpg'}]).length,0);
for(const patch of [{noPerson:false},{approved:false},{view:'top'}]){
 assert.equal(run([a],{products:[{...reviews.products[0],...patch}]}).length,0);
}
assert.equal(run([a],{products:[]}).length,0);
// Even a recognized automatic side-photo slot cannot override a negative review.
const nb={...a,brand:'New Balance',image:'https://nb.scene7.com/is/image/NB/sku001_nb_02_i'};
nb.presentation={image:nb.image,view:'three-quarter'};
nb.officialProductEvidence={...a.officialProductEvidence,brand:nb.brand};
nb.officialImageEvidence={...a.officialImageEvidence,brand:nb.brand,url:nb.image};
nb.arrivalEvidence={...a.arrivalEvidence,brand:nb.brand};
assert.equal(run([nb],{products:[]}).length,1);
assert.equal(run([nb],{products:[{...reviews.products[0],brand:nb.brand,originalImage:nb.image,image:nb.image,noPerson:false}]}).length,0);
const noNew={...a};delete noNew.arrivalEvidence;
assert.equal(run([noNew]).length,0);
const dated={...noNew,releaseDate:'2026-09-01',dateEvidence:{verified:true,precision:'day',url:a.url,excerpt:'Released September 1',verifiedAt:at}};
assert.equal(run([dated]).length,1);
assert.equal(run([{...dated,dateEvidence:{...dated.dateEvidence,verified:false}}]).length,0);
assert.equal(run([{...dated,releaseDate:'2026-01-01'}]).length,0);
assert.equal(run([{...dated,releaseDate:'2026-11-01'}]).length,0);
assert.equal(run([{...dated,releaseDate:'2026-07',dateEvidence:{...dated.dateEvidence,precision:'month'}}]).length,0);
console.log(JSON.stringify({variants:models[0].variants.length,colorVariants:models[0].colorVariants.length}));
"""
        result = subprocess.run(["node", "--input-type=module"], input=script, text=True, encoding="utf-8", capture_output=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"variants": 3, "colorVariants": 2})


if __name__ == "__main__":
    unittest.main()
