"""Three rules that decide which of several listings of one shoe publishes.

Why
---
A single design reaches the retail run several times over, and each copy was
becoming its own card:

  1. the same shoe listed for men and for women. Jaclar's "페이스 로우 차콜
     그레이" arrived once under 남성 and once under 여성 with the same
     photograph; Discovery's 스무디 슬립온 did the same in three colours.
     One design is one card, and the women's listing is the one kept.

  2. a shoe the brand's own site already published. The official catalogue is
     the better record - it carries the brand's own photo, its style code and
     its release evidence - so a retailer's copy of the same shoe is dropped
     rather than shown twice.

  3. a model that has been on sale for years. A retailer's listing date is
     the date of *that listing*, so an evergreen line re-listed this week
     looks new however long it has been selling. Models named in
     config/evergreen-models.json never publish as new.

Each rule records what it removed on the surviving listing (`alsoListedAt`)
or in the run report, so nothing disappears without a trace.
"""
import os
import re

from brand_identity import canonical_brand
from common import read_json
from image_signals import colour_distance
from model_grouping import without_audience

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Latin audience words need boundaries - "men" lives inside "women" - while
# the Korean ones are unambiguous as plain substrings.
WOMEN_LATIN = re.compile(r"\b(?:women|womens|women's|female|ladies|wmns)\b", re.I)
MEN_LATIN = re.compile(r"\b(?:men|mens|men's|male)\b", re.I)
WOMEN_KO = ('여성', '여자')
MEN_KO = ('남성', '남자')


def audience(item):
    """'women', 'men' or '' for one listing.

    The title outranks the category the shop filed it under: 29CM lists
    fitflop's "남성 RTG 레이스 업 트레이너" inside a women's category, and the
    title is the one that names the shoe.
    """
    text = f"{item.get('name') or ''} {item.get('fullName') or ''}"
    said_women = bool(WOMEN_LATIN.search(text)) or any(w in text for w in WOMEN_KO)
    said_men = bool(MEN_LATIN.search(text)) or any(w in text for w in MEN_KO)
    if said_women and not said_men:
        return 'women'
    if said_men and not said_women:
        return 'men'
    gender = (item.get('gender') or '').lower()
    return gender if gender in ('men', 'women') else ''


def _fold(value):
    return ''.join(c for c in (value or '').lower() if c.isalnum())


COLOUR_SAME_SHOE = 40     # RGB distance under which two photos show one colour


def _colour_token(item):
    """The written colour, folded to letters and digits.

    The weakest of the three colour answers and the last one tried: it cannot
    tell 29CM's "BLACK" from the same shop's "블랙", which is why the colour
    read off the photograph is preferred over it.
    """
    return _fold(item.get('colorway'))


def _same_colour(a, b):
    """Whether two listings of one model are the same colourway.

    Three answers in order of reliability: the same photograph, then the
    colour read off each photo - which crosses the language barrier the
    colour *names* do not - then the written colour.
    """
    if a.get('photoHash') and a['photoHash'] == b.get('photoHash'):
        return True
    if a.get('bodyColor') and b.get('bodyColor'):
        return colour_distance(a['bodyColor'], b['bodyColor']) <= COLOUR_SAME_SHOE
    ca, cb = _colour_token(a), _colour_token(b)
    return bool(ca) and ca == cb


def prefer_women(items, status=None):
    """One design listed for both audiences publishes as the women's listing.

    Scoped to a single model group - the grouping is what establishes that two
    listings are the same shoe - and then to one colourway inside it. Both
    scopes matter:

      the group, because a brand's men's and women's lines rarely share a
      style code. Kizik files one shoe as SKZM261MATH and SKZF261WATH and
      Skechers as SP0MRCGX231 and SP0WRCGX263, so the codes can never match
      and only the model grouping knows they are one shoe.

      the colourway, because dropping every men's listing in the group would
      take a colour the women's line does not carry down with it. Colour is
      read off the photograph where possible, which is what crosses 29CM's
      "BLACK" against the same shop's "블랙".

    A men-only design is left alone: the rule removes a duplicate, not a
    category.
    """
    status = status if status is not None else {}
    by_group = {}
    for item in items:
        by_group.setdefault(item.get('modelGroupId') or f"id:{item['id']}", []).append(item)

    drop, dropped, kept_for_colour = set(), 0, 0
    for listings in by_group.values():
        womens = [i for i in listings if audience(i) == 'women']
        mens = [i for i in listings if audience(i) == 'men']
        if not womens or not mens:
            continue
        for item in mens:
            twin = next((w for w in womens if _same_colour(w, item)), None)
            if twin is None:
                kept_for_colour += 1
                continue
            twin.setdefault('alsoListedAt', []).append(
                {'source': item.get('source'), 'url': item.get('url'),
                 'priceLabel': item.get('priceLabel'), 'droppedAs': 'mens-duplicate'})
            drop.add(item['id'])
            dropped += 1
    status['mensDuplicatesDropped'] = status.get('mensDuplicatesDropped', 0) + dropped
    status['mensKeptAsOnlyColourway'] = status.get('mensKeptAsOnlyColourway', 0) + kept_for_colour
    return [i for i in items if i['id'] not in drop]


# --- rule 2: the brand's own catalogue outranks a retailer's copy ----------

COLOUR_ONLY_STYLE = None


def _colour_only(value):
    global COLOUR_ONLY_STYLE
    if COLOUR_ONLY_STYLE is None:
        data = read_json(os.path.join(ROOT, 'config', 'colour-words.json'), {})
        COLOUR_ONLY_STYLE = {_fold(w) for w in
                             (data.get('derived') or []) + (data.get('supplement') or []) if w}
    return _fold(value) in COLOUR_ONLY_STYLE


def _identity_keys(brand, name, style):
    """brand|model and style:<code>, folded the same way on both sides.

    A style field holding nothing but a colour name is not a style code -
    29CM files KEEN's 재스퍼 under "BLACK" and "SAFARI" - and matching on one
    would retire every black shoe the brand makes.
    """
    keys = []
    canonical = _fold(canonical_brand(brand))
    model = _fold(re.sub(r'\s+(?:running\s+)?(?:shoes?|sneakers?)$', '',
                         without_audience(name or ''), flags=re.I))
    if canonical and len(model) >= 4:
        keys.append(f'{canonical}|{model}')
    folded_style = _fold(style)
    if len(folded_style) >= 6 and not _colour_only(style):
        keys.append(f'style:{folded_style}')
    return keys


def official_identity_keys(catalog_path):
    """Every key the official catalogue already publishes under."""
    catalog = read_json(catalog_path, {})
    keys = set()
    for product in catalog.get('products') or []:
        keys.update(_identity_keys(product.get('brand'), product.get('name'), product.get('style')))
    return keys


def drop_already_official(items, official_keys, status=None):
    """A retailer's copy of a shoe the brand's own site published is dropped."""
    status = status if status is not None else {}
    if not official_keys:
        status['alreadyOfficialDropped'] = 0
        return items
    kept, dropped = [], []
    for item in items:
        keys = _identity_keys(item.get('brand'), item.get('name'), item.get('style'))
        hit = next((k for k in keys if k in official_keys), '')
        if hit:
            dropped.append({'id': item['id'], 'brand': item.get('brand'),
                            'name': item.get('name'), 'matchedOn': hit})
            continue
        kept.append(item)
    status['alreadyOfficialDropped'] = len(dropped)
    status['alreadyOfficialExamples'] = dropped[:20]
    return kept


# --- brands that must not appear at all -----------------------------------

def excluded_brand_keys():
    """Every spelling of a brand that must not publish, folded.

    The official catalogue answers this through config/brand-policy.json: a
    brand with no entry there is never collected. The retail run publishes
    what the shops list, so without this it had no lever - removing Oakley
    Factory Team from the brand policy left 29CM free to keep listing it.
    """
    data = read_json(os.path.join(ROOT, 'config', 'excluded-brands.json'), {})
    keys = set()
    for entry in data.get('brands') or []:
        for spelling in [entry.get('name'), *(entry.get('spellings') or [])]:
            if not spelling:
                continue
            keys.add(_fold(spelling))
            keys.add(_fold(canonical_brand(spelling)))
    return {k for k in keys if k}


def drop_excluded_brands(items, keys, status=None):
    """Listings of a removed brand, in any of its spellings."""
    status = status if status is not None else {}
    if not keys:
        status['excludedBrandDropped'] = 0
        return items
    def excluded(item):
        return any(_fold(value) in keys for value in
                   (item.get('brand'), item.get('brandKo'), item.get('brandAsListed'),
                    canonical_brand(item.get('brand') or '')) if value)
    kept = [i for i in items if not excluded(i)]
    status['excludedBrandDropped'] = len(items) - len(kept)
    return kept


# --- rule 3: lines that are never new -------------------------------------

def evergreen_keys():
    """Models that have been on sale for years, read from config."""
    data = read_json(os.path.join(ROOT, 'config', 'evergreen-models.json'), {})
    keys = set()
    for entry in data.get('models') or []:
        brand = _fold(canonical_brand(entry.get('brand')))
        for spelling in entry.get('names') or []:
            words = _name_tokens(without_audience(spelling))
            joined = ''.join(words)
            # Two syllables is a whole model name in Korean - 가젤, 삼바, 트랙 -
            # so the minimum length has to follow the script rather than the
            # character count the latin spellings need.
            floor = 2 if any('가' <= c <= '힣' for c in joined) else 3
            if brand and words and len(joined) >= floor:
                keys.add(f"{brand}|{' '.join(words)}")
        for style in entry.get('styles') or []:
            if len(_fold(style)) >= 6:
                keys.add(f'style:{_fold(style)}')
    return keys


def _name_tokens(text):
    """The title's words, folded, with the separators the shops use removed.

    Token-level matching, not substring: folded to one string, "530" lives
    inside "1530" and inside half the style codes, which would retire shoes
    the entry never named.
    """
    return [t for t in (_fold(part) for part in re.split(r'[^0-9A-Za-z가-힣]+', text or '')) if t]


def _contains_sequence(haystack, needle):
    if not needle or len(needle) > len(haystack):
        return False
    return any(haystack[i:i + len(needle)] == needle
               for i in range(len(haystack) - len(needle) + 1))


def is_evergreen(item, keys):
    """True when this listing names a model that is never a new release.

    The entry's words have to appear in the title as consecutive words, so
    "Speed 2.0 Sneakers", "스피드 2.0" and "Speed 2.0 Black" all answer to the
    one Balenciaga entry while "Speedcat" does not.
    """
    if not keys:
        return False
    brand = _fold(canonical_brand(item.get('brand')))
    style = _fold(item.get('style'))
    if len(style) >= 6 and f'style:{style}' in keys:
        return True
    titles = [_name_tokens(without_audience(item.get('name') or '')),
              _name_tokens(without_audience(item.get('fullName') or ''))]
    for key in keys:
        if key.startswith('style:') or not key.startswith(f'{brand}|'):
            continue
        model = key.split('|', 1)[1].split(' ')
        if any(_contains_sequence(title, model) for title in titles if title):
            return True
    return False
