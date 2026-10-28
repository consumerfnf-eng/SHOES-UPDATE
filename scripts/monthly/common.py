"""Shared helpers for the monthly retail/SNS/media collection pipeline.

This pipeline is additive: it never edits public/data/catalog.json or the
daily/weekly scripts. It only ever writes files under data/monthly-*.json
and public/data/monthly-catalog.json.
"""
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

KST = timezone(timedelta(hours=9))

TRACKING_PARAMS = re.compile(r'^(?:utm_|gclid$|fbclid$|ref$|referrer$|igsh$|igshid$)', re.I)


def kst_now():
    return datetime.now(timezone.utc).astimezone(KST)


def kst_day(dt=None):
    return (dt or kst_now()).strftime('%Y-%m-%d')


def kst_three_months_ago(dt=None):
    """Calendar-month subtraction in KST, matching the main pipeline's 'recent 3 months' basis."""
    d = dt or kst_now()
    year, month = d.year, d.month - 3
    while month <= 0:
        month += 12
        year -= 1
    day = min(d.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
                       31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return d.replace(year=year, month=month, day=day)


def sha256_hex(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def short_id(prefix, *parts):
    return f"{prefix}-{sha256_hex('|'.join(parts))[:20]}"


def canonical_url(url):
    try:
        parts = urlsplit(url)
        if parts.scheme != 'https':
            return ''
        query = [(k, v) for k, v in parse_qsl(parts.query) if not TRACKING_PARAMS.match(k)]
        query.sort()
        host = parts.netloc.lower()
        if host.startswith('www.'):
            host = host[4:]
        path = parts.path.rstrip('/')
        return urlunsplit((parts.scheme, host, path, urlencode(query), ''))
    except Exception:
        return ''


def read_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def atomic_write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.tmp-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


# Sneaker-vs-other-footwear classification, mirroring the include/exclude intent
# of scripts/curation.mjs classifyFootwear (English retail listings only; this
# pipeline never touches the Korean/Japanese/Chinese official-brand gates there).
SNEAKER_INCLUDE = re.compile(
    r'\b(sneakers?|trainers?|running shoes?|runners?|skate shoes?|court shoes?|high-?tops?|low-?tops?)\b', re.I)
SNEAKER_EXCLUDE = re.compile(
    r'\b(loafers?|oxfords?|derbys?|derbies|boots?|heels?|pumps?|mules?|sandals?|slides?|flats?|'
    r'slingbacks?|espadrilles?|clogs?|mary ?janes?|wedges?|moccasins?|monk straps?)\b', re.I)


def is_sneaker_title(name):
    name = name or ''
    if SNEAKER_EXCLUDE.search(name) and not SNEAKER_INCLUDE.search(name):
        return False
    return bool(SNEAKER_INCLUDE.search(name))


BROWSER_HEADERS = {
    'accept-language': 'en-US,en;q=0.9',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
}
