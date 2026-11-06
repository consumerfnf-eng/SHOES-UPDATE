"""Publish exact-photo labels and a private review queue, without training.

Assistant photo audits are private evaluation references, never public manual
labels or human ground truth. Only qualified model results enter this snapshot;
owner decisions are supplied exclusively by the independent live D1 overlay.
NumPy/sklearn (via the trusted local pickle) are loaded only during inference.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import pickle
import re
import sqlite3
import struct
import tempfile
from datetime import datetime, timezone
from contextlib import closing
from urllib.parse import urlsplit

CATEGORIES = ('low-profile', 'chunky', 'retro-tech-runner', 'ballet-mary-jane',
              'mule-slipper', 'court-other', 'boot', 'sandal', 'performance')
LEGACY_LABELS = dict(zip(('로우프로파일', '청키', '복고·테크 러너', '발레·메리제인',
                         '뮬·슬리퍼', '코트·기타', '부츠', '샌들', '퍼포먼스(축구·육상)'), CATEGORIES))
HASH = re.compile(r'[a-f0-9]{64}\Z')
ASSET = re.compile(r'/images/([a-f0-9]{64})\.(jpg|png|webp)\Z')
REVIEWER = 'assistant-independent-visual-review'
SCORE_FIELDS = {'minConfidence', 'minMargin', 'calibrationPrecision', 'testPrecision'}
COUNT_FIELDS = {'calibrationN', 'testN'}


def safe_text(value, limit):
    if not isinstance(value, str) or not 0 < len(value) <= limit or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid text field')
    return value


def image_hash(value):
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise ValueError('Invalid image hash')
    return value


def score(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError('Invalid probability/margin')
    return float(value)


def clean_metadata(metadata):
    if 'legacyLabels' in metadata and type(metadata['legacyLabels']) is not bool:
        raise ValueError('Invalid legacy label mode')
    model = {key: safe_text(metadata.get(key), limit) for key, limit in
             [('version', 160), ('encoder', 200)]}
    model['sha256'] = image_hash(metadata.get('sha256'))
    if type(metadata.get('validated')) is not bool:
        raise ValueError('Missing validation flag')
    model['validated'] = metadata['validated']
    gates = metadata.get('thresholds')
    if not isinstance(gates, dict):
        raise ValueError('Missing class gates')
    model['thresholds'] = {}
    for category, gate in gates.items():
        if category not in CATEGORIES or not isinstance(gate, dict):
            raise ValueError('Invalid class gate')
        clean = {}
        for key, value in gate.items():
            if key in SCORE_FIELDS:
                clean[key] = score(value)
            elif key in COUNT_FIELDS and type(value) is int and 0 <= value <= 100000:
                clean[key] = value
            else:
                raise ValueError('Invalid class gate field')
        if not {'minConfidence', 'minMargin'} <= clean.keys():
            raise ValueError('Incomplete class gate')
        model['thresholds'][category] = clean
    return model


def normalize_class(value, legacy=False):
    value = LEGACY_LABELS.get(str(value)) if legacy else str(value)
    if value not in CATEGORIES:
        raise ValueError('Classifier contains an unknown class')
    return value


def prediction_from_probabilities(classes, probabilities, legacy=False):
    categories = [normalize_class(c, legacy) for c in classes]
    if len(categories) < 2 or len(categories) != len(set(categories)) or len(categories) != len(probabilities):
        raise ValueError('Invalid classifier probability shape')
    values = [score(float(p)) for p in probabilities]
    if abs(sum(values) - 1) > 0.001:
        raise ValueError('Unnormalized probabilities')
    order = sorted(range(len(values)), key=lambda i: (-values[i], categories[i]))
    return {'category': categories[order[0]], 'confidence': values[order[0]],
            'margin': values[order[0]] - values[order[1]],
            'alternatives': [{'category': categories[i], 'score': values[i]} for i in order[:3]]}


def safe_products(products):
    if not isinstance(products, list) or not products:
        raise ValueError('Image must have bound products')
    result, seen = [], set()
    for product in products:
        clean = {key: safe_text(product.get(key), limit) for key, limit in
                 [('id', 200), ('brand', 160), ('name', 500), ('url', 2048), ('modelKey', 300)]}
        url = urlsplit(clean['url'])
        if url.scheme != 'https' or not url.hostname or url.username or url.password or re.search(r'\s', clean['url']):
            raise ValueError('Product URL must be HTTPS without credentials')
        if clean['id'] in seen:
            continue
        seen.add(clean['id'])
        if len(result) < 200:
            result.append(clean)
    # Keep per-row JSON below the backend's 64KiB limit, even for shared photos.
    while len(result) > 1 and len(json.dumps(result, ensure_ascii=False).encode('utf-8')) > 56000:
        result.pop()
    return result


def thumbnail_index(catalogs):
    index = {}
    for catalog in catalogs:
        for product in catalog.get('products', []) + catalog.get('retail', []):
            presentation = product.get('presentation') or {}
            original = presentation.get('cachedPath', '')
            thumbnail = (presentation.get('thumbnail') or {}).get('path', '')
            match = ASSET.fullmatch(original) if isinstance(original, str) else None
            if match and isinstance(thumbnail, str) and ASSET.fullmatch(thumbnail):
                index.setdefault((product.get('id'), match[1]), thumbnail)
    return index


def manifest_rows(manifest):
    rows = manifest.get('images')
    if manifest.get('schemaVersion') != 1 or not isinstance(rows, list) or len(rows) > 20000:
        raise ValueError('Invalid manifest')
    seen = set()
    for row in rows:
        key = image_hash(row.get('imageHash'))
        if key in seen:
            raise ValueError('Duplicate manifest photo')
        seen.add(key)
        asset = str(row.get('path', '')).replace('\\', '/')
        # Ignore arbitrary filesystem locations: only a bound hashed original.
        if asset.startswith('public/'):
            asset = asset[len('public'):]
        match = ASSET.fullmatch(asset)
        if not match or match[1] != key:
            raise ValueError('Manifest original path does not match image hash')
        yield {**row, 'originalAsset': asset}


def audit_index(audit):
    if audit.get('schemaVersion') != 1 or not isinstance(audit.get('records'), list):
        raise ValueError('Invalid site audit')
    result = {}
    # Never consume calibration/test predictions or infer truth from sample IDs.
    for row in audit['records']:
        key = image_hash(row.get('imageHash'))
        if key in result:
            raise ValueError('Duplicate audit photo')
        truth = row.get('truth') if 'truth' in row else row.get('category')
        if row.get('status') == 'reviewed' and truth is not None and truth not in CATEGORIES:
            raise ValueError('Invalid audit truth')
        if row.get('status') == 'reviewed' and truth:
            # v2 audit.category may be a prediction. Only truth is authoritative
            # when present; category is a fallback for original review files.
            result[key] = {'status': 'reviewed', 'category': truth}
        else:
            result[key] = {'status': 'excluded' if row.get('status') == 'excluded' else 'needs-owner', 'category': None}
    return result


def read_features(database, encoder, allowed):
    """Read the selected encoder only; errors resolve work but are never guesses."""
    vectors, errors = {}, set()
    with closing(sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        for key, blob in db.execute('SELECT hash,vector FROM features WHERE encoder=?', (encoder,)):
            if key not in allowed:
                continue
            if not isinstance(blob, bytes) or len(blob) != 512 * 4:
                raise ValueError('Feature must contain 512 float32 values')
            if not all(math.isfinite(v) for v in struct.unpack('<512f', blob)):
                raise ValueError('Feature contains nonfinite values')
            vectors[key] = blob
        for (key,) in db.execute('SELECT hash FROM errors WHERE encoder=?', (encoder,)):
            if key in allowed and key not in vectors:
                errors.add(key)
    return vectors, errors


def infer_predictions(vectors, metadata, payload):
    """The pickle is a SHA-verified, trusted local artifact, never a user upload."""
    import numpy as np
    classifier = pickle.loads(payload)
    if getattr(classifier, 'n_features_in_', None) != 512:
        raise ValueError('Classifier feature dimension must be 512')
    classes = list(classifier.classes_)
    for value in classes:
        normalize_class(value, metadata.get('legacyLabels', False))
    keys, predictions = sorted(vectors), {}
    for start in range(0, len(keys), 256):
        batch = keys[start:start + 256]
        matrix = np.stack([np.frombuffer(vectors[key], dtype='<f4') for key in batch])
        probabilities = classifier.predict_proba(matrix)
        if len(probabilities) != len(batch):
            raise ValueError('Invalid classifier result count')
        for key, values in zip(batch, probabilities):
            predictions[key] = prediction_from_probabilities(classes, values, metadata.get('legacyLabels', False))
    return predictions


def build_documents(manifest, metadata, audit, predictions, errors=(), catalogs=(), *, allow_partial=False, generated_at=None):
    """Pure release/binding logic; neither predictions nor audits create manual records."""
    rows, model, reviews = list(manifest_rows(manifest)), clean_metadata(metadata), audit_index(audit)
    # These are source-manifest totals, not a new grouping or inherited-photo
    # count. Unknown model totals stay null for older full-photo manifests.
    catalog_images = manifest.get('catalogImages', len(rows))
    total_models = manifest.get('totalModels')
    if type(catalog_images) is not int or catalog_images < len(rows):
        raise ValueError('Invalid manifest catalogImages total')
    if 'totalModels' in manifest and (type(total_models) is not int or total_models < 0):
        raise ValueError('Invalid manifest totalModels total')
    allowed = {row['imageHash'] for row in rows}
    if set(predictions) - allowed or set(errors) - allowed:
        raise ValueError('Unbound inference result')
    errors = set(errors) - predictions.keys()
    pending = allowed - predictions.keys() - errors
    if pending and not allow_partial:
        raise ValueError(f'Incomplete inference: {len(pending)} manifest photos unresolved')
    thumbnails, public, private = thumbnail_index(catalogs), [], []
    counts = {'totalImages': len(rows), 'catalogImages': catalog_images, 'totalModels': total_models,
              'inferredImages': len(predictions), 'acceptedImages': 0,
              'manualImages': 0, 'modelImages': 0, 'pendingInference': len(pending),
              'errorImages': len(errors), 'needsOwnerImages': 0, 'partialPreview': bool(allow_partial)}
    if 'scope' in manifest:
        counts['scope'] = safe_text(manifest['scope'], 80)
    comparison = {'reviewer': REVIEWER, 'reviewedImages': 0, 'comparedImages': 0, 'matchingImages': 0}
    for row in rows:
        key, decision = row['imageHash'], reviews.get(row['imageHash'])
        raw = predictions.get(key)
        prediction = None
        if raw is not None:
            if raw.get('category') not in CATEGORIES or not isinstance(raw.get('alternatives'), list) or not 1 <= len(raw['alternatives']) <= 3:
                raise ValueError('Invalid prediction')
            prediction = {'category': raw['category'], 'confidence': score(raw.get('confidence')), 'margin': score(raw.get('margin')),
                          'alternatives': [{'category': a['category'], 'score': score(a['score'])} for a in raw['alternatives']]}
            if any(a['category'] not in CATEGORIES for a in prediction['alternatives']):
                raise ValueError('Invalid alternative')
        gate = model['thresholds'].get(prediction['category']) if prediction else None
        released = bool(prediction and model['validated'] and gate and
                        prediction['confidence'] >= gate['minConfidence'] and prediction['margin'] >= gate['minMargin'])
        if decision and decision['status'] == 'reviewed':
            comparison['reviewedImages'] += 1
            if prediction:
                comparison['comparedImages'] += 1
                comparison['matchingImages'] += prediction['category'] == decision['category']
        elif decision:
            counts['needsOwnerImages'] += decision['status'] == 'needs-owner'
        accepted = released and (not decision or decision['status'] == 'reviewed')
        if accepted:
            public.append({'imageHash': key, 'category': prediction['category'],
                           'confidence': prediction['confidence'], 'margin': prediction['margin'],
                           'source': 'model', 'modelVersion': model['version']})
            counts['modelImages'] += 1
        products = safe_products(row['products'])
        thumbnail = next((thumbnails[(p['id'], key)] for p in products if (p['id'], key) in thumbnails), row['originalAsset'])
        status = 'auto' if accepted else 'review-needed'
        if decision and decision['status'] == 'excluded' and prediction:
            status = 'excluded'
        private.append({'imageHash': key, 'modelVersion': model['version'],
                        **(prediction or {'category': None, 'confidence': 0, 'margin': 0, 'alternatives': []}),
                        'thumbnail': thumbnail, 'products': products, 'status': status})
    counts['acceptedImages'] = len(public)
    generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    evaluation = {'labelSource': REVIEWER, 'accuracyAssessment': 'Assistant visual audit reference labels; not human ground truth or owner decisions.',
                  'modelValidated': model['validated'], 'releasedCategories': list(model['thresholds']) if model['validated'] else [],
                  'coverage': counts, 'referenceComparison': {**comparison, 'agreementRate':
                      comparison['matchingImages'] / comparison['comparedImages'] if comparison['comparedImages'] else None}}
    return ({'schemaVersion': 1, 'model': model, 'generatedAt': generated_at, 'records': public, 'coverage': counts},
            {'schemaVersion': 1, 'model': model, 'generatedAt': generated_at, 'records': private, 'evaluation': evaluation})


def atomic_documents(public_path, snapshot, queue_path, queue):
    """Stage both complete JSON files, then replace the public snapshot last."""
    targets = [(Path(queue_path), queue), (Path(public_path), snapshot)]
    if targets[0][0].resolve() == targets[1][0].resolve():
        raise ValueError('Public and private outputs must differ')
    staged = []
    try:
        for target, document in targets:
            payload = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(prefix='.' + target.name + '.', suffix='.tmp', dir=target.parent)
            staged.append((Path(name), target))
            with os.fdopen(fd, 'wb') as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        for temporary, target in staged:
            os.replace(temporary, target)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)


def publish(*, manifest_path='.secrets/clip/manifest.json', model_dir='.secrets/clip-models/site-v1',
            database='.secrets/clip/features.sqlite', audit_path='.secrets/clip/site-audit.json',
            catalog_paths=('public/data/catalog.json', 'public/data/monthly-catalog.json'),
            output=None, queue_output=None, allow_partial=False, predictor=None):
    output = Path(output or ('.secrets/clip/preview/visual-classifications.json' if allow_partial else 'public/data/visual-classifications.json'))
    queue_output = Path(queue_output or ('.secrets/clip/preview/admin-queue.json' if allow_partial else '.secrets/clip/admin-queue.json'))
    if queue_output.resolve().is_relative_to(Path('public').resolve()):
        raise ValueError('The candidate queue must remain private')
    if allow_partial and any(not p.resolve().is_relative_to(Path('.secrets').resolve()) for p in (output, queue_output)):
        raise ValueError('Partial results may only be written to a private .secrets preview')
    if allow_partial and queue_output.resolve() == Path('.secrets/clip/admin-queue.json').resolve():
        raise ValueError('Partial preview cannot replace the operational admin queue')
    read = lambda p: json.loads(Path(p).read_text(encoding='utf-8'))
    manifest, metadata, audit = read(manifest_path), read(Path(model_dir) / 'metadata.json'), read(audit_path)
    rows, model = list(manifest_rows(manifest)), clean_metadata(metadata)
    # Fail before loading optional ML dependencies or touching either output.
    vectors, errors = read_features(database, model['encoder'], {r['imageHash'] for r in rows})
    pending = len(rows) - len(vectors) - len(errors)
    if pending and not allow_partial:
        raise ValueError(f'Incomplete inference: {pending} manifest photos unresolved')
    payload = (Path(model_dir) / 'model.pkl').read_bytes()
    if hashlib.sha256(payload).hexdigest() != model['sha256']:
        raise ValueError('Model artifact SHA does not match metadata')
    predictions = (predictor or infer_predictions)(vectors, metadata, payload) if vectors else {}
    if set(predictions) != set(vectors):
        raise ValueError('Every resolved feature must have exactly one prediction')
    catalogs = [read(p) for p in catalog_paths if Path(p).exists()]
    snapshot, queue = build_documents(manifest, metadata, audit, predictions, errors, catalogs, allow_partial=allow_partial)
    atomic_documents(output, snapshot, queue_output, queue)
    return snapshot['coverage']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', default='.secrets/clip/manifest.json',
                        help='Full-photo or deduplicated representative-photo manifest; exact SHA ownership is preserved')
    parser.add_argument('--model-dir', default='.secrets/clip-models/site-v1')
    parser.add_argument('--database', default='.secrets/clip/features.sqlite')
    parser.add_argument('--audit', default='.secrets/clip/site-audit.json')
    parser.add_argument('--catalog', action='append', help='Repeat for canonical/monthly catalog files')
    parser.add_argument('--output')
    parser.add_argument('--queue-output')
    parser.add_argument('--allow-partial', action='store_true', help='Private local preview only')
    args = parser.parse_args()
    print(json.dumps(publish(manifest_path=args.manifest, model_dir=args.model_dir, database=args.database,
                             audit_path=args.audit, catalog_paths=args.catalog or ('public/data/catalog.json', 'public/data/monthly-catalog.json'),
                             output=args.output, queue_output=args.queue_output, allow_partial=args.allow_partial)))


if __name__ == '__main__':
    main()
