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

The second rule: style codes
----------------------------
A dictionary of colour words cannot keep up with what retailers write.
fitflop names its trainer's shades 그레이 세이지, 카푸치노 and 스파이스드
에프리콧; two of those are in no vocabulary, and because the first rule
needs *every* listing's remainder to be colour-only, one unknown shade kept
the whole model split into four cards.

The manufacturer already answered the question, in the style code:

    여성 네오D 하이커 패디드 트레이너  그레이 세이지 (FT69K2N51H)
    여성 네오D 하이커 패디드 트레이너  카푸치노      (FT69K2N51A)
    여성 네오D 하이커 패디드 트레이너  블랙          (FT69K2N515)

    NBPDGF762C   NBPDGF762T

Codes of equal length sharing every character but the last are one model in
two colourways - that is what the trailing position of a style code is for.
It needs no vocabulary and no language, so it also catches the listings
whose whole name is the code. Whatever word is left over is then a colour
by construction, which is how 카푸치노 gets recognised at all.
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
TRAILING_CODE = re.compile(
    r'[-_/]?\b[A-Z0-9]{2,}[-_][A-Z0-9]+\b'           # KI-2208, SP0WRCGX-251
    r'|\b[A-Z]{1,4}\d{3,}[A-Z0-9-]*\b'               # IF6490, KI2971
    # AF2D01051, SP0MWCGX211: letters and digits interleaved, which is
    # most Korean retailers' SKU. ASH's listings arrive from the
    # collector with the bracket left open, so it is optional here.
    r'|\(?\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\b\)?')
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
    """The words of a title.

    An underscore separates as surely as a space: NATIVE writes
    "제퍼슨_웨이브" and Skechers "플렉스(슬립인스)_SP0MWCGX211". Read as one
    token each, the colour and the code can never be seen.
    """
    return [t for t in re.split(r'[\s_]+', (text or '').strip()) if t]


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


# A style code at the end of a listing title, bracketed or bare. Six
# characters is the shortest that is a code rather than a size or a year.
NAME_CODE = re.compile(
    r'[\(\[]\s*([A-Za-z0-9][A-Za-z0-9\-_/]{4,})\s*[\)\]]?\s*$'
    # A bare code at the end, after a space or an underscore. ASH's
    # listings reach us with the bracket open - "... (AF2D01051" - and
    # Skechers joins the code on with an underscore.
    r'|(?:^|[\s_(])([A-Za-z0-9]{6,})\s*$')
MIN_CODE_CHARS = 6
MAX_COLOUR_SUFFIX = 2     # how much of a code may be the colour position


def name_code(item):
    """The style code a listing's title ends with, normalised, or ''.

    Both a letter and a digit are required: "SNEAKERS" is the end of a
    title and "AF2D01051" is a reference to one shoe in one colour.
    """
    found = NAME_CODE.search((item.get('name') or '').strip())
    if not found:
        return ''
    code = re.sub(r'[^A-Za-z0-9]', '', found.group(1) or found.group(2) or '').upper()
    if len(code) < MIN_CODE_CHARS:
        return ''
    return code if any(c.isdigit() for c in code) and any(c.isalpha() for c in code) else ''


def name_without_code(item):
    """The title with its trailing style code removed."""
    return NAME_CODE.sub(' ', (item.get('name') or '').strip()).strip()


def shared_prefix(names):
    """The leading tokens every name has in common."""
    split = [tokens(n) for n in names]
    prefix = []
    for column in zip(*split):
        if len(set(column)) != 1:
            break
        prefix.append(column[0])
    return ' '.join(prefix)


def code_groups(listings):
    """Listings of one brand whose style codes differ only in their last
    character or two - the position a manufacturer puts the colour in.

    Codes of different lengths are never compared: "ABC123" and "ABC1234"
    share a stem without sharing a model.
    """
    by_stem = defaultdict(list)
    for item in listings:
        code = name_code(item)
        if not code:
            continue
        for cut in range(1, MAX_COLOUR_SUFFIX + 1):
            if len(code) - cut >= MIN_CODE_CHARS - 1:
                by_stem[(len(code), code[:-cut])].append((item, code))
    seen, groups = set(), []
    for (_, stem), members in sorted(by_stem.items(), key=lambda kv: -len(kv[0][1])):
        fresh = [(i, c) for i, c in members if id(i) not in seen]
        if len(fresh) < 2 or len({c for _, c in fresh}) < 2:
            continue
        for prefix, chosen in _by_title(fresh):
            for item, _ in chosen:
                seen.add(id(item))
            bodies = [name_without_code(i) for i, _ in chosen]
            size = len(tokens(prefix))
            groups.append((stem, prefix, [(i, ' '.join(tokens(b)[size:]))
                                          for (i, _), b in zip(chosen, bodies)]))
    return groups


def _by_title(members):
    """Split one code stem into the products its titles actually describe.

    Sharing a stem is not enough on its own. fitflop numbers the metallic
    version of a trainer in the same block as the plain one, so
    "...패디드 트레이너 블랙" and "...패디드 메탈릭 트레이너 실버" share
    FT69K2N51 while differing by a word in the middle that is not a colour.
    Taken as one group their common prefix stops early and every colour chip
    inherits the leftover "트레이너". Grouped by title instead, the four
    plain shades become one card and the metallic one stands on its own.

    No colour vocabulary is consulted here: the code already established
    that siblings differ by colour, so an unrecognised shade is fine. Only a
    model identifier or another silhouette can break a title apart.
    """
    candidates = defaultdict(list)
    for item, code in members:
        parts = tokens(name_without_code(item))
        for size in range(len(parts), -1, -1):
            candidates[' '.join(parts[:size])].append((item, code))
    taken, out = set(), []
    for prefix in sorted(candidates, key=lambda p: (-len(tokens(p)), -len(p))):
        chosen = [(i, c) for i, c in candidates[prefix] if id(i) not in taken]
        if len(chosen) < 2 or len({c for _, c in chosen}) < 2:
            continue
        size = len(tokens(prefix))
        remainders = [' '.join(tokens(name_without_code(i))[size:]) for i, _ in chosen]
        # A prefix too short to name a model is allowed only when there is
        # no model name to find: New Balance's Korean listings are called
        # "NBPDGF762C" and nothing else, so the code is the whole title.
        if (len(tokens(prefix)) < MIN_PREFIX_TOKENS
                or len(PUNCT.sub('', prefix)) < MIN_PREFIX_CHARS):
            if not all(remainder_is_colour_only(r) for r in remainders):
                continue
        if any(MODEL_TOKEN.match(PUNCT.sub('', t.lower()))
               for r in remainders for t in tokens(HEIGHT.sub(' ', r))):
            continue
        if any(names_a_silhouette(r) for r in remainders):
            continue
        # No requirement that the leftovers differ, unlike the word rule:
        # the codes already do, and when the title *is* the code there is
        # nothing left over at all ("NBPDGF762C" and "NBPDGF762T").
        for i, _ in chosen:
            taken.add(id(i))
        out.append((prefix, chosen))
    return out


def trimmed(remainder):
    """The remainder as a label, with brackets, codes and heights gone.

    colour_from_remainder returns only words it recognises. When the style
    code has already established that two listings are one model, the words
    it did not recognise are the colour anyway - 카푸치노 is in no
    vocabulary and is still what tells that listing from its siblings.
    """
    stripped = HEIGHT.sub(' ', BRACKETED.sub(' ', remainder or ''))
    stripped = TRAILING_CODE.sub(' ', stripped)
    return ' '.join(tokens(stripped)).strip(' -_/()[]')


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

    grouped, coloured, by_code = 0, 0, 0
    for brand, listings in by_brand.items():
        # The manufacturer's own answer first: a shared style-code stem is
        # not a guess about language, so it outranks the word rule and takes
        # its members out of the running before prefixes are considered.
        taken = set()
        for stem, prefix, members in code_groups(listings):
            # The model's name is its identity; the code only found it. Two
            # code blocks of one model - adidas numbers the 핸드볼 스페지알
            # across KI2970, KK0932 and KZ6705 - therefore land on the same
            # key, and so do a code group and a word group of the same name.
            # Only a listing with no name to share falls back to the stem:
            # New Balance's "NBPDGF762C" is a code and nothing else.
            named = PUNCT.sub('', prefix.lower())
            group_id = f'{brand}|{named}' if named else f'{brand}|code:{stem.lower()}'
            for item, remainder in members:
                taken.add(id(item))
                item['modelGroupId'] = group_id
                item['modelName'] = prefix or item.get('modelName') or ''
                grouped += 1
                by_code += 1
                if not (item.get('colorway') or '').strip():
                    # The code says these differ only by colour, so whatever
                    # the title has left over is the colour - no vocabulary
                    # needed, which is the point.
                    found = colour_from_remainder(remainder) or trimmed(remainder)
                    if found:
                        item['colorway'] = found
                        item['colorwayFrom'] = 'style-code-sibling'
                        coloured += 1

        # Candidate prefixes, longest first, so the most specific model wins.
        candidates = defaultdict(list)
        for item in listings:
            parts = tokens(item.get('name'))
            # `len(parts)` included: adidas lists four colourways of the
            # 핸드볼 스페지알 under that name exactly and a fifth as
            # "핸드볼 스페지알 IF6490". Stopping one token short of the title
            # left the plain ones unable to join their own model.
            for size in range(len(parts), MIN_PREFIX_TOKENS - 1, -1):
                prefix = ' '.join(parts[:size])
                if len(PUNCT.sub('', prefix)) >= MIN_PREFIX_CHARS:
                    candidates[prefix].append(item)

        for prefix in sorted(candidates, key=lambda p: (-len(tokens(p)), -len(p))):
            members = [m for m in candidates[prefix] if id(m) not in taken]
            if len(members) < 2:
                continue
            size = len(tokens(prefix))
            # The members that qualify, not all-or-nothing. adidas lists the
            # 핸드볼 스페지알 in four colourways, a Low Pro and a Bold; under
            # the old rule "로 프로" disqualified the whole prefix and all six
            # stayed apart. The two that are their own models still do.
            pairs = [(m, ' '.join(tokens(m.get('name'))[size:])) for m in members]
            pairs = [(m, r) for m, r in pairs if remainder_is_colour_only(r)]
            if len(pairs) < 2:
                continue
            members = [m for m, _ in pairs]
            remainders = [r for _, r in pairs]
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
    status['groupedByStyleCode'] = by_code
    status['colourwaysRecoveredFromName'] = coloured
    return items
