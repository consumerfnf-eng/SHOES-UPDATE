import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from update import first_listed_index, is_rerelease, model_key, style_key

CUTOFF = '2026-07-29'
old_en = {'brand': 'Converse', 'name': 'Chuck 70 AT-CX Sneakers', 'colorway': 'White',
          'style': 'A08990C', 'listedAt': '2022-08-26T00:00:00Z'}
relisted_kr = {'brand': 'Converse', 'name': '척 70 AT-CX', 'colorway': '화이트',
               'style': 'A08990C', 'listedAt': '2026-10-20T00:00:00+09:00'}
fresh = {'brand': 'Nike', 'name': 'Mind 002 Flyknit', 'colorway': 'Black',
         'style': 'HQ4310-500', 'listedAt': '2026-10-14T00:00:00+09:00'}


class KeyTests(unittest.TestCase):
    def test_the_colourway_and_category_words_leave_the_model_key(self):
        self.assertEqual(model_key(old_en), 'converse|chuck70atcx')

    def test_a_model_name_too_short_to_identify_anything_has_no_key(self):
        self.assertEqual(model_key({'brand': 'Nike', 'name': 'A'}), '')
        self.assertEqual(model_key({'brand': '', 'name': 'Chuck 70'}), '')

    def test_a_style_code_is_the_same_in_every_language(self):
        self.assertEqual(style_key(old_en), style_key(relisted_kr))

    def test_a_short_or_missing_style_code_is_not_used_as_identity(self):
        self.assertEqual(style_key({'style': 'AB12'}), '')
        self.assertEqual(style_key({}), '')


class RereleaseTests(unittest.TestCase):
    def test_an_old_shoe_relisted_today_is_not_new(self):
        # 29CM and Musinsa stamp a re-listing with today's date, so the date
        # on the listing cannot answer this on its own.
        index = first_listed_index([old_en, relisted_kr, fresh], {})
        self.assertTrue(is_rerelease(relisted_kr, index, CUTOFF))

    def test_the_style_code_carries_the_evidence_across_languages(self):
        # The Korean listing's model name folds differently from the English
        # one; only the style code links them.
        index = first_listed_index([old_en], {})
        self.assertNotIn(model_key(relisted_kr), index)
        self.assertTrue(is_rerelease(relisted_kr, index, CUTOFF))

    def test_a_genuinely_new_model_is_left_alone(self):
        index = first_listed_index([old_en, relisted_kr, fresh], {})
        self.assertFalse(is_rerelease(fresh, index, CUTOFF))

    def test_evidence_carries_over_from_previous_runs(self):
        previous = {'converse|chuck70atcx': '2022-08-26'}
        index = first_listed_index([relisted_kr], previous)
        self.assertEqual(index['converse|chuck70atcx'], '2022-08-26')

    def test_the_index_keeps_the_earliest_date_it_has_ever_seen(self):
        later = {**old_en, 'listedAt': '2026-10-01T00:00:00Z'}
        index = first_listed_index([later, old_en], {})
        self.assertEqual(index['converse|chuck70atcx'], '2022-08-26')

    def test_an_unknown_shoe_is_not_assumed_old(self):
        self.assertFalse(is_rerelease(fresh, {}, CUTOFF))


if __name__ == '__main__':
    unittest.main()
