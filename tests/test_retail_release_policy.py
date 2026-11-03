"""Synthetic fixtures only; never used as published evidence."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "monthly"))
from retail_release_policy import calendar_shift, retail_release_eligibility

TODAY = "2026-11-03"  # cutoff is 2026-08-03 (three calendar months)
URL = "https://brand.example.com/sneaker/fa-123-white"
LISTING_NOISE = {
    "listedAt": "2026-10-30", "publishedAt": "2026-10-30T00:00:00Z",
    "firstDetected": "2026-10-30", "published_at": "2026-10-30T00:00:00Z",
    "collections": ["new-arrivals", "current-assortment"],
    "imagePath": "/img/2026/10/fa-123.jpg", "seasonCode": "262MZSFG2110",
    "inCurrentAssortment": True, "regions": ["KR", "UAE"],
}


def proof(**over):
    base = {"verified": True, "kind": "first-release", "firstRelease": True,
            "date": "2026-10-20", "authority": "brand-official",
            "url": "https://brand.example.com/news/fa-123-launch",
            "productUrl": URL, "brand": "Common Projects", "style": "FA-123"}
    base.update(over)
    return base


def product(over=None, evidence=None, with_evidence=True):
    item = {"brand": "Common Projects", "url": URL, "manufacturerStyle": "FA-123"}
    if with_evidence:
        item["releaseEvidence"] = proof(**(evidence or {}))
    item.update(over or {})
    return item


class RetailReleasePolicyTest(unittest.TestCase):
    def test_recent_verified_first_release_qualifies(self):
        self.assertEqual(
            retail_release_eligibility(product(), TODAY),
            {"eligible": True, "reason": "release-verified-within-three-calendar-months",
             "releaseDate": "2026-10-20", "cutoff": "2026-08-03"})

    def test_retailer_explicit_first_release_authority_accepted(self):
        out = retail_release_eligibility(product(evidence={"authority": "retailer-explicit-first-release"}), TODAY)
        self.assertTrue(out["eligible"])

    def test_reissue_and_restock_markers_reject(self):
        cases = [(dict(LISTING_NOISE), {"title": "Re-issue of the 2019 runway pair"}),
                 ({**LISTING_NOISE, "isRestock": True}, {}),
                 ({**LISTING_NOISE, "releaseType": "restock"}, {}),
                 ({}, {"basis": "back in stock at retailer"}),
                 ({}, {"release_type": "rerelease"})]
        for over, evidence in cases:
            out = retail_release_eligibility(product(over, evidence), TODAY)
            self.assertEqual((out["eligible"], out["reason"]), (False, "release-restock-or-reissue"))

    def test_old_original_with_new_listing_rejected_on_original_date(self):
        out = retail_release_eligibility(
            product({**LISTING_NOISE, "originalReleaseDate": "2024-03-01"}), TODAY)
        self.assertEqual(out, {"eligible": False, "reason": "release-outside-three-calendar-months",
                               "releaseDate": "2024-03-01", "cutoff": "2026-08-03"})

    def test_missing_proof_is_unverified_despite_listing_signals(self):
        out = retail_release_eligibility(product(LISTING_NOISE, with_evidence=False), TODAY)
        self.assertEqual(out, {"eligible": False, "reason": "release-date-unverified",
                               "releaseDate": None, "cutoff": "2026-08-03"})
        bally = {"brand": "Bally", "url": URL, "manufacturerStyle": "FA-123",
                 "releaseDate": "2026-10-20", **LISTING_NOISE}
        self.assertEqual(retail_release_eligibility(bally, TODAY)["reason"], "release-date-unverified")

    def test_incomplete_proof_shapes_stay_unverified(self):
        for over in ({"verified": False}, {"kind": "listing"}, {"firstRelease": False},
                     {"date": "2026-10-32"}, {"date": "2026-10"}, {"date": None}):
            self.assertEqual(retail_release_eligibility(product(evidence=over), TODAY)["reason"],
                             "release-date-unverified")

    def test_listing_grade_authorities_rejected(self):
        for authority in ("retailer-registration", "retailer-upload", "shopify-published-at", "new-arrivals", None):
            self.assertEqual(retail_release_eligibility(product(evidence={"authority": authority}), TODAY)["reason"],
                             "release-evidence-unauthoritative")

    def test_mismatched_url_brand_style_rejects(self):
        for over in ({"productUrl": "https://brand.example.com/sneaker/other"},
                     {"url": "http://brand.example.com/news/fa-123-launch"},
                     {"productUrl": "http://brand.example.com/sneaker/fa-123-white"},
                     {"brand": "Bally"}, {"style": "FA-124"}, {"style": ""}):
            out = retail_release_eligibility(product(evidence=over), TODAY)
            self.assertEqual((out["eligible"], out["reason"]), (False, "release-evidence-mismatch"))
        self.assertEqual(retail_release_eligibility(product({"manufacturerStyle": None}), TODAY)["reason"],
                         "release-evidence-mismatch")

    def test_distinct_colourway_needs_its_own_proof(self):
        black = {**product(), "url": "https://brand.example.com/sneaker/fa-456-black",
                 "manufacturerStyle": "FA-456"}
        self.assertEqual(retail_release_eligibility(black, TODAY)["reason"], "release-evidence-mismatch")
        owned = {**black, "releaseEvidence": proof(productUrl=black["url"], style="FA-456")}
        self.assertTrue(retail_release_eligibility(owned, TODAY)["eligible"])

    def test_future_release_rejected(self):
        self.assertEqual(retail_release_eligibility(product(evidence={"date": "2026-11-04"}), TODAY),
                         {"eligible": False, "reason": "release-date-in-future",
                          "releaseDate": "2026-11-04", "cutoff": "2026-08-03"})

    def test_window_is_three_calendar_months_inclusive(self):
        self.assertTrue(retail_release_eligibility(product(evidence={"date": "2026-08-03"}), TODAY)["eligible"])
        self.assertEqual(retail_release_eligibility(product(evidence={"date": "2026-08-02"}), TODAY)["reason"],
                         "release-outside-three-calendar-months")
        # 2026-08-04 is 91 days before today: a 90-day cutoff would wrongly drop it.
        self.assertTrue(retail_release_eligibility(product(evidence={"date": "2026-08-04"}), TODAY)["eligible"])
        month_end = retail_release_eligibility(product(evidence={"date": "2026-02-28"}), "2026-05-31")
        self.assertEqual(month_end["cutoff"], "2026-02-28")
        self.assertTrue(month_end["eligible"])
        self.assertFalse(retail_release_eligibility(product(evidence={"date": "2026-02-27"}), "2026-05-31")["eligible"])
        self.assertEqual(calendar_shift("2026-05-31", -3), "2026-02-28")

    def test_invalid_today_and_non_mappings(self):
        with self.assertRaises(ValueError):
            retail_release_eligibility(product(), "2026-13-01")
        self.assertEqual(retail_release_eligibility(None, TODAY)["reason"], "release-date-unverified")


if __name__ == "__main__":
    unittest.main()
