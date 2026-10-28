import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from update import match_mentions, tokenize


class TokenizeTests(unittest.TestCase):
    def test_drops_generic_color_and_short_words(self):
        tokens = tokenize('Black TTNM EVO Knitted Upper Sneakers')
        self.assertNotIn('black', tokens)
        self.assertNotIn('sneakers', tokens)
        self.assertIn('ttnm', tokens)
        self.assertIn('evo', tokens)


class MatchMentionsTests(unittest.TestCase):
    def setUp(self):
        self.items = [
            {'brand': 'New Balance', 'name': 'Grey 991v2 Sneakers'},
            {'brand': 'BOSS', 'name': 'Black TTNM EVO Knitted Upper Sneakers'},
        ]

    def test_matches_brand_plus_model_token(self):
        mentions = [{'headline': 'New Balance 991v2 Prepares for Fall in "Iron/Mulch"'}]
        unmatched = match_mentions(self.items, mentions, 'headline')
        self.assertEqual(unmatched, [])
        self.assertEqual(len(self.items[0]['_mentions']), 1)
        self.assertNotIn('_mentions', self.items[1])

    def test_brand_only_mention_is_held_not_matched(self):
        # Brand name alone (no model token overlap) must not count as a match.
        mentions = [{'headline': 'New Balance teases a new colorway'}]
        unmatched = match_mentions(self.items, mentions, 'headline')
        self.assertEqual(len(unmatched), 1)
        self.assertNotIn('_mentions', self.items[0])

    def test_unrelated_mention_is_held(self):
        mentions = [{'headline': 'Totally unrelated jacket release'}]
        unmatched = match_mentions(self.items, mentions, 'headline')
        self.assertEqual(len(unmatched), 1)


if __name__ == '__main__':
    unittest.main()
