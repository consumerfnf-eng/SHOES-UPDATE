"""Widen a trend hashtag into the terms that actually appear in product names.

A Korean hashtag has to reach English listings and the other way round:
#발레스니커즈 must find "Ballet Sneakers", #gorpcore must find 고프코어 items,
#스피드캣 must find "Speedcat". Without this a Korean keyword matched nothing
in an English-language retail feed, and an English one matched nothing in a
Korean one.

Two sources, neither duplicated here:
  config/shoe-term-synonyms.json  - the shoe vocabulary
  config/brand-aliases-ko.json    - brand spellings, shared with the
                                    newsletter collector's brand matching

A hashtag is one run-on word ("발레스니커즈"), so expansion also looks for
known terms *inside* it, not only as the whole string.
"""
import os
import re

from common import read_json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_GROUPS = None
_GENERIC = None
# Two characters is meaningful in Hangul ("뮬") but not in Latin: "on" for
# the brand On matched Cloudmonster, cotton and 1,094 other items.
MIN_TERM_HANGUL = 2
MIN_TERM_LATIN = 3


def long_enough(term):
    if not term:
        return False
    hangul = any('가' <= c <= '힣' for c in term)
    return len(term) >= (MIN_TERM_HANGUL if hangul else MIN_TERM_LATIN)


def fold(value):
    """Letters and digits of any script, lowercased.

    Must not use NFKD: it decomposes Hangul syllables into Jamo, which then
    fall outside the syllable range and vanish, so every Korean term folded
    to the empty string.
    """
    return ''.join(c for c in (value or '').lower() if c.isalnum())


def generic_terms():
    """Words that describe the whole category, not one shoe.

    "스니커즈" and "sneaker" belong to every sneaker listing there is, so
    letting a keyword expand into them made every keyword match every item -
    3,695 of 3,925 items matched three or more keywords before this. They are
    only used when a keyword has nothing more specific.
    """
    global _GENERIC
    if _GENERIC is not None:
        return _GENERIC
    data = read_json(os.path.join(ROOT, 'config', 'shoe-term-synonyms.json'), {})
    _GENERIC = {fold(t) for group in data.get('generic', []) for t in group if fold(t)}
    return _GENERIC


def synonym_groups():
    """[{folded spelling, ...}, ...] - one set per meaning."""
    global _GROUPS
    if _GROUPS is not None:
        return _GROUPS
    groups = []
    data = read_json(os.path.join(ROOT, 'config', 'shoe-term-synonyms.json'), {'groups': []})
    for group in data.get('groups', []):
        folded = {fold(term) for term in group if fold(term)}
        if len(folded) > 1:
            groups.append(folded)
    aliases = read_json(os.path.join(ROOT, 'config', 'brand-aliases-ko.json'), {})
    by_brand = {}
    for part in ('derived', 'manual'):
        for spelling, canonical in (aliases.get(part) or {}).items():
            by_brand.setdefault(canonical, set()).update({fold(spelling), fold(canonical)})
    for spellings in by_brand.values():
        folded = {s for s in spellings if s}
        if len(folded) > 1:
            groups.append(folded)
    _GROUPS = groups
    return _GROUPS


def expand(*phrases):
    """Every term worth matching on, for this hashtag and its related words.

    Returns folded terms only - the caller compares against folded product
    text. Two things are dropped: terms under two characters, which match
    most of the catalogue, and category-wide words like "스니커즈" whenever
    the keyword has something specific to offer instead. A keyword left with
    nothing but category words returns [] - it cannot tell one shoe from
    another, so it should not pretend to.
    """
    return sorted({t for group in expand_groups(*phrases) for t in group})


def expand_groups(*phrases):
    """Match terms as groups: alternatives inside one, requirements across.

    "나이키 러닝화" is two ideas, not one list. Flattening them into a single
    OR-list matched every Nike shoe and every running shoe - 781 items. As
    groups it means Nike AND running, which is what the hashtag says.
    """
    seeds = {fold(p) for p in phrases if fold(p)}
    groups, covered = [], set()
    for group in synonym_groups():
        hit = {m for m in group if long_enough(m) and any(m in seed for seed in seeds)}
        if not hit:
            continue
        alternatives = {m for m in group if long_enough(m)}
        if alternatives - generic_terms():
            groups.append(sorted(alternatives - generic_terms()))
            covered |= {m for m in hit}
    # Whatever the hashtag says that no group explained - as long as it is not
    # simply a category word - stands as its own requirement.
    for seed in seeds:
        if not long_enough(seed) or seed in generic_terms():
            continue
        remainder = seed
        for term in sorted(covered | generic_terms(), key=len, reverse=True):
            remainder = remainder.replace(term, '')
        if long_enough(remainder) and remainder not in generic_terms():
            groups.append([seed])
    # A hashtag made only of category and audience words - "스니커즈추천",
    # "남자스니커즈" - describes no particular shoe, so it gets no terms at
    # all rather than a requirement nothing can satisfy.
    return [g for g in groups if g]
