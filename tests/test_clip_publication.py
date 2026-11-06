"""Publication tests require only Python's standard library; no model unpickling."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import closing

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'publish_visual_classifications.py'
spec = importlib.util.spec_from_file_location('clip_publication', SCRIPT)
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


def photo_hash(n):
    return f'{n:064x}'


def photo(n=1, **extra):
    return {'imageHash': photo_hash(n), 'path': f'public/images/{photo_hash(n)}.webp',
            'products': [{'id': f'p{n}', 'brand': 'Nike', 'group': 'SPORTS', 'name': 'Shoe',
                          'modelKey': f'Nike|m{n}', 'productType': 'sneaker', 'url': 'https://example.com/shoe',
                          'image': 'https://example.com/private-original.jpg'}], **extra}


def metadata(validated=False, gates=None):
    return {'version': 'clip-future-v2', 'sha256': photo_hash(100), 'encoder': 'future-shoe-letterbox-encoder-v2',
            'validated': validated, 'thresholds': gates or {}, 'legacyLabels': False,
            'sourceWeights': '/private/source/weights', 'evaluation': {'accuracy': .707}}


def prediction(category='chunky', confidence=.9, margin=.3, **extra):
    return {'category': category, 'confidence': confidence, 'margin': margin,
            'alternatives': [{'category': category, 'score': confidence}, {'category': 'boot', 'score': .1}], **extra}


class PublicationTests(unittest.TestCase):
    def documents(self, rows=None, meta=None, audits=None, predictions=None, errors=(), **kwargs):
        return publication.build_documents({'schemaVersion': 1, 'images': rows if rows is not None else [photo()]},
                                           meta or metadata(), {'schemaVersion': 1, 'records': audits or []},
                                           predictions if predictions is not None else {photo_hash(1): prediction()}, errors, **kwargs)

    def test_representative_manifest_retains_catalog_totals_without_expanding_hashes_or_owners(self):
        shared = photo()
        shared['products'].append({**shared['products'][0], 'id': 'actual-shared-owner', 'modelKey': 'Nike|another-existing-model'})
        manifest = {'schemaVersion': 1, 'catalogImages': 12534, 'totalModels': 4264, 'images': [shared, photo(2)]}
        audit = {'schemaVersion': 1, 'records': [{'imageHash': photo_hash(1), 'status': 'reviewed', 'truth': 'boot'},
                                                {'imageHash': photo_hash(99), 'status': 'reviewed', 'truth': 'sandal'}]}
        # Same existing design key on another color/photo grants no SHA/ownership
        # expansion in this publisher; inheritance belongs to the frontend.
        catalogs = [{'products': [{'id': 'another-color', 'modelKey': 'Nike|m1',
                                   'presentation': {'cachedPath': f'/images/{photo_hash(99)}.webp'}}]}]
        snapshot, queue = publication.build_documents(manifest, metadata(), audit,
                                                      {photo_hash(1): prediction(), photo_hash(2): prediction()}, catalogs=catalogs)
        coverage = snapshot['coverage']
        self.assertEqual((coverage['totalModels'], coverage['catalogImages'], coverage['totalImages'], coverage['inferredImages']),
                         (4264, 12534, 2, 2))
        self.assertEqual(snapshot['records'], [])
        self.assertEqual([r['imageHash'] for r in queue['records']], [photo_hash(1), photo_hash(2)])
        self.assertEqual([p['id'] for p in queue['records'][0]['products']], ['p1', 'actual-shared-owner'])
        self.assertEqual(queue['evaluation']['coverage'], coverage)
        for field, value in [('catalogImages', 1), ('catalogImages', True), ('totalModels', -1), ('totalModels', 1.5)]:
            with self.assertRaises(ValueError):
                publication.build_documents({**manifest, field: value}, metadata(), audit,
                                            {photo_hash(1): prediction(), photo_hash(2): prediction()})
        old_coverage = self.documents()[0]['coverage']
        self.assertEqual(old_coverage['catalogImages'], 1)
        self.assertIsNone(old_coverage['totalModels'], 'Missing model totals must not be invented from representative count')

    def test_unvalidated_or_no_class_gate_never_publishes_model(self):
        gate = {'chunky': {'minConfidence': .8, 'minMargin': .2, 'calibrationN': 8, 'testN': 9}}
        for meta in (metadata(False, gate), metadata(True), metadata(True, {'boot': gate['chunky']})):
            public, queue = self.documents(meta=meta)
            self.assertEqual(public['records'], [])
            self.assertEqual(queue['records'][0]['status'], 'review-needed')
        public, queue = self.documents(meta=metadata(True, gate))
        self.assertEqual(public['records'][0]['source'], 'model')
        self.assertEqual(queue['records'][0]['status'], 'auto')
        for guessed in (prediction(confidence=.79), prediction(margin=.19)):
            self.assertFalse(self.documents(meta=metadata(True, gate), predictions={photo_hash(1): guessed})[0]['records'])

    def test_unqualified_pilot400_stays_private_even_when_every_audit_is_reviewed(self):
        rows = [photo(n) for n in range(1, 401)]
        manifest = {'schemaVersion': 1, 'scope': 'pilot', 'catalogImages': 12534, 'totalModels': 4264, 'images': rows}
        audits = {'schemaVersion': 1, 'records': [{'imageHash': r['imageHash'], 'status': 'reviewed', 'truth': 'boot'} for r in rows]}
        public, queue = publication.build_documents(manifest, metadata(), audits, {r['imageHash']: prediction() for r in rows})
        self.assertEqual(public['records'], [])
        self.assertEqual(public['coverage']['manualImages'], 0)
        self.assertEqual(public['coverage']['acceptedImages'], 0)
        self.assertEqual((public['coverage']['totalImages'], public['coverage']['inferredImages']), (400, 400))
        self.assertEqual((public['coverage']['catalogImages'], public['coverage']['totalModels'], public['coverage']['scope']),
                         (12534, 4264, 'pilot'))
        self.assertEqual(len(queue['records']), 400)
        self.assertTrue(all(r['status'] == 'review-needed' and r['category'] == 'chunky' for r in queue['records']))
        self.assertEqual(queue['evaluation']['referenceComparison']['comparedImages'], 400)
        self.assertEqual(queue['evaluation']['referenceComparison']['matchingImages'], 0)

    def test_assistant_audit_is_private_reference_never_public_manual_or_prediction_override(self):
        audits = [{'imageHash': photo_hash(1), 'status': 'reviewed', 'truth': 'sandal', 'category': 'sandal',
                   'reviewer': 'assistant-independent-visual-review', 'prediction': 'chunky'}]
        public, queue = self.documents(audits=audits)
        self.assertEqual(public['records'], [])
        self.assertEqual(public['coverage']['manualImages'], 0)
        self.assertEqual(queue['records'][0]['category'], 'chunky', 'Private prediction is not relabeled as the audit')
        self.assertEqual(queue['records'][0]['status'], 'review-needed')
        self.assertEqual(queue['evaluation']['referenceComparison']['reviewer'], publication.REVIEWER)
        self.assertIn('not human ground truth', queue['evaluation']['accuracyAssessment'])
        for status in ('needs-owner', 'unknown', 'excluded'):
            review = {**audits[0], 'status': status}
            public, _ = self.documents(audits=[review], meta=metadata(True, {'chunky': {'minConfidence': .8, 'minMargin': .2}}))
            self.assertFalse(public['records'], 'Owner-needed audit must block even a released model')
        public, _ = self.documents(predictions={photo_hash(1): prediction(source='manual', truth='boot', reviewer='owner')})
        self.assertFalse(public['records'])
        public, _ = self.documents(audits=[{**audits[0], 'imageHash': photo_hash(2)}])
        self.assertFalse(public['records'], 'Another photo cannot confer a manual label')
        public, queue = self.documents(audits=[{**audits[0], 'truth': 'boot', 'category': 'chunky'}])
        self.assertFalse(public['records'])
        self.assertEqual(queue['evaluation']['referenceComparison']['matchingImages'], 0, 'Evaluation uses truth, not predicted audit.category')
        public, _ = self.documents(audits=[{**audits[0], 'truth': None, 'category': 'chunky'}])
        self.assertFalse(public['records'], 'An explicit unknown truth cannot fall back to a prediction')
        public, queue = self.documents(audits=[{'imageHash': photo_hash(1), 'status': 'reviewed', 'category': 'boot'}])
        self.assertFalse(public['records'])
        self.assertEqual(queue['evaluation']['referenceComparison']['reviewedImages'], 1)
        released = metadata(True, {'chunky': {'minConfidence': .8, 'minMargin': .2}})
        public, queue = self.documents(meta=released, audits=audits)
        self.assertEqual(public['records'][0]['source'], 'model')
        self.assertEqual(public['records'][0]['category'], 'chunky', 'Audit truth must not replace a qualified model prediction')
        self.assertEqual(public['coverage']['manualImages'], 0)

    def test_thumbnail_bound_to_product_id_and_original_sha_and_product_whitelist(self):
        thumbnails = [dict(products=[{'id': 'p1', 'presentation': {'cachedPath': f'/images/{photo_hash(9)}.webp',
                                          'thumbnail': {'path': f'/images/{photo_hash(8)}.webp'}}}]),
                      dict(retail=[{'id': 'p1', 'presentation': {'cachedPath': f'/images/{photo_hash(1)}.webp',
                                          'thumbnail': {'path': f'/images/{photo_hash(7)}.webp'}}}])]
        public, queue = self.documents(catalogs=thumbnails)
        self.assertEqual(queue['records'][0]['thumbnail'], f'/images/{photo_hash(7)}.webp')
        self.assertEqual(set(queue['records'][0]['products'][0]), {'id', 'brand', 'name', 'url', 'modelKey'})
        self.assertEqual(self.documents(catalogs=thumbnails[:1])[1]['records'][0]['thumbnail'], f'/images/{photo_hash(1)}.webp')
        thumbnails[1]['retail'][0]['presentation']['thumbnail']['path'] = 'https://evil.example/photo.jpg'
        self.assertEqual(self.documents(catalogs=thumbnails)[1]['records'][0]['thumbnail'], f'/images/{photo_hash(1)}.webp')
        wire = json.dumps(public)
        for secret in ('alternatives', 'vector', 'private-original', 'sourceWeights', 'legacyLabels', '/private/', 'reviewer', 'accuracy'):
            self.assertNotIn(secret, wire)
        row = photo(); row['products'][0]['url'] = 'javascript:alert(1)'
        with self.assertRaises(ValueError): self.documents(rows=[row])
        with self.assertRaises(ValueError): self.documents(rows=[photo(path=f'public/images/{photo_hash(2)}.webp')])
        with self.assertRaises(ValueError): self.documents(rows=[photo(), photo()])

    def test_incomplete_default_fails_errors_are_review_only_and_preview_counts_are_honest(self):
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            self.documents(rows=[photo(), photo(2)])
        public, queue = self.documents(rows=[photo(), photo(2)], errors=[photo_hash(2)])
        unresolved = queue['records'][1]
        self.assertEqual((unresolved['category'], unresolved['confidence'], unresolved['margin'], unresolved['alternatives'], unresolved['status']),
                         (None, 0, 0, [], 'review-needed'))
        self.assertEqual(public['coverage']['pendingInference'], 0)
        self.assertEqual(public['coverage']['errorImages'], 1)
        public, _ = self.documents(rows=[photo(), photo(2)], allow_partial=True)
        self.assertEqual(public['coverage']['pendingInference'], 1)
        self.assertTrue(public['coverage']['partialPreview'])
        public, _ = self.documents(predictions={}, errors=[photo_hash(1)], audits=[{'imageHash': photo_hash(1), 'status': 'reviewed', 'truth': 'boot'}])
        self.assertEqual(public['records'], [])

    def test_classes_support_legacy_and_future_ids_without_importing_clip_runtime(self):
        for korean, category in publication.LEGACY_LABELS.items():
            self.assertEqual(publication.normalize_class(korean, True), category)
            self.assertEqual(publication.normalize_class(category), category)
        p = publication.prediction_from_probabilities(['청키', '부츠', '샌들'], [.8, .15, .05], True)
        self.assertEqual(p['category'], 'chunky'); self.assertAlmostEqual(p['margin'], .65)
        self.assertEqual(len(p['alternatives']), 3)
        with self.assertRaises(ValueError): publication.prediction_from_probabilities(['chunky', 'boot'], [.8, .8])
        with self.assertRaises(ValueError): publication.normalize_class('made-up')
        for gates in ({'chunky': {'minConfidence': .8}}, {'chunky': {'minConfidence': .8, 'minMargin': .2, 'testN': -1}},
                      {'chunky': {'minConfidence': .8, 'minMargin': .2, 'weights': .9}}):
            with self.assertRaises(ValueError): publication.clean_metadata(metadata(True, gates))

    def test_metadata_encoder_selects_matching_512f_vectors_and_resolves_stale_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            dbpath = Path(tmp) / 'features.sqlite'
            with closing(sqlite3.connect(dbpath)) as db, db:
                db.executescript('CREATE TABLE features(encoder,hash,vector);CREATE TABLE errors(encoder,hash,error);')
                blob = struct.pack('<512f', *([.1] * 512))
                db.executemany('INSERT INTO features VALUES(?,?,?)', [('old', photo_hash(2), blob), ('future', photo_hash(1), blob), ('future', photo_hash(99), blob)])
                db.executemany('INSERT INTO errors VALUES(?,?,?)', [('future', photo_hash(1), 'stale'), ('future', photo_hash(3), 'failed'), ('old', photo_hash(2), 'wrong encoder')])
            vectors, errors = publication.read_features(dbpath, 'future', {photo_hash(1), photo_hash(2), photo_hash(3)})
            self.assertEqual(set(vectors), {photo_hash(1)}); self.assertEqual(errors, {photo_hash(3)})
            with closing(sqlite3.connect(dbpath)) as db, db: db.execute('UPDATE features SET vector=? WHERE encoder=?', (b'bad', 'future'))
            with self.assertRaises(ValueError): publication.read_features(dbpath, 'future', {photo_hash(1)})

    def test_missing_feature_and_bad_model_sha_preserve_existing_snapshot_before_inference(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); modeldir = root / 'model'; modeldir.mkdir()
            manifest, audit, output, queuepath, dbpath = [root / p for p in ('manifest.json', 'audit.json', 'snapshot.json', 'queue.json', 'features.sqlite')]
            manifest.write_text(json.dumps({'schemaVersion': 1, 'images': [photo()]}))
            audit.write_text(json.dumps({'schemaVersion': 1, 'records': []}))
            model = metadata(); (modeldir / 'metadata.json').write_text(json.dumps(model)); (modeldir / 'model.pkl').write_bytes(b'trusted fixture')
            output.write_text('previous public'); queuepath.write_text('previous queue')
            with closing(sqlite3.connect(dbpath)) as db, db: db.executescript('CREATE TABLE features(encoder,hash,vector);CREATE TABLE errors(encoder,hash,error);')
            def run(predictor):
                return publication.publish(manifest_path=manifest, model_dir=modeldir, database=dbpath, audit_path=audit,
                                           catalog_paths=(), output=output, queue_output=queuepath, predictor=predictor)
            with patch.object(publication, 'infer_predictions', side_effect=AssertionError('must not infer')):
                with self.assertRaisesRegex(ValueError, 'unresolved'): run(None)
            self.assertEqual(output.read_text(), 'previous public'); self.assertEqual(queuepath.read_text(), 'previous queue')
            with closing(sqlite3.connect(dbpath)) as db, db: db.execute('INSERT INTO features VALUES(?,?,?)', (model['encoder'], photo_hash(1), struct.pack('<512f', *([.1] * 512))))
            with self.assertRaisesRegex(ValueError, 'SHA'): run(lambda *_: {})
            self.assertEqual(output.read_text(), 'previous public')
            model['sha256'] = hashlib.sha256(b'trusted fixture').hexdigest(); (modeldir / 'metadata.json').write_text(json.dumps(model))
            def fake_predictor(vectors, meta, payload):
                self.assertEqual(set(vectors), {photo_hash(1)}); self.assertEqual(meta['encoder'], model['encoder'])
                return {photo_hash(1): prediction()}
            coverage = run(fake_predictor)
            self.assertEqual(coverage['inferredImages'], 1); self.assertFalse(json.loads(output.read_text())['records'])
            self.assertEqual(json.loads(queuepath.read_text())['records'][0]['category'], 'chunky')

    def test_atomic_staging_or_replace_failure_preserves_public_and_cleans_temp_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); output, queuepath = root / 'snapshot.json', root / 'queue.json'
            output.write_text('old'); queuepath.write_text('old queue')
            with self.assertRaises(ValueError): publication.atomic_documents(output, {'bad': math_nan()}, queuepath, {})
            self.assertEqual(output.read_text(), 'old'); self.assertEqual(queuepath.read_text(), 'old queue')
            original = os.replace
            def fail_public(src, dst):
                if Path(dst) == output: raise OSError('fixture replacement failure')
                original(src, dst)
            with patch.object(publication.os, 'replace', side_effect=fail_public):
                with self.assertRaises(OSError): publication.atomic_documents(output, {}, queuepath, {})
            self.assertEqual(output.read_text(), 'old'); self.assertFalse(list(root.glob('*.tmp')))

    def test_partial_cannot_write_canonical_public_or_operational_queue(self):
        for output, queuepath in [('public/data/visual-classifications.json', None),
                                  (None, '.secrets/clip/admin-queue.json')]:
            with self.assertRaisesRegex(ValueError, 'Partial'):
                publication.publish(allow_partial=True, output=output, queue_output=queuepath)

    def test_import_and_cli_help_never_load_heavy_optional_packages(self):
        command = "import runpy,sys; runpy.run_path(sys.argv[1],run_name='publication_import'); assert not any(m in sys.modules for m in ('numpy','sklearn','torch','pandas'))"
        subprocess.run([sys.executable, '-S', '-c', command, str(SCRIPT)], check=True, capture_output=True)
        subprocess.run([sys.executable, '-S', str(SCRIPT), '--help'], check=True, capture_output=True)


def math_nan():
    return float('nan')


if __name__ == '__main__':
    unittest.main()
