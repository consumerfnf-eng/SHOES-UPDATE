"""Shared footwear scope for the weekly retail/newsletter collectors.

The publication scope is fixed by public/assets/footwear-policy.mjs:
sneaker, ballet-sneaker, mary-jane-sneaker, mule-sneaker, jelly, platform,
clog, slipper, loafer, sandal. Court/running/skate sneakers and the
sneaker-soled hybrids count, and so do flat loafers, clogs, slides, thongs,
slippers and platform sandals. Dress footwear - oxfords, derbies, brogues,
heels, pumps, slingbacks, boots - does not.

Every rule here reads only a listing's own title and its retailer category
label - the two things every source in this pipeline actually provides. A
title that proves nothing returns ('', reason); the caller drops it rather
than guessing a category, mirroring the main catalog's evidence gates.
"""
import re

from common import COLOR_WORDS

COLOUR_NAMES = set(COLOR_WORDS)

# --- hard exclusions -------------------------------------------------------
# Checked before any inclusion rule: these words describe the shoe's own
# construction, so a "platform loafer" is a loafer, not a platform sneaker.
# Loafers, clogs, slides, thongs and slippers were on this list and are now
# asked for by name, so they moved to the inclusions below. What is left is
# dress and heeled footwear and boots - shapes nobody has asked for. A heeled
# loafer is still caught here, by its heel.
EXCLUDE_EN = re.compile(
    r'\b(?:oxfords?|derbys?|derbies|brogues?|monk ?straps?|boat shoes?|'
    r'heels?|heeled|pumps?|stilettos?|slingbacks?|kitten ?heels?|'
    r'boots?|booties?|ankle ?boots?|chelsea)\b', re.I)
EXCLUDE_KO = re.compile(
    r'옥스포드|옥스퍼드|더비|브로그|몽크|보트\s?슈즈|구두|'
    r'힐|펌프스|하이힐|웨지힐|킬힐|슬링백|'
    r'부츠|부티|워커|첼시')
# A strappy summer sandal is still not in scope; a platform one is, and is
# matched by the inclusion rule below before this gets a say.
EXCLUDE_SOFT = re.compile(r'\b(?:sandals?)\b|샌들', re.I)

# Shapes that are in scope on their own, without the title having to say
# sneaker. Checked before EXCLUDE_SOFT so 통굽 샌들 is kept while a plain
# strappy sandal is not.
OTHER_SHAPES = (
    ('loafer', re.compile(r'\b(?:loafers?|moccasins?|mocassins?|penny loafers?|driving shoes?)\b'
                          r'|로퍼|블로퍼|모카신', re.I)),
    ('clog', re.compile(r'\b(?:clogs?)\b|클로그', re.I)),
    ('slipper', re.compile(r'\b(?:thongs?|flip[- ]?flops?|slides?|slippers?)\b'
                           r'|쪼리|조리|플립플랍|슬리퍼|슬라이드|실내화', re.I)),
    ('sandal', re.compile(r'(?:\bplatform\b[^|]{0,20}\bsandals?\b)|통굽[^|]{0,6}샌들|플랫폼[^|]{0,6}샌들', re.I)),
)

# --- inclusions ------------------------------------------------------------
SNEAKER_EN = re.compile(
    r'\b(?:sneakers?|trainers?|runners?|running shoes?|skate shoes?|court shoes?|'
    r'tennis shoes?|basketball shoes?|high[- ]?tops?|low[- ]?tops?|slip[- ]?ons?|'
    r'plimsolls?|kicks)\b', re.I)
SNEAKER_KO = re.compile(
    r'스니커|운동화|러닝화|러닝\s?슈즈|트레이닝화|트레일화|피트니스화|훈련화|농구화|테니스화|'
    r'배드민턴화|배구화|탁구화|스케이트화|스케이트보드화|슬립온|캔버스화|단화|워킹화|라이프스타일화')

BALLET = re.compile(r'\b(?:ballet|ballerinas?)\b|발레리나|발레', re.I)
MARY_JANE = re.compile(r'\bmary[ -]?janes?\b|메리제인|메리 제인', re.I)
MULE = re.compile(r'\bmules?\b|뮬', re.I)
JELLY = re.compile(r'\bjell(?:y|ies)\b|젤리', re.I)
PLATFORM = re.compile(r'\bplatform\b|플랫폼|통굽', re.I)

KIDS = re.compile(
    r'\b(?:kids?|baby|toddler|infant|junior|youth|little\s*kids?|big\s*kids?|'
    r'grade\s*school|pre-?school)\b|\((?:gs|ps|td)\)|키즈|아동|주니어|유아|베이비|어린이', re.I)


def names_other_shape(text):
    """True when the text names a shape that is in scope on its own.

    These words used to sit in the hard exclusions, and the colour reader
    asked that list whether a token was a silhouette. Moving them here made
    "로퍼-블랙" read as a shade, which merges a loafer onto a sneaker's card.
    A word that says what kind of shoe this is is never its colour.
    """
    text = text or ''
    return bool(EXCLUDE_SOFT.search(text)) or any(p.search(text) for _, p in OTHER_SHAPES)


def is_kids(*texts):
    return bool(KIDS.search(' '.join(t or '' for t in texts)))


def classify(title, retailer_category=''):
    """Return (category, types, reason).

    category: the main catalog's own value ('sneaker' | 'hybrid' | 'jelly' |
              'platform-shoe'), or '' when the title is not in scope.
    types:    the display types from footwear-policy.mjs's FOOTWEAR_TYPES.
    reason:   why it was dropped, for the run diagnostics.

    `retailer_category` is the retailer's own category label for the listing
    (e.g. Musinsa's "스니커즈 뮬", SSENSE's "sneakers"). A retailer filing an
    item under its sneakers category is the same kind of claim as the
    official feeds' `productType` field the main catalog already trusts, so
    the label counts as sneaker evidence in its own right.

    It does not, however, get to overrule the product's own title. Retailers
    mis-file constantly - Musinsa's 스니커즈 category carries "키높이 페니로퍼" -
    so when the *title* names an excluded silhouette, only the *title* can
    clear it ("Mule Sneakers" stays, "페니로퍼" goes), no matter what category
    it was filed under.
    """
    title = title or ''
    label = retailer_category or ''
    text = f'{title} {label}'
    if is_kids(text):
        return '', [], 'kids'

    ballet, mary_jane, mule = BALLET.search(text), MARY_JANE.search(text), MULE.search(text)
    jelly, platform = JELLY.search(text), PLATFORM.search(text)
    sneaker_in_title = bool(SNEAKER_EN.search(title) or SNEAKER_KO.search(title))
    sneaker = sneaker_in_title or bool(SNEAKER_EN.search(label) or SNEAKER_KO.search(label))

    # A hard-excluded silhouette in the title wins over every inclusion word:
    # "platform loafer", "ballet flat with heel", "mule pump" are all out.
    if EXCLUDE_EN.search(title) or EXCLUDE_KO.search(title):
        if not sneaker_in_title:
            return '', [], 'excluded-silhouette'
    elif EXCLUDE_EN.search(label) or EXCLUDE_KO.search(label):
        # The exclusion is only in the shelf name (e.g. 뮬/슬리퍼): the title
        # still has to show this particular item is a sneaker.
        if not sneaker_in_title:
            return '', [], 'excluded-silhouette'
    # Shapes that stand on their own: a loafer does not have to call itself a
    # sneaker to be a loafer. Checked before the sandal rule so 통굽 샌들 is
    # kept while a plain strappy one is not.
    # A title that calls itself a sneaker keeps its sneaker reading, whatever
    # shelf it sits on: Musinsa files "바이커 뮬 스니커즈" under 뮬/슬리퍼, and it
    # is a mule sneaker, not a slipper. Only a title making no sneaker claim
    # falls through to these shapes.
    for shape, pattern in (() if sneaker_in_title else OTHER_SHAPES):
        if pattern.search(title) or (pattern.search(label)
                                     and not EXCLUDE_EN.search(title)
                                     and not EXCLUDE_KO.search(title)):
            if shape == 'sandal':
                return 'platform-sandal', ['sandal', 'platform'], ''
            if shape == 'slipper':
                return ('platform-slipper' if platform else 'slipper'), ['slipper'] + (['platform'] if platform else []), ''
            return shape, [shape] + (['platform'] if platform else []), ''

    if EXCLUDE_SOFT.search(title) and not sneaker_in_title:
        return '', [], 'sandal-or-clog'
    if EXCLUDE_SOFT.search(label) and not sneaker_in_title and not jelly:
        return '', [], 'sandal-or-clog'

    types = []
    if jelly:
        # Jelly shoes are in scope as their own type; the main catalog also
        # requires a flat/sneaker construction before publishing one.
        if not (sneaker or PLATFORM.search(text) or re.search(r'\bflats?\b|플랫', text, re.I)):
            return '', [], 'jelly-structure-unverified'
        types.append('jelly')
        if platform:
            types.append('platform')
        return 'jelly', types, ''

    if not sneaker:
        # Ballet/Mary Jane/mule/platform alone is a dress shoe unless the
        # listing also carries a sneaker claim - never assume one.
        return '', [], 'no-sneaker-evidence'

    types.append('sneaker')
    hybrid = False
    if ballet:
        types.append('ballet-sneaker'); hybrid = True
    if mary_jane:
        types.append('mary-jane-sneaker'); hybrid = True
    if mule:
        types.append('mule-sneaker'); hybrid = True
    if platform:
        types.append('platform')
    category = 'hybrid' if hybrid else 'sneaker'
    return category, types, ''


def in_scope(title, retailer_category=''):
    return bool(classify(title, retailer_category)[0])


# Korean retailers (Musinsa, 29CM) share one listing-title convention:
# "<model> - <colorway> / <style code>". Both tails are optional, and a title
# without them yields an empty colorway/style rather than a guessed one.
KO_NAME_PARTS = re.compile(r'^(?P<model>.*?)(?:\s+-\s+(?P<color>[^/]+?))?(?:\s*/\s*(?P<style>[^/]+))?$')


def split_ko_listing_title(name):
    """Return (model, colorway, style) for a Korean retailer listing title."""
    match = KO_NAME_PARTS.match((name or '').strip())
    if not match:
        return (name or '').strip(), '', ''
    return ((match.group('model') or name or '').strip(),
            (match.group('color') or '').strip(),
            (match.group('style') or '').strip())


# Korean retailers let a seller answer a required field by pointing at the
# images. Those answers state nothing, so they must never be stored as a
# colourway or a material - "상세내용참고" was reaching the colour chips.
PLACEHOLDER_VALUE = re.compile(
    r'^(?:상세\s*(?:페이지|이미지|내용|정보|설명)?\s*(?:참조|참고|확인)?|상품\s*(?:상세|tag)?\s*참고|'
    r'설명\s*페이지\s*(?:참조|참고)?|상세피이지\s*(?:참조|참고)?|맨발신발|'
    r'별도\s*표기|해당\s*없음|없음|기타|n/?a|-{1,3}|\.*)$', re.I)

# A seller's standing notice, pasted into the colour field after the answer:
# 29CM appends "(입고 시기에 따라 정보가 상이할 수 있어...)" and Musinsa
# "(선택되지 않는 색상은 판매하지 않거나 품절인 상품입니다)". The colour in
# front of it is real, so the notice is cut rather than the whole value
# thrown away - and when nothing but the notice was there, nothing is left.
SELLER_NOTICE = re.compile(
    r'[\(\[]\s*[^\)\]]*(?:입고\s*시기|색상은|판매하지|품절|라벨을\s*참고|상이할\s*수\s*있)[^\)\]]*[\)\]]')
# An audience tag is not a colour: Musinsa answers the colour field with
# "맨발신발 [남성용]" on a shoe sold in a men's and a women's listing.
AUDIENCE_TAG = re.compile(r'[\(\[]\s*(?:남성|여성|남녀|공용|유니섹스)\s*용?\s*[\)\]]')
# "BGD0,BLK0,WHGY" and "BLK0,DKBL,WHBR" are a retailer's internal colour
# codes. They identify nothing a reader can see, and as a chip label they
# are noise - but "BLACK, WHITE" is the same shape and says plenty, so a
# recognised colour name in the list is what tells the two apart.
CODE_TOKEN = re.compile(r'^[A-Z0-9]{2,6}$')


def is_opaque_codes(text):
    parts = [p.strip() for p in re.split(r'[,/]', text) if p.strip()]
    if not parts or not all(CODE_TOKEN.match(p) for p in parts):
        return False
    if any(p.lower() in COLOUR_NAMES for p in parts):
        return False
    # A single code has to look like one; two or more never read as colours.
    return len(parts) > 1 or any(c.isdigit() for c in parts[0])


# 29CM pins its own code to each colour name: "CHARCOAL(B02),DARK KHAKI(B65)"
# and "(19)BLACK". The name is the answer; the code only stops that name
# matching the same colour written plainly somewhere else.
INLINE_CODE = re.compile(r'[\(\[]\s*[A-Za-z]{0,3}\d{1,4}[A-Za-z]{0,2}\s*[\)\]]')


# New Balance's Korean listings put the model code in the name and the
# colour in the style field, in brackets after the SKU:
#     name "NBPDGF762C"   style "MT10O6L5 (CHARCOAL)"
# That is a colour the retailer stated; it was being thrown away because
# nothing looks for it outside the colour field.
STYLE_COLOUR = re.compile(r'\(\s*([A-Za-z][A-Za-z /\-]{2,30})\s*\)\s*$')


def colour_from_style(style):
    """The colour a retailer wrote into the style field, or ''."""
    found = STYLE_COLOUR.search((style or '').strip())
    return clean_colour_value(found.group(1)) if found else ''


def clean_colour_value(value):
    """The colour a retailer stated, with its boilerplate cut off, or ''."""
    text = SELLER_NOTICE.sub(' ', (value or '').strip())
    text = AUDIENCE_TAG.sub(' ', text)
    text = INLINE_CODE.sub(' ', text)
    text = re.sub(r'\s*,\s*', ', ', text)
    text = re.sub(r'\s{2,}', ' ', text).strip(' ,/|-')
    if not text or not is_stated_value(text) or is_opaque_codes(text):
        return ''
    return text


def is_stated_value(value):
    """True when a field actually says something."""
    text = (value or '').strip()
    return bool(text) and not PLACEHOLDER_VALUE.match(text)
