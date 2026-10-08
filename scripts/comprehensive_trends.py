"""python scripts/comprehensive_trends.py --output-dir reports/latest [--browser-channel msedge]."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

from shoe_trends.ranking import prepare_observations, calculate_ranking, reconcile_source_statuses
from shoe_trends.exporting import verified_models, generate_upload_items, export_workbook, excel_value

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def run(config, output_dir, now, input_snapshot=None):
    if input_snapshot:
        # Explicit replay preserves original capture dates; it is never labelled a live fetch.
        bundle = json.loads(Path(input_snapshot).read_text(encoding="utf-8-sig"))
    else:
        from shoe_trends.collectors import collect_internal, collect_ecommerce, collect_instagram, collect_newsletters
        bundle = {"records": [], "statuses": [], "catalog": {}, "captured_at": now.isoformat()}
        for collect in (collect_internal, collect_ecommerce, collect_instagram, collect_newsletters):
            result = collect(config, now)
            bundle["records"].extend(result.get("records", []))
            bundle["statuses"].extend(result.get("statuses", []))
            if result.get("catalog"):
                bundle["catalog"] = result["catalog"]
            print(json.dumps({"collector": collect.__name__, "records": len(result.get("records", [])), "statuses": result.get("statuses", [])}, ensure_ascii=False), flush=True)
    out = Path(output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    taxonomy = Path(config.get("taxonomy_path", "config/style-trend-board.json"))
    topics = json.loads((taxonomy if taxonomy.is_absolute() else ROOT / taxonomy).read_text(encoding="utf-8-sig"))["topics"]
    observations, raw = prepare_observations(bundle["records"], topics, now)
    evaluated_statuses = reconcile_source_statuses(bundle["statuses"], raw, now)
    rankings = calculate_ranking(observations, evaluated_statuses, config["weights"], config.get("max_keywords", 100))
    models = verified_models(bundle.get("catalog", {}), ROOT, now)
    uploads, items = generate_upload_items(models, rankings, topics, raw, config.get("max_items", 100))
    report = export_workbook(rankings, uploads, raw, evaluated_statuses, out / "Comprehensive_Shoe_Trend_Report.xlsx", config["weights"], now)
    write_json(out / "collection_snapshot.json", bundle)
    write_json(out / "combined_ranking.json", json.loads(rankings.to_json(orient="records", force_ascii=False)))
    write_json(out / "upload_items.json", {"schemaVersion": 1, "generatedAt": now.isoformat(), "items": items,
                                           "importMode": "existing-verified-catalog-models", "sourceStatus": evaluated_statuses})
    # Existing publisher input: preserve all variant IDs and proofs. New popularity
    # claims are not generated merely because an item matches a ranked attribute.
    write_json(out / "catalog_import.json", {"schemaVersion": 1, "products": [p for item in items for p in item["variants"]]})
    uploads.map(excel_value).to_csv(out / "Upload_Format.csv", index=False, encoding="utf-8-sig")
    summary = {"report": report, "rankedKeywords": len(rankings), "modelItems": len(items), "variantItems": sum(len(i["variants"]) for i in items),
               "complete": bool(len(rankings) and rankings.Ranking_Status.eq("complete").all()),
               "mode": "replay" if input_snapshot else "live", "sourceStatus": evaluated_statuses}
    write_json(out / "run_summary.json", summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(ROOT / "config/comprehensive-trends.json"))
    parser.add_argument("--output-dir", default=str(ROOT / "reports/latest"))
    parser.add_argument("--input-snapshot", help="Replay an explicit previously saved collection; never refreshes evidence dates")
    parser.add_argument("--browser-channel", help="Installed Playwright browser channel, e.g. msedge")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig"))
    if args.browser_channel:
        config["browser"]["channel"] = args.browser_channel
    print(json.dumps(run(config, args.output_dir, datetime.now(timezone(timedelta(hours=9))), args.input_snapshot), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
