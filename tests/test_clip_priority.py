"""Deterministic split/leakage contracts; no ML or image dependencies."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
spec = importlib.util.spec_from_file_location('clip_priority',
    Path(__file__).resolve().parents[1] / 'scripts/select-visual-priority.py')
priority = importlib.util.module_from_spec(spec)
spec.loader.exec_module(priority)


def photo(n, brand, model=None):
    return {'imageHash': f'{n:064x}', 'path': f'public/images/{n:064x}.jpg',
            'products': [{'id': f'p{n}', 'brand': brand, 'modelKey': model or f'{brand}|{n}',
                          'name': 'Lace-up Sneakers', 'productType': 'sneaker',
                          'url': f'https://example.org/{n}', 'image': 'original-url'}]}


def fixture():
    rows = [photo(1, 'Nike'), photo(2, 'Nike'), photo(3, 'Cal A'), photo(4, 'Cal B'),
            photo(5, 'New A'), photo(6, 'New A'), photo(7, 'New B'),
            photo(8, 'Exposed'), photo(9, 'Exposed', 'Exposed|8'),
            photo(10, 'PUMA'), photo(11, 'Cal A')]
    audit = {'records': [{'imageHash': f'{n:064x}', 'modelKey': rows[n-1]['products'][0]['modelKey'],
                          'brand': rows[n-1]['products'][0]['brand'], 'split': split,
                          'truth': truth, 'status': 'reviewed', 'notes': 'Side view of shoe'}
                         for n, split, truth in [(1, 'train', 'boot'), (2, 'train', 'chunky'),
                                                 (3, 'calibration', 'boot'), (4, 'calibration', 'boot'),
                                                 (8, 'fresh-test', 'boot')]]}
    queue = {'model': {'version': 'fixture-v1'}, 'records': [
        {'imageHash': r['imageHash'], 'products': r['products'], 'category': 'chunky',
         'confidence': .9, 'margin': .7} for r in rows if r['imageHash'] in {a['imageHash'] for a in audit['records']}]}
    return {'images': rows}, audit, queue


class PrioritySelectionTests(unittest.TestCase):
    def select(self, manifest, audit, queue, **kwargs):
        return priority.select_priority(manifest, audit, queue, ['Puma'], per_role=2, **kwargs)

    def test_balanced_roles_new_test_and_teacher_brand_exclusion(self):
        manifest, audit, queue = fixture()
        result = self.select(manifest, audit, queue)
        self.assertEqual([r['role'] for r in result['images']],
                         ['train']*2 + ['calibration']*2 + ['test']*2)
        test = [r for r in result['images'] if r['role'] == 'test']
        self.assertEqual({r['brand'] for r in test}, {'New A', 'New B'})
        old = {r['imageHash'] for r in audit['records']}
        old_models = {r['modelKey'] for r in audit['records']}
        self.assertTrue(all(r['imageHash'] not in old and r['modelKey'] not in old_models for r in test))
        groups = [{priority.brand_key(r['brand']) for r in result['images'] if r['role'] == role}
                  for role in priority.ROLES]
        self.assertFalse(groups[0] & groups[1] or groups[0] & groups[2] or groups[1] & groups[2])

    def test_test_selection_is_invariant_to_all_predictions_and_all_truth(self):
        manifest, audit, queue = fixture()
        before = self.select(manifest, audit, queue)
        for row in audit['records']:
            row['truth'] = 'sandal'
            row['category'] = 'performance'
        for row in queue['records']:
            row.update(category='boot', confidence=.01, margin=.001)
        after = self.select(manifest, audit, queue)
        self.assertEqual([r for r in before['images'] if r['role'] == 'test'],
                         [r for r in after['images'] if r['role'] == 'test'])

    def test_input_order_does_not_change_selection_or_leak_reference_fields(self):
        manifest, audit, queue = fixture()
        before = deepcopy((manifest, audit, queue))
        a = self.select(manifest, audit, queue)
        self.assertEqual((manifest, audit, queue), before)
        b = self.select({'images': list(reversed(manifest['images']))},
                        {'records': list(reversed(audit['records']))},
                        {**queue, 'records': list(reversed(queue['records']))})
        self.assertEqual(a, b)
        for row in a['images']:
            self.assertFalse(set(row) & {'truth', 'category', 'confidence', 'notes', 'alternatives'})
            original = next(r for r in manifest['images'] if r['imageHash'] == row['imageHash'])
            self.assertEqual(row['products'], original['products'])

    def test_uncertain_disagreement_prioritized_within_brand(self):
        manifest, audit, queue = fixture()
        result = self.select(manifest, audit, queue)
        train = [r for r in result['images'] if r['role'] == 'train']
        self.assertEqual(train[0]['imageHash'], f'{1:064x}')

    def test_all_linked_design_keys_prevent_color_duplicates(self):
        manifest, audit, queue = fixture()
        for row in manifest['images']:
            if row['imageHash'] in {f'{1:064x}', f'{2:064x}'}:
                row['products'].append({**row['products'][0], 'id': 'shared', 'modelKey': 'Nike|same'})
        with self.assertRaisesRegex(ValueError, 'Insufficient.*train'):
            self.select(manifest, audit, queue)

    def test_eligibility_rejects_blank_bad_views_and_garment_metadata(self):
        manifest, audit, queue = fixture()
        audit['records'][0]['notes'] = 'Image contains only a wordmark; no shoe'
        with self.assertRaisesRegex(ValueError, 'Insufficient.*train'):
            self.select(manifest, audit, queue)
        manifest, audit, queue = fixture()
        manifest['images'][0]['products'][0]['name'] = 'Winter Gloves'
        with self.assertRaisesRegex(ValueError, 'Insufficient.*train'):
            self.select(manifest, audit, queue)
        manifest, audit, queue = fixture()
        with self.assertRaisesRegex(ValueError, 'Insufficient.*test'):
            self.select(manifest, audit, queue, eligible=lambda r: r['products'][0]['brand'] != 'New A')

    def test_teacher_brand_alias_and_duplicate_manifest_fail_closed(self):
        manifest, audit, queue = fixture()
        manifest['images'][4]['products'][0]['brand'] = 'Puma'
        manifest['images'][5]['products'][0]['brand'] = 'PUMA'
        with self.assertRaisesRegex(ValueError, 'Insufficient.*test'):
            self.select(manifest, audit, queue)
        manifest, audit, queue = fixture()
        manifest['images'].append(manifest['images'][0])
        with self.assertRaisesRegex(ValueError, 'Duplicate manifest'):
            self.select(manifest, audit, queue)


if __name__ == '__main__':
    unittest.main()
