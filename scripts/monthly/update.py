"""Weekly retail + newsletter orchestrator.

Collects eight retailers and seven sneaker publications into a *separate*
overlay catalog that the site adds to its existing display, never touching
public/data/catalog.json or the official daily/weekly scripts.

  리테일 신상   SSENSE, Farfetch, Mytheresa, Net-a-Porter, Lyst, 무신사, 29CM,
               W컨셉. Korean platforms used to live in their own 이커머스 tab;
               they are retailers like the rest and are now merged in.
  뉴스레터      Sneaker News, Highsnobiety, Sneaker Freaker, Hypebeast,
               Hypebeast Korea, Concept Kicks, Footwear News - each article
               that names an identifiable brand becomes an item, including
               ones whose stated release date is still in the future.

What counts as "new" is decided per source by what that source actually
publishes, never by a single blanket rule:

  dated      29CM gives every listing a real visibleBeginTimestamp, and every
             article carries a publish date -> a true 3-month window.
  new-sort   SSENSE (sort=latest-desc) and 무신사 (sortCode=NEW) order their own
             listings newest-first -> the top of that order is the new arrivals.
  delta      W컨셉, Lyst, Farfetch, Mytheresa, Net-a-Porter expose neither a date
             nor a working newest sort -> the only honest signal is what they
             are showing now that they were not showing at the last check, so
             those publish on a week-over-week delta and the first run records
             a baseline instead of publishing one.

Design rules carried over from this repo's pipeline philosophy:
  - Never fabricate: a blocked source keeps 0 items and is reported as such;
    previously published products are kept until they leave the 3-month window.
  - Never auto-productize an SNS mention of a model that is not already a
    verified retail item or registered in data/monthly-model-aliases.json.
    Unmatched mentions are held in data/monthly-unmatched-mentions.json.
  - Retail and newsletter items publish directly, since their image, link and
    evidence come straight from the retailer's or publisher's own structured
    data - the same trust level as the officialImageEvidence pattern elsewhere.
"""
import argparse
import os
import re
import subprocess
import sys

from brand_identity import canonical_brand
from dedupe_rules import (drop_already_official, drop_excluded_brands, evergreen_keys,
                          excluded_brand_keys, is_evergreen, official_identity_keys, prefer_women)
from footwear_scope import clean_colour_value, colour_from_style, is_stated_value
from image_signals import colour_distance, signals_for
from model_grouping import assign_model_groups
from common import atomic_write_json, derive_colorway, kst_day, kst_iso_week, kst_now, kst_three_months_ago, read_json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = os.path.join(ROOT, 'data')
PUBLIC_DATA = os.path.join(ROOT, 'public', 'data')
GENERIC_WORDS = {'sneakers', 'sneaker', 'shoes', 'shoe', 'trainers', 'trainer', 'low', 'high', 'mid',
                  'black', 'white', 'red', 'blue', 'green', 'grey', 'gray', 'tan', 'brown', 'pink',
                  'navy', 'beige', 'cream', 'yellow', 'orange', 'purple', 'leather', 'knit', 'mesh'}

# Retail collectors, in merge order. `basis` says how this source's own data
# establishes that an item is new - see the module docstring.
RETAIL_COLLECTORS = [
    {'script': 'collect_ssense.py', 'staging': 'monthly-staging-ssense.json',
     'report': 'retail-ssense', 'basis': 'dated'},
    {'script': 'collect_musinsa.py', 'staging': 'monthly-staging-musinsa.json',
     'report': 'retail-musinsa', 'basis': 'dated'},
    {'script': 'collect_29cm.py', 'staging': 'monthly-staging-29cm.json',
     'report': 'retail-29cm', 'basis': 'dated'},
    {'script': 'collect_wconcept.py', 'staging': 'monthly-staging-wconcept.json',
     'report': 'retail-wconcept', 'basis': 'delta'},
    {'script': 'collect_lyst_scrapingbee.py', 'staging': 'monthly-staging-lyst.json',
     'report': 'retail-lyst', 'basis': 'delta'},
    {'script': 'collect_generic_jsonld.py', 'staging': 'monthly-staging-farfetch-mytheresa.json',
     'report': 'retail-farfetch-mytheresa-netaporter', 'basis': 'delta'},
]
DELTA_BASIS = 'delta'


def tokenize(text):
    return [t for t in re.findall(r"[a-zA-Z0-9']+", (text or '').lower()) if len(t) > 2 and t not in GENERIC_WORDS]


def match_key(brand, name):
    tokens = sorted(set(tokenize(brand) + tokenize(name)))
    return tokens


def run_collector(script, out_path, extra_args=None, reuse=False):
    """Run a collector, or reuse the staging file it wrote last time.

    `reuse` exists so the merge/publish logic can be re-run against an
    already-collected week without hitting every retailer again - iterating on
    how items are merged is not a reason to re-crawl eight sites."""
    if reuse:
        existing = read_json(out_path, None)
        if existing is not None:
            return existing
    cmd = [sys.executable, os.path.join(os.path.dirname(__file__), script), '--out', out_path]
    if extra_args:
        cmd.extend(extra_args)
    # Collectors print em dashes and Korean category names; decoding their
    # output with the Windows locale codepage (cp949) raises inside
    # subprocess' reader thread and loses the diagnostics.
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if proc.returncode != 0:
        return {'status': 'error', 'items': [], 'diagnostics': [{'error': proc.stderr[-2000:]}]}
    return read_json(out_path, {'status': 'unavailable', 'items': [], 'diagnostics': []})


def match_mentions(retail_items, mentions, mention_field, model_aliases=None):
    """Attach mentions to retail items. First tries a registered model alias
    (data/monthly-model-aliases.json) - a human-reviewed mapping, so a bare
    alias like "스피드캣" is enough to match every variant of that model
    without also requiring the brand word in the same text. Falls back to
    brand+model token overlap for everything not covered by an alias.
    Mentions that match nothing are returned separately, never turned into
    new products."""
    model_aliases = model_aliases or {}
    unmatched = []
    index = [(item, set(match_key(item['brand'], item['name']))) for item in retail_items]
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
            for item in retail_items:
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


# Fields the published snapshot actually needs. Everything a collector gathers
# stays in the staging files and the run report; the browser only downloads
# what a card or its detail panel renders. Without this the payload runs to
# 1KB per item (42% of it retailerEvidence alone), which is tens of megabytes
# over a full week's retail collection.
INTERNAL_FIELDS = ('firstSeenAt', 'sku', 'brandSlug', '_mentions', 'retailerEvidence',
                   'mediaEvidence', 'productType', 'newnessBasis', 'firstDetectedAsNewAt')


def source_directory(items):
    """Everything an item's evidence repeats verbatim for its whole source.

    retailer name, listing URL and check time are identical for every item a
    collector returned, so they are published once per source instead of once
    per item - on a 6,000-item week that alone is a third of the payload.
    """
    directory = {}
    for item in items:
        source = item.get('source')
        if not source or source in directory:
            continue
        evidence = item.get('retailerEvidence') or item.get('mediaEvidence') or {}
        entry = {
            'label': item.get('retailer') or item.get('publisher') or evidence.get('retailer') or '',
            'listingUrl': evidence.get('listingUrl') or '',
            'checkedAt': evidence.get('verifiedAt') or '',
            'basis': item.get('newnessBasis') or 'dated',
        }
        directory[source] = {k: v for k, v in entry.items() if v}
    return directory


def slim_for_publish(item):
    """Drop internal bookkeeping, empty values and anything already carried
    either at the top level or in the per-source directory."""
    out = {}
    for field, value in item.items():
        if field in INTERNAL_FIELDS or value in ('', [], {}, None):
            continue
        if field == 'popularity' and isinstance(value, dict):
            if not (value.get('media') or value.get('sns')):
                continue
            value = {k: v for k, v in value.items() if v not in ('', [], None, False)}
        if field == 'footwearTypes' and value == ['sneaker']:
            continue  # the reader defaults to ['sneaker']
        if field in ('fullName', 'brandKo', 'retailer', 'publisher') and value == item.get(
                'name' if field == 'fullName' else 'brand'):
            continue
        if field in ('retailer', 'publisher'):
            continue  # carried by the source directory
        if field == 'newThisRun' and value is False:
            continue
        out[field] = value
    # The only part of the evidence that is genuinely per-item: which position
    # in the listing, or which article, this record came from.
    evidence = item.get('retailerEvidence') or item.get('mediaEvidence') or {}
    basis = evidence.get('listingBasis') or evidence.get('headline')
    if basis and basis != item.get('fullName'):
        out['basis'] = basis
    return out


def snapshot_entry(item):
    """The week-over-week delta only needs to answer "have we seen this URL,
    and when did it first count as new?" - so the committed snapshot stores
    exactly that rather than a second full copy of every record."""
    return {k: item[k] for k in ('url', 'source', 'firstSeenAt', 'firstDetectedAsNewAt') if item.get(k)}


def repair_split_title(item):
    """Put back a title a collector cut in half inside its own brackets.

    29CM returns DISCOVERY EXPEDITION's slip-on as three products called
    "토리노 (S", "토리노 (L" and "토리노 (BLACK)", with "WHITE)" and "BROWN)"
    left in the style field. The name is a fragment and the style is not a
    style, so nothing downstream can tell the three apart or put them
    together. Rejoining them restores "토리노 (S WHITE)" and the colour with
    it; the style field is cleared, because it never held one.
    """
    name = (item.get('name') or '').strip()
    style = (item.get('style') or '').strip()
    if not name or not style or style.count(')') != 1 or not style.endswith(')'):
        return
    if name.count('(') != name.count(')') + 1:
        return
    item['name'] = f'{name} {style}'
    if item.get('fullName') == name:
        item['fullName'] = item['name']
    item['style'] = ''


def normalize_retail_item(item, basis, previous, now, is_baseline):
    """Align a collector's record with the official catalog's field shape and
    stamp its newness. `is_baseline` is this *source's* baseline flag, not the
    whole run's. A field the source never provided stays absent rather
    than being invented - unlike the official pipeline's same-named fields,
    which are always brand-verified."""
    item.setdefault('category', 'sneaker')
    item.setdefault('productType', 'sneaker')
    item.setdefault('footwearTypes', ['sneaker'])
    item.setdefault('newnessBasis', basis)
    # One canonical brand across retailers, so the same shoe listed on Musinsa
    # as 나이키 and on SSENSE as Nike is one card and one sidebar entry. The
    # retailer's own wording is kept alongside it, never discarded.
    written = item.get('brand') or ''
    canonical = canonical_brand(item.get('brandSlug'), written, item.get('brandKo'))
    if canonical and canonical != written:
        item['brandAsListed'] = written
        item['brand'] = canonical
    if not item.get('style'):
        item['style'] = item.get('sku', '')
    repair_split_title(item)
    # A retailer is allowed to answer a required colour field with "상세내용참고",
    # with its own internal codes, or with a colour followed by a paragraph of
    # standing notice. None of that belongs on a chip, so the field is cleaned
    # down to whatever colour it actually states before anything else reads it.
    item['colorway'] = clean_colour_value(item.get('colorway'))
    if not item['colorway']:
        # A colour the retailer stated in the wrong field still counts:
        # New Balance writes "MT10O6L5 (CHARCOAL)" into `style`.
        item['colorway'] = colour_from_style(item.get('style'))
    # A style field holding nothing but a colour name is not a style code.
    # 29CM files KEEN's 재스퍼 under "BLACK", "SAFARI" and "MAGNET" and EPT's
    # whole shelf under "black", and a code is matched on as an identity: six
    # unrelated KEEN models were answering to one "style" and the first-listed
    # index was dating them off each other.
    if style_is_colour_only(item.get('style')):
        if not item['colorway']:
            item['colorway'] = clean_colour_value(item['style'])
        item['styleAsListed'] = item['style']
        item['style'] = ''
    if not item['colorway']:
        item['colorway'] = derive_colorway(item.get('fullName') or item.get('name', ''))
    for field in ('material', 'countryOrigin'):
        if item.get(field) and not is_stated_value(item[field]):
            item.pop(field)
    prior = previous.get(item['url'])
    item['firstSeenAt'] = prior['firstSeenAt'] if prior else now.isoformat()
    item['newThisRun'] = (prior is None) and not is_baseline
    # firstDetectedAsNewAt is set once, the first time an item is confirmed
    # genuinely new. It must not be reset on later runs just because the item
    # is still being carried forward, or a 3-month window keyed off it would
    # quietly restart every week.
    if prior and prior.get('firstDetectedAsNewAt'):
        item['firstDetectedAsNewAt'] = prior['firstDetectedAsNewAt']
    elif basis != DELTA_BASIS:
        # A dated or newest-sorted source states its own newness; the first
        # run it is seen on is the first run it was new to us.
        item['firstDetectedAsNewAt'] = (prior or {}).get('firstSeenAt') or now.isoformat()
    elif item['newThisRun']:
        item['firstDetectedAsNewAt'] = now.isoformat()
    return item


def carry_forward(previous_payload, published, collected_by_source, cutoff_day):
    """Keep a blocked source's last published items instead of deleting them.

    A retailer that 403s the runner for one run must not empty its section of
    the site. When a source collected nothing this run but had published items
    last run, those items are carried over with their original evidence and a
    `carriedForward` date, still subject to the same 3-month window. A source
    that collected something is fully replaced by what it collected - this is
    only a floor under a failed fetch, never a way for stale items to linger
    beside fresh ones.
    """
    kept, carried_sources = [], {}
    published_sources = {item.get('source') for item in published}
    for item in (previous_payload.get('retail') or []) + (previous_payload.get('newsletter') or []):
        source = item.get('source')
        if not source or collected_by_source.get(source) or source in published_sources:
            continue
        listed = (item.get('listedAt') or item.get('publishedAt') or '')[:10]
        if listed and listed < cutoff_day:
            continue
        kept.append({**item, 'carriedForward': True})
        carried_sources[source] = carried_sources.get(source, 0) + 1
    return kept, carried_sources


# How many published photos a single run will download. They are cached by
# URL in data/image-signals.json, so after the first run this only covers
# genuinely new listings.
PHOTO_BUDGET = 6000
PHOTO_SAME_SHOT = 2       # hamming distance at or under this is the same shot


def attach_photo_signals(items, status):
    """Read each published photo once: who it is, and what colour it is."""
    signals = signals_for([i.get('image') for i in items], status, budget=PHOTO_BUDGET)
    for item in items:
        found = signals.get(item.get('image') or '')
        if not found:
            continue
        if found.get('phash'):
            item['photoHash'] = found['phash']
        if found.get('body'):
            item['bodyColor'] = found['body']
    return items


def drop_duplicate_photos(items, status):
    """Collapse listings that are literally the same photograph.

    The same shot gets re-hosted - one retailer's image reused by another,
    or one product listed twice - and each copy was becoming its own card or
    its own colour chip. The duplicates' links are kept on the survivor
    rather than thrown away. A different angle of the same shoe does NOT
    hash alike and is handled by the colour merge in the view, not here.

    Two passes, because the model name can be the thing that is wrong:

      distance 0, grouped by brand. A byte-identical hash is the same
      photograph whatever each shop called it, and the naming is exactly
      what differs - 29CM's "goodnews 라나 스니커즈-아이보리" and Musinsa's
      "GOODNEWS 굿뉴스 라나 여성 스니커즈-아이보리" are one listing whose model
      keys never matched, so they were never compared.

      distance 1-2, grouped by brand *and* model. A near hash across two
      different models is a collision, not a duplicate: before the model
      guard, a Nike Tennis Classic absorbed an Air Force 1 and an Air Max 90.
    """
    drop, merged = set(), 0

    def collapse(group_key, exact_only):
        nonlocal merged
        groups = {}
        for item in items:
            if item['id'] in drop or not item.get('photoHash'):
                continue
            groups.setdefault(group_key(item), []).append(item)
        for group in groups.values():
            kept = []
            for item in group:
                twin = next((k for k in kept
                             if (k['photoHash'] == item['photoHash'] if exact_only
                                 else _same_shot(k['photoHash'], item['photoHash']))), None)
                if twin is None:
                    kept.append(item)
                    continue
                twin.setdefault('alsoListedAt', []).append(
                    {'source': item.get('source'), 'url': item.get('url'),
                     'priceLabel': item.get('priceLabel')})
                drop.add(item['id'])
                merged += 1

    before = merged
    collapse(lambda i: _brand_only_key(i) or f"id:{i['id']}", exact_only=True)
    # The brand spelling can be the thing that differs: Musinsa calls one
    # label "leey" and 29CM calls it "Yeel", so the brand group never held
    # both copies of their identical photograph. An identical photo under an
    # identical product name is one product whatever the shops call the label.
    collapse(lambda i: 'title:' + _title_key(i) if _title_key(i) else f"id:{i['id']}",
             exact_only=True)
    status['identicalPhotosMerged'] = status.get('identicalPhotosMerged', 0) + (merged - before)
    collapse(lambda i: model_key(i) or f"id:{i['id']}", exact_only=False)
    status['duplicatePhotosMerged'] = status.get('duplicatePhotosMerged', 0) + merged
    return [i for i in items if i['id'] not in drop]


def _brand_only_key(item):
    """The brand, folded, in any script - the widest group an exact hash match
    is allowed to reach across."""
    return ''.join(c for c in (canonical_brand(item.get('brand') or '')).lower() if c.isalnum())


def _title_key(item):
    """The product name alone, folded, with no brand in it.

    Long enough to be a name and not a category: "스니커즈" on its own says
    nothing about which shoe it is.
    """
    folded = ''.join(c for c in (item.get('name') or '').lower() if c.isalnum())
    return folded if len(folded) >= 8 else ''


def _same_shot(a, b):
    return int(bin(int(a, 16) ^ int(b, 16)).count('1')) <= PHOTO_SAME_SHOT


MODEL_INDEX_FILE = 'model-first-listed.json'
MIN_MODEL_KEY = 3


_COLOUR_ONLY = None


def style_is_colour_only(value):
    """Whether a style field holds something that is not a style code.

    Two tests, and either is enough:

      no digit anywhere. Manufacturers' codes carry them - FS263RU02X098,
      1042A332-400, SKZF261WATH - and a few words of plain letters is a
      colour, a size or a category instead. This catches a brand's own colour
      names, which no general colour list has: 29CM files KEEN's 재스퍼 under
      "AQUIFER", "MAGNET" and "SAFARI".

      every word is a colour, per config/colour-words.json - the same list the
      colour chips read, so a word counts as a colour here exactly when it
      counts as one there.

    It matters because a code is matched on as an identity: six unrelated KEEN
    models answered to one "BLACK" and the first-listed index was dating them
    off each other.
    """
    global _COLOUR_ONLY
    if _COLOUR_ONLY is None:
        words = read_json(os.path.join(ROOT, 'config', 'colour-words.json'), {})
        _COLOUR_ONLY = {w.strip().lower() for w in
                        (words.get('derived') or []) + (words.get('supplement') or []) if w}
    text = (value or '').strip().lower()
    if not text:
        return False
    parts = [p for p in re.split(r'[\s/,·|&_-]+', text) if p]
    if not parts:
        return False
    if not any(c.isdigit() for c in text):
        return len(parts) <= 3
    return all(p in _COLOUR_ONLY for p in parts)


def style_key(item):
    """A manufacturer style code identifies one shoe in any language.

    Model names do not cross languages - Musinsa's "척 70" and SSENSE's
    "Chuck 70" fold to different keys - but HQ4310-500 is HQ4310-500
    everywhere, so it is indexed alongside the name.
    """
    style = ''.join(c for c in (item.get('style') or '').lower() if c.isalnum())
    return f'style:{style}' if len(style) >= 6 else ''


def model_key(item):
    """brand|model, with the colourway and trailing category words removed.

    Deliberately coarser than a SKU: the point is to recognise the same shoe
    across retailers and across weeks, however each of them spells its
    listing.
    """
    brand = re.sub(r'[^0-9a-z가-힣]', '', (item.get('brand') or '').lower())
    name = item.get('name') or item.get('fullName') or ''
    colour = item.get('colorway') or ''
    if colour:
        name = name.replace(colour, ' ')
    name = re.sub(r'\s+(?:running\s+)?(?:shoes?|sneakers?)$', '', name.strip(), flags=re.I)
    model = ''.join(c for c in name.lower() if c.isalnum())
    return f'{brand}|{model}' if brand and len(model) >= MIN_MODEL_KEY else ''


def first_listed_index(items, previous):
    """Earliest listing date ever seen for each model, across every source.

    A retailer re-listing an old shoe stamps it with today's date - 29CM's
    visibleBeginTimestamp and Musinsa's image-upload day are both the date of
    *this* listing, not of the shoe. So the earliest date any source has ever
    shown for that model is kept, and a model first seen more than three
    months ago is a re-release however fresh today's listing looks.

    Cross-source evidence works on the very first run too: SSENSE records a
    creationDate of 2022 for the Chuck 70, which rules out a 29CM listing of
    the same shoe posted this week.
    """
    index = dict(previous)
    for item in items:
        day = (item.get('listedAt') or '')[:10]
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
            continue
        for key in (model_key(item), style_key(item)):
            if key and (key not in index or day < index[key]):
                index[key] = day
    return index


def is_rerelease(item, index, cutoff_day):
    """True when this shoe was already on sale before the window opened."""
    dates = [index.get(key) for key in (model_key(item), style_key(item)) if key]
    known = [d for d in dates if d]
    return bool(known) and min(known) < cutoff_day


def retail_is_published(item, cutoff_day, cutoff_iso):
    """Only items that are actually inside the three-month window publish.

    A dated item needs its own listing date inside the window, and an item
    with no date at all does not publish - "within three months" is a claim
    that has to be backed by a date, and every source except W Concept now
    provides one (29CM's visibleBeginTimestamp, SSENSE's creationDate,
    Musinsa's image-upload day). Position in a site's own newest-first sort
    is no longer accepted on its own: Musinsa's 신상품순 reaches back past
    three months, so the sort alone would have let older listings through.

    A delta-basis item has no date anywhere, so its window runs for three
    months from the run that first saw it appear.
    """
    basis = item.get('newnessBasis')
    if basis == DELTA_BASIS:
        detected = item.get('firstDetectedAsNewAt')
        return bool(detected) and detected >= cutoff_iso
    listed = (item.get('listedAt') or '')[:10]
    return bool(listed) and listed >= cutoff_day


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only-if-stale', action='store_true')
    parser.add_argument('--use-staging', action='store_true',
                        help="re-merge and re-publish from the last run's staging files without collecting")
    parser.add_argument('--ig-session-file')
    parser.add_argument('--ig-username')
    args = parser.parse_args()

    now = kst_now()
    today = kst_day(now)
    previous_source = read_json(os.path.join(DATA, 'monthly-catalog-source.json'),
                                {'products': [], 'lastRunAt': None})

    if args.only_if_stale and previous_source.get('lastRunWeek') == kst_iso_week(now):
        print('This week already has a completed retail/newsletter collection; no duplicate run.')
        return

    os.makedirs(os.path.join(ROOT, 'logs'), exist_ok=True)

    results = {}
    for collector in RETAIL_COLLECTORS:
        results[collector['report']] = run_collector(
            collector['script'], os.path.join(DATA, collector['staging']), reuse=args.use_staging)
    newsletter = run_collector('collect_newsletter.py', os.path.join(DATA, 'monthly-staging-newsletter.json'),
                               reuse=args.use_staging)
    ig_args = []
    if args.ig_session_file:
        ig_args += ['--session-file', args.ig_session_file]
    if args.ig_username:
        ig_args += ['--username', args.ig_username]
    instagram = run_collector('collect_instagram.py', os.path.join(DATA, 'monthly-staging-instagram.json'),
                              ig_args, reuse=args.use_staging)
    # The trend ranking writes straight into public/data: it is its own
    # snapshot with its own history file, not part of the product catalog.
    trends = run_collector('collect_trend_keywords.py',
                           os.path.join(PUBLIC_DATA, 'trend-keywords.json'),
                           reuse=args.use_staging)

    model_aliases = read_json(os.path.join(DATA, 'monthly-model-aliases.json'), {})
    previous_payload = read_json(os.path.join(PUBLIC_DATA, 'monthly-catalog.json'), {})
    previous_products = previous_source.get('products', [])
    previous_by_url = {p['url']: p for p in previous_products if p.get('url')}
    # Baseline is decided per source, not per run. A newly added collector
    # starts with nothing of its own in the snapshot even when the snapshot is
    # full of other sources' items - without this, its entire back catalogue
    # would publish once as "new this week" (W Concept's 13,407 items did
    # exactly that the first time it ran).
    seen_before = {p.get('source') for p in previous_products if p.get('source')}
    run_is_baseline = not previous_products

    retail_items, seen_urls = [], set()
    baseline_sources = set()
    for collector in RETAIL_COLLECTORS:
        collected = results[collector['report']].get('items', [])
        source_ids = {item.get('source') for item in collected if item.get('source')}
        source_is_new = bool(source_ids) and not (source_ids & seen_before)
        if collector['basis'] == DELTA_BASIS and source_is_new:
            baseline_sources.update(source_ids)
        for item in collected:
            if not item.get('url') or item['url'] in seen_urls:
                continue
            seen_urls.add(item['url'])
            retail_items.append(normalize_retail_item(
                item, collector['basis'], previous_by_url, now,
                run_is_baseline or (collector['basis'] == DELTA_BASIS and source_is_new)))

    # Durable hand-curated finds (e.g. an item collected by browsing a real
    # logged-in session) merge in on every run so they survive automation.
    for item in read_json(os.path.join(DATA, 'monthly-manual-items.json'), {'items': []}).get('items', []):
        if not item.get('url') or item['url'] in seen_urls:
            continue
        seen_urls.add(item['url'])
        merged = normalize_retail_item(dict(item), 'delta', previous_by_url, now, run_is_baseline)
        merged.setdefault('firstDetectedAsNewAt', now.isoformat())
        retail_items.append(merged)

    newsletter_items = newsletter.get('items', [])
    cutoff = kst_three_months_ago(now)
    cutoff_iso, cutoff_day = cutoff.isoformat(), cutoff.strftime('%Y-%m-%d')

    # Newsletter items double as media mentions of the retail items, so a
    # retail card can show that the press covered it this quarter.
    unmatched_media = match_mentions(retail_items, newsletter_items, 'fullName', model_aliases)
    unmatched_sns = match_mentions(retail_items, instagram.get('items', []), 'caption', model_aliases)

    for item in retail_items:
        mentions = item.pop('_mentions', [])
        media_mentions = [m for m in mentions if m.get('publisher')]
        sns_mentions = [m for m in mentions if m.get('shortcode')]
        likes = [m['likeCount'] for m in sns_mentions if isinstance(m.get('likeCount'), int)]
        item['popularity'] = {
            'media': len(media_mentions) > 0,
            'mediaMentions': [{'publisher': m.get('publisher'), 'headline': m.get('fullName'),
                               'url': m.get('url'), 'publishedAt': m.get('publishedAt')}
                              for m in media_mentions],
            'sns': len(sns_mentions) > 0,
            'snsPosts': sns_mentions,
            'snsAverageLikes': round(sum(likes) / len(likes)) if likes else None,
        }

    # Every collected item feeds the index, not only the published ones: an
    # old SSENSE record is exactly the evidence that rules out a fresh-looking
    # re-listing of the same shoe somewhere else.
    model_index = first_listed_index(
        retail_items, read_json(os.path.join(DATA, MODEL_INDEX_FILE), {}))
    atomic_write_json(os.path.join(DATA, MODEL_INDEX_FILE), model_index)

    in_window = [p for p in retail_items if retail_is_published(p, cutoff_day, cutoff_iso)]
    published_retail = [p for p in in_window if not is_rerelease(p, model_index, cutoff_day)]
    rereleases = len(in_window) - len(published_retail)
    # A line that has been on sale for years needs no date to be ruled out.
    # The index can only answer with the earliest listing *some source* has
    # shown, which for a model one shop carries alone is that shop's own
    # listing date - Balardi stamped the 2021 Balenciaga Speed 2.0 with
    # 2026-09-16 and the gate above had nothing older to overturn it with.
    evergreen = evergreen_keys()
    before_evergreen = len(published_retail)
    published_retail = [p for p in published_retail if not is_evergreen(p, evergreen)]
    evergreens = before_evergreen - len(published_retail)
    # A removed brand must not reach the page from any shop.
    brand_status = {'step': 'excluded brands'}
    excluded = excluded_brand_keys()
    published_retail = drop_excluded_brands(published_retail, excluded, brand_status)
    published_newsletter = [n for n in drop_excluded_brands(newsletter_items, excluded, {})
                            if not n.get('publishedAt') or n['publishedAt'][:10] >= cutoff_day]

    collected_by_source = {}
    for item in retail_items + newsletter_items:
        source = item.get('source')
        if source:
            collected_by_source[source] = collected_by_source.get(source, 0) + 1
    carried, carried_sources = carry_forward(
        previous_payload, published_retail + published_newsletter, collected_by_source, cutoff_day)
    published_retail += [c for c in carried if str(c.get('source', '')).startswith('retail-')]
    published_newsletter += [c for c in carried if str(c.get('source', '')).startswith('newsletter-')]

    # A retired source must not survive as carried-forward stock. Balardi was
    # removed because its "newest" listing is a re-release more often than
    # not, and its 913 published items would otherwise have been carried for
    # another three months after the collector was deleted.
    live_sources = {c['report'] for c in RETAIL_COLLECTORS} | {
        'retail-farfetch', 'retail-mytheresa', 'retail-netaporter'}
    retired = [p for p in published_retail if p.get('source') not in live_sources]
    published_retail = [p for p in published_retail if p.get('source') in live_sources]

    photo_status = {'step': 'photo signals'}
    published_retail = attach_photo_signals(published_retail, photo_status)
    published_newsletter = attach_photo_signals(published_newsletter, photo_status)
    published_retail = drop_duplicate_photos(published_retail, photo_status)
    published_newsletter = drop_duplicate_photos(published_newsletter, photo_status)

    # Colourways a retailer only ever wrote into the product name, so the
    # four shades of one slip-on become one card with four chips instead of
    # four cards. Retail only: a newsletter item is an article, and two
    # articles about one shoe are two pieces of writing, not two colours.
    grouping_status = {'step': 'model grouping'}
    assign_model_groups(published_retail, grouping_status)

    # One design, one card, and the women's listing is the one kept: Jaclar's
    # 페이스 로우 arrived once under 남성 and once under 여성 with the same
    # photograph. Runs after the grouping, which is what establishes that two
    # listings are the same model in the first place.
    audience_status = {'step': 'audience merge'}
    published_retail = prefer_women(published_retail, audience_status)

    # The brand's own catalogue is the better record of a shoe it already
    # publishes - its own photo, its style code, its release evidence - so a
    # retailer's copy of the same shoe is dropped rather than shown twice.
    official_status = {'step': 'already on the official page'}
    published_retail = drop_already_official(
        published_retail, official_identity_keys(os.path.join(PUBLIC_DATA, 'catalog.json')),
        official_status)

    atomic_write_json(os.path.join(DATA, 'monthly-catalog-source.json'), {
        'lastRunAt': now.isoformat(),
        'lastRunWeek': kst_iso_week(now),
        'note': 'Delta bookkeeping only - the full records live in the staging files.',
        'products': [snapshot_entry(p) for p in retail_items],
    })
    atomic_write_json(os.path.join(DATA, 'monthly-unmatched-mentions.json'), {
        'checkedAt': now.isoformat(),
        'note': 'SNS mentions here reference a model not found among this run\'s verified retail items '
                'and not registered in monthly-model-aliases.json. They are held, not auto-productized. '
                'Newsletter articles without an identifiable brand are held in '
                'monthly-staging-newsletter.json under unidentifiedArticles.',
        'sns': unmatched_sns,
        'mediaNotMatchedToRetail': len(unmatched_media),
    })

    source_status = []
    for collector in RETAIL_COLLECTORS:
        result = results[collector['report']]
        source_status.append({'id': collector['report'], 'kind': 'retail', 'basis': collector['basis'],
                              'status': result.get('status'), 'collected': len(result.get('items', []))})
    source_status.append({'id': 'newsletter', 'kind': 'newsletter', 'basis': 'dated',
                          'status': newsletter.get('status'), 'collected': len(newsletter_items)})

    public_catalog = {
        'schemaVersion': 2,
        'publishedAt': now.isoformat(),
        'asOf': today,
        'periodStart': cutoff_day,
        'isBaselineRun': run_is_baseline,
        'baselineSources': sorted(baseline_sources),
        'sources': {**{k: v for k, v in (previous_payload.get('sources') or {}).items()
                       if k in carried_sources},
                    **source_directory(published_retail + published_newsletter)},
        'retail': [slim_for_publish(p) for p in published_retail],
        'newsletter': [slim_for_publish(n) for n in published_newsletter],
        'sourceStatus': source_status,
    }
    atomic_write_json(os.path.join(PUBLIC_DATA, 'monthly-catalog.json'), public_catalog, compact=True)

    report = {
        'checkedAt': now.isoformat(),
        'sources': {
            **{collector['report']: {
                'status': results[collector['report']].get('status'),
                'basis': collector['basis'],
                'items': len(results[collector['report']].get('items', [])),
                'creditsUsed': results[collector['report']].get('scrapingBeeCreditsUsed', 0),
                'diagnostics': results[collector['report']].get('diagnostics', []),
            } for collector in RETAIL_COLLECTORS},
            'newsletter': {'status': newsletter.get('status'), 'items': len(newsletter_items),
                           'matchedToRetail': len(newsletter_items) - len(unmatched_media),
                           'unidentifiedArticles': len(newsletter.get('unidentifiedArticles', [])),
                           'diagnostics': newsletter.get('diagnostics', [])},
            'instagram': {'status': instagram.get('status'), 'items': len(instagram.get('items', [])),
                          'matched': len(instagram.get('items', [])) - len(unmatched_sns),
                          'held': len(unmatched_sns), 'diagnostics': instagram.get('diagnostics', [])},
            'sns-trend-keywords': {'status': 'ok' if trends.get('keywords') else 'unavailable',
                                    'items': len(trends.get('keywords', [])),
                                    'acceptedIntoSeeds': len(trends.get('acceptedIntoSeeds', [])),
                                    'diagnostics': [trends.get('sourceStatus', {})]},
        },
        'isBaselineRun': run_is_baseline,
        'baselineSources': sorted(baseline_sources),
        'carriedForward': carried_sources,
        'photoSignals': photo_status,
        'modelGrouping': grouping_status,
        'audienceMerge': audience_status,
        'alreadyOfficial': official_status,
        'rereleasesExcluded': rereleases,
        'evergreenExcluded': evergreens,
        'excludedBrands': brand_status,
        'retiredSourcesDropped': len(retired),
        'modelsIndexed': len(model_index),
        'publishedRetail': len(published_retail),
        'publishedNewsletter': len(published_newsletter),
        'retailCollected': len(retail_items),
        'heldOutsideWindow': len(retail_items) - len(published_retail),
    }
    atomic_write_json(os.path.join(DATA, 'monthly-run-report.json'), report)

    baseline_note = (f" (baseline for {', '.join(sorted(baseline_sources))}: they publish from the next run)"
                     if baseline_sources else '')
    if carried_sources:
        baseline_note += (' (kept last run\'s items for blocked sources: '
                          + ', '.join(f'{k} x{v}' for k, v in sorted(carried_sources.items())) + ')')
    print(f'Weekly retail/newsletter update complete: {len(published_retail)} retail items + '
          f'{len(published_newsletter)} newsletter items published from {len(retail_items)} collected'
          f'{baseline_note}; '
          + ' '.join(f"{c['report']}={results[c['report']].get('status')}" for c in RETAIL_COLLECTORS)
          + f" newsletter={newsletter.get('status')} instagram={instagram.get('status')}")


if __name__ == '__main__':
    main()
