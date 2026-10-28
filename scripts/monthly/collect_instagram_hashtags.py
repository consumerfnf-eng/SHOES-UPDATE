"""Collect Instagram hashtag volume + related keywords WITHOUT logging in.

Instagram's logged-out hashtag explore page (/explore/tags/<tag>/) embeds a
server-rendered 'popularSearchPage' JSON block with the hashtag's real total
post count (total_media_count_intl) and a list of related search keywords.
This is public, requires no authentication, and is not the same data as
collect_instagram.py (which needs the user's own login session to read
individual posts/likes). The two are complementary:
  - this script: hashtag-level volume + trend keywords, always available
  - collect_instagram.py: post-level captions/like counts, needs login

Hashtags with negligible volume render no popularSearchPage block at all; we
report those honestly as 'no-data', never a fabricated zero or estimate.
"""
import argparse
import json
import re
import sys
import time

from curl_cffi import requests as curl_requests

from common import BROWSER_HEADERS, atomic_write_json, kst_now

HASHTAGS = ['sneakers', 'sneakerhead', '신발추천', '고프코어슈즈', '스니커즈추천', '신상스니커즈']

BLOCK_RE = re.compile(
    r'"page_logging":\{"name":"popularSearchPage","params":\{\}\},'
    r'"title":"(?P<title>[^"]*)","total_media_count_intl":"(?P<count>[^"]*)",'
    r'"initial_media_count":(?P<initial>\d+),"related_keywords":\[(?P<keywords>[^\]]*)\]'
)


def parse_hashtag_page(html):
    m = BLOCK_RE.search(html)
    if not m:
        return None
    keywords_raw = m.group('keywords')
    keywords = [k for k in re.findall(r'"((?:[^"\\]|\\.)*)"', keywords_raw)]
    keywords = [json.loads(f'"{k}"') for k in keywords]
    return {
        'title': json.loads(f'"{m.group("title")}"'),
        'totalMediaCount': m.group('count'),
        'relatedKeywords': keywords,
    }


def fetch(url, attempts=3):
    last_error = None
    for attempt in range(attempts):
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=20)
            if r.status_code == 200:
                return r.text
            last_error = f'http-{r.status_code}'
        except Exception as e:
            last_error = str(e)
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last_error or 'unknown-fetch-error')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    checked_at = kst_now().isoformat()
    items = []
    diagnostics = []
    for tag in HASHTAGS:
        url = f'https://www.instagram.com/explore/tags/{tag}/'
        status = {'hashtag': tag, 'url': url, 'errors': []}
        try:
            html = fetch(url)
            parsed = parse_hashtag_page(html)
            if parsed:
                items.append({
                    'hashtag': tag,
                    'url': url,
                    'title': parsed['title'],
                    'totalMediaCount': parsed['totalMediaCount'],
                    'relatedKeywords': parsed['relatedKeywords'][:20],
                    'checkedAt': checked_at,
                })
                status['status'] = 'ok'
            else:
                status['status'] = 'no-data'
        except Exception as e:
            status['status'] = 'error'
            status['errors'].append({'error': str(e)})
        diagnostics.append(status)
        time.sleep(1.5)

    result = {
        'status': 'ok' if items else 'unavailable',
        'checkedAt': checked_at,
        'items': items,
        'diagnostics': diagnostics,
    }
    atomic_write_json(args.out, result)
    print(f"Instagram hashtag-volume collection: {result['status']} — {len(items)}/{len(HASHTAGS)} hashtags with data",
          file=sys.stderr)


if __name__ == '__main__':
    main()
