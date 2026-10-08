"""Exact seven-column upload form and three-sheet XLSX; metadata remains in JSON."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from unicodedata import east_asian_width

import pandas as pd
from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .ranking import CHANNELS, topic_matches

UPLOAD_COLUMNS = ["Item_Name", "Brand", "Price", "Trend_Keyword", "Image_CDN_URL", "Color_Hex", "Description"]


def verified_models(catalog, root, now):
    process = subprocess.run(["node", str(Path(root) / "scripts/export-trend-catalog.mjs")],
                             input=json.dumps({"catalog": catalog, "now": now.isoformat()}, ensure_ascii=False),
                             capture_output=True, text=True, encoding="utf-8", timeout=60, check=True)
    return json.loads(process.stdout)


def generate_upload_items(models, ranking, topics, raw, limit=100):
    keywords = {r["Keyword"]: r for r in ranking.to_dict("records")}
    rows, items = [], []
    for model in models:
        variants = model["variants"]
        candidates = []
        for p in variants:
            description = " ".join(str(p.get(k) or "") for k in ("name", "description", "material", "colorway"))
            description += " " + " ".join(p.get("keywords", []) + p.get("keywordTags", []))
            for topic, _ in topic_matches(description, topics):
                if topic["label"] in keywords:
                    candidates.append((keywords[topic["label"]]["Rank"], topic["label"], p))
        if not candidates:
            continue
        _, keyword, representative = min(candidates, key=lambda row: (row[0], row[1], row[2]["id"]))
        descriptions = []
        for r in raw:
            style = representative.get("style", "")
            text = r.get("text", "")
            if r.get("included") and r.get("source_type") == "sns" and len(style) >= 5 and re.search(r"(?<!\w)" + re.escape(style) + r"(?!\w)", text, re.I):
                descriptions.append(r)
        # An exact SKU is required before describing a caption as item evidence.
        if descriptions:
            sns = max(descriptions, key=lambda r: r.get("likes") or 0)
            description = re.sub(r"\s+", " ", sns["text"]).strip()[:160]
            description_basis = {"type": "sns-exact-style", "sourceUrl": sns["source_url"]}
        else:
            description = re.sub(r"\s+", " ", representative.get("description") or model["name"]).strip()[:160]
            description_basis = {"type": "official-catalog", "sourceUrl": representative["url"], "snsAvailable": False}
        swatches = representative.get("colorSwatches", [])
        row = dict(zip(UPLOAD_COLUMNS, [model["name"], representative["brand"], representative.get("priceLabel", ""), keyword,
                     representative["presentation"]["image"], next((s for s in swatches if re.fullmatch(r"#[0-9A-Fa-f]{6}", s)), ""), description]))
        rows.append(row)
        items.append({"modelKey": model["modelKey"], "representativeId": representative["id"], "form": row,
                      "descriptionEvidence": description_basis, "matchBasis": "ranked-keyword-attribute-match",
                      "snsCaptionVerified": bool(descriptions), "productPopularityVerified": False, "keywordRank": int(keywords[keyword]["Rank"]),
                      "keywordRankingStatus": keywords[keyword]["Ranking_Status"],
                      "provisionalScore": float(keywords[keyword]["Provisional_Score"]),
                      "totalTrendScore": None if pd.isna(keywords[keyword]["Total_Trend_Score"]) else float(keywords[keyword]["Total_Trend_Score"]),
                      "colorVariants": model.get("colorVariants", variants), "variants": variants,
                      "allVariantIds": model["allVariantIds"]})
    items.sort(key=lambda p: (p["keywordRank"], p["form"]["Brand"], p["modelKey"]))
    items = items[:int(limit)]
    return pd.DataFrame([i["form"] for i in items], columns=UPLOAD_COLUMNS), items


def excel_value(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    if isinstance(value, str):
        value = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", value)[:32760]
        return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value
    return None if pd.isna(value) else value


def export_workbook(ranking, uploads, raw, statuses, output, weights, now):
    wb = Workbook()
    wb.remove(wb.active)
    status_rows = [{"record_type": "source_status", **s} for s in statuses]
    raw_rows = [{"record_type": "observation", **r} for r in raw] + status_rows
    raw_columns = list(dict.fromkeys(["record_type", "record_id", "source_type", "source_id", "source_url", "captured_at", "published_at", "rank", "item_name", "brand", "price", "currency", "keyword", "text", "likes", "included", "exclusion_reason", "status", "reason"] + [k for r in raw_rows for k in r]))
    datasets = [("Combined_Ranking", ranking), ("Upload_Format", uploads), ("Raw_Data", pd.DataFrame(raw_rows, columns=raw_columns))]
    for name, frame in datasets:
        ws = wb.create_sheet(name)
        ws.append(list(frame.columns))
        for row in frame.itertuples(index=False, name=None):
            ws.append([excel_value(value) for value in row])
        ws.freeze_panes = "C2" if name == "Combined_Ranking" else "A2"
        ws.auto_filter.ref = ws.dimensions
        ws.sheet_view.showGridLines = False
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.print_options.horizontalCentered = False
        ws.page_setup.orientation = "landscape"
        ws.page_setup.paperSize = ws.PAPERSIZE_A3
        ws.print_title_rows = "1:1"
        for cell in ws[1]:
            cell.font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="24364B")
            cell.alignment = Alignment(wrap_text=True, vertical="center")
        ws.row_dimensions[1].height = 34
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.font = Font(name="Arial", size=10)
                cell.alignment = Alignment(vertical="top", wrap_text=True)
                if cell.row % 2 == 0:
                    cell.fill = PatternFill("solid", fgColor="F2F5F8")
        for column in ws.columns:
            width = max((sum(2 if east_asian_width(ch) in "WF" else 1 for ch in str(c.value or "").split("\n")[0]) for c in column), default=8) + 2
            ws.column_dimensions[column[0].column_letter].width = min(64, max(14, width))
        for r in range(2, ws.max_row + 1):
            ws.row_dimensions[r].height = 44 if name != "Raw_Data" else 60
    rank_sheet = wb["Combined_Ranking"]
    rank_sheet["G1"].comment = Comment("전체 설정 소스 수집이 성공한 경우에만 고정 가중치 종합 점수. 자료 누락/부분 수집이면 비워 둡니다.", "SHOES")
    rank_sheet["H1"].comment = Comment("확보된 채널의 가중치 합으로 나눈 잠정 점수. 순위는 실행 시점의 정적 스냅샷이며 변경 후에는 스크립트를 재실행하세요.", "SHOES")
    rank_sheet["I1"].comment = Comment("사용 가능한 채널의 설정 가중치 합. 각 플랫폼의 1~50위 수집 완전성은 Raw_Data의 source_status 행에서 확인하세요.", "SHOES")
    rank_sheet["K1"].comment = Comment("수집된 고유 게시물 표본 수이며 Instagram 전체 게시물 수/검색량이 아닙니다.", "SHOES")
    for row in range(2, rank_sheet.max_row + 1):
        for col in range(3, 9):
            rank_sheet.cell(row, col).number_format = "0.00"
        rank_sheet.cell(row, 9).number_format = "0%"
        for col in (11, 13):
            rank_sheet.cell(row, col).number_format = "#,##0"
        rank_sheet.cell(row, 12).number_format = "#,##0.0"
    wb["Upload_Format"]["C1"].comment = Comment("공식 가격 문자열과 통화를 그대로 보존합니다. 환율 변환 또는 서로 다른 통화의 합계는 계산하지 않습니다.", "SHOES")
    wb["Upload_Format"]["G1"].comment = Comment("정확한 품번과 일치하는 SNS 본문이 있으면 그 한 줄을 사용합니다. 없으면 공식 카탈로그 설명을 사용하며 구분 근거는 upload_items.json에 저장합니다.", "SHOES")
    # Keep the requested first-row table headers and exactly three worksheets.
    raw_sheet = wb["Raw_Data"]
    raw_sheet.append(["run_metadata", "", "", "", "", now.isoformat(), "", "", "", "", "", "", "", json.dumps({"weights": weights, "method": "publisher-balanced-log-normalized-v1", "rankRefresh": "rerun-script"}, ensure_ascii=False)])
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.xlsx")
    wb.save(temporary)
    # Reopen to confirm the delivered OOXML and requested schema before replacing.
    check = load_workbook(temporary, read_only=True)
    assert check.sheetnames == ["Combined_Ranking", "Upload_Format", "Raw_Data"]
    assert list(next(check["Upload_Format"].values)) == UPLOAD_COLUMNS
    check.close()
    temporary.replace(output)
    return str(output)
