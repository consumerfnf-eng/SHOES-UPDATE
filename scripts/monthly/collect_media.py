"""Collect recent-3-months footwear articles from Hypebeast, Hypebeast Korea,
and Sneaker News, for the newsletter/media mention tab.

Sneaker News exposes a public WordPress REST API (wp-json/wp/v2/posts) with
exact publish dates, so that source uses the API directly rather than HTML
scraping. Hypebeast/Hypebeast Korea use the same HTML template, scraped with
the real selectors observed on their /footwear listing pages.

This script only extracts headline/url/publishedAt/excerpt. It does not try
to guess which shoe model an article is about beyond simple keyword matching
left to update.py, which cross-references against known models and holds
anything unregistered rather than inventing a product record.
"""
import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone

from curl_cffi import requests as curl_requests

from common import BROWSER_HEADERS, atomic_write_json, canonical_url, kst_now, kst_three_months_ago

MAX_LISTING_PAGES = 8

HYPEBEAST_SOURCES = [
    {'id': 'hypebeast', 'label': 'Hypebeast', 'base': 'https://hypebeast.com/footwear'},
    {'id': 'hypebeast-kr', 'label': 'Hypebeast Korea', 'base': 'https://hypebeast.kr/footwear'},
]

ARTICLE_RE = re.compile(
    r'post-box-content-title">\s*<a href="([^"]+)" class="title"\s+title="([^"]*)"', re.S)
TIME_RE = re.compile(r'<time class="timeago"\s+datetime="([^"]+)"')


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


def collect_sneakernews(cutoff_iso, checked_at, diagnostics):
    items = []
    status = {'source': 'sneaker-news', 'pages': 0, 'responses': 0, 'articles': 0, 'errors': []}
    cutoff_gmt = cutoff_iso[:19]
    for page in range(1, MAX_LISTING_PAGES + 1):
        url = f'https://sneakernews.com/wp-json/wp/v2/posts?per_page=50&page={page}&after={cutoff_gmt}'
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
                'source': 'sneaker-news',
                'sourceLabel': 'Sneaker News',
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
    try:
        items.extend(collect_sneakernews(cutoff_iso, checked_at, diagnostics))
    except Exception as e:
        diagnostics.append({'source': 'sneaker-news', 'errors': [{'error': str(e)}]})

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
