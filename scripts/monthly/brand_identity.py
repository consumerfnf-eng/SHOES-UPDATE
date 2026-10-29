"""One canonical brand name per brand, across every retailer and publisher.

The same sneaker is listed as "나이키" on Musinsa, "Nike" on SSENSE and
"NIKE" on 29CM. Left alone those are three brands: the sidebar filter splits
them, and the same shoe shows up as three separate cards instead of one.

Canonical names come from config/brand-policy.json - the list the official
catalog already uses - and Korean spellings from config/brand-aliases-ko.json,
whose main half is generated from Musinsa listings that carry both the Korean
name and the English slug for the same product.

A name that matches nothing is left exactly as the retailer wrote it. Guessing
a canonical brand from a partial match is how "On" ends up swallowing every
listing with the word "on" in it.
"""
import os
import re

from common import read_json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_CACHE = {}


def _key(value):
    """Fold a spelling to its letters and digits, in any script.

    Hangul has to survive this: stripping to [a-z0-9] turns every Korean
    brand name into the empty string, so they all collide on one key and the
    last one loaded wins - "푸마" resolved to HOKA before this was fixed.
    """
    folded = (value or '').lower()
    return ''.join(c for c in folded if c.isalnum())


def brand_index():
    """{normalised spelling -> canonical name}, built once per process."""
    if _CACHE:
        return _CACHE
    policy = read_json(os.path.join(ROOT, 'config', 'brand-policy.json'), {'brands': []})
    for entry in policy.get('brands', []):
        name = entry.get('name')
        if name and _key(name):
            _CACHE[_key(name)] = name
    known = set(_CACHE.values())
    aliases = read_json(os.path.join(ROOT, 'config', 'brand-aliases-ko.json'), {})
    for group in ('derived', 'manual'):
        for spelling, canonical in (aliases.get(group) or {}).items():
            if canonical in known and _key(spelling):
                _CACHE[_key(spelling)] = canonical
    # Sub-labels the retailers and the press write as standalone brands.
    for spelling, canonical in {'airjordan': 'Jordan', 'jordanbrand': 'Jordan', 'nikesb': 'Nike',
                                'adidasoriginals': 'adidas', 'newbalancenumeric': 'New Balance',
                                'thenorthface': 'The North Face', 'mm6': 'MM6 Maison Margiela'}.items():
        if canonical in known:
            _CACHE[spelling] = canonical
    return _CACHE


def canonical_brand(*spellings):
    """First spelling that resolves to a known brand, else the first non-empty
    one exactly as written."""
    index = brand_index()
    for spelling in spellings:
        folded = _key(spelling)
        if folded and folded in index:
            return index[folded]
    return next((s.strip() for s in spellings if s and s.strip()), '')
