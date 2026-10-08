"""Deterministic, auditable ranking. Missing channels never silently become zero."""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import urlsplit

import pandas as pd
from dateutil.relativedelta import relativedelta

CHANNELS = ("internal", "ecommerce", "sns", "newsletter")
DEFAULT_WEIGHTS = dict(zip(CHANNELS, (.2, .3, .3, .2)))
KST = timezone(timedelta(hours=9))


def timestamp(value):
    try:
        stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def safe_url(value):
    try:
        url = urlsplit(str(value or ""))
        return url.scheme in ("http", "https") and bool(url.hostname) and not url.username and not url.password
    except ValueError:
        return False


def topic_matches(text, topics):
    text = str(text or "")
    return [(t, len(re.findall(t["pattern"], text, flags=re.I))) for t in topics
            if re.search(t["pattern"], text, flags=re.I)]


def prepare_observations(records, topics, now):
    """Retain exclusions and raw records; expand only valid observations by topic."""
    raw, expanded, seen = [], [], set()
    cutoff = now.astimezone(KST) - relativedelta(months=1)
    for original in records:
        row = dict(original)
        channel = row.get("source_type")
        capture, published = timestamp(row.get("captured_at")), timestamp(row.get("published_at"))
        reason = ""
        if channel not in CHANNELS or not row.get("source_id") or not safe_url(row.get("source_url")):
            reason = "invalid_source"
        elif capture is None or capture > now or now - capture > timedelta(days=7):
            reason = "stale_or_invalid_capture"
        elif channel in ("newsletter", "sns") and (published is None or not cutoff <= published <= now):
            reason = "publication_outside_one_calendar_month"
        elif channel in ("internal", "ecommerce") and (not isinstance(row.get("rank"), int)
                or isinstance(row.get("rank"), bool) or not 1 <= row["rank"] <= (50 if channel == "ecommerce" else 100)):
            reason = "invalid_explicit_rank"
        entity = row.get("post_id") or row.get("item_url") or row.get("article_url")
        if channel == "internal":
            entity = row.get("keyword")
        if not entity:
            entity = row.get("source_url") if channel == "newsletter" else row.get("item_name")
        if not entity:
            reason = reason or "missing_entity_identity"
        identity = (channel, row.get("source_id"), entity)
        if identity in seen:
            reason = reason or "duplicate_entity"
        if not reason:
            seen.add(identity)
        explicit = row.get("keyword", "")
        text = " ".join(str(row.get(k) or "") for k in ("keyword", "text", "item_name", "category"))
        matches = [(t, 1) for t in topics if explicit and explicit.casefold() in
                   [str(t.get("label", "")).casefold(), str(t.get("id", "")).casefold()]]
        matches = matches or topic_matches(text, topics)
        row["record_id"] = hashlib.sha256(json.dumps(original, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:20]
        row["included"] = not reason and bool(matches)
        row["exclusion_reason"] = reason or ("no_matching_keyword" if not matches else "")
        row["matched_keywords"] = [t["label"] for t, _ in matches]
        raw.append(row)
        if row["included"]:
            for topic, frequency in matches:
                if channel in ("internal", "ecommerce"):
                    signal = 1 / math.log2(row["rank"] + 1)
                elif channel == "sns":
                    signal = 1.0  # distinct sampled posts, not whole-platform volume
                else:
                    signal = float(frequency)
                likes = row.get("likes")
                expanded.append({"Keyword": topic["label"], "topic_id": topic["id"],
                                 "channel": channel, "source_id": row["source_id"], "signal": signal,
                                 "likes": likes if isinstance(likes, (int, float)) and likes >= 0 else None,
                                 "record_id": row["record_id"]})
    return pd.DataFrame(expanded, columns=["Keyword", "topic_id", "channel", "source_id", "signal", "likes", "record_id"]), raw


def reconcile_source_statuses(statuses, raw, now):
    """Return ranking statuses; leave original collection statuses and raw rows intact."""
    reconciled = []
    for original in statuses:
        status = dict(original)
        status["collection_status"] = original.get("status")
        status["collection_reason"] = original.get("reason")
        key = (original.get("source_type"), original.get("source_id"))
        status["ranking_eligible"] = (key[0] in CHANNELS and bool(key[1])
                                      and key[1] != "internal-catalog"
                                      and original.get("ranking_eligible") is not False)
        capture = timestamp(original.get("captured_at"))
        rows = [r for r in raw if (r.get("source_type"), r.get("source_id")) == key]
        valid = [r for r in rows if r.get("included") or r.get("exclusion_reason") == "no_matching_keyword"]
        rejected = [r for r in rows if not r.get("included") and r.get("exclusion_reason") not in
                    ("no_matching_keyword", "duplicate_entity")]
        status["accepted_record_count"] = len(valid)
        status["rejected_record_count"] = len(rejected)
        if not status["ranking_eligible"]:
            status["reconciliation_reason"] = "metadata_only"
        elif capture is None or capture > now or now - capture > timedelta(days=7):
            status.update(status="unavailable", reconciliation_reason="stale_or_invalid_status_capture")
        elif original.get("status") in ("ok", "partial"):
            if rejected:
                status.update(status="partial" if valid else "unavailable", reconciliation_reason="rejected_evidence")
            elif not valid and (rows or original.get("record_count", 0) > 0):
                status.update(status="unavailable", reconciliation_reason="no_valid_evidence")
            else:
                status["reconciliation_reason"] = "validated_evidence" if valid else "fresh_successful_empty_result"
        reconciled.append(status)
    return reconciled


def calculate_ranking(observations, statuses, weights=None, limit=100):
    weights = dict(DEFAULT_WEIGHTS if weights is None else weights)
    if set(weights) != set(CHANNELS) or any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in weights.values()) or not math.isclose(sum(weights.values()), 1):
        raise ValueError("weights must contain exactly four non-negative channels summing to 1")
    columns = ["Rank", "Keyword", "Internal_Score", "Ecommerce_Score", "SNS_Score", "Newsletter_Score",
               "Total_Trend_Score", "Provisional_Score", "Evidence_Coverage", "Ranking_Status",
               "SNS_Sampled_Posts", "SNS_Average_Likes", "Newsletter_Mentions", "Evidence_IDs"]
    excluded_sources = {(s.get("source_type"), s.get("source_id")) for s in statuses
                        if s.get("ranking_eligible") is False or s.get("source_id") == "internal-catalog"
                        or s.get("status") not in ("ok", "partial")}
    if not observations.empty:
        observations = observations.loc[[(r.channel, r.source_id) not in excluded_sources
                                         for r in observations.itertuples()]].copy()
    if observations.empty:
        return pd.DataFrame(columns=columns)
    keywords = sorted(observations["Keyword"].unique())
    result = pd.DataFrame(index=keywords)
    availability, completeness = {}, {}
    for channel in CHANNELS:
        channel_status = [s for s in statuses if s.get("source_type") == channel
                          and s.get("ranking_eligible") is not False and s.get("source_id") != "internal-catalog"]
        rows = observations[observations.channel == channel]
        good_sources = {s["source_id"] for s in channel_status if s.get("status") in ("ok", "partial")}
        available_sources = sorted(good_sources | set(rows.source_id))
        availability[channel] = bool(available_sources)
        completeness[channel] = (bool(channel_status) and all(s.get("status") == "ok" for s in channel_status)
                                 and set(rows.source_id) <= good_sources)
        field = {"internal": "Internal_Score", "ecommerce": "Ecommerce_Score", "sns": "SNS_Score", "newsletter": "Newsletter_Score"}[channel]
        if not availability[channel]:
            result[field] = float("nan")
            continue
        if rows.empty:
            result[field] = 0.0
            continue
        # Normalize each publisher before averaging, so a larger platform cannot
        # acquire more than its channel's configured weight by returning more rows.
        per_source = rows.groupby(["source_id", "Keyword"]).signal.sum().unstack(fill_value=0).reindex(index=available_sources, columns=keywords, fill_value=0)
        if channel in ("sns", "newsletter"):
            per_source = per_source.map(math.log1p)
        maxima = per_source.max(axis=1).replace(0, 1)
        result[field] = per_source.div(maxima, axis=0).mean(axis=0) * 100
    coverage = sum(weights[c] for c in CHANNELS if availability[c])
    complete = all(completeness[c] for c in CHANNELS if weights[c] > 0)
    score_fields = ["Internal_Score", "Ecommerce_Score", "SNS_Score", "Newsletter_Score"]
    weighted = result[score_fields].fillna(0).mul([weights[c] for c in CHANNELS]).sum(axis=1)
    result["Total_Trend_Score"] = weighted if complete else float("nan")
    result["Provisional_Score"] = weighted / coverage if coverage else float("nan")
    result["Evidence_Coverage"] = coverage
    result["Ranking_Status"] = "complete" if complete else "provisional_missing_or_partial_sources"
    sns = observations[observations.channel == "sns"]
    result["SNS_Sampled_Posts"] = sns.groupby("Keyword").size().reindex(keywords, fill_value=0) if availability["sns"] else float("nan")
    result["SNS_Average_Likes"] = sns.groupby("Keyword").likes.mean().reindex(keywords)
    result["Newsletter_Mentions"] = observations[observations.channel == "newsletter"].groupby("Keyword").signal.sum().reindex(keywords, fill_value=0) if availability["newsletter"] else float("nan")
    result["Evidence_IDs"] = observations.groupby("Keyword").record_id.agg(lambda values: ", ".join(sorted(set(values)))).reindex(keywords)
    result = result.rename_axis("Keyword").reset_index().sort_values(["Provisional_Score", "Keyword"], ascending=[False, True], kind="stable")
    result.insert(0, "Rank", result.Provisional_Score.rank(method="min", ascending=False).astype("Int64"))
    return result.head(min(int(limit), 100))[columns].reset_index(drop=True)
