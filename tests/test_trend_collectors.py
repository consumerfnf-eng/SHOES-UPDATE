"""Synthetic source fixtures: none of these rows are production trend evidence.

Run: python -m unittest discover -s tests -p test_trend_collectors.py -v
All network/browser/session calls are mocked. Fixtures exercise observable HTML
and documented public API shapes, not fabricated production snapshots.
"""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from shoe_trends import collectors as c

NOW = datetime(2026, 10, 8, 18, 0, tzinfo=timezone(timedelta(hours=9)))
SOURCE = {"id": "fixture-shop", "url": "https://shop.example/ranking", "max_rank": 50}
INTERNAL_HTML = """<!doctype html><!-- SYNTHETIC FIXTURE -->
<div id="keyword-list">
 <article class="keyword"><span class="rank">03</span><span class="keyword-name">#발레 스니커즈</span></article>
 <article class="keyword"><span class="rank">09</span><span class="keyword-name">#트레일 슈즈</span></article>
 <article class="keyword"><span class="keyword-name">#No observed rank</span></article>
</div>"""
SHOP_HTML = """<!doctype html><!-- SYNTHETIC FIXTURE, deliberately out of rank order -->
<div class="ranking-item" data-category="Sneakers"><span class="rank">9위</span>
 <a href="/product/red?access_token=TEST_SECRET"><span class="product_name">Example red runner</span></a>
 <span class="brand">Example</span><span class="price">129,000원</span><img src="/red.jpg"></div>
<div class="ranking-item" data-category="Sneakers"><span class="rank">02</span>
 <a href="/product/blue"><span class="product_name">Example blue runner</span></a>
 <span class="price">$95.50</span></div>
<div class="ranking-item"><span class="rank">03</span>
 <a href="/product/loafers"><span class="product_name">Sneaker sole leather loafers</span></a></div>
<div class="ranking-item"><span class="rank">51</span>
 <a href="/product/late"><span class="product_name">Example running shoes</span></a></div>
<div class="ranking-item"><a href="/product/unranked"><span class="product_name">Example sneakers</span></a></div>
<div class="ranking-item"><span class="rank">5</span>
 <a href="/product/dress"><span class="product_name">Summer dress</span></a></div>
<div class="ranking-item" data-category="Sneakers"><span class="rank">6</span>
 <a href="/product/socks"><span class="product_name">Sneaker socks</span></a></div>"""
ARTICLE_BODY = ("This synthetic footwear article discusses mesh running shoes and ballet sneakers. "
                "The article text must be collected independently from the archive and unrelated navigation.")


def article(date="2026-09-08", canonical="https://news.example/p/one", body=ARTICLE_BODY):
    return f'''<!doctype html><!-- SYNTHETIC FIXTURE -->
    <meta property="article:published_time" content="{date}">
    <link rel="canonical" href="{canonical}"><h1>Synthetic shoe article</h1>
    <article><div class="entry-content"><p>{body}</p>
    <aside><p>DO_NOT_COUNT recommended sneaker</p></aside></div></article>'''


def musinsa_item(rank=7, name="Synthetic mesh sneakers", code="103004"):
    return {"image": {"rank": rank, "url": "https://img.example/shoe.jpg"},
            "info": {"productName": name, "finalPrice": 105000},
            "onClick": {"url": f"https://www.musinsa.com/products/{rank}",
              "eventLog": {"ga4": {"payload": {"section_name": "ranking_goods_list",
                 "applied_tab": "ranking_cat", "item_brand": "synthetic", "item_category_id": code}}}}}


class ParsingTests(unittest.TestCase):
    def test_internal_rank_is_visible_not_array_position(self):
        rows, count = c._internal_rows(INTERNAL_HTML, {"url": "https://internal.example/"}, NOW)
        self.assertEqual([r["rank"] for r in rows], [3, 9])
        self.assertEqual(count, 3)
        self.assertEqual(rows[0]["keyword"], "발레 스니커즈")
        self.assertEqual(rows[0]["raw_rank"], "03")

    def test_html_keeps_raw_rank_and_filters_non_shoes_and_excluded_types(self):
        rows, _ = c._ecommerce_html(SHOP_HTML, SOURCE, NOW)
        self.assertEqual([r["rank"] for r in rows], [9, 2])
        self.assertEqual(rows[0]["raw_rank"], "9위")
        self.assertEqual(rows[0]["price"], 129000)
        self.assertEqual(rows[0]["currency"], "KRW")
        self.assertEqual(rows[1]["price"], 95.5)
        self.assertIsNone(rows[1]["currency"])
        self.assertNotIn("TEST_SECRET", json.dumps(rows))

    def test_no_rank_from_product_number_or_composite_text(self):
        for value in ("Model 32", "1▲2", "50%", "Rank 4 price 20", True, 2.5):
            self.assertIsNone(c._rank(value))

    def test_hybrid_keywords_never_override_excluded_footwear(self):
        for name in ("Platform ballet heels", "Ballet sneaker loafers", "Platform dress shoes",
                     "Mary Jane sneaker slingbacks", "메리제인 스니커즈 슬링백", "플랫폼 구두"):
            self.assertFalse(c._eligible_item(name, "Sneakers"), name)
        self.assertFalse(c._eligible_item("Platform ballet sneakers", "Heels"))

    def test_ordinary_flats_and_mules_require_positive_hybrid_description(self):
        for name in ("Ballet flats", "Platform Mary Jane", "Suede mule", "발레리나 플랫", "메리제인 슈즈", "플랫폼 뮬"):
            self.assertFalse(c._eligible_item(name, "Sneakers"), name)
        for name in ("Ballet sneakers", "Mary Jane hybrid sneakers", "Mule trainers", "발레리나 스니커즈", "메리제인 스니커즈", "뮬 스니커즈"):
            self.assertTrue(c._eligible_item(name, "Footwear"), name)

    def test_jsonld_requires_explicit_position_and_product(self):
        listing = {"@type": "ItemList", "itemListElement": [
            {"@type": "ListItem", "position": 12, "item": {"@type": "Product", "name": "Synthetic shoes", "url": "/p/one", "offers": {"price": 39.5, "priceCurrency": "EUR"}}},
            {"@type": "ListItem", "item": {"@type": "Product", "name": "Unranked sneakers", "url": "/p/two"}},
            {"@type": "ListItem", "position": 1, "item": {"@type": "Product", "name": "Bag", "url": "/p/bag"}},
        ]}
        html = '<script type="application/ld+json">' + json.dumps(listing) + '</script>'
        rows, _ = c._ecommerce_html(html, SOURCE, NOW)
        self.assertEqual([r["rank"] for r in rows], [12])
        self.assertEqual(rows[0]["currency"], "EUR")

    def test_musinsa_filters_category_and_preserves_sparse_rank(self):
        source = {"id": "musinsa", "url": "https://www.musinsa.com/main/sneaker/ranking?categoryCode=103004"}
        data = {"meta": {"result": "SUCCESS"}, "data": {"modules": [{"type": "MULTICOLUMN", "items": [
            musinsa_item(), musinsa_item(4, code="001001"), musinsa_item(51), musinsa_item(3, "Formal loafers"), musinsa_item(None)
        ]}]}}
        rows, observed = c._musinsa_json(data, source, NOW)
        self.assertEqual([r["rank"] for r in rows], [7])
        self.assertEqual(rows[0]["price"], 105000)
        self.assertEqual(observed, 5)

    def test_article_excludes_recommendations_and_requires_publication_not_modified(self):
        source = {"id": "news", "url": "https://news.example/feed"}
        cutoff = NOW - timedelta(days=31)
        row = c._article(article(), "https://news.example/p/one", source, NOW, cutoff)
        self.assertNotIn("DO_NOT_COUNT", row["text"])
        self.assertIsNone(row["image_url"])
        self.assertIsNone(c._article(article().replace("article:published_time", "article:modified_time"), source["url"], source, NOW, cutoff))
        self.assertIsNone(c._article(article("2026-08-01"), source["url"], source, NOW, cutoff))
        self.assertIsNone(c._article(article("2026-12-01"), source["url"], source, NOW, cutoff))

    def test_archive_page_is_not_an_article_body(self):
        source = {"id": "news", "url": "https://news.example/"}
        html = '<meta property="article:published_time" content="2026-10-01"><main>' + ARTICLE_BODY + '</main>'
        self.assertIsNone(c._article(html, source["url"], source, NOW, NOW - timedelta(days=30)))

    def test_clothing_tags_and_sidebars_cannot_supply_footwear_keywords(self):
        source = {"id": "news", "url": "https://news.example/"}
        html = article().replace('</div></article>', '<div class="post-tags"><p>EXCLUDED_CLOTHING_TAG mesh coat</p></div></div></article>')
        row = c._article(html, "https://news.example/p/one", source, NOW, NOW - timedelta(days=31))
        self.assertNotIn("EXCLUDED_CLOTHING_TAG", row["text"])
        clothing = "This synthetic article is about jackets and woven shirts only. " * 3
        html = article(body=clothing).replace('Synthetic shoe article', 'Synthetic apparel article')
        self.assertIsNone(c._article(html, "https://news.example/p/one", source, NOW, NOW - timedelta(days=31)))

    def test_feed_discovery_deduplicates_and_rejects_external_entities(self):
        feed = '''<rss><channel><item><link>https://news.example/p/a?utm_source=test</link></item>
        <item><link>https://news.example/p/a</link></item><item><link>https://other.example/p/b</link></item></channel></rss>'''
        self.assertEqual(c._article_links(feed, "https://news.example/feed"), ["https://news.example/p/a"])
        with self.assertRaises(c._Failure):
            c._article_links('<!DOCTYPE rss [<!ENTITY a SYSTEM "file:///private">]>' + feed, "https://news.example/feed")

    def test_url_sanitization_preserves_public_category_not_auth(self):
        url = "https://shop.example/list?categoryCode=103004&token=TEST_SECRET&tab=home_ranking_v2#private"
        self.assertEqual(c._url(url, safe=True), "https://shop.example/list?categoryCode=103004&tab=home_ranking_v2")
        self.assertEqual(c._url("https://user:secret@shop.example/", safe=True), "")


class TransportTests(unittest.TestCase):
    @patch.object(c.time, "sleep")
    @patch.object(c.requests, "get")
    def test_http_403_and_429_stop_without_retry_or_next_same_host(self, get, sleep):
        for status in (403, 429):
            get.reset_mock()
            response = MagicMock(status_code=status, url="https://source.example/list")
            get.return_value.__enter__.return_value = response
            http = c._Http({})
            for url in ("https://source.example/list", "https://source.example/other"):
                with self.assertRaises(c._Failure) as exc:
                    http.get(url)
                self.assertEqual(exc.exception.status, "blocked")
            self.assertEqual(get.call_count, 1)

    @patch.object(c.time, "sleep")
    @patch.object(c.requests, "get")
    def test_network_timeout_retries_at_most_once(self, get, sleep):
        get.side_effect = c.requests.Timeout("https://example/?token=TEST_SECRET")
        with self.assertRaises(c._Failure) as exc:
            c._Http({}).get("https://example/list")
        self.assertEqual(get.call_count, 2)
        self.assertNotIn("TEST_SECRET", str(exc.exception))
        self.assertEqual(sleep.call_args_list[0].args, (2.0,))
        self.assertEqual(sleep.call_args_list[1].args, (4.0,))

    @patch.object(c.time, "sleep")
    def test_browser_http_block_is_not_retried(self, _):
        browser = c._Browser({})
        browser.context = MagicMock()
        page = browser.context.new_page.return_value
        page.goto.return_value.status = 429
        with self.assertRaises(c._Failure):
            browser.read("https://example/list")
        self.assertEqual(page.goto.call_count, 1)
        page.close.assert_called_once()
        with self.assertRaises(c._Failure):
            browser.read("https://example/other")
        self.assertEqual(page.goto.call_count, 1)

    @patch.dict(os.environ, {}, clear=True)
    @patch("playwright.sync_api.sync_playwright")
    def test_browser_does_not_discover_default_sessions(self, playwright):
        with c._Browser({"browser": {"channel": "msedge"}}):
            pass
        engine = playwright.return_value.start.return_value
        options = engine.chromium.launch.return_value.new_context.call_args.kwargs
        self.assertNotIn("storage_state", options)
        self.assertEqual(engine.chromium.launch.call_args.kwargs["channel"], "msedge")

    @patch("playwright.sync_api.sync_playwright")
    def test_browser_loads_only_explicit_env_file(self, playwright):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "synthetic-session.json"
            file.write_text('{"cookies":[],"origins":[]}', encoding="utf-8")
            with patch.dict(os.environ, {"TEST_EXPLICIT_STATE": str(file)}, clear=True):
                with c._Browser({"browser": {}}, {"storage_state_env": "TEST_EXPLICIT_STATE"}):
                    pass
            engine = playwright.return_value.start.return_value
            self.assertEqual(engine.chromium.launch.return_value.new_context.call_args.kwargs["storage_state"], str(file))


class CollectorTests(unittest.TestCase):
    def test_timezone_aware_now_is_required(self):
        for function in (c.collect_internal, c.collect_ecommerce, c.collect_instagram, c.collect_newsletters):
            with self.assertRaises(ValueError):
                function({}, datetime(2026, 10, 8))

    @patch.object(c, "_Browser")
    def test_internal_contract_keeps_catalog_separate(self, browser):
        session = browser.return_value.__enter__.return_value
        session.read.return_value = (INTERNAL_HTML, "https://internal.example/")
        session.json.return_value = {"products": [{"name": "Example"}], "keywords": [{"label": "Unranked catalog keyword"}]}
        result = c.collect_internal({"internal": {"url": "https://internal.example/"}}, NOW)
        self.assertEqual([r["rank"] for r in result["records"]], [3, 9])
        self.assertEqual(len(result["catalog"]["products"]), 1)
        session.json.assert_called_once_with("https://internal.example/data/catalog.json")
        self.assertTrue(all(s["source_type"] == "internal" for s in result["statuses"]))

    @patch.object(c, "_Browser")
    def test_partial_internal_failure_sanitizes_status_and_keeps_catalog(self, browser):
        session = browser.return_value.__enter__.return_value
        session.read.side_effect = RuntimeError("Private https://example/?token=TEST_SECRET")
        session.json.return_value = {"products": []}
        result = c.collect_internal({"internal": {"url": "https://internal.example/?token=TEST_SECRET"}}, NOW)
        self.assertNotIn("TEST_SECRET", json.dumps(result))
        self.assertEqual(result["statuses"][0]["status"], "unavailable")
        self.assertEqual(result["catalog"], {"products": []})

    @patch.object(c, "_Browser")
    def test_sparse_ecommerce_is_partial_not_50_fabricated_rows(self, browser):
        browser.return_value.__enter__.return_value.read.return_value = (SHOP_HTML, SOURCE["url"])
        result = c.collect_ecommerce({"ecommerce": [SOURCE]}, NOW)
        self.assertEqual(len(result["records"]), 2)
        self.assertEqual(result["statuses"][0]["status"], "partial")
        self.assertEqual(len(result["statuses"][0]["missing_ranks"]), 48)

    @patch.object(c, "_Browser")
    def test_blocked_ranking_host_is_not_reopened_for_another_category(self, browser):
        browser.return_value.__enter__.return_value.read.side_effect = c._Failure("HTTP_403", "blocked")
        result = c.collect_ecommerce({"ecommerce": [SOURCE, {**SOURCE, "url": "https://shop.example/other"}]}, NOW)
        self.assertEqual(browser.call_count, 1)
        self.assertEqual([s["status"] for s in result["statuses"]], ["blocked", "blocked"])
        self.assertEqual(result["statuses"][1]["reason"], "HOST_ALREADY_BLOCKED")

    @patch.object(c, "_Browser")
    def test_explicit_empty_config_and_unverified_kream_do_not_browse(self, browser):
        self.assertEqual(c.collect_ecommerce({"ecommerce": []}, NOW)["records"], [])
        result = c.collect_ecommerce({"ecommerce": [{"id": "kream", "url": "https://kream.co.kr/ranking"}]}, NOW)
        self.assertEqual(result["statuses"][0]["reason"], "UNVERIFIED_RANKING_URL")
        browser.assert_not_called()

    @patch.object(c, "_Http")
    def test_newsletter_fetches_individual_articles_once_not_feed_summary(self, http):
        feed = '''<rss><channel><item><link>https://news.example/p/one</link><description>DONOTCOUNT_FEED_BODY</description></item>
        <item><link>https://news.example/p/one?utm_source=duplicate</link></item>
        <item><link>https://news.example/p/old</link></item><item><link>https://news.example/p/nodate</link></item></channel></rss>'''
        responses = {"https://news.example/feed": feed, "https://news.example/p/one": article(),
                     "https://news.example/p/old": article("2026-09-07"),
                     "https://news.example/p/nodate": article().replace("article:published_time", "article:modified_time")}
        http.return_value.get.side_effect = lambda url: (responses[url], url)
        result = c.collect_newsletters({"newsletters": [{"id": "news", "url": "https://news.example/feed"}]}, NOW)
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(http.return_value.get.call_count, 4)
        self.assertNotIn("DONOTCOUNT_FEED_BODY", result["records"][0]["text"])
        self.assertTrue(result["statuses"][0]["cutoff"].startswith("2026-09-08"))

    @patch.object(c, "_Http")
    def test_calendar_month_cutoff_at_month_end(self, http):
        now = NOW.replace(year=2026, month=3, day=31)
        html = article("2026-02-28")
        http.return_value.get.return_value = (html, "https://news.example/p/one")
        result = c.collect_newsletters({"newsletters": [{"id": "news", "url": "https://news.example/p/one"}]}, now)
        self.assertEqual(len(result["records"]), 1)
        self.assertTrue(result["statuses"][0]["cutoff"].startswith("2026-02-28"))

    @patch.object(c, "_Http")
    def test_newsletter_block_keeps_already_collected_rows(self, http):
        feed = '<rss><channel><item><link>https://news.example/p/one</link></item><item><link>https://news.example/p/two</link></item></channel></rss>'
        http.return_value.get.side_effect = [(feed, "https://news.example/feed"), (article(), "https://news.example/p/one"), c._Failure("HTTP_429", "blocked")]
        result = c.collect_newsletters({"newsletters": [{"id": "news", "url": "https://news.example/feed"}]}, NOW)
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(result["statuses"][0]["status"], "blocked")
        self.assertEqual(result["statuses"][0]["record_count"], 1)


class InstagramTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        session = Path(self.temp.name) / "synthetic-session"
        session.write_bytes(b"synthetic fixture - loader is mocked")
        self.env = patch.dict(os.environ, {"TEST_IG_USER": "synthetic", "TEST_IG_SESSION": str(session)}, clear=True)
        self.env.start()
        self.config = {"instagram": {"enabled": True, "username_env": "TEST_IG_USER", "session_file_env": "TEST_IG_SESSION", "hashtags": ["shoe", "sneaker"], "max_posts_per_tag": 10}}

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    @staticmethod
    def post(code, days=1, likes=10):
        return SimpleNamespace(shortcode=code, date_utc=(NOW - timedelta(days=days)).astimezone(timezone.utc).replace(tzinfo=None), caption="Synthetic ballet sneakers", likes=likes)

    @patch.object(c, "_new_instaloader")
    def test_disabled_or_missing_explicit_session_never_logs_in(self, loader):
        self.assertEqual(c.collect_instagram({}, NOW)["statuses"][0]["reason"], "DISABLED")
        with patch.dict(os.environ, {}, clear=True):
            result = c.collect_instagram(self.config, NOW)
        self.assertEqual(result["statuses"][0]["reason"], "EXPLICIT_SESSION_REQUIRED")
        loader.assert_not_called()

    @patch.object(c.time, "sleep")
    @patch.object(c, "_hashtag_posts")
    @patch.object(c, "_new_instaloader")
    def test_top_posts_are_unsorted_and_deduplicated_across_tags(self, loader, posts, _):
        posts.side_effect = [(iter([self.post("old", 40), self.post("fresh", 1), self.post("future", -1)]), "hashtag-top-posts"),
                             (iter([self.post("fresh", 1), self.post("other", 2, 0)]), "hashtag-top-posts")]
        result = c.collect_instagram(self.config, NOW)
        self.assertEqual(len(result["records"]), 2)
        self.assertEqual(result["records"][0]["matched_hashtags"], ["shoe", "sneaker"])
        self.assertEqual(result["records"][1]["likes"], 0)
        self.assertEqual({r["source_id"] for r in result["records"]}, {s["source_id"] for s in result["statuses"]})
        self.assertTrue(all("rank" not in row and "mentions" not in row for row in result["records"]))
        loader.return_value.load_session_from_file.assert_called_once()
        loader.return_value.login.assert_not_called()
        loader.return_value.close.assert_called_once()

    @patch.object(c.time, "sleep")
    @patch.object(c, "_hashtag_posts")
    @patch.object(c, "_new_instaloader")
    def test_instagram_block_stops_following_tags_without_losing_rows(self, loader, posts, _):
        def stream():
            yield self.post("fresh")
            raise RuntimeError("429 https://private/?access_token=TEST_SECRET")
        posts.return_value = (stream(), "hashtag-top-posts")
        result = c.collect_instagram(self.config, NOW)
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual([s["status"] for s in result["statuses"]], ["blocked", "blocked"])
        self.assertEqual(posts.call_count, 1)
        self.assertNotIn("TEST_SECRET", json.dumps(result))

    @patch.object(c.time, "sleep")
    @patch.object(c, "_hashtag_posts")
    @patch.object(c, "_new_instaloader")
    def test_instagram_limit_is_bounded_even_for_all_old_posts(self, loader, posts, _):
        self.config["instagram"].update(hashtags=["shoe"], max_posts_per_tag=2)
        stream = iter([self.post("old1", 90), self.post("old2", 91), self.post("fresh")])
        posts.return_value = (stream, "hashtag-top-posts")
        result = c.collect_instagram(self.config, NOW)
        self.assertEqual(result["records"], [])
        self.assertEqual(result["statuses"][0]["reason"], "SAMPLE_LIMIT_REACHED")
        self.assertEqual(next(stream).shortcode, "fresh")


if __name__ == "__main__":
    unittest.main()
