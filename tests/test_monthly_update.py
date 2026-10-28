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

    def test_registered_alias_matches_every_variant_without_brand_word(self):
        items = [
            {'brand': 'PUMA', 'name': 'Black Speedcat OG Sneakers'},
            {'brand': 'PUMA', 'name': 'Jil Sander X Speedcat Low-Top Sneakers'},
            {'brand': 'PUMA', 'name': 'White Low-Top Sneakers'},
        ]
        aliases = {'puma:speedcat': {'brand': 'PUMA', 'model': 'Speedcat', 'aliases': ['스피드캣', 'speedcat']}}
        mentions = [{'caption': '오늘 스피드캣 신고 나왔어요'}]
        unmatched = match_mentions(items, mentions, 'caption', aliases)
        self.assertEqual(unmatched, [])
        self.assertEqual(len(items[0]['_mentions']), 1)
        self.assertEqual(len(items[1]['_mentions']), 1)
        self.assertNotIn('_mentions', items[2])

    def test_unregistered_korean_mention_without_alias_is_held(self):
        items = [{'brand': 'PUMA', 'name': 'Black Speedcat OG Sneakers'}]
        mentions = [{'caption': '오늘 스피드캣 신고 나왔어요'}]
        unmatched = match_mentions(items, mentions, 'caption', model_aliases={})
        self.assertEqual(len(unmatched), 1)
        self.assertNotIn('_mentions', items[0])


if __name__ == '__main__':
    unittest.main()
