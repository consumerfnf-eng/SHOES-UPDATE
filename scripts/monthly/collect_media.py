"""Collect recent-3-months footwear articles from Hypebeast, Hypebeast Korea,
Sneaker News, Footwear News, and Allure Korea, for the newsletter tab.

Sneaker News and Footwear News (whose real articles live on wwd.com, not
footwearnews.com - confirmed by hand: footwearnews.com's own <time> tags are
an unpopulated template placeholder, "00:00-YY-DD-MM") expose a public
WordPress REST API (wp-json/wp/v2/posts) with exact publish dates, so those
two use the API directly. Footwear News is filtered server-side to WWD's
"Sneaker News" category (id 344412701, found via /wp-json/wp/v2/categories).
Hypebeast/Hypebeast Korea use the same HTML template, scraped with the real
selectors observed on their /footwear listing pages. Allure Korea has no
public REST API (401 rest_not_logged_in) and its <time> markup is not
reliable either, so it's scraped from site search results instead: each
result's own URL embeds a real /YYYY/MM/DD/ publish date, and the headline
comes from the thumbnail <img alt="..."> next to it (confirmed by hand -
there is no plain-text headline next to the link itself).

This script only extracts headline/url/publishedAt/excerpt. It does not try
to guess which shoe model an article is about beyond simple keyword matching
left to update.py, which cross-references against known models/aliases and
holds anything unmatched rather than inventing a product record.
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone

from curl_cffi import requests as curl_requests

from common import BROWSER_HEADERS, atomic_write_json, canonical_url, kst_now, kst_three_months_ago

MAX_LISTING_PAGES = 8

HYPEBEAST_SOURCES = [
    {'id': 'hypebeast', 'label': 'Hypebeast', 'base': 'https://hypebeast.com/footwear'},
    {'id': 'hypebeast-kr', 'label': 'Hypebeast Korea', 'base': 'https://hypebeast.kr/footwear'},
]
WP_REST_SOURCES = [
    {'id': 'sneaker-news', 'label': 'Sneaker News', 'base': 'https://sneakernews.com/wp-json/wp/v2/posts'},
    {'id': 'footwear-news', 'label': 'Footwear News', 'base': 'https://wwd.com/wp-json/wp/v2/posts',
     'extra': 'categories=344412701'},
]
ALLURE_KR_QUERIES = ['스니커즈', '운동화']

ARTICLE_RE = re.compile(
    r'post-box-content-title">\s*<a href="([^"]+)" class="title"\s+title="([^"]*)"', re.S)
TIME_RE = re.compile(r'<time class="timeago"\s+datetime="([^"]+)"')
FOOTWEAR_KEYWORD_RE = re.compile(r'스니커즈|운동화|신발|슈즈|sneaker', re.I)
ALLURE_ITEM_RE = re.compile(
    r'<a href="(https://www\.allurekorea\.com/(20\d\d)/(\d\d)/(\d\d)/[^"]+)"[^>]*>\s*'
    r'<div class="thum">\s*<img[^>]*alt="([^"]*)"', re.S)


def fetch(url, attempts=3):
    last_error = None
    for attempt in range(attempts):
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=25)
            if r.status_code == 200:
                return r.text
            last_error = f'http-{r.status_code}'
        except Exception as e:
            last_error = str(e)
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last_error or 'unknown-fetch-error')


def collect_hypebeast(source, cutoff_iso, checked_at, diagnostics):
    items = []
    status = {'source': source['id'], 'pages': 0, 'responses': 0, 'articles': 0, 'errors': []}
    seen = set()
    stop = False
    for page in range(1, MAX_LISTING_PAGES + 1):
        url = source['base'] if page == 1 else f"{source['base']}/page/{page}"
        try:
            html = fetch(url)
            status['responses'] += 1
        except Exception as e:
            status['errors'].append({'url': url, 'error': str(e)})
            break
        articles = ARTICLE_RE.findall(html)
        times = TIME_RE.findall(html)
        if not articles:
            break
        for i, (href, title) in enumerate(articles):
            canon = canonical_url(href)
            if not canon or canon in seen:
                continue
            seen.add(canon)
            published_at = times[i] if i < len(times) else None
            if not published_at:
                continue
            if published_at < cutoff_iso:
                stop = True
                continue
            title = title.replace('�', '').strip()
            if not title:
                continue
            items.append({
                'source': source['id'],
                'sourceLabel': source['label'],
                'headline': title,
                'url': href,
                'publishedAt': published_at,
                'checkedAt': checked_at,
            })
            status['articles'] += 1
        status['pages'] = page
        if stop:
            break
        time.sleep(1.5)
    diagnostics.append(status)
    return items


def collect_wp_rest(source, cutoff_iso, checked_at, diagnostics):
    items = []
    status = {'source': source['id'], 'pages': 0, 'responses': 0, 'articles': 0, 'errors': []}
    cutoff_gmt = cutoff_iso[:19]
    extra = f"&{source['extra']}" if source.get('extra') else ''
    for page in range(1, MAX_LISTING_PAGES + 1):
        url = f"{source['base']}?per_page=50&page={page}&after={cutoff_gmt}{extra}"
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=25)
            status['responses'] += 1
        except Exception as e:
            status['errors'].append({'url': url, 'error': str(e)})
            break
        if r.status_code == 400:
            break  # WP REST API returns 400 past the last valid page
        if r.status_code != 200:
            status['errors'].append({'url': url, 'error': f'http-{r.status_code}'})
            break
        try:
            posts = r.json()
        except Exception as e:
            status['errors'].append({'url': url, 'error': f'bad-json: {e}'})
            break
        if not posts:
            break
        for post in posts:
            title = re.sub(r'<[^>]+>', '', (post.get('title') or {}).get('rendered') or '').strip()
            if not title:
                continue
            items.append({
                'source': source['id'],
                'sourceLabel': source['label'],
                'headline': title,
                'url': post.get('link'),
                'publishedAt': post.get('date_gmt', '') + 'Z' if post.get('date_gmt') else '',
                'checkedAt': checked_at,
            })
            status['articles'] += 1
        status['pages'] = page
        if len(posts) < 50:
            break
        time.sleep(1.2)
    diagnostics.append(status)
    return items


def collect_allurekorea(cutoff_iso, checked_at, diagnostics):
    items = []
    status = {'source': 'allure-korea', 'queries': 0, 'responses': 0, 'articles': 0, 'errors': []}
    seen = set()
    cutoff_day = cutoff_iso[:10]
    for query in ALLURE_KR_QUERIES:
        url = f'https://www.allurekorea.com/?s={urllib.parse.quote(query)}'
        status['queries'] += 1
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=25)
            status['responses'] += 1
        except Exception as e:
            status['errors'].append({'url': url, 'error': str(e)})
            continue
        if r.status_code != 200:
            status['errors'].append({'url': url, 'error': f'http-{r.status_code}'})
            continue
        for href, year, month, day, alt in ALLURE_ITEM_RE.findall(r.text):
            canon = canonical_url(href)
            if not canon or canon in seen:
                continue
            seen.add(canon)
            published_at = f'{year}-{month}-{day}T00:00:00Z'
            if published_at < cutoff_day + 'T00:00:00Z':
                continue
            headline = alt.strip()
            # Allure Korea's own site search is loose (observed returning
            # unrelated beauty/fashion articles for a "스니커즈" query), so
            # filter by the headline text itself rather than trusting the
            # search match.
            if not headline or not FOOTWEAR_KEYWORD_RE.search(headline):
                continue
            items.append({
                'source': 'allure-korea',
                'sourceLabel': 'Allure Korea',
                'headline': headline,
                'url': href,
                'publishedAt': published_at,
                'checkedAt': checked_at,
            })
            status['articles'] += 1
        time.sleep(1.5)
    diagnostics.append(status)
    return items


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    checked_at = kst_now().isoformat()
    cutoff_iso = kst_three_months_ago().astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    diagnostics = []
    items = []
    for source in HYPEBEAST_SOURCES:
        try:
            items.extend(collect_hypebeast(source, cutoff_iso, checked_at, diagnostics))
        except Exception as e:
            diagnostics.append({'source': source['id'], 'errors': [{'error': str(e)}]})
    for source in WP_REST_SOURCES:
        try:
            items.extend(collect_wp_rest(source, cutoff_iso, checked_at, diagnostics))
        except Exception as e:
            diagnostics.append({'source': source['id'], 'errors': [{'error': str(e)}]})
    try:
        items.extend(collect_allurekorea(cutoff_iso, checked_at, diagnostics))
    except Exception as e:
        diagnostics.append({'source': 'allure-korea', 'errors': [{'error': str(e)}]})

    responded = any(d.get('responses') for d in diagnostics)
    result = {
        'status': 'ok' if responded and items else ('partial' if responded else 'unavailable'),
        'checkedAt': checked_at,
        'periodStart': cutoff_iso,
        'items': items,
        'diagnostics': diagnostics,
    }
    atomic_write_json(args.out, result)
    print(f"Media collection: {result['status']} — {len(items)} articles since {cutoff_iso}", file=sys.stderr)


if __name__ == '__main__':
    main()
