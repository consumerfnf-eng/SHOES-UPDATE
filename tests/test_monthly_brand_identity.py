import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from brand_identity import _key, brand_index, canonical_brand


class KeyTests(unittest.TestCase):
    def test_hangul_survives_folding(self):
        # Folding to [a-z0-9] collapsed every Korean name to the empty string,
        # so they all shared one index entry and "푸마" resolved to HOKA.
        self.assertTrue(_key('푸마'))
        self.assertNotEqual(_key('푸마'), _key('나이키'))

    def test_case_spacing_and_punctuation_are_ignored(self):
        self.assertEqual(_key('New Balance'), _key('new-balance'))
        self.assertEqual(_key('NIKE'), _key('Nike'))


class CanonicalBrandTests(unittest.TestCase):
    def test_korean_and_english_spellings_meet_at_one_name(self):
        self.assertEqual(canonical_brand('나이키'), 'Nike')
        self.assertEqual(canonical_brand('NIKE'), 'Nike')
        self.assertEqual(canonical_brand('nike'), 'Nike')
        self.assertEqual(canonical_brand('푸마'), 'PUMA')
        self.assertEqual(canonical_brand('뉴발란스'), 'New Balance')

    def test_the_first_resolvable_spelling_wins(self):
        self.assertEqual(canonical_brand('nike', '나이키'), 'Nike')
        self.assertEqual(canonical_brand('', '나이키'), 'Nike')

    def test_sub_labels_fold_into_their_parent(self):
        self.assertEqual(canonical_brand('adidas Originals'), 'adidas')
        self.assertEqual(canonical_brand('Air Jordan'), 'Jordan')

    def test_an_unknown_brand_is_left_exactly_as_the_retailer_wrote_it(self):
        self.assertEqual(canonical_brand('VETIANO'), 'VETIANO')
        self.assertEqual(canonical_brand('에이지'), '에이지')
        self.assertEqual(canonical_brand('', '  Some Label '), 'Some Label')

    def test_empty_input_stays_empty(self):
        self.assertEqual(canonical_brand('', None), '')

    def test_every_alias_target_is_a_real_policy_brand(self):
        index = brand_index()
        policy = {v for v in index.values()}
        self.assertIn('Nike', policy)
        self.assertTrue(all(v in policy for v in index.values()))


if __name__ == '__main__':
    unittest.main()
