"""Retail first-release eligibility: three calendar months, source-bound proof only.

Mirrors public/assets/retail-release-policy.mjs. Listing signals (retailer
registration, upload/listedAt/publishedAt/firstDetected, new-arrivals or
current-assortment placement, Shopify published_at, image path dates) are never
sufficient; only a verified first-release evidence object counts.
"""
from __future__ import annotations

import calendar
import re
from urllib.parse import urlsplit
from datetime import date

AUTHORITIES = frozenset({"brand-official", "retailer-explicit-first-release"})
REISSUE_TEXT = re.compile(r"\b(?:re[ -]?issue|re[ -]?release|re[ -]?stock|back\s*in\s*stock|re[ -]?edition|re[ -]?run|relaunch)\b|재발매|재입고|리이슈|복각", re.IGNORECASE)
REISSUE_FLAGS = ("isRestock", "restock", "isReissue", "reissue", "isRerelease",
                 "rerelease", "reRelease", "backInStock", "isRetro", "isReEdition")
REISSUE_TEXT_FIELDS = ("releaseType", "release_type", "type", "basis", "name", "title",
                       "label", "note", "description", "headline")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
def https_url(value):
    try:
        u = urlsplit(_text(value))
        return u.scheme == 'https' and bool(u.hostname) and not u.username and not u.password and not re.search(r'\s',value)
    except (ValueError,TypeError):
        return False



def valid_calendar_day(day) -> bool:
    if not isinstance(day, str) or not _DAY.match(day):
        return False
    try:
        return date.fromisoformat(day).isoformat() == day
    except ValueError:
        return False


def calendar_shift(day: str, delta: int) -> str:
    if not valid_calendar_day(day) or not isinstance(delta, int) or isinstance(delta, bool):
        raise ValueError("Invalid calendar shift")
    anchor = date.fromisoformat(day)
    month_index = anchor.year * 12 + (anchor.month - 1) + delta
    year, month = divmod(month_index, 12)
    month += 1
    return date(year, month, min(anchor.day, calendar.monthrange(year, month)[1])).isoformat()


def _text(value) -> str:
    return value if isinstance(value, str) else ""


def _brand_key(value) -> str:
    return " ".join(_text(value).lower().split())


def _style_key(value) -> str:
    return "".join(_text(value).upper().split())


def _flagged(source) -> bool:
    return isinstance(source, dict) and any(source.get(flag) is True for flag in REISSUE_FLAGS)


def _marked_text(source) -> bool:
    return isinstance(source, dict) and any(
        REISSUE_TEXT.search(_text(source.get(field))) for field in REISSUE_TEXT_FIELDS)


def _verdict(eligible: bool, reason: str, release_date, cutoff: str) -> dict:
    return {"eligible": eligible, "reason": reason,
            "releaseDate": release_date or None, "cutoff": cutoff}


def retail_release_eligibility(product, today: str) -> dict:
    if not valid_calendar_day(today):
        raise ValueError("Invalid today")
    cutoff = calendar_shift(today, -3)
    if not isinstance(product, dict):
        return _verdict(False, "release-date-unverified", None, cutoff)

    evidence = product.get("releaseEvidence")
    if not isinstance(evidence, dict):
        return _verdict(False, "release-date-unverified", None, cutoff)
    if (evidence.get("verified") is not True or evidence.get("firstRelease") is not True
            or evidence.get("kind") != "first-release"):
        return _verdict(False, "release-date-unverified", None, cutoff)
    if not valid_calendar_day(evidence.get("date")):
        return _verdict(False, "release-date-unverified", None, cutoff)
    if evidence.get("authority") not in AUTHORITIES:
        return _verdict(False, "release-evidence-unauthoritative", None, cutoff)
    if (not https_url(evidence.get("url"))
            or not https_url(evidence.get("productUrl"))
            or evidence.get("productUrl") != product.get("url")):
        return _verdict(False, "release-evidence-mismatch", None, cutoff)
    if not _brand_key(product.get("brand")) or _brand_key(evidence.get("brand")) != _brand_key(product.get("brand")):
        return _verdict(False, "release-evidence-mismatch", None, cutoff)

    # Colourway-specific proof: the evidence must name this exact style code.
    style = _style_key(product.get("manufacturerStyle") or product.get("style"))
    if not style or _style_key(evidence.get("style")) != style:
        return _verdict(False, "release-evidence-mismatch", None, cutoff)

    # A restock/reissue is not a first release, however recent its listing.
    if _flagged(product) or _flagged(evidence) or _marked_text(product) or _marked_text(evidence):
        return _verdict(False, "release-restock-or-reissue", None, cutoff)

    # An older original release outranks the evidence date it was re-proven on.
    release_date = evidence["date"]
    originals = [d for d in [product.get("originalReleaseDate"), evidence.get("originalReleaseDate")] if valid_calendar_day(d)]
    original = min(originals) if originals else None
    if valid_calendar_day(original) and original < release_date:
        release_date = original

    if release_date > today:
        return _verdict(False, "release-date-in-future", release_date, cutoff)
    if release_date < cutoff:
        return _verdict(False, "release-outside-three-calendar-months", release_date, cutoff)
    return _verdict(True, "release-verified-within-three-calendar-months", release_date, cutoff)


def retail_publication_eligibility(product, today: str) -> dict:
    """Preserve the exact user-restored snapshot without inventing release proof."""
    if isinstance(product, dict):
        proof = product.get('retailRestoration')
        if (isinstance(proof, dict) and proof.get('snapshotId') == 'retail-restored-20261103'
                and str(product.get('source', '')).startswith('retail-')
                and all(isinstance(product.get(k), str) and product[k] and proof.get(k) == product[k]
                        for k in ('id', 'brand', 'url', 'image'))
                and proof.get('style') == (product.get('style') or '')):
            return _verdict(True, 'user-restored-retail-listing', None, None)
    return retail_release_eligibility(product, today)
