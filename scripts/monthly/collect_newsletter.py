"""Turn the sneaker press into item records for the 뉴스레터 tab.

Seven publishers, each read the cheapest honest way its own site allows:

  sneaker-news    WordPress REST (wp-json/wp/v2/posts, _embed=1). The embedded
                  terms are the richest signal anywhere in this pipeline - the
                  post's category IS the brand ("New Balance") and its tags ARE
                  the models ("New Balance 990v7"), straight from the editors.
  footwear-news   The same REST API on wwd.com, where Footwear News' articles
                  actually live, filtered to WWD's "Sneaker News" category
                  (344412701). footwearnews.com's own <time> tags are an
                  unpopulated template placeholder ("00:00-YY-DD-MM").
  hypebeast       Listing HTML. Every card carries data-permalink/data-title
                  on .post-box-container plus a real <time datetime>.
  hypebeast-kr    Same template, Korean edition.
  highsnobiety    RSS + the Google-News sitemap. The /sneakers listing is
                  client-rendered with no article links in the HTML at all,
                  and /feed/ ignores ?paged, so these two together are the
                  whole of what the site exposes without JavaScript.
  sneaker-freaker RSS (rss.xml; /feed is a 404). Its <category> values are
                  model and brand names, like Sneaker News' terms.
  concept-kicks   Squarespace, so every collection answers ?format=json with
                  its real items. There is no RSS.

An article only becomes an item when a brand can actually be identified -
from the publisher's own taxonomy, or by matching config/brand-policy.json's
157 brand names against the headline. Anything else is returned as an
unidentified article instead, never published as a product with a guessed
brand. Release date, price and style code are pulled from the article body
with conservative patterns and left empty when the article does not state
them; an extracted future date marks the item 발매 예정 rather than released.
"""
import argparse
import html as html_mod
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from curl_cffi import requests as curl_requests

from common import (BROWSER_HEADERS, atomic_write_json, canonical_url, kst_day, kst_now,
                    kst_three_months_ago, read_json, short_id)
from footwear_scope import EXCLUDE_EN, EXCLUDE_KO, is_kids

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MAX_ARTICLES_PER_SOURCE = 400
LISTING_PAGES = 10

WP_SOURCES = [
    {'id': 'sneaker-news', 'label': 'Sneaker News', 'base': 'https://sneakernews.com/wp-json/wp/v2/posts',
     'extra': '', 'pages': 4, 'perPage': 50},
    {'id': 'footwear-news', 'label': 'Footwear News', 'base': 'https://wwd.com/wp-json/wp/v2/posts',
     'extra': '&categories=344412701', 'pages': 7, 'perPage': 50},
]
HYPEBEAST_SOURCES = [
    {'id': 'hypebeast', 'label': 'Hypebeast', 'base': 'https://hypebeast.com/footwear'},
    {'id': 'hypebeast-kr', 'label': 'Hypebeast Korea', 'base': 'https://hypebeast.kr/footwear'},
]
RSS_SOURCES = [
    {'id': 'highsnobiety', 'label': 'Highsnobiety', 'url': 'https://www.highsnobiety.com/feed/'},
    {'id': 'sneaker-freaker', 'label': 'Sneaker Freaker', 'url': 'https://www.sneakerfreaker.com/rss.xml'},
]
HIGHSNOBIETY_NEWS_SITEMAP = 'https://www.highsnobiety.com/sitemap-news.xml'
# /news and /blog are 404s; these two are Concept Kicks' real collections,
# found from its own navigation links.
CONCEPT_KICKS_COLLECTIONS = [
    {'url': 'https://www.conceptkicks.com/design?format=json', 'label': 'Design'},
    {'url': 'https://www.conceptkicks.com/feature?format=json', 'label': 'Feature'},
]

HB_CARD_RE = re.compile(r'data-permalink="([^"]+)"\s+data-title="([^"]*)"', re.S)
HB_TIME_RE = re.compile(r'<time[^>]*datetime="([^"]+)"')
RSS_ITEM_RE = re.compile(r'<item>(.*?)</item>', re.S)
SITEMAP_URL_RE = re.compile(r'<url>(.*?)</url>', re.S)
TAG_RE = re.compile(r'<[^>]+>')

# Release-date phrasings actually used by these publishers. Each one has to
# name a month, so a bare "out now" never becomes a date.
MONTHS = ('january|february|march|april|may|june|july|august|september|october|november|december')
RELEASE_EN_RE = re.compile(
    r'(?:release[sd]?\s*(?:date)?\s*[:\-]?\s*|launch(?:es|ing)?\s+(?:on\s+)?|'
    r'drop(?:s|ping)?\s+(?:on\s+)?|available\s+(?:on\s+|from\s+)?|arrives?\s+(?:on\s+)?)'
    r'(?:[a-z]+day,?\s+)?(' + MONTHS + r')\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d\d))?', re.I)
RELEASE_KO_RE = re.compile(r'(20\d\d)?\s*년?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일[^.]{0,12}?(?:발매|출시|공개|드롭)')
PRICE_RE = re.compile(r'(?:US)?\$\s?(\d{1,3}(?:,\d{3})*)(?:\.00)?\b|(\d{1,3}(?:,\d{3})+)\s*원')
STYLE_RE = re.compile(r'\b([A-Z]{2}\d{4}-\d{3}|[A-Z]{2}\d{4}|\d{6}-\d{3}|[A-Z]\d{5}[A-Z]?)\b')
MONTH_INDEX = {name: i + 1 for i, name in enumerate(MONTHS.split('|'))}

# Headline boilerplate that is editorial framing, not part of a model name.
HEADLINE_NOISE_RE = re.compile(
    r'\b(?:official\s+(?:images?|look)|first\s+look|release\s+date|where\s+to\s+buy|'
    r'official(?:ly)?\s+rev(?:eal|ealed)|detailed\s+look|closer\s+look|on\s+foot|'
    r'is\s+releasing|releases?\s+(?:this|next)\s+\w+|drops?\s+(?:this|next)\s+\w+|'
    r'coming\s+soon|now\s+available|revealed|unveiled|announced|'
    r'공식\s*이미지|출시\s*정보|발매\s*정보|발매\s*일정|상세\s*정보)\b', re.I)
SEPARATORS_RE = re.compile(r'^[\s:,\-–—|·]+|[\s:,\-–—|·]+$')


def korean_aliases():
    """Korean brand spellings -> canonical policy brand.

    Hypebeast Korea writes "나이키", not "Nike", so an English-only vocabulary
    identified almost none of its articles (85 of 120 unidentified before this
    was added). config/brand-aliases-ko.json is mostly generated from Musinsa
    listings, which carry both spellings for the same product.
    """
    data = read_json(os.path.join(ROOT, 'config', 'brand-aliases-ko.json'), {})
    merged = dict(data.get('derived') or {})
    merged.update(data.get('manual') or {})
    return merged


def brand_vocabulary():
    policy = read_json(os.path.join(ROOT, 'config', 'brand-policy.json'), {'brands': []})
    names = [b['name'] for b in policy.get('brands', []) if b.get('name')]
    # Sub-labels the press names on their own, each already covered by a parent
    # brand in the policy file but written differently in headlines.
    names += ['Air Jordan', 'Jordan Brand', 'Nike SB', 'adidas Originals', 'New Balance Numeric']
    # Longest first so "New Balance" wins over "On" inside "New Balance 990".
    return sorted(set(names), key=len, reverse=True)


def normalize_brand(name, aliases=None):
    if aliases and name in aliases:
        return aliases[name]
    return {'Air Jordan': 'Jordan', 'Jordan Brand': 'Jordan', 'Nike SB': 'Nike',
            'adidas Originals': 'adidas', 'New Balance Numeric': 'New Balance'}.get(name, name)


def strip_tags(value):
    return html_mod.unescape(TAG_RE.sub(' ', value or '')).replace('\xa0', ' ')


def squeeze(value):
    return re.sub(r'\s+', ' ', value or '').strip()


def fetch(url, attempts=3, accept=None, timeout=30):
    headers = dict(BROWSER_HEADERS)
    if accept:
        headers['accept'] = accept
    last_error = None
    for attempt in range(attempts):
        try:
            r = curl_requests.get(url, impersonate='chrome124', headers=headers, timeout=timeout)
            if r.status_code == 200:
                return r.text
            last_error = f'http-{r.status_code}'
        except Exception as e:
            last_error = str(e)
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last_error or 'unknown-fetch-error')


def parse_release_date(text, published_day):
    """Return an ISO day for a stated release date, or ''.

    A date without a year is read as the year of publication, rolled forward
    when that would put it more than a month in the past - exactly how a
    reader parses "drops January 9" in a December article.
    """
    match = RELEASE_KO_RE.search(text or '')
    if match:
        year = int(match.group(1) or published_day[:4])
        month, day = int(match.group(2)), int(match.group(3))
    else:
        match = RELEASE_EN_RE.search(text or '')
        if not match:
            return ''
        month = MONTH_INDEX[match.group(1).lower()]
        day = int(match.group(2))
        year = int(match.group(3)) if match.group(3) else int(published_day[:4])
        if not match.group(3):
            candidate = f'{year:04d}-{month:02d}-{day:02d}'
            if candidate < published_day and published_day[5:7] == '12' and month == 1:
                year += 1
    try:
        datetime(year, month, day)
    except ValueError:
        return ''
    return f'{year:04d}-{month:02d}-{day:02d}'


def parse_price(text):
    match = PRICE_RE.search(text or '')
    if not match:
        return ''
    return f'${match.group(1)}' if match.group(1) else f'{match.group(2)}원'


def identify(headline, terms, vocabulary, aliases):
    """Return (brand, model). Publisher taxonomy wins; headline match is the
    fallback. ('', '') means the article names no brand we can stand behind."""
    term_names = [t for t in terms if t]
    brand = ''
    for term in term_names:
        if term in vocabulary:
            brand = term
            break
    if not brand:
        lowered = f' {headline.lower()} '
        for name in vocabulary:
            if re.search(r'(?<![\w])' + re.escape(name.lower()) + r'(?![\w])', lowered):
                brand = name
                break
    if not brand:
        # Korean headlines name the brand in Hangul; no word boundary applies.
        for alias in sorted(aliases, key=len, reverse=True):
            if alias in headline:
                brand = alias
                break
    if not brand:
        return '', ''
    canonical = normalize_brand(brand, aliases)
    # Prefer a taxonomy term that names a model of this brand over slicing the
    # headline apart: "New Balance 990v7" is an editor's label, not our guess.
    model = ''
    brand_key = canonical.lower()
    candidates = [t for t in term_names
                  if t not in vocabulary and brand_key in t.lower() and len(t) > len(canonical)]
    if candidates:
        # An article tagged with a whole model line ("990", "990v2" ... "990v7")
        # is about whichever one the headline names; only when the headline
        # names none of them does the longest tag win.
        lowered_headline = headline.lower()
        named = [t for t in candidates if t.lower() in lowered_headline
                 or t.lower().replace(canonical.lower(), '').strip() in lowered_headline]
        model = max(named or candidates, key=len)
    else:
        model = HEADLINE_NOISE_RE.sub(' ', headline)
        model = re.sub(r'(?<![\w])' + re.escape(brand.lower()) + r"(?:['’]s)?(?![\w])", ' ', model, flags=re.I)
        model = SEPARATORS_RE.sub('', squeeze(model))
    return canonical, model or headline


def out_of_scope(headline):
    """Drop an article whose own headline names a non-sneaker silhouette.

    The section each of these feeds is read from is already footwear
    (/footwear, /sneakers, Sneaker News), so the absence of the word
    "sneaker" proves nothing - only an explicit boot/loafer/heel does.
    """
    if is_kids(headline):
        return 'kids'
    if re.search(r'\bsneakers?\b|스니커즈', headline or '', re.I):
        return ''
    if EXCLUDE_EN.search(headline or '') or EXCLUDE_KO.search(headline or ''):
        return 'excluded-silhouette'
    return ''


def build_item(source, article, vocabulary, aliases, checked_at, today):
    headline = squeeze(article['headline'])
    reason = out_of_scope(headline)
    if reason:
        return None, reason
    brand, model = identify(headline, article.get('terms') or [], vocabulary, aliases)
    if not brand:
        return None, 'brand-unidentified'
    body = article.get('body') or ''
    published_day = (article.get('publishedAt') or checked_at)[:10]
    release_date = parse_release_date(f'{headline} {body}', published_day)
    url = canonical_url(article['url']) or article['url']
    return {
        'id': short_id('weekly-newsletter', source['id'], url),
        'source': f"newsletter-{source['id']}",
        'publisher': source['label'],
        'brand': brand,
        'name': model,
        'fullName': headline,
        'url': article['url'],
        'image': article.get('image') or '',
        'priceLabel': parse_price(body),
        'style': (STYLE_RE.search(body).group(1) if STYLE_RE.search(body) else ''),
        'colorway': '',
        'gender': '',
        'category': 'sneaker',
        'productType': 'sneaker',
        'footwearTypes': ['sneaker'],
        'officialCategory': source['label'],
        'releaseDate': release_date,
        'releaseStatus': ('upcoming' if release_date and release_date > today
                          else 'released' if release_date else ''),
        'publishedAt': article.get('publishedAt') or '',
        'excerpt': squeeze(strip_tags(article.get('excerpt') or ''))[:400],
        'mediaEvidence': {
            'verified': True,
            'publisher': source['label'],
            'publisherId': source['id'],
            'articleUrl': article['url'],
            'headline': headline,
            'publishedAt': article.get('publishedAt') or '',
            'verifiedAt': checked_at,
            'identifiedBy': 'publisher-taxonomy' if article.get('terms') else 'headline-brand-match',
            'releaseDateStated': bool(release_date),
        },
    }, ''


# --------------------------------------------------------------------------
# per-publisher article readers
# --------------------------------------------------------------------------

def read_wordpress(source, cutoff_iso, status):
    articles = []
    for page in range(1, source['pages'] + 1):
        url = (f"{source['base']}?per_page={source['perPage']}&page={page}&_embed=1"
               f"&after={cutoff_iso}{source['extra']}")
        try:
            posts = json.loads(fetch(url, accept='application/json', timeout=45))
            status['responses'] += 1
        except Exception as e:
            status['errors'].append({'url': url, 'error': str(e)})
            break
        if not isinstance(posts, list) or not posts:
            break
        for post in posts:
            embedded = post.get('_embedded') or {}
            media = (embedded.get('wp:featuredmedia') or [{}])[0]
            terms = [t.get('name') for group in (embedded.get('wp:term') or []) for t in group if t.get('name')]
            articles.append({
                'url': post.get('link') or '',
                'headline': strip_tags((post.get('title') or {}).get('rendered') or ''),
                'publishedAt': post.get('date_gmt') and f"{post['date_gmt']}Z" or post.get('date') or '',
                'image': media.get('source_url') or post.get('jetpack_featured_media_url') or '',
                'body': strip_tags((post.get('content') or {}).get('rendered') or '')[:6000],
                'excerpt': (post.get('excerpt') or {}).get('rendered') or '',
                'terms': terms,
            })
        status['pages'] = page
        if len(articles) >= MAX_ARTICLES_PER_SOURCE:
            break
        time.sleep(0.8)
    return articles


OG_IMAGE_RE = re.compile(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"')
OG_IMAGE_ALT_RE = re.compile(r'<meta[^>]+content="([^"]+)"[^>]+property="og:image"')
BODY_RE = re.compile(r'<(?:article|main)[^>]*>(.*?)</(?:article|main)>', re.S)


def enrich_articles(articles, status, limit=160, workers=4):
    """Fill image/body from each article page for listing-only sources.

    Hypebeast's and Highsnobiety's listings give a headline, a link and a
    date but no body, so a release date or price can only come from the
    article itself. Pages are fetched a few at a time and a failure just
    leaves that article thinner, never drops it.
    """
    targets = [a for a in articles if not a.get('body')][:limit]

    def load(article):
        try:
            html = fetch(article['url'], timeout=35)
        except Exception as e:
            status['errors'].append({'url': article['url'], 'error': f'article: {e}'})
            return
        if not article.get('image'):
            found = OG_IMAGE_RE.search(html) or OG_IMAGE_ALT_RE.search(html)
            if found:
                article['image'] = html_mod.unescape(found.group(1))
        body = BODY_RE.search(html)
        article['body'] = strip_tags(body.group(1) if body else html)[:6000]

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(load, targets))
    status['enriched'] = len(targets)
    return articles


def read_hypebeast(source, cutoff_iso, status):
    articles, seen = [], set()
    for page in range(1, LISTING_PAGES + 1):
        url = source['base'] if page == 1 else f"{source['base']}/page/{page}"
        try:
            html = fetch(url, timeout=40)
            status['responses'] += 1
        except Exception as e:
            status['errors'].append({'url': url, 'error': str(e)})
            break
        cards = HB_CARD_RE.findall(html)
        times = HB_TIME_RE.findall(html)
        if not cards:
            break
        stop = False
        for index, (link, title) in enumerate(cards):
            if link in seen:
                continue
            seen.add(link)
            published = times[index] if index < len(times) else ''
            if published and published < cutoff_iso:
                stop = True
                continue
            articles.append({'url': html_mod.unescape(link), 'headline': html_mod.unescape(title),
                             'publishedAt': published, 'image': '', 'body': '', 'excerpt': '', 'terms': []})
        status['pages'] = page
        if stop or len(articles) >= MAX_ARTICLES_PER_SOURCE:
            break
        time.sleep(1.0)
    return enrich_articles(articles, status)


def read_rss(source, cutoff_iso, status):
    try:
        xml = fetch(source['url'], accept='application/rss+xml,application/xml,text/xml', timeout=40)
        status['responses'] += 1
    except Exception as e:
        status['errors'].append({'url': source['url'], 'error': str(e)})
        return []
    status['pages'] = 1
    articles = []
    for block in RSS_ITEM_RE.findall(xml):
        def pick(tag):
            found = re.search(rf'<{tag}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{tag}>', block, re.S)
            return html_mod.unescape(found.group(1)).strip() if found else ''
        link = pick('link')
        if not link:
            continue
        published = ''
        raw_date = pick('pubDate')
        if raw_date:
            try:
                published = parsedate_to_datetime(raw_date).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            except Exception:
                published = ''
        if published and published < cutoff_iso:
            continue
        enclosure = re.search(r'<enclosure[^>]*url="([^"]+)"', block)
        content = pick('content:encoded')
        image = enclosure.group(1) if enclosure else ''
        if not image:
            inline = re.search(r'<img[^>]*src="([^"]+)"', content)
            image = inline.group(1) if inline else ''
        articles.append({
            'url': link,
            'headline': strip_tags(pick('title')),
            'publishedAt': published,
            'image': image,
            'body': strip_tags(content)[:6000],
            'excerpt': pick('description'),
            'terms': [html_mod.unescape(c).strip() for c in
                      re.findall(r'<category[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</category>', block, re.S)],
        })
    return articles


def read_highsnobiety_sitemap(cutoff_iso, status):
    """The Google-News sitemap reaches articles the 8-item feed has dropped."""
    try:
        xml = fetch(HIGHSNOBIETY_NEWS_SITEMAP, accept='application/xml', timeout=40)
        status['responses'] += 1
    except Exception as e:
        status['errors'].append({'url': HIGHSNOBIETY_NEWS_SITEMAP, 'error': str(e)})
        return []
    articles = []
    for block in SITEMAP_URL_RE.findall(xml):
        loc = re.search(r'<loc>(.*?)</loc>', block)
        published = re.search(r'<news:publication_date>(.*?)</news:publication_date>', block)
        headline = re.search(r'<news:name>(.*?)</news:name>', block)
        image = re.search(r'<image:loc>(.*?)</image:loc>', block)
        if not loc or not headline:
            continue
        when = (published.group(1) if published else '')
        if when and when < cutoff_iso:
            continue
        articles.append({'url': html_mod.unescape(loc.group(1)),
                         'headline': html_mod.unescape(headline.group(1)),
                         'publishedAt': when, 'image': image.group(1) if image else '',
                         'body': '', 'excerpt': '', 'terms': []})
    return enrich_articles(articles, status)


def read_concept_kicks(cutoff_iso, status):
    articles = []
    for collection in CONCEPT_KICKS_COLLECTIONS:
        try:
            payload = json.loads(fetch(collection['url'], accept='application/json', timeout=40))
            status['responses'] += 1
        except Exception as e:
            status['errors'].append({'url': collection['url'], 'error': str(e)})
            continue
        entries = payload.get('items') or []
        if not entries:
            status['errors'].append({'url': collection['url'], 'error': 'NO_ITEMS_IN_COLLECTION_JSON'})
            continue
        status['pages'] += 1
        for entry in entries:
            published = entry.get('publishOn')
            when = (datetime.fromtimestamp(published / 1000, tz=timezone.utc).isoformat().replace('+00:00', 'Z')
                    if isinstance(published, int) else '')
            if when and when < cutoff_iso:
                continue
            full_url = entry.get('fullUrl') or ''
            articles.append({
                'url': f"https://www.conceptkicks.com{full_url}" if full_url.startswith('/') else full_url,
                'headline': strip_tags(entry.get('title') or ''),
                'publishedAt': when,
                'image': (entry.get('assetUrl') or ''),
                'body': strip_tags(entry.get('body') or '')[:6000],
                'excerpt': entry.get('excerpt') or '',
                'terms': (entry.get('tags') or []) + (entry.get('categories') or []),
            })
    return articles


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    now = kst_now()
    checked_at = now.isoformat()
    today = kst_day(now)
    cutoff_iso = kst_three_months_ago(now).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')[:19]
    vocabulary = brand_vocabulary()
    aliases = korean_aliases()

    plans = []
    for source in WP_SOURCES:
        plans.append((source, lambda s, status: read_wordpress(s, cutoff_iso, status)))
    for source in HYPEBEAST_SOURCES:
        plans.append((source, lambda s, status: read_hypebeast(s, cutoff_iso, status)))
    for source in RSS_SOURCES:
        plans.append((source, lambda s, status: read_rss(s, cutoff_iso, status)))
    plans.append(({'id': 'highsnobiety-sitemap', 'label': 'Highsnobiety (news sitemap)'},
                  lambda s, status: read_highsnobiety_sitemap(cutoff_iso, status)))
    plans.append(({'id': 'concept-kicks', 'label': 'Concept Kicks'},
                  lambda s, status: read_concept_kicks(cutoff_iso, status)))

    def run(plan):
        source, reader = plan
        status = {'source': source['id'], 'label': source['label'], 'pages': 0, 'responses': 0,
                  'articles': 0, 'items': 0, 'dropped': {}, 'errors': []}
        try:
            articles = reader(source, status)
        except Exception as e:
            status['errors'].append({'error': str(e)})
            articles = []
        status['articles'] = len(articles)
        items, unidentified = [], []
        for article in articles:
            if not article.get('url'):
                continue
            item, reason = build_item(source, article, vocabulary, aliases, checked_at, today)
            if item is None:
                status['dropped'][reason] = status['dropped'].get(reason, 0) + 1
                if reason == 'brand-unidentified':
                    unidentified.append({'publisher': source['label'], 'headline': article['headline'],
                                         'url': article['url'], 'publishedAt': article.get('publishedAt') or ''})
                continue
            items.append(item)
        status['items'] = len(items)
        return status, items, unidentified

    diagnostics, items, unidentified, seen = [], [], [], set()
    with ThreadPoolExecutor(max_workers=4) as pool:
        for status, collected, held in pool.map(run, plans):
            diagnostics.append(status)
            unidentified.extend(held)
            for item in collected:
                key = canonical_url(item['url']) or item['url']
                if key in seen:
                    continue
                seen.add(key)
                items.append(item)

    responded = any(d['responses'] for d in diagnostics)
    result = {
        'status': 'ok' if items else ('partial' if responded else 'unavailable'),
        'checkedAt': checked_at,
        'cutoff': cutoff_iso,
        'items': items,
        'unidentifiedArticles': unidentified,
        'diagnostics': diagnostics,
    }
    atomic_write_json(args.out, result)
    upcoming = sum(1 for i in items if i['releaseStatus'] == 'upcoming')
    print(f"Newsletter collection: {result['status']} - {len(items)} items "
          f"({upcoming} upcoming) from {len(diagnostics)} readers; "
          f'{len(unidentified)} articles held without an identified brand', file=sys.stderr)


if __name__ == '__main__':
    main()
