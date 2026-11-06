"""Select private owner-review work; test selection never uses predictions/truth.

No model loading or inference. Pillow checks candidate photos lazily; pandas is
used only to read conservative teacher brand metadata from trusted local files.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re

from clip_quality import brand_key

SEED = 'priority-20261106-v1'
ROLES = ('train', 'calibration', 'test')
REASONS = {
    'train': '학습 브랜드 내 불확실성·불일치·경계 사례 우선 검수',
    'calibration': '학습과 분리된 브랜드의 보정용 사진 검수',
    'test': '새 디자인의 독립 평가용 사진',
}
# Suitability checks only, from direct photo inspection; never category truth
# or correctness predictions. Keep exact hashes so reruns are reproducible.
ELIGIBILITY_EXCLUSIONS = {
    '4de23b90745b6e007b7509dfbdf3e98a43ed76d86312cf7ce534815f06c11cd8': 'Overhead-only photo',
    '6774d01ec762fe05939f44a487af153e91ec36d28f38c5937db1d139bd8ec7e5': 'Overhead-only photo',
    '2104060b2ba6cf044f384f94bc007a94f9333e2ec54723b1df3f7474f396739b': 'No clearly visible shoe opening or construction',
    '62f379bdd59edec11bb95a6df696dc0df2d3499ea19793e46c87436a71ae8b86': 'Worn-on-foot overhead photo',
    'f449e798bafe18879e76ad936527232b346e4f2eec23e4a11a6e5169868a6a6b': 'Worn-on-foot fashion photo',
    '5c45510e8c942740f3755cfb933c189912199ce083f99bf9952fed2136f585aa': 'Fashion photo dominated by a person rather than a shoe',
    '178fd208db0a6eb74f6794ff90bda5275e1b1152c5dad8246f49e65c585473b9': 'Worn-on-foot fashion photo',
    '4af26dd2271f9241a12e53522865981aa9bba9b7e7b97113f089eaeebb8cc5a0': 'Worn-on-foot fashion photo',
    '45029f76a5702b66d2774ca860ee5049804e4d386e0e07630f2ff5dfa919977e': 'Worn-on-foot fashion photo',
    'ee1ae94075f4bc0b8438147b61ae753273c1cad5b21455f1468d1c8307661c01': 'Worn-on-foot fashion photo',
    '1a550c921fa7116dab479b94c83845ab9bb8b8ab3c2ad1704707e6ab9d50a18d': 'Worn-on-foot fashion photo',
}
FOOTWEAR = {'sneaker', 'hybrid', 'slipper', 'platform-slipper', 'platform-shoe',
            'platform-sandal', 'clog', 'jelly', 'boot', 'sandal', 'loafer'}
NONSHOE = re.compile(
    r'\b(?:gloves?|mittens?|socks?|t-shirts?|hoodies?|sweatshirts?|pants|trousers|'
    r'jackets?|bags?|caps?|hats?|wordmark|logo only)\b|장갑|양말|티셔츠|모자', re.I)
BAD_VIEW = re.compile(
    r'wordmark|no shoe|not a shoe|gloves|overhead|top[- ](?:view|only)|worn on feet|'
    r'shoes are worn|on[- ]foot|outsole[- ]first|워드마크|장갑|착용|탑뷰', re.I)


def stable(value):
    return hashlib.sha256((SEED + '|' + value).encode()).hexdigest()


def identities(row):
    return {p['modelKey'] for p in row['products']}


def brands(row):
    return {brand_key(p['brand']) for p in row['products']}


def shelf_eligible(row):
    """Shelf/name evidence is eligibility only, never a category label."""
    products = row.get('products', [])
    return bool(products) and len(brands(row)) == 1 and all(
        p.get('modelKey') and p.get('brand') and p.get('name')
        and p.get('productType') in FOOTWEAR and not NONSHOE.search(p['name'])
        for p in products)


def photo_eligible(row, root):
    """Decode only inspected candidates; verify original bytes and min dimensions."""
    from PIL import Image, ImageOps, ImageStat, ImageChops
    image_hash = row['imageHash']
    path = Path(row['path'])
    if not re.fullmatch(r'[a-f0-9]{64}', image_hash):
        return False
    normalized = path.as_posix()
    if not re.fullmatch(r'public/images/' + image_hash + r'\.(?:jpg|png|webp)', normalized):
        return False
    try:
        path = root / path
        if hashlib.sha256(path.read_bytes()).hexdigest() != image_hash:
            return False
        with Image.open(path) as source:
            source = ImageOps.exif_transpose(source)
            if min(source.size) < 120:
                return False
            source.thumbnail((192, 192))
            rgba = source.convert('RGBA')
            canvas = Image.new('RGBA', rgba.size, 'white')
            canvas.alpha_composite(rgba)
            rgb = canvas.convert('RGB')
            if max(ImageStat.Stat(rgb).stddev) < 2:
                return False
            corners = [rgb.getpixel(p) for p in [(0, 0), (rgb.width-1, 0),
                       (0, rgb.height-1), (rgb.width-1, rgb.height-1)]]
            bg = tuple(sorted(p[c] for p in corners)[2] for c in range(3))
            channels = ImageChops.difference(rgb, Image.new('RGB', rgb.size, bg)).split()
            mask = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
            bbox = mask.point(lambda v: 255 if v > 28 else 0).getbbox()
            if not bbox:
                return False
            width, height = bbox[2]-bbox[0], bbox[3]-bbox[1]
            return width * height / (rgb.width * rgb.height) >= .025 and width / height < 6
    except (OSError, ValueError, Image.DecompressionBombError):
        return False


def select_priority(manifest, audit, queue, teacher_brands=(), *, per_role=32,
                    eligible=lambda row: True):
    """Pure deterministic role selection with an injectable photo eligibility check."""
    if per_role < 1:
        raise ValueError('Role count must be positive')
    rows = manifest['images']
    by_hash = {r['imageHash']: r for r in rows}
    if len(by_hash) != len(rows):
        raise ValueError('Duplicate manifest hash')
    prior = audit['records']
    if len({r['imageHash'] for r in prior}) != len(prior):
        raise ValueError('Duplicate audit hash')
    audit_by_hash = {r['imageHash']: r for r in prior}
    old_hashes = set(audit_by_hash) | {r['imageHash'] for r in queue['records']}
    old_models = {r['modelKey'] for r in prior}
    for row in rows:
        if row['imageHash'] in old_hashes:
            old_models.update(identities(row))
    for row in queue['records']:
        old_models.update(identities(row))
    train_brands = {brand_key(r['brand']) for r in prior if r['split'] == 'train'}
    training_brands = train_brands | {brand_key(b) for b in teacher_brands}
    # Exclude the WHOLE original calibration brand pool from test, so even a
    # changed calibration ranking cannot alter test-brand eligibility.
    calibration_brands = {brand_key(r['brand']) for r in prior
                          if r['split'] == 'calibration'} - training_brands
    pools = {role: [] for role in ROLES}
    for row in rows:
        if row['imageHash'] in ELIGIBILITY_EXCLUSIONS or not shelf_eligible(row):
            continue
        row_brands = brands(row)
        reviewed = audit_by_hash.get(row['imageHash'])
        if reviewed and not BAD_VIEW.search(reviewed.get('notes', '')):
            if reviewed['split'] == 'train' and row_brands <= train_brands:
                pools['train'].append(row)
            elif reviewed['split'] == 'calibration' and row_brands <= calibration_brands:
                pools['calibration'].append(row)
        if (row['imageHash'] not in old_hashes and not identities(row) & old_models
                and not row_brands & (training_brands | calibration_brands)):
            pools['test'].append(row)

    # Prediction lookup is restricted to old training/calibration candidates.
    rankable = {r['imageHash'] for role in ('train', 'calibration') for r in pools[role]}
    predictions = {r['imageHash']: r for r in queue['records'] if r['imageHash'] in rankable}
    frequencies = Counter(r.get('category') for r in predictions.values())

    def rank(row):
        prediction = predictions.get(row['imageHash'], {})
        reference = audit_by_hash[row['imageHash']]
        truth = reference.get('truth')
        disagreement = bool(truth and prediction.get('category')
                            and truth != prediction['category'])
        margin = prediction.get('margin', 0)
        confidence = prediction.get('confidence', 0)
        rarity = 1 / max(1, frequencies[prediction.get('category')])
        priority = 2 * disagreement + (1-margin) + (1-confidence) + rarity
        return (-priority, stable(row['imageHash']))

    selected, used_hashes, used_models = [], set(), set()
    selected_brands = {}
    for role in ROLES:
        queues = defaultdict(list)
        for row in pools[role]:
            queues[next(iter(brands(row)))].append(row)
        for candidates in queues.values():
            # Critically, no predictions, truth, categories or features here.
            candidates.sort(key=(lambda r: stable(r['imageHash'])) if role == 'test' else rank)
        order = sorted(queues, key=stable)
        count = 0
        while count < per_role:
            progress = False
            for brand in order:
                candidates = queues[brand]
                while candidates:
                    row = candidates.pop(0)
                    if (row['imageHash'] in used_hashes or identities(row) & used_models
                            or not eligible(row)):
                        continue
                    product = min(row['products'], key=lambda p: (p['modelKey'], p['id']))
                    selected.append({**row, 'role': role, 'reason': REASONS[role],
                                     'position': len(selected)+1,
                                     'modelKey': product['modelKey'], 'brand': product['brand']})
                    used_hashes.add(row['imageHash'])
                    used_models.update(identities(row))
                    count += 1
                    progress = True
                    break
                if count == per_role:
                    break
            if not progress:
                raise ValueError(f'Insufficient eligible distinct designs for {role}: {count}/{per_role}')
        selected_brands[role] = {next(iter(brands(r))) for r in selected if r['role'] == role}
    if any(selected_brands[a] & selected_brands[b] for a, b in
           [('train', 'calibration'), ('train', 'test'), ('calibration', 'test')]):
        raise ValueError('Role brand overlap')
    notes = {
        'roleCounts': {role: per_role for role in ROLES},
        'method': 'Deterministic brand round robin; prior train/calibration ranked by uncertainty, disagreement and predicted-class rarity. New test uses hash ordering and eligibility only.',
        'excludedTrainingBrands': sorted(training_brands),
        'excludedCalibrationBrandsForTest': sorted(calibration_brands),
        'priorPhotoCount': len(old_hashes), 'priorDesignCount': len(old_models),
        'photoEligibilityExclusions': ELIGIBILITY_EXCLUSIONS,
        'referencePolicy': 'Assistant reference labels remain private ranking evidence; no owner decisions or category truth are supplied in this task.',
        'warnings': ['32 calibration/test designs cannot supply 8 examples for each of 9 classes (72 minimum per split); owner labels and independent class gates remain required.',
                     'Shelf/name and pixel checks establish eligibility, not visual ground truth; owners may exclude unsuitable photos.'],
    }
    return {'schemaVersion': 1, 'id': SEED, 'title': '우선 검수 96개',
            'selectionVersion': 'priority-v1', 'modelVersion': queue['model']['version'],
            'targetCount': per_role*3, 'selectionNotes': notes, 'images': selected}


def teacher_brand_metadata(directory):
    """Conservatively exclude every brand in both teacher source tables."""
    import pandas as pd
    result = set()
    for name in ('kr_clip_v3.pkl', 'cn.pkl'):
        table = pd.read_pickle(directory / name)  # Trusted local tables, no vectors.
        result.update(str(v) for v in table['brand'].dropna())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    read = lambda name: json.loads((root / name).read_text(encoding='utf-8'))
    frozen_path=root / '.secrets/clip/priority-review.json'
    if frozen_path.exists():
        frozen=read('.secrets/clip/priority-review.json')
        if frozen.get('id')!=SEED or frozen.get('targetCount')!=96 or len(frozen.get('images',[]))!=96:
            raise ValueError('Inspect the existing frozen batch; do not replace owner work')
        manifest_path=root / '.secrets/clip/priority-manifest.json'
        if not manifest_path.exists():
            manifest_path.write_text(json.dumps({'schemaVersion':1,'images':frozen['images']},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'reusedFrozenBatch':True,'id':SEED,'photos':96}));return
    teacher = teacher_brand_metadata(root / '.secrets/clip-models/user-v4/training')
    result = select_priority(read('.secrets/clip/manifest.json'),
                             read('.secrets/clip/site-audit-v2.json'),
                             read('.secrets/clip/admin-queue.json'), teacher,
                             eligible=lambda r: photo_eligible(r, root))
    for name, document in [('priority-review.json', result),
                           ('priority-manifest.json', {'schemaVersion': 1, 'images': result['images']})]:
        (root / '.secrets/clip' / name).write_text(
            json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'path': '.secrets/clip/priority-review.json',
                      'modelVersion': result['modelVersion'],
                      'roles': {role: {'count': sum(r['role'] == role for r in result['images']),
                                      'brands': dict(Counter(r['brand'] for r in result['images'] if r['role'] == role))}
                                for role in ROLES}, 'warnings': result['selectionNotes']['warnings']}))


if __name__ == '__main__':
    main()
