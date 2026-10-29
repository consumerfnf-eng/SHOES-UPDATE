"""Weekly SNS sneaker-trend keywords, ranked by week-over-week growth.

What this produces
------------------
`public/data/trend-keywords.json` - the top keywords by growth since the last
run - and `data/trend-history.csv`, the running observation log the growth is
computed from. One row per hashtag per run per platform; nothing is ever
rewritten, so a week's number can always be traced back.

Where the numbers come from
---------------------------
Instagram: the logged-out hashtag page (/explore/tags/<tag>/) server-renders a
`popularSearchPage` block holding the hashtag's real total post count and
Instagram's own list of related search keywords. Public, no login, and the
same block collect_instagram_hashtags.py already reads.

TikTok: /tag/<tag> is attempted with Playwright. As of 2026-10-29 TikTok
answers both headless and headful automation with its "문제가 발생했습니다"
error shell and no view count at all, and its Creative Center API replies
`40101 no permission` without a signed anonymous token. So this is wired up,
reports `blocked` honestly when that happens, and contributes nothing to the
ranking until it can actually read a number. It never estimates one.

Growth
------
A keyword needs two observations at least 5 days apart to have a growth rate;
the newest is compared against the closest observation to 7 days before it.
A keyword seen for the first time has no growth rate and is reported as new
rather than as 0% or as infinite growth.

Discovering keywords nobody seeded
----------------------------------
Instagram publishes `related_keywords` for every hashtag page it renders.
Those are the co-occurrence candidates - the real thing, from Instagram,
rather than guessed from scraping posts we cannot read without a login.
Candidates not already in the seed list are counted across the whole run, and
the most frequent are put through the sneaker test below before any of them
is allowed to join next week's seeds.

The sneaker test (a candidate must pass, in this order)
-------------------------------------------------------
1. Any EXCLUDE term (구두 / 힐 / 펌프스 / 슬링백 / 로퍼 / 부츠 ...) in the
   candidate or in the related keywords of its own hashtag page: rejected
   outright. One is enough.
2. Its name or related keywords match a product name already collected from
   Musinsa or 29CM this week: accepted. Those staging files are this run's own
   e-commerce sneaker catalogue, so a match is a real cross-check and costs no
   extra request.
3. Otherwise at least 30% of its related keywords must carry an INCLUDE term
   (스니커즈 / 운동화 / 러닝화 / sneaker ...).
"""
import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.parse
from collections import Counter

from curl_cffi import requests as curl_requests

from common import BROWSER_HEADERS, atomic_write_json, kst_day, kst_now, read_json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = os.path.join(ROOT, 'data')
SEED_FILE = os.path.join(ROOT, 'config', 'trend-seed-hashtags.json')
HISTORY_FILE = os.path.join(DATA, 'trend-history.csv')
HISTORY_FIELDS = ['observedAt', 'day', 'platform', 'hashtag', 'metric', 'value']

TOP_N = 15
MAX_CANDIDATES = 20
MIN_GROWTH_GAP_DAYS = 5
TARGET_GAP_DAYS = 7

INSTAGRAM_URL = 'https://www.instagram.com/explore/tags/{}/'
TIKTOK_URL = 'https://www.tiktok.com/tag/{}'

BLOCK_RE = re.compile(
    r'"page_logging":\{"name":"popularSearchPage","params":\{\}\},'
    r'"title":"(?P<title>[^"]*)","total_media_count_intl":"(?P<count>[^"]*)",'
    r'"initial_media_count":(?P<initial>\d+),"related_keywords":\[(?P<keywords>[^\]]*)\]'
)

INCLUDE_TERMS = ['스니커즈', '스니커', '운동화', '러닝화', '신발', '슈즈', '단화', '슬립온',
                 'sneaker', 'sneakers', 'trainer', 'trainers', 'runner', 'kicks', 'footwear']
EXCLUDE_TERMS = ['구두', '힐', '하이힐', '펌프스', '슬링백', '로퍼', '블로퍼', '부츠', '워커',
                 '샌들', '슬리퍼', '쪼리', '옥스포드', '더비', '모카신', '웨지',
                 'loafer', 'heel', 'heels', 'pump', 'pumps', 'slingback', 'boot', 'boots',
                 'sandal', 'sandals', 'slipper', 'slippers', 'oxford', 'derby', 'mule' ]
# "mule" alone is an exclusion term, but a mule *sneaker* is in scope, so the
# sneaker words above are checked first on the same text.
EXCLUDE_OVERRIDE = re.compile(r'뮬\s?스니커|mule\s?sneaker', re.I)


SUFFIXES = {'k': 1_000, 'm': 1_000_000, 'b': 1_000_000_000, '만': 10_000, '억': 100_000_000}


def parse_abbreviated_count(text):
    """Turn Instagram's "243M" / "619K" into a real number.

    `total_media_count_intl` is an abbreviated, localised string, not digits.
    Stripping it to digits gives 243 for #sneakers and 619 for #러닝화, which
    ranks a 619-thousand tag above a 243-million one - the suffix carries
    almost the whole number. An unrecognised format returns None so the
    hashtag is reported unreadable instead of silently mis-ranked.
    """
    cleaned = str(text or '').strip().replace(',', '').replace(' ', '')
    if not cleaned:
        return None
    # Small tags come back as a floor ("350+"); that is a real number with a
    # stated direction, so it is kept as the floor rather than discarded.
    cleaned = cleaned.rstrip('+')
    found = re.fullmatch(r'(\d+(?:\.\d+)?)([a-zA-Z만억]*)', cleaned)
    if not found:
        return None
    value, suffix = float(found.group(1)), found.group(2).lower()
    if not suffix:
        return int(value)
    if suffix not in SUFFIXES:
        return None
    return int(round(value * SUFFIXES[suffix]))


def normalise(tag):
    return re.sub(r'[^0-9a-z가-힣]', '', (tag or '').lower().lstrip('#'))


def has_term(text, terms):
    lowered = (text or '').lower()
    return any(term in lowered for term in terms)


# ---------------------------------------------------------------- Instagram
def fetch_instagram(tag, attempts=2):
    url = INSTAGRAM_URL.format(urllib.parse.quote(tag))
    last = 'unknown'
    for attempt in range(attempts):
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=BROWSER_HEADERS, timeout=30)
            if r.status_code == 200:
                found = BLOCK_RE.search(r.text)
                if not found:
                    return None, 'no-data', url
                label = found.group('count')
                count = parse_abbreviated_count(label)
                if count is None:
                    # An empty count means the page rendered without a volume
                    # figure at all, which is 'no-data', not a parse failure.
                    return None, ('no-data' if not label.strip() else f'unparsable-count:{label[:12]}'), url
                raw = re.findall(r'"((?:[^"\\]|\\.)*)"', found.group('keywords'))
                return {
                    'count': count,
                    'countLabel': found.group('count'),
                    'related': [json.loads(f'"{k}"') for k in raw],
                }, 'ok', url
            last = f'http-{r.status_code}'
        except Exception as e:
            last = type(e).__name__
        time.sleep(1.2 * (attempt + 1))
    return None, last, url


# ------------------------------------------------------------------ TikTok
VIEW_COUNT_RE = re.compile(r'"viewCount":\s*(\d+)')


def fetch_tiktok_many(tags, status):
    """Read TikTok hashtag view counts with Playwright, or report why not.

    Kept deliberately simple: one browser for the whole batch, and any page
    that does not yield a number is recorded as blocked rather than guessed.
    """
    results = {}
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        status['tiktok'] = {'status': 'unavailable', 'error': f'playwright missing: {e}'}
        return results
    blocked = 0
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(
                headless=True, args=['--disable-blink-features=AutomationControlled', '--no-sandbox'])
            context = browser.new_context(viewport={'width': 1366, 'height': 900}, locale='ko-KR')
            context.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")
            page = context.new_page()
            for tag in tags:
                try:
                    page.goto(TIKTOK_URL.format(urllib.parse.quote(tag)),
                              wait_until='domcontentloaded', timeout=40000)
                    page.wait_for_timeout(4000)
                    found = VIEW_COUNT_RE.search(page.content())
                    if found:
                        results[tag] = int(found.group(1))
                    else:
                        blocked += 1
                except Exception:
                    blocked += 1
            browser.close()
    except Exception as e:
        status['tiktok'] = {'status': 'unavailable', 'error': str(e)[:200]}
        return results
    status['tiktok'] = {
        'status': 'ok' if results else 'blocked',
        'read': len(results), 'blocked': blocked,
        'note': ('TikTok answered automation with its error shell and no view count; '
                 'Creative Center replies 40101 no permission without a signed token.')
                if not results else '',
    }
    return results


# ------------------------------------------------------------------ history
def read_history():
    if not os.path.exists(HISTORY_FILE):
        return []
    with open(HISTORY_FILE, 'r', encoding='utf-8', newline='') as f:
        return [row for row in csv.DictReader(f)]


def append_history(rows):
    exists = os.path.exists(HISTORY_FILE)
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    with open(HISTORY_FILE, 'a', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=HISTORY_FIELDS)
        if not exists:
            writer.writeheader()
        writer.writerows(rows)


def day_diff(a, b):
    from datetime import date
    ay, am, ad = (int(x) for x in a.split('-'))
    by, bm, bd = (int(x) for x in b.split('-'))
    return (date(ay, am, ad) - date(by, bm, bd)).days


def growth_for(history, platform, hashtag, current_day, current_value):
    """Compare against the observation closest to a week before today."""
    previous = [row for row in history
                if row['platform'] == platform and row['hashtag'] == hashtag
                and row['day'] < current_day and str(row['value']).isdigit()]
    if not previous:
        return None, None, None
    scored = [(abs(day_diff(current_day, row['day']) - TARGET_GAP_DAYS), row) for row in previous
              if day_diff(current_day, row['day']) >= MIN_GROWTH_GAP_DAYS]
    if not scored:
        return None, None, None
    best = min(scored, key=lambda pair: pair[0])[1]
    before = int(best['value'])
    if before <= 0:
        return None, best['day'], before
    return round((current_value - before) / before * 100, 2), best['day'], before


# ------------------------------------------------- discovery and validation
def ecommerce_vocabulary():
    """Sneaker product names this run already collected from Musinsa and 29CM."""
    words = set()
    for name in ('monthly-staging-musinsa.json', 'monthly-staging-29cm.json'):
        payload = read_json(os.path.join(DATA, name), {'items': []})
        for item in payload.get('items', []):
            for token in re.split(r'[^0-9A-Za-z가-힣]+', item.get('fullName') or item.get('name') or ''):
                if len(token) >= 2:
                    words.add(token.lower())
    return words


def validate_candidate(tag, related, vocabulary):
    """Return (accepted, reason). See the module docstring for the order."""
    text = ' '.join([tag, *related])
    if has_term(text, EXCLUDE_TERMS) and not EXCLUDE_OVERRIDE.search(text):
        return False, 'excluded-term'
    folded = normalise(tag)
    if folded and folded in vocabulary:
        return True, 'ecommerce-name-match'
    if any(normalise(word) in vocabulary for word in related if len(word) >= 2):
        return True, 'ecommerce-related-match'
    if not related:
        return False, 'no-related-keywords'
    hits = sum(1 for word in related if has_term(word, INCLUDE_TERMS))
    share = hits / len(related)
    return (share >= 0.30), ('include-share-%.2f' % share)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--skip-tiktok', action='store_true')
    args = parser.parse_args()

    now = kst_now()
    today = kst_day(now)
    seeds_file = read_json(SEED_FILE, {'seed': [], 'discovered': []})
    tags = list(dict.fromkeys([*(seeds_file.get('seed') or []), *(seeds_file.get('discovered') or [])]))

    status = {}
    observations, related_by_tag, instagram_errors = [], {}, Counter()
    for tag in tags:
        data, state, url = fetch_instagram(tag)
        if data:
            observations.append({'platform': 'instagram', 'hashtag': tag, 'metric': 'post-count',
                                 'value': data['count'], 'label': data.get('countLabel', ''), 'url': url})
            related_by_tag[tag] = data['related']
        else:
            instagram_errors[state] += 1
        time.sleep(0.8)
    status['instagram'] = {'status': 'ok' if observations else 'unavailable',
                           'read': len(observations), 'tags': len(tags),
                           'failures': dict(instagram_errors)}

    tiktok_counts = {} if args.skip_tiktok else fetch_tiktok_many(tags, status)
    if args.skip_tiktok:
        status['tiktok'] = {'status': 'skipped'}
    for tag, value in tiktok_counts.items():
        observations.append({'platform': 'tiktok', 'hashtag': tag, 'metric': 'view-count',
                             'value': value, 'url': TIKTOK_URL.format(tag)})

    history = read_history()
    append_history([{'observedAt': now.isoformat(), 'day': today, 'platform': o['platform'],
                     'hashtag': o['hashtag'], 'metric': o['metric'], 'value': o['value']}
                    for o in observations])

    ranked = []
    for o in observations:
        growth, since, before = growth_for(history, o['platform'], o['hashtag'], today, o['value'])
        ranked.append({
            'hashtag': o['hashtag'], 'platform': o['platform'], 'metric': o['metric'],
            'value': o['value'], 'valueLabel': o.get('label', ''), 'growthPercent': growth, 'comparedToDay': since,
            'previousValue': before, 'isNew': growth is None,
            'relatedKeywords': related_by_tag.get(o['hashtag'], [])[:8],
            'sourceUrl': o['url'],
        })
    # Growth first; a keyword with no comparison yet cannot outrank a measured
    # one, so new keywords sort below by volume rather than above by accident.
    measured = sorted([r for r in ranked if r['growthPercent'] is not None],
                      key=lambda r: (-r['growthPercent'], -r['value']))
    unmeasured = sorted([r for r in ranked if r['growthPercent'] is None], key=lambda r: -r['value'])
    top = (measured + unmeasured)[:TOP_N]

    known = {normalise(t) for t in tags}
    counts = Counter()
    for related in related_by_tag.values():
        for word in related:
            folded = normalise(word)
            if folded and folded not in known:
                counts[word] += 1
    vocabulary = ecommerce_vocabulary()
    candidates, accepted = [], []
    for word, seen in counts.most_common(MAX_CANDIDATES):
        data, state, _ = fetch_instagram(word)
        related = data['related'] if data else []
        ok, reason = validate_candidate(word, related, vocabulary) if data else (False, f'unreadable:{state}')
        candidates.append({'hashtag': word, 'coOccurrences': seen, 'accepted': ok, 'reason': reason,
                           'postCount': data['count'] if data else None})
        if ok:
            accepted.append(word)
        time.sleep(0.8)

    if accepted:
        seeds_file['discovered'] = sorted(set([*(seeds_file.get('discovered') or []), *accepted]))
        seeds_file['updatedAt'] = today
        atomic_write_json(SEED_FILE, seeds_file)

    result = {
        'schemaVersion': 1,
        'generatedAt': now.isoformat(),
        'asOf': today,
        'method': 'instagram-post-count-wow',
        'window': {'targetGapDays': TARGET_GAP_DAYS, 'minGapDays': MIN_GROWTH_GAP_DAYS},
        'sourceStatus': status,
        'keywords': top,
        'candidates': candidates,
        'acceptedIntoSeeds': accepted,
        'seedCount': len(tags),
    }
    atomic_write_json(args.out, result)
    measured_count = sum(1 for k in top if k['growthPercent'] is not None)
    print(f"Trend keywords: {len(top)} published ({measured_count} with a week-over-week rate), "
          f"{len(observations)} observations over {len(tags)} seeds, "
          f"{len(accepted)} new keywords accepted into the seed list; "
          f"instagram={status['instagram']['status']} tiktok={status.get('tiktok', {}).get('status')}",
          file=sys.stderr)


if __name__ == '__main__':
    main()
