"""Put one shoe on one card when the retailer wrote the colour into its name.

The problem
-----------
Korean retailers often name a listing "<model> <colour> (<style code>)":

    OLLA 양털슬립온 실브라운 (K3708240SD-W)
    OLLA 양털슬립온 히커리 II (K3708220SD-W)
    OLLA 양털슬립온 초콜릿 (K3708205SD-W)
    OLLA 양털슬립온 블랙 II (K3708011SD-W)

Nothing in those records says "실브라운" is a colour - the colour field is
empty - so each became its own card instead of one card with four chips.
The same shoe sold by a second retailer made it worse: two listings of one
colourway, two near-identical photos, two chips.

The rule
--------
Within one brand, listings that share a token prefix and differ only by
something that cannot be a model identifier are the same model. "Cannot be
a model identifier" means the remainder, once bracketed groups, trailing
style codes and heel-height tokens are removed, is either empty (the
listings differed only by a code, as in PUMA's "(40612702)" vs
"(40612701)") or made entirely of known colour words.

A bare number or a version token blocks the merge, which is what keeps
"Air Max 90" and "Air Max 95" apart - they share a prefix and differ by one
short token, exactly like a colour pair, and only the remainder's shape
tells them apart. The longest qualifying prefix wins, so a more specific
model never dissolves into a shorter one.
"""
import os
import re
from collections import defaultdict

from common import read_json
from footwear_scope import EXCLUDE_EN, EXCLUDE_KO, SNEAKER_EN, SNEAKER_KO

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_WORDS = None

MIN_PREFIX_TOKENS = 2
MIN_PREFIX_CHARS = 6
MAX_REMAINDER_TOKENS = 4

BRACKETED = re.compile(r'[\(\[\{][^\)\]\}]*[\)\]\}]')
TRAILING_CODE = re.compile(r'[-_/]?\b[A-Z0-9]{2,}[-_][A-Z0-9]+\b|\b[A-Z]{1,4}\d{3,}[A-Z0-9-]*\b')
HEIGHT = re.compile(r'\b\d+(?:\.\d+)?\s*(?:cm|mm|inch|호)\b', re.I)
# A token that identifies a model rather than a colour: a bare number, a
# version marker, or a number glued to a short suffix (90, v2, 1906, 9060).
MODEL_TOKEN = re.compile(r'^(?:v\d+|\d+(?:\.\d+)?|\d+[a-z]{0,2}|[ivx]+)$', re.I)
PUNCT = re.compile(r'[^0-9A-Za-z가-힣]+')


def colour_words():
    global _WORDS
    if _WORDS is not None:
        return _WORDS
    data = read_json(os.path.join(ROOT, 'config', 'colour-words.json'), {})
    _WORDS = {w.lower() for w in (data.get('derived') or []) + (data.get('supplement') or []) if w}
    return _WORDS


def tokens(text):
    return [t for t in re.split(r'\s+', (text or '').strip()) if t]


HANGUL_TOKEN = re.compile(r'^[가-힣]+$')


def names_a_silhouette(token):
    """True when the token says what kind of shoe this is.

    29CM writes GEOX's variants as "<model> 여성 스니커즈-그레이지" and
    "<model> 여성 슬립온-골드". Both tails end in a shade, so both read as
    colour-only and a sneaker merged with a slip-on onto one card. A word
    that names the silhouette is the shoe's identity, never its colour.
    """
    return bool(SNEAKER_KO.search(token) or EXCLUDE_KO.search(token)
                or SNEAKER_EN.search(token) or EXCLUDE_EN.search(token))


def is_colour_token(token):
    """A token that names a colour, by itself or as part of a compound.

    Compounds are read differently by script, because the two languages glue
    words together differently. Korean runs them into one token - 실브라운,
    화이트아이보리 - so any known shade inside the token makes it a colour.
    English separates them, and the only compound that survives punctuation
    stripping is a two-word one ("off-white" -> "offwhite"), so Latin tokens
    are matched whole or split into exactly two known words. Accepting any
    Latin substring instead, which is what this did first, made a colour out
    of every token containing one: "star" matched "starter", "ink" matched
    "link", "tea" matched "instead", and unrelated models merged.
    """
    folded = PUNCT.sub('', token.lower())
    if not folded:
        return True
    if MODEL_TOKEN.match(folded):
        return False
    if names_a_silhouette(token):
        return False
    words = colour_words()
    if folded in words:
        return True
    if HANGUL_TOKEN.match(folded):
        return any(w in folded for w in words if len(w) >= 2 and HANGUL_TOKEN.match(w))
    return any(folded[:i] in words and folded[i:] in words
               for i in range(2, len(folded) - 1))


def remainder_is_colour_only(remainder):
    """True when the remainder cannot be a model identifier.

    Position matters. A bare "90" after "Air Max" is a model; the "II" in
    "히커리 II" and "블랙 II" is part of the shade, because a colour word
    comes immediately before it. So a model-shaped token is accepted only
    when it trails a colour.
    """
    stripped = HEIGHT.sub(' ', BRACKETED.sub(' ', remainder or ''))
    stripped = TRAILING_CODE.sub(' ', stripped)
    parts = [t for t in tokens(stripped) if PUNCT.sub('', t)]
    if not parts:
        return True                       # the listings differed only by a code
    if len(parts) > MAX_REMAINDER_TOKENS:
        return False
    previous_was_colour = False
    for token in parts:
        if is_colour_token(token):
            previous_was_colour = True
            continue
        if previous_was_colour and MODEL_TOKEN.match(PUNCT.sub('', token.lower())):
            continue                      # "히커리 II" - a shade, not a model
        return False
    return True


def colour_from_remainder(remainder):
    """The human-readable colour hidden in the remainder, or ''."""
    stripped = HEIGHT.sub(' ', TRAILING_CODE.sub(' ', remainder or ''))
    inner = ' '.join(BRACKETED.findall(stripped))
    outer = BRACKETED.sub(' ', stripped)
    for candidate in (outer, inner):
        parts = [t for t in tokens(candidate) if PUNCT.sub('', t)]
        words, previous_was_colour = [], False
        for token in parts:
            if is_colour_token(token):
                words.append(token)
                previous_was_colour = True
            elif previous_was_colour and MODEL_TOKEN.match(PUNCT.sub('', token.lower())):
                words.append(token)       # keep the "II" of "히커리 II"
            else:
                previous_was_colour = False
        if words:
            return ' '.join(words).strip(' -_/()[]')
    return ''


def _brand_key(item):
    return PUNCT.sub('', (item.get('brand') or '').lower())


def assign_model_groups(items, status=None):
    """Give every listing of one model the same `modelGroupId`.

    Also fills in a colourway when the colour was only ever written into the
    product name, which is what lets those listings become chips instead of
    separate cards.
    """
    status = status if status is not None else {}
    by_brand = defaultdict(list)
    for item in items:
        if _brand_key(item):
            by_brand[_brand_key(item)].append(item)

    grouped, coloured = 0, 0
    for brand, listings in by_brand.items():
        # Candidate prefixes, longest first, so the most specific model wins.
        candidates = defaultdict(list)
        for item in listings:
            parts = tokens(item.get('name'))
            for size in range(len(parts) - 1, MIN_PREFIX_TOKENS - 1, -1):
                prefix = ' '.join(parts[:size])
                if len(PUNCT.sub('', prefix)) >= MIN_PREFIX_CHARS:
                    candidates[prefix].append(item)

        taken = set()
        for prefix in sorted(candidates, key=lambda p: (-len(tokens(p)), -len(p))):
            members = [m for m in candidates[prefix] if id(m) not in taken]
            if len(members) < 2:
                continue
            size = len(tokens(prefix))
            remainders = [' '.join(tokens(m.get('name'))[size:]) for m in members]
            if not all(remainder_is_colour_only(r) for r in remainders):
                continue
            # Two listings whose remainders are identical are not a colour
            # pair; leave them to the photo-duplicate step.
            if len({r.strip().lower() for r in remainders}) < 2:
                continue
            group_id = f'{brand}|{PUNCT.sub("", prefix.lower())}'
            for member, remainder in zip(members, remainders):
                taken.add(id(member))
                member['modelGroupId'] = group_id
                member['modelName'] = prefix
                grouped += 1
                if not (member.get('colorway') or '').strip():
                    found = colour_from_remainder(remainder)
                    if found:
                        member['colorway'] = found
                        member['colorwayFrom'] = 'product-name'
                        coloured += 1
    status['modelGroupsAssigned'] = grouped
    status['colourwaysRecoveredFromName'] = coloured
    return items
