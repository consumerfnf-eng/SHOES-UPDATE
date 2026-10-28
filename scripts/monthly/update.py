"""Monthly orchestrator: retail (SSENSE) + media (Hypebeast/Hypebeast KR/Sneaker
News) + SNS (Instagram hashtags) collection, merged into a *separate* overlay
catalog that the site adds to its existing display without ever touching
public/data/catalog.json or the daily/weekly scripts.

Design rules carried over from this repo's existing pipeline philosophy:
  - Never fabricate: a source that is blocked/unavailable keeps 0 items and
    is reported as such; the previous month's published products are kept
    (not deleted) until no longer within the 3-month display window.
  - Never auto-productize an SNS/media mention of a model that isn't already
    a verified SSENSE retail item or in data/monthly-model-aliases.json. An
    unmatched mention is held in data/monthly-unmatched-mentions.json for a
    human to register an alias for, exactly like the real catalog's
    unregistered-model gate.
  - Retail items publish directly (their image/evidence comes straight from
    the retailer's own structured product data, the same trust level as the
    existing officialImageEvidence pattern elsewhere in this repo).
"""
import argparse
import os
import re
import subprocess
import sys
from datetime import timezone

from common import atomic_write_json, kst_day, kst_now, kst_three_months_ago, read_json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = os.path.join(ROOT, 'data')
PUBLIC_DATA = os.path.join(ROOT, 'public', 'data')
GENERIC_WORDS = {'sneakers', 'sneaker', 'shoes', 'shoe', 'trainers', 'trainer', 'low', 'high', 'mid',
                  'black', 'white', 'red', 'blue', 'green', 'grey', 'gray', 'tan', 'brown', 'pink',
                  'navy', 'beige', 'cream', 'yellow', 'orange', 'purple', 'leather', 'knit', 'mesh'}


def tokenize(text):
    return [t for t in re.findall(r"[a-zA-Z0-9']+", (text or '').lower()) if len(t) > 2 and t not in GENERIC_WORDS]


def match_key(brand, name):
    tokens = sorted(set(tokenize(brand) + tokenize(name)))
    return tokens


def run_collector(script, out_path, extra_args=None):
    cmd = [sys.executable, os.path.join(os.path.dirname(__file__), script), '--out', out_path]
    if extra_args:
        cmd.extend(extra_args)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return {'status': 'error', 'items': [], 'diagnostics': [{'error': proc.stderr[-2000:]}]}
    return read_json(out_path, {'status': 'unavailable', 'items': [], 'diagnostics': []})


def match_mentions(ssense_items, mentions, mention_field, model_aliases=None):
    """Attach mentions to retail items. First tries a registered model alias
    (data/monthly-model-aliases.json) - a human-reviewed mapping, so a bare
    alias like "스피드캣" is enough to match every variant of that model
    without also requiring the brand word in the same text. Falls back to
    brand+model token overlap for everything not covered by an alias.
    Mentions that match nothing are returned separately, never turned into
    new products."""
    model_aliases = model_aliases or {}
    unmatched = []
    index = [(item, set(match_key(item['brand'], item['name']))) for item in ssense_items]
    alias_entries = [(key(v['brand']), [a.lower() for a in v.get('aliases', [])], v)
                      for v in model_aliases.values()]
    for mention in mentions:
        text = (mention.get(mention_field) or '') + ' ' + (mention.get('headline') or '')
        text_lower = text.lower()
        mention_tokens = set(tokenize(text))
        alias_hit = next((v for brand_key, aliases, v in alias_entries
                           if any(a in text_lower for a in aliases)), None)
        if alias_hit:
            matched_any = False
            for item in ssense_items:
                if key(item['brand']) == key(alias_hit['brand']) and alias_hit['model'].lower() in item['name'].lower():
                    item.setdefault('_mentions', []).append(mention)
                    matched_any = True
            if matched_any:
                continue
        best, best_overlap = None, 0
        for item, tokens in index:
            if not tokens:
                continue
            brand_tokens = set(tokenize(item['brand']))
            model_tokens = tokens - brand_tokens
            # Require the brand AND at least one distinct model token in the
            # mention text; a brand name alone (e.g. just "New Balance") is
            # not evidence this mention is about any specific item.
            if not (brand_tokens and brand_tokens <= mention_tokens):
                continue
            model_overlap = model_tokens & mention_tokens
            if model_overlap and len(model_overlap) > best_overlap:
                best, best_overlap = item, len(model_overlap)
        if best:
            best.setdefault('_mentions', []).append(mention)
        else:
            unmatched.append(mention)
    return unmatched


def key(value):
    return re.sub(r'[^a-z0-9]', '', (value or '').lower())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only-if-stale', action='store_true')
    parser.add_argument('--ig-session-file')
    parser.add_argument('--ig-username')
    args = parser.parse_args()

    now = kst_now()
    today = kst_day(now)
    previous_source = read_json(os.path.join(DATA, 'monthly-catalog-source.json'), {'products': [], 'lastRunAt': None})

    if args.only_if_stale and previous_source.get('lastRunMonth') == today[:7]:
        print('This month already has a completed monthly collection; no duplicate run.')
        return

    os.makedirs(os.path.join(ROOT, 'logs'), exist_ok=True)
    ssense = run_collector('collect_ssense.py', os.path.join(DATA, 'monthly-staging-ssense.json'))
    # ScrapingBee only runs when SCRAPINGBEE_API_KEY is set (status
    # 'requires_key' otherwise) - Lyst blocks curl_cffi and both headless and
    # headful Playwright for an unattended run, confirmed by hand.
    lyst = run_collector('collect_lyst_scrapingbee.py', os.path.join(DATA, 'monthly-staging-lyst.json'))
    media = run_collector('collect_media.py', os.path.join(DATA, 'monthly-staging-media.json'))
    musinsa = run_collector('collect_musinsa.py', os.path.join(DATA, 'monthly-staging-musinsa.json'))
    ig_args = []
    if args.ig_session_file:
        ig_args += ['--session-file', args.ig_session_file]
    if args.ig_username:
        ig_args += ['--username', args.ig_username]
    instagram = run_collector('collect_instagram.py', os.path.join(DATA, 'monthly-staging-instagram.json'), ig_args)
    hashtag_volume = run_collector('collect_instagram_hashtags.py', os.path.join(DATA, 'monthly-staging-ig-hashtags.json'))

    model_aliases = read_json(os.path.join(DATA, 'monthly-model-aliases.json'), {})
    previous_by_url = {p['url']: p for p in previous_source.get('products', [])}
    # SSENSE's category listing has no "new arrivals" signal at all (no sort,
    # no facet, no dedicated URL for it) - verified by hand, not assumed. The
    # only honest way to know a listing is new is a month-over-month delta
    # against our own prior snapshot. On the very first run there IS no prior
    # snapshot, so nothing can be called new yet - the whole current listing
    # is establishing the baseline, not a month's worth of new arrivals.
    is_baseline_run = not previous_source.get('products')

    ssense_items = ssense.get('items', [])
    known_urls = {p['url'] for p in ssense_items}
    for item in lyst.get('items', []):
        if item['url'] not in known_urls:
            ssense_items.append(item)
            known_urls.add(item['url'])
    # Durable hand-curated finds (e.g. a Lyst item collected by browsing a real
    # logged-in session, before ScrapingBee was wired in) merge in on every
    # run too, so they survive the next automated collection.
    manual_items = read_json(os.path.join(DATA, 'monthly-manual-items.json'), {'items': []}).get('items', [])
    manual_urls = set()
    for item in manual_items:
        if item['url'] not in known_urls:
            ssense_items.append(dict(item))
            known_urls.add(item['url'])
        manual_urls.add(item['url'])
    for item in ssense_items:
        prior = previous_by_url.get(item['url'])
        item['firstSeenAt'] = prior['firstSeenAt'] if prior else now.isoformat()
        item['newThisRun'] = (prior is None) and not is_baseline_run
        # firstDetectedAsNewAt is only set the one time an item is confirmed
        # genuinely new - a real month-over-month delta, or a human manually
        # verifying a find right now (e.g. browsing a site that blocks
        # automation). It must NOT be reset on later runs just because the
        # item is still being carried forward as "known" - otherwise a
        # 3-month publish window keyed off it would quietly reset every run.
        if prior and prior.get('firstDetectedAsNewAt'):
            item['firstDetectedAsNewAt'] = prior['firstDetectedAsNewAt']
        elif item['newThisRun'] or (item['url'] in manual_urls and not prior):
            item['firstDetectedAsNewAt'] = now.isoformat()

    unmatched_media = match_mentions(ssense_items, media.get('items', []), 'headline', model_aliases)
    unmatched_sns = match_mentions(ssense_items, instagram.get('items', []), 'caption', model_aliases)
    unmatched_ecommerce = match_mentions(ssense_items, musinsa.get('items', []), 'name', model_aliases)

    for item in ssense_items:
        mentions = item.pop('_mentions', [])
        media_mentions = [m for m in mentions if m.get('headline')]
        sns_mentions = [m for m in mentions if m.get('shortcode')]
        ecommerce_mentions = [m for m in mentions if 'rank' in m]
        likes = [m['likeCount'] for m in sns_mentions if isinstance(m.get('likeCount'), int)]
        item['popularity'] = {
            'media': len(media_mentions) > 0,
            'mediaMentions': media_mentions,
            'sns': len(sns_mentions) > 0,
            'snsPosts': sns_mentions,
            'ecommerce': len(ecommerce_mentions) > 0,
            'ecommerceRankings': ecommerce_mentions,
            'snsAverageLikes': round(sum(likes) / len(likes)) if likes else None,
        }

    cutoff = kst_three_months_ago(now).isoformat()
    # SSENSE's category listing has no release date, so there is no honest
    # basis for a 3-month display window the way the official catalog has
    # (which carries real verified release dates). Giving a retail item a
    # 3-month grace period after its firstSeenAt would mean a whole month's
    # baseline (hundreds of items already carried by SSENSE, not newly
    # arrived) stays published for 3 months regardless - exactly the
    # over-inclusion this was built to avoid. So "published" here means only
    # this run's genuine delta against last run's snapshot: items SSENSE is
    # showing that it was not showing last time we checked. Baseline run:
    # publish nothing, since there is no prior snapshot to diff against yet.
    # A manually hand-verified find (firstDetectedAsNewAt set the moment a
    # human confirmed it, not from a bulk baseline) stays published for the
    # normal 3 months from that date, same as a genuine automated delta -
    # it does not need to be "new this exact run" every run to stay visible.
    published = [] if is_baseline_run else [p for p in ssense_items
                                             if p.get('firstDetectedAsNewAt') and p['firstDetectedAsNewAt'] >= cutoff]

    source_snapshot = {
        'lastRunAt': now.isoformat(),
        'lastRunMonth': today[:7],
        'products': ssense_items,
    }
    atomic_write_json(os.path.join(DATA, 'monthly-catalog-source.json'), source_snapshot)

    atomic_write_json(os.path.join(DATA, 'monthly-unmatched-mentions.json'), {
        'checkedAt': now.isoformat(),
        'note': 'Mentions here reference a model not found among this run\'s verified SSENSE retail items '
                'and not registered in monthly-model-aliases.json. They are held, not auto-productized. '
                'Register a real alias in monthly-model-aliases.json to let a future run match them.',
        'media': unmatched_media,
        'sns': unmatched_sns,
        'ecommerce': unmatched_ecommerce,
    })

    public_catalog = {
        'schemaVersion': 1,
        'publishedAt': now.isoformat(),
        'asOf': today,
        'periodStart': cutoff[:10],
        'isBaselineRun': is_baseline_run,
        'products': published,
        # Hashtag-level volume + related keywords, collected without any Instagram
        # login (see collect_instagram_hashtags.py). This is a different, coarser
        # signal than popularity.snsPosts above (which needs the user's login
        # session and gives per-post captions/likes matched to specific items).
        'hashtagTrends': hashtag_volume.get('items', []),
        # Musinsa's own "인기순" sneaker-category ranking (top 50, real
        # products with a real rank position - not a search-term list).
        # Kept here in full regardless of matching, since the ranking
        # itself is useful context even for items not (yet) carried by
        # SSENSE/Lyst.
        'ecommerceRanking': musinsa.get('items', []),
    }
    atomic_write_json(os.path.join(PUBLIC_DATA, 'monthly-catalog.json'), public_catalog)

    report = {
        'checkedAt': now.isoformat(),
        'sources': {
            'retail-ssense': {'status': ssense.get('status'), 'items': len(ssense.get('items', [])),
                               'diagnostics': ssense.get('diagnostics', [])},
            'retail-lyst': {'status': lyst.get('status'), 'items': len(lyst.get('items', [])),
                             'creditsUsed': lyst.get('scrapingBeeCreditsUsed', 0), 'diagnostics': lyst.get('diagnostics', [])},
            'media': {'status': media.get('status'), 'items': len(media.get('items', [])),
                      'matched': len(media.get('items', [])) - len(unmatched_media),
                      'held': len(unmatched_media), 'diagnostics': media.get('diagnostics', [])},
            'instagram': {'status': instagram.get('status'), 'items': len(instagram.get('items', [])),
                          'matched': len(instagram.get('items', [])) - len(unmatched_sns),
                          'held': len(unmatched_sns), 'diagnostics': instagram.get('diagnostics', [])},
            'instagram-hashtag-volume': {'status': hashtag_volume.get('status'),
                                          'items': len(hashtag_volume.get('items', [])),
                                          'diagnostics': hashtag_volume.get('diagnostics', [])},
            'ecommerce-musinsa': {'status': musinsa.get('status'), 'items': len(musinsa.get('items', [])),
                                   'matched': len(musinsa.get('items', [])) - len(unmatched_ecommerce),
                                   'held': len(unmatched_ecommerce), 'diagnostics': musinsa.get('diagnostics', [])},
        },
        'isBaselineRun': is_baseline_run,
        'published': len(published),
        'heldAsStale': len(ssense_items) - len(published) if not is_baseline_run else 0,
        'heldAsBaseline': len(ssense_items) if is_baseline_run else 0,
    }
    atomic_write_json(os.path.join(DATA, 'monthly-run-report.json'), report)

    if is_baseline_run:
        print(f"Monthly update: baseline run, 0 published ({len(ssense_items)} SSENSE items recorded as "
              f"the starting snapshot; next run will publish only genuinely new-since-then items).")
        return
    print(f"Monthly update complete: {len(published)} published retail items; "
          f"{report['sources']['media']['held']} media + {report['sources']['instagram']['held']} SNS mentions held unmatched; "
          f"SSENSE={ssense.get('status')} Lyst={lyst.get('status')} media={media.get('status')} "
          f"Musinsa={musinsa.get('status')} instagram={instagram.get('status')}")


if __name__ == '__main__':
    main()
