"""Evidence-only collectors for the comprehensive shoe trends pipeline.

Public API: collect_{internal,ecommerce,instagram,newsletters}(config, now).
Each returns records and statuses; internal also returns the public catalog.
``now`` must be timezone aware. No scoring, uploads, session discovery or writes.

Dependencies: beautifulsoup4, requests, python-dateutil, playwright; optional
instaloader>=4.14.3,<5 when Instagram is enabled. Playwright needs Chromium or
the configured installed browser channel. Tests use synthetic sources only.

Statuses use ok/partial/blocked/unavailable, record_count, observed_count and
reason codes. A bounded sample is not a census; ecommerce is partial unless
all explicitly observed ranks through max_rank are present. Missing fields
stay null. Images are raw source URLs, NOT approved product thumbnails.

Authentication is opt-in: only files named by the configured environment
variables are read. Never search browser profiles, prompt for passwords, or
serialize credentials. The caller must supply trusted, user-owned session files
(Instaloader's native session format is pickle). Query strings in emitted URLs
are restricted to public category/pagination/product parameters.

Instaloader API references (checked 2026-10-08):
https://instaloader.github.io/module/structures.html#instaloader.Hashtag
https://instaloader.github.io/module/instaloader.html
Prefer Hashtag.get_top_posts, then get_posts_resumable if top is absent;
get_hashtag_posts/get_posts are deprecated. Unsupported or blocked endpoints
are reported, never substituted with invented volume or average-like metrics.
https://playwright.dev/python/docs/auth documents explicit storage_state files.
"""
from __future__ import annotations

import contextlib
import io
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree

import requests
from bs4 import BeautifulSoup
from dateutil.parser import isoparse
from dateutil.relativedelta import relativedelta

__all__ = ["collect_internal", "collect_ecommerce", "collect_instagram", "collect_newsletters"]

_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_UA = "SHOES-UPDATE-Trends/1.0 (public footwear research)"
_BLOCK_CODES = {401, 403, 429}
_SAFE_QUERY = {"id", "item_id", "product_id", "category", "categoryid", "categorycode",
               "category_large_code", "categorylist", "period", "periodsort", "page",
               "offset", "limit", "storecode", "contentsid", "tab"}
_SHOES = re.compile(r"\b(?:sneakers?|trainers?|footwear|shoes?|sandals?|clogs?|boots?|jelly)\b|"
                    r"스니커|운동화|러닝화|런닝화|스포츠화|신발|슈즈|샌들|슬리퍼|클로그", re.I)
_EXCLUDED = re.compile(r"\b(?:loafers?|slingbacks?|stilettos?|pumps?|oxfords?|derby|derbies|"
                       r"dress shoes?|(?:high )?heels?|socks?|shoelaces?|insoles?|shoe care)\b|"
                       r"구두|슬링백|로퍼|하이힐|펌프스|양말|신발끈|깔창|슈케어", re.I)
_ORDINARY_FLATS = re.compile(r"\b(?:ballet|ballerina|mary[ -]?jane|mules?|flats?)\b|발레|메리[ -]?제인|뮬|플랫", re.I)
_HYBRID = re.compile(r"\b(?:sneakers?|trainers?|hybrid|running shoes?)\b|스니커|운동화|러닝화|혼합형", re.I)
_CATEGORY_CODES = {"103004": "스니커즈", "103005": "스포츠화", "103003": "샌들/슬리퍼",
                   "270100100": "여성슈즈", "274100100": "남성슈즈"}
_ARTICLE_TYPES = {"Article", "NewsArticle", "BlogPosting", "ReportageNewsArticle", "ReviewNewsArticle"}


class _Failure(Exception):
    def __init__(self, reason, status="unavailable"):
        super().__init__(reason)
        self.reason, self.status = reason, status


def _now(now):
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be a timezone-aware datetime")
    return now


def _url(value, base="", *, safe=False):
    try:
        value = urljoin(base, str(value or "").strip())
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            return ""
        query = urlencode([(k, v) for k, v in parse_qsl(parsed.query) if k.lower() in _SAFE_QUERY]) if safe else parsed.query
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, ""))
    except (TypeError, ValueError):
        return ""


def _same_site(a, b):
    return urlsplit(a).hostname.removeprefix("www.") == urlsplit(b).hostname.removeprefix("www.")


def _label(value):
    return re.sub(r"https?://\S+", "[url]", str(value or ""))[:160]


def _base(kind, source, now, url=None):
    return {"source_type": kind, "source_id": _label(source.get("id", kind)),
            "source_url": _url(url or source.get("url"), safe=True), "captured_at": now.isoformat()}


def _status(kind, source, now, records=(), *, observed=0, status="ok", reason="COLLECTED", **extra):
    return {**_base(kind, source, now), "status": status, "reason": reason,
            "record_count": len(records), "observed_count": observed, **extra}


def _failure(exc):
    if isinstance(exc, _Failure):
        return exc
    # Inspect only to classify. Never emit raw exception strings or request URLs.
    name = type(exc).__name__.lower()
    message = str(exc).lower()
    if "429" in message or "toomanyrequests" in name:
        return _Failure("HTTP_429", "blocked")
    if any(s in name for s in ("login", "challenge", "forbidden", "abortdownload")) or re.search(r"\b(?:401|403)\b", message):
        return _Failure("AUTH_OR_ACCESS_BLOCKED", "blocked")
    if isinstance(exc, ImportError):
        return _Failure("DEPENDENCY_UNAVAILABLE")
    if "timeout" in name:
        return _Failure("REQUEST_TIMEOUT")
    if "err_http_response_code_failure" in message:
        return _Failure("HTTP_RESPONSE_FAILURE")
    return _Failure("SOURCE_READ_FAILED")


def _failed_status(kind, source, now, exc, records=(), observed=0):
    failure = _failure(exc)
    return _status(kind, source, now, records, observed=observed,
                   status=failure.status if failure.status == "blocked" or not records else "partial",
                   reason=failure.reason)


def _bounded(value, default, maximum):
    try:
        return max(1, min(int(value), maximum))
    except (TypeError, ValueError):
        return default


def _delay(config):
    try:
        delay = float(config.get("browser", {}).get("delay_seconds", 2))
        return max(0.0, min(delay, 60.0)) if math.isfinite(delay) else 2.0
    except (TypeError, ValueError):
        return 2.0


def _source_defaults(key):
    try:
        data = json.loads((_ROOT / "config/signal-sources.json").read_text(encoding="utf-8"))
        return data.get(key, [])
    except (OSError, ValueError):
        return []


class _Http:
    """Public requests only. No cookies from the browser/Instaloader context."""
    def __init__(self, config):
        browser = config.get("browser", {})
        self.delay = _delay(config)
        self.timeout = _bounded(browser.get("timeout_ms"), 30000, 120000) / 1000
        self.headers = {"User-Agent": browser.get("user_agent") or _DEFAULT_UA,
                        "Accept": "text/html, application/json, application/rss+xml, application/atom+xml"}
        self.blocked = set()

    def get(self, url):
        url = _url(url)
        if not url:
            raise _Failure("INVALID_SOURCE_URL")
        origin = urlsplit(url).netloc
        if origin in self.blocked:
            raise _Failure("HOST_ALREADY_BLOCKED", "blocked")
        for attempt in range(2):
            time.sleep(self.delay * (attempt + 1))
            try:
                with requests.get(url, headers=self.headers, timeout=self.timeout, stream=True) as response:
                    if response.status_code in _BLOCK_CODES:
                        self.blocked.update({origin, urlsplit(response.url).netloc})
                        raise _Failure(f"HTTP_{response.status_code}", "blocked")
                    if response.status_code >= 500 and attempt == 0:
                        continue
                    if response.status_code >= 400:
                        raise _Failure(f"HTTP_{response.status_code}")
                    chunks, size = [], 0
                    for chunk in response.iter_content(65536):
                        size += len(chunk)
                        if size > 8_000_000:
                            raise _Failure("RESPONSE_TOO_LARGE")
                        chunks.append(chunk)
                    encoding = response.encoding
                    if not encoding or encoding.lower() == "iso-8859-1":
                        encoding = "utf-8"
                    return b"".join(chunks).decode(encoding, errors="replace"), response.url
            except (requests.Timeout, requests.ConnectionError):
                if attempt:
                    raise _Failure("NETWORK_UNAVAILABLE") from None
        raise _Failure("SOURCE_READ_FAILED")


class _Browser:
    def __init__(self, config, source=None):
        self.options = config.get("browser", {})
        self.source = source or {}
        self.delay = _delay(config)
        self.timeout = _bounded(self.options.get("timeout_ms"), 30000, 120000)
        self.blocked = set()
        self.manager = self.browser = self.context = None

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        try:
            env = self.source.get("storage_state_env", self.options.get("storage_state_env", "SHOE_TRENDS_STORAGE_STATE"))
            state = os.environ.get(env, "") if env else ""
            if state and not Path(state).is_file():
                raise _Failure("STORAGE_STATE_FILE_UNAVAILABLE")
            self.manager = sync_playwright().start()
            launch = {"headless": self.options.get("headless", True)}
            if self.options.get("channel"):
                launch["channel"] = self.options["channel"]
            self.browser = self.manager.chromium.launch(**launch)
            options = {"user_agent": self.options.get("user_agent") or _DEFAULT_UA}
            if state:
                options["storage_state"] = state
            self.context = self.browser.new_context(**options)
            self.context.set_default_timeout(self.timeout)
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        for item in (self.context, self.browser):
            if item:
                with contextlib.suppress(Exception):
                    item.close()
        if self.manager:
            with contextlib.suppress(Exception):
                self.manager.stop()

    def read(self, url, selector="", *, scroll=False):
        url = _url(url)
        if not url:
            raise _Failure("INVALID_SOURCE_URL")
        host = urlsplit(url).netloc
        if host in self.blocked:
            raise _Failure("HOST_ALREADY_BLOCKED", "blocked")
        for attempt in range(2):
            time.sleep(self.delay * (attempt + 1))
            page = self.context.new_page()
            blocked_response = []

            def inspect(response):
                if response.status in _BLOCK_CODES and response.request.resource_type in {"document", "xhr", "fetch"} and urlsplit(response.url).netloc == host:
                    blocked_response.append(response.status)

            page.on("response", inspect)
            try:
                response = page.goto(url, wait_until="domcontentloaded", timeout=self.timeout)
                status = response.status if response else 0
                if status in _BLOCK_CODES:
                    self.blocked.add(host)
                    raise _Failure(f"HTTP_{status}", "blocked")
                if status >= 500 and attempt == 0:
                    continue
                if status >= 400:
                    raise _Failure(f"HTTP_{status}")
                if selector:
                    try:
                        page.locator(selector).first.wait_for(state="visible", timeout=self.timeout)
                    except Exception as exc:
                        if "Timeout" not in type(exc).__name__:
                            raise
                        # Preserve the response for a precise NO_VERIFIABLE_* status.
                if scroll:
                    for _ in range(6):
                        if blocked_response:
                            break
                        before = page.locator(selector).count() if selector else 0
                        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        time.sleep(self.delay)
                        if selector and page.locator(selector).count() == before:
                            break
                if blocked_response:
                    self.blocked.add(host)
                    raise _Failure(f"HTTP_{blocked_response[0]}", "blocked")
                html = page.content()
                if re.search(r"(?is)<title[^>]*>\s*(?:just a moment|access denied|security verification)", html):
                    self.blocked.add(host)
                    raise _Failure("ACCESS_CHALLENGE", "blocked")
                return html, page.url
            except Exception as exc:
                if blocked_response:
                    self.blocked.add(host)
                    raise _Failure(f"HTTP_{blocked_response[0]}", "blocked") from None
                if "Timeout" in type(exc).__name__ and not attempt:
                    continue
                raise
            finally:
                page.close()
        raise _Failure("SOURCE_READ_FAILED")

    def json(self, url):
        url = _url(url)
        if not url:
            raise _Failure("INVALID_CATALOG_URL")
        host = urlsplit(url).netloc
        if host in self.blocked:
            raise _Failure("HOST_ALREADY_BLOCKED", "blocked")
        for attempt in range(2):
            time.sleep(self.delay * (attempt + 1))
            response = self.context.request.get(url, timeout=self.timeout)
            try:
                if response.status in _BLOCK_CODES:
                    self.blocked.add(host)
                    raise _Failure(f"HTTP_{response.status}", "blocked")
                if response.status >= 500 and not attempt:
                    continue
                if response.status >= 400:
                    raise _Failure(f"HTTP_{response.status}")
                return response.json()
            finally:
                response.dispose()
        raise _Failure("CATALOG_UNAVAILABLE")


def _text(node, selector=None):
    selected = node.select_one(selector) if selector else node
    return selected.get_text(" ", strip=True) if selected else ""


def _rank(value):
    if isinstance(value, bool):
        return None
    match = re.fullmatch(r"\s*(?:#|No\.?\s*)?(\d{1,4})(?:위|st|nd|rd|th)?\s*", str(value or ""), re.I)
    return int(match[1]) if match and int(match[1]) > 0 else None


def _internal_rows(html, source, now):
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select(source.get("item_selector") or "#keyword-list .keyword, [data-trend-keyword]")
    records, seen = [], set()
    for row in rows:
        keyword = (row.get("data-trend-keyword") or _text(row, source.get("name_selector") or ".keyword-name")).strip().lstrip("#").strip()
        raw_rank = row.get("data-rank") or _text(row, source.get("rank_selector") or ".rank")
        rank = _rank(raw_rank)
        if not keyword or not rank or keyword.casefold() in seen:
            continue
        seen.add(keyword.casefold())
        records.append({**_base("internal", source, now), "keyword": keyword, "text": keyword,
                        "rank": rank, "raw_rank": raw_rank, "rank_basis": "visible-dom-rank"})
    return records, len(rows)


def collect_internal(config, now):
    """Read rendered keyword ranks AND public catalog, without inventing ranks."""
    now = _now(now)
    source = {"id": "internal", **config.get("internal", {})}
    result = {"records": [], "statuses": [], "catalog": {}}
    if not source.get("url"):
        result["statuses"].append(_status("internal", source, now, status="unavailable", reason="SOURCE_NOT_CONFIGURED"))
        return result
    try:
        with _Browser(config, source) as browser:
            try:
                html, _ = browser.read(source["url"], source.get("item_selector") or "#keyword-list .keyword-name, [data-trend-keyword]")
                records, observed = _internal_rows(html, source, now)
                result["records"] = records
                result["statuses"].append(_status("internal", source, now, records, observed=observed,
                    status="ok" if records else "unavailable", reason="COLLECTED" if records else "NO_VERIFIABLE_KEYWORD_RANKS"))
            except Exception as exc:
                result["statuses"].append(_failed_status("internal", source, now, exc))
            catalog_source = {"id": "internal-catalog", "url": source.get("catalog_url") or urljoin(source["url"], "data/catalog.json")}
            try:
                catalog = browser.json(catalog_source["url"])
                if not isinstance(catalog, dict) or not isinstance(catalog.get("products"), list):
                    raise _Failure("INVALID_CATALOG_SCHEMA")
                result["catalog"] = catalog
                result["statuses"].append(_status("internal", catalog_source, now,
                    observed=len(catalog["products"]), catalog_count=len(catalog["products"])))
            except Exception as exc:
                result["statuses"].append(_failed_status("internal", catalog_source, now, exc))
    except Exception as exc:
        result["statuses"].append(_failed_status("internal", source, now, exc))
    return result


def _price(value, currency=None):
    text = str(value if value is not None else "").strip()
    for marker, code in (("KRW", "KRW"), ("원", "KRW"), ("₩", "KRW"), ("USD", "USD"),
                         ("EUR", "EUR"), ("€", "EUR"), ("GBP", "GBP"), ("£", "GBP")):
        if marker in text:
            currency = code
            text = text.replace(marker, "").strip()
    # A dollar/yen symbol alone does not establish USD/JPY.
    text = text.strip("$¥ ")
    if not re.fullmatch(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?", text):
        return None, currency
    number = float(text.replace(",", ""))
    return (int(number) if number.is_integer() else number), currency


def _category(source):
    params = {k.lower(): v for k, v in parse_qsl(urlsplit(source.get("url", "")).query)}
    code = str(source.get("categoryCode") or params.get("categorycode") or params.get("category_large_code") or "")
    return str(source.get("category") or _CATEGORY_CODES.get(code, ""))


def _eligible_item(name, category):
    if not name or _EXCLUDED.search(f"{name} {category}"):
        return False
    # A broad Sneakers ranking can contain miscategorised dress shoes. Ordinary
    # ballet flats/Mary Janes/mules need positive hybrid evidence in their name.
    if _ORDINARY_FLATS.search(name) and not _HYBRID.search(name):
        return False
    return bool(_SHOES.search(f"{name} {category}"))


def _product_row(source, now, *, name, rank, raw_rank, brand="", price=None, currency=None,
                 url="", image="", category="", **extra):
    limit = _bounded(source.get("max_rank"), 50, 50)
    category = str(category or _category(source))
    item_url = _url(url, source["url"], safe=True) if url else ""
    if not rank or rank > limit or not item_url or not _eligible_item(name, category):
        return None
    amount, currency = _price(price, currency)
    return {**_base("ecommerce", source, now), "text": " ".join(filter(None, [brand, name, category])),
            "rank": rank, "raw_rank": raw_rank, "rank_basis": "source-explicit-rank", "brand": brand or None,
            "item_name": name, "price": amount, "price_raw": price, "currency": currency,
            "category": category, "item_url": item_url, "image_url": _url(image, source["url"], safe=True) if image else None,
            **extra}


def _jsonld(soup):
    def walk(value):
        if isinstance(value, list):
            for item in value:
                yield from walk(item)
        elif isinstance(value, dict):
            yield value
            for key in ("@graph", "mainEntity"):
                yield from walk(value.get(key))
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            yield from walk(json.loads(script.string or script.get_text()))
        except (TypeError, ValueError):
            continue


def _type_is(node, allowed):
    types = node.get("@type", [])
    return bool(set(types if isinstance(types, list) else [types]) & allowed)


def _ecommerce_html(html, source, now):
    soup = BeautifulSoup(html, "html.parser")
    records, observed = [], 0
    selector = source.get("item_selector") or '[data-rank], .product_item, .ranking-item, .goods-list li, [itemtype$="/ListItem"]'
    for node in soup.select(selector):
        observed += 1
        rank_node = node.select_one(source.get("rank_selector") or '.rank, .ranking, [itemprop="position"], .rank_num')
        raw_rank = node.get("data-rank") or (rank_node.get("content") or _text(rank_node) if rank_node else "")
        name = _text(node, source.get("name_selector") or '.product_name, .name, [itemprop="name"], .list_info')
        brand = _text(node, source.get("brand_selector") or '.brand, .brand_name, [itemprop="brand"]')
        price_node = node.select_one(source.get("price_selector") or '.price, .amount, [itemprop="price"]')
        price = price_node.get("content") or _text(price_node) if price_node else None
        link = node.select_one(source.get("link_selector") or 'a[href]')
        image = node.select_one('img[src], img[data-src]')
        category = node.get("data-category") or _text(node, '.category, [itemprop="category"]') or _category(source)
        row = _product_row(source, now, name=name, brand=brand, rank=_rank(raw_rank), raw_rank=raw_rank,
                           price=price, currency=source.get("currency"), url=link.get("href") if link else "",
                           image=(image.get("data-src") or image.get("src")) if image else "", category=category)
        if row:
            records.append(row)
    for listing in _jsonld(soup):
        if not _type_is(listing, {"ItemList"}):
            continue
        for item in listing.get("itemListElement", []):
            if not isinstance(item, dict) or not isinstance(item.get("item"), dict):
                continue
            observed += 1
            product = item["item"]
            if not _type_is(product, {"Product"}):
                continue
            brand = product.get("brand", "")
            brand = brand.get("name", "") if isinstance(brand, dict) else str(brand)
            offers = product.get("offers", {})
            offers = offers if isinstance(offers, dict) else {}
            image = product.get("image", "")
            image = image[0] if isinstance(image, list) and image else image
            image = image.get("url", "") if isinstance(image, dict) else image
            row = _product_row(source, now, name=product.get("name", ""), brand=brand,
                rank=_rank(item.get("position")), raw_rank=item.get("position"), price=offers.get("price"),
                currency=offers.get("priceCurrency"), url=product.get("url") or item.get("url"), image=image,
                category=product.get("category") or _category(source))
            if row:
                records.append(row)
    unique = {}
    for record in records:
        unique.setdefault((record["rank"], record["item_url"]), record)
    return list(unique.values()), observed


def _musinsa_json(data, source, now):
    records, observed = [], 0
    if data.get("meta", {}).get("result") != "SUCCESS":
        return records, observed
    expected = dict(parse_qsl(urlsplit(source["url"]).query)).get("categoryCode") or source.get("categoryCode")
    for module in data.get("data", {}).get("modules", []):
        if module.get("type") != "MULTICOLUMN":
            continue
        for item in module.get("items", []):
            observed += 1
            payload = item.get("onClick", {}).get("eventLog", {}).get("ga4", {}).get("payload", {})
            code = str(payload.get("item_category_id", ""))
            if payload.get("section_name") != "ranking_goods_list" or payload.get("applied_tab") != "ranking_cat" or code not in _CATEGORY_CODES or (expected and str(expected) != code):
                continue
            info, image = item.get("info", {}), item.get("image", {})
            row = _product_row(source, now, name=info.get("productName", ""), brand=payload.get("item_brand", ""),
                rank=_rank(image.get("rank")), raw_rank=image.get("rank"), price=info.get("finalPrice"), currency="KRW",
                url=item.get("onClick", {}).get("url", ""), image=image.get("url", ""), category=_CATEGORY_CODES[code])
            if row:
                records.append(row)
    return records, observed


def collect_ecommerce(config, now):
    """Collect explicit ranks 1..50; never derive rank from array/list position.

    Missing ecommerce config uses the repo source directory. An explicit []
    disables collection. Exact registered Musinsa URLs may use their reviewed
    public API; other pages need rendered selectors or Product ItemList JSON-LD.
    There is deliberately no guessed KREAM API or fallback proxy.
    """
    now = _now(now)
    defaults = _source_defaults("rankingPages")
    sources = config.get("ecommerce", defaults)
    records, statuses, http, blocked_hosts = [], [], _Http(config), set()
    for supplied in sources:
        registered = next((s for s in defaults if s.get("url") == supplied.get("url")), {})
        source = {**registered, **supplied}
        try:
            if urlsplit(source.get("url", "")).netloc in blocked_hosts:
                raise _Failure("HOST_ALREADY_BLOCKED", "blocked")
            if urlsplit(source.get("url", "")).hostname == "kream.co.kr" and urlsplit(source["url"]).path == "/ranking":
                raise _Failure("UNVERIFIED_RANKING_URL")
            if source.get("adapter") == "musinsa" and source.get("apiUrl") and not source.get("item_selector"):
                content, _ = http.get(source["apiUrl"])
                rows, observed = _musinsa_json(json.loads(content), source, now)
            else:
                selector = source.get("item_selector") or '[data-rank], .product_item, .ranking-item, .goods-list li, [itemtype$="/ListItem"]'
                with _Browser(config, source) as browser:
                    content, _ = browser.read(source["url"], selector, scroll=True)
                rows, observed = _ecommerce_html(content, source, now)
            records.extend(rows)
            limit = _bounded(source.get("max_rank"), 50, 50)
            missing = sorted(set(range(1, limit + 1)) - {r["rank"] for r in rows})
            statuses.append(_status("ecommerce", source, now, rows, observed=observed,
                status="unavailable" if not rows else "partial" if missing else "ok",
                reason="NO_VERIFIABLE_SHOE_RANKS" if not rows else "RANK_COVERAGE_INCOMPLETE" if missing else "COLLECTED",
                requested_max_rank=limit, missing_ranks=missing, coverage="observed-ranking-items"))
        except Exception as exc:
            if _failure(exc).status == "blocked":
                blocked_hosts.add(urlsplit(source.get("url", "")).netloc)
            statuses.append(_failed_status("ecommerce", source, now, exc))
    return {"records": records, "statuses": statuses}


def _new_instaloader(config):
    import instaloader
    browser = config.get("browser", {})
    return instaloader.Instaloader(quiet=True, sleep=True, download_pictures=False,
        download_videos=False, download_video_thumbnails=False, save_metadata=False,
        max_connection_attempts=1, fatal_status_codes=[401, 403, 429],
        request_timeout=_bounded(browser.get("timeout_ms"), 30000, 120000) / 1000,
        user_agent=browser.get("user_agent") or _DEFAULT_UA)


def _hashtag_posts(loader, tag):
    import instaloader
    hashtag = instaloader.Hashtag.from_name(loader.context, tag)
    if callable(getattr(hashtag, "get_top_posts", None)):
        return iter(hashtag.get_top_posts()), "hashtag-top-posts"
    if callable(getattr(hashtag, "get_posts_resumable", None)):
        return iter(hashtag.get_posts_resumable()), "hashtag-recent-posts"
    raise _Failure("HASHTAG_API_UNSUPPORTED")


def collect_instagram(config, now):
    """Return individual recent posts with likes, deduplicated across hashtags.

    top posts are NOT chronological: inspect the bounded sample without stopping
    on the first old post. No inferred ranking, global volume, or average likes.
    Source failure/403/429 stops further tags for that session.
    """
    now = _now(now)
    settings = config.get("instagram", {})
    source = {"id": "instagram", "url": "https://www.instagram.com/"}
    if not settings.get("enabled", False):
        return {"records": [], "statuses": [_status("sns", source, now, status="unavailable", reason="DISABLED")]}
    username = os.environ.get(settings.get("username_env", "INSTAGRAM_USERNAME"), "")
    session = os.environ.get(settings.get("session_file_env", "INSTALOADER_SESSION_FILE"), "")
    if not username or not session or not Path(session).is_file():
        return {"records": [], "statuses": [_status("sns", source, now, status="unavailable", reason="EXPLICIT_SESSION_REQUIRED")]}
    cutoff = now - timedelta(days=_bounded(config.get("lookback_days"), 30, 366))
    limit = _bounded(settings.get("max_posts_per_tag"), 30, 200)
    by_url, statuses, loader = {}, [], None
    tags = list(dict.fromkeys(str(t).strip().lstrip("#") for t in settings.get("hashtags", ["신발추천", "고프코어슈즈"])))
    # Some library versions print request details even in quiet mode.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            loader = _new_instaloader(config)
            loader.load_session_from_file(username, filename=session)
            stopped = False
            for tag in tags:
                tag_source = {"id": "instagram", "url": f"https://www.instagram.com/explore/tags/{quote(tag)}/"}
                if not re.fullmatch(r"\w+", tag, re.UNICODE):
                    statuses.append(_status("sns", tag_source, now, status="unavailable", reason="INVALID_HASHTAG"))
                    continue
                if stopped:
                    statuses.append(_status("sns", tag_source, now, status="blocked", reason="SESSION_COLLECTION_STOPPED"))
                    continue
                observed, rows, exhausted = 0, [], False
                try:
                    time.sleep(_delay(config))
                    posts, method = _hashtag_posts(loader, tag)
                    for _ in range(limit):
                        time.sleep(_delay(config))
                        try:
                            post = next(posts)
                        except StopIteration:
                            exhausted = True
                            break
                        observed += 1
                        published = post.date_utc
                        if published.tzinfo is None:
                            published = published.replace(tzinfo=timezone.utc)
                        if not cutoff <= published <= now:
                            continue
                        shortcode = str(post.shortcode)
                        if not re.fullmatch(r"[A-Za-z0-9_-]+", shortcode):
                            continue
                        url = f"https://www.instagram.com/p/{shortcode}/"
                        if url in by_url:
                            if tag not in by_url[url]["matched_hashtags"]:
                                by_url[url]["matched_hashtags"].append(tag)
                            continue
                        caption, likes = post.caption or "", post.likes
                        if not caption.strip():
                            continue
                        row = {**_base("sns", source, now, url), "published_at": published.isoformat(),
                               "text": caption, "likes": likes if isinstance(likes, int) and not isinstance(likes, bool) and likes >= 0 else None,
                               "item_url": url, "matched_hashtags": [tag], "collection_method": method,
                               "coverage": "bounded-hashtag-post-sample"}
                        by_url[url] = row
                        rows.append(row)
                    statuses.append(_status("sns", tag_source, now, rows, observed=observed,
                        status="ok" if exhausted else "partial", reason="COLLECTED" if exhausted else "SAMPLE_LIMIT_REACHED",
                        coverage="bounded-hashtag-post-sample", collection_method=method))
                except Exception as exc:
                    statuses.append(_failed_status("sns", tag_source, now, exc, rows, observed))
                    stopped = True
        except Exception as exc:
            statuses.append(_failed_status("sns", source, now, exc))
        finally:
            if loader:
                with contextlib.suppress(Exception):
                    loader.close()
    return {"records": list(by_url.values()), "statuses": statuses}


def _date(value, now):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = isoparse(value.strip())
    except (ValueError, TypeError):
        try:
            parsed = parsedate_to_datetime(value.strip())
        except (ValueError, TypeError, OverflowError):
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=now.tzinfo)


def _meta(soup, name):
    node = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
    return node.get("content", "") if node else ""


def _article(html, url, source, now, cutoff):
    soup = BeautifulSoup(html, "html.parser")
    articles = soup.select("article")
    structured = next((node for node in _jsonld(soup) if _type_is(node, _ARTICLE_TYPES)), {})
    raw_date = structured.get("datePublished") or _meta(soup, "article:published_time") or _meta(soup, "datePublished")
    if not raw_date and len(articles) == 1:
        stamp = articles[0].select_one('[itemprop="datePublished"], time[datetime]:not(.updated):not([itemprop="dateModified"])')
        raw_date = (stamp.get("datetime") or stamp.get("content")) if stamp else None
    published = _date(raw_date, now)
    if not published or not cutoff <= published <= now:
        return None
    body = structured.get("articleBody", "")
    if not isinstance(body, str):
        body = ""
    title = structured.get("headline") or _meta(soup, "og:title") or _text(soup, "h1")
    if not body:
        node = soup.select_one('[itemprop="articleBody"], .entry-content, .article-body, .post-content, .body.markup')
        if not node and len(articles) == 1:
            node = articles[0]
        if not node:
            return None
        for element in list(node.select('script, style, nav, aside, footer, .related, .related-posts, .recommendations, .comments, .tags, .tag-list, .post-tags, .article-tags, .newsletter-signup, .social-share, [rel="tag"]')):
            element.decompose()
        paragraphs = node.select("p")
        body = "\n".join(p.get_text(" ", strip=True) for p in paragraphs) if paragraphs else node.get_text(" ", strip=True)
    # Archive cards/excerpts must not become article evidence.
    if len(body.strip()) < 80 or not _SHOES.search(f"{title} {body}"):
        return None
    canonical_node = soup.select_one('link[rel="canonical"][href]')
    canonical = _url(canonical_node.get("href"), url, safe=True) if canonical_node else _url(url, safe=True)
    if not canonical or not _same_site(canonical, source["url"]):
        canonical = _url(url, safe=True)
    return {**_base("newsletter", source, now, canonical), "published_at": published.isoformat(),
            "text": f"{title}\n{body.strip()}", "item_name": title, "item_url": canonical,
            "image_url": _url(_meta(soup, "og:image"), url, safe=True) if _meta(soup, "og:image") else None,
            "date_precision": "day" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(raw_date)) else "instant",
            "date_timezone_assumed": not bool(re.search(r"(?:Z|[+-]\d\d:?\d\d|GMT|UTC)$", str(raw_date))),
            "collection_method": "individual-article-body"}


def _article_links(content, base):
    urls = []
    if re.search(r"<(?:rss|feed)\b", content[:2000], re.I):
        if re.search(r"<!DOCTYPE|<!ENTITY", content, re.I):
            raise _Failure("UNSAFE_FEED_DECLARATION")
        root = ElementTree.fromstring(content)
        for entry in root.iter():
            if entry.tag.rsplit("}", 1)[-1] not in {"item", "entry"}:
                continue
            for child in entry:
                if child.tag.rsplit("}", 1)[-1] == "link" and child.get("rel", "alternate") == "alternate":
                    urls.append(child.get("href") or child.text)
    else:
        soup = BeautifulSoup(content, "html.parser")
        for link in soup.select('article h2 a[href], article h3 a[href], main h2 a[href], main h3 a[href], a[rel="bookmark"], a.post-preview-title[href], .post-preview a[href]'):
            urls.append(link.get("href"))
        for link in soup.select("h2, h3"):
            parent = link.find_parent("a", href=True)
            if parent:
                urls.append(parent["href"])
    result, seen = [], set()
    for value in urls:
        url = _url(value, base, safe=True) if value else ""
        if url and _same_site(url, base) and url != _url(base, safe=True) and url not in seen:
            seen.add(url)
            result.append(url)
    return result


def collect_newsletters(config, now):
    """Fetch dated individual articles, once per canonical URL.

    Default/30-day lookback means one calendar month (inclusive cutoff day).
    Other lookback_days values request that many days. Archive text/feed
    summaries are discovery only and never emitted as article bodies.
    """
    now = _now(now)
    days = _bounded(config.get("lookback_days"), 30, 366)
    cutoff = (now - relativedelta(months=1) if days == 30 else now - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
    sources = config.get("newsletters", _source_defaults("editorialSources"))
    http, records, statuses, seen = _Http(config), [], [], set()
    for source in sources:
        rows, observed, failures = [], 0, []
        limit = _bounded(source.get("max_articles"), 10, 100)
        try:
            source_url = source["url"]
            # Registered feed endpoints provide reliable article links; bodies still
            # come from their individual pages, not from RSS excerpts.
            content, final_url = http.get(source.get("feedUrl") or source_url)
            links = _article_links(content, final_url)
            if not links and _article(content, final_url, source, now, cutoff):
                links = [final_url]
            for url in links[:limit]:
                if _url(url, safe=True) in seen:
                    continue
                observed += 1
                try:
                    article_html, article_url = (content, final_url) if url == final_url else http.get(url)
                    if not _same_site(article_url, source_url):
                        failures.append("ARTICLE_REDIRECT_OUTSIDE_SOURCE")
                        continue
                    row = _article(article_html, article_url, source, now, cutoff)
                    if row and row["source_url"] not in seen:
                        rows.append(row)
                        seen.add(row["source_url"])
                except Exception as exc:
                    failure = _failure(exc)
                    if failure.status == "blocked":
                        raise
                    failures.append(failure.reason)
            records.extend(rows)
            partial = bool(failures) or len(links) > limit
            statuses.append(_status("newsletter", source, now, rows, observed=observed,
                status="partial" if partial else "ok" if rows else "unavailable",
                reason="ARTICLE_ERRORS" if failures else "SAMPLE_LIMIT_REACHED" if len(links) > limit else "COLLECTED" if rows else "NO_RECENT_DATED_ARTICLE_BODIES",
                coverage="bounded-article-sample", cutoff=cutoff.isoformat(), discovered_count=len(links),
                skipped_count=observed - len(rows), errors=sorted(set(failures))))
        except Exception as exc:
            records.extend(rows)
            statuses.append(_failed_status("newsletter", source, now, exc, rows, observed))
    return {"records": records, "statuses": statuses}
