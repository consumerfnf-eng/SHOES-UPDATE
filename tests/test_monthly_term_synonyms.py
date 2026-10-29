import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from term_synonyms import expand, fold, generic_terms, synonym_groups


class FoldTests(unittest.TestCase):
    def test_hangul_survives(self):
        # NFKD would decompose Hangul into Jamo and strip it all away.
        self.assertEqual(fold('발레 스니커즈'), '발레스니커즈')
        self.assertNotEqual(fold('발레'), fold('메리제인'))

    def test_case_and_punctuation_fall_away(self):
        self.assertEqual(fold('#Ballet-Sneakers!'), 'balletsneakers')


class ExpansionTests(unittest.TestCase):
    def test_a_korean_keyword_reaches_english_listings(self):
        terms = expand('발레스니커즈')
        self.assertIn('ballet', terms)
        self.assertIn('발레', terms)

    def test_an_english_keyword_reaches_korean_listings(self):
        self.assertIn('고프코어', expand('gorpcore'))
        self.assertIn('청키', expand('chunky'))

    def test_brand_spellings_come_from_the_shared_brand_list(self):
        terms = expand('뉴발란스530')
        self.assertIn('newbalance', terms)
        self.assertIn('뉴발란스', terms)

    def test_a_model_inside_a_run_on_hashtag_is_found(self):
        self.assertIn('jordan', expand('조던1'))
        self.assertIn('dunk', expand('나이키덩크'))


class GenericTermTests(unittest.TestCase):
    def test_category_words_never_become_match_terms(self):
        # Letting a keyword expand into "스니커즈" made every keyword match
        # every sneaker: 3,695 of 3,925 items matched three or more keywords.
        for term in expand('발레스니커즈'):
            self.assertNotIn(term, generic_terms())

    def test_a_keyword_that_is_only_a_category_word_matches_nothing(self):
        for tag in ('스니커즈추천', '남자스니커즈', '신발추천', 'sneakers'):
            self.assertEqual(expand(tag), [], tag)

    def test_a_specific_keyword_still_keeps_its_own_terms(self):
        self.assertTrue(expand('스피드캣'))
        self.assertTrue(expand('살로몬'))

    def test_every_generic_group_is_declared_separately_from_the_synonyms(self):
        generic = generic_terms()
        self.assertIn('스니커즈', generic)
        self.assertIn('sneaker', generic)
        for group in synonym_groups():
            self.assertFalse(group <= generic, group)


if __name__ == '__main__':
    unittest.main()
