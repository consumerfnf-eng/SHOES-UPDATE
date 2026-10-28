import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from collect_instagram_hashtags import parse_hashtag_page

FIXTURE = (
    '...junk before...'
    '"page_logging":{"name":"popularSearchPage","params":{}},'
    '"title":"Sneakers","total_media_count_intl":"243M","initial_media_count":12,'
    '"related_keywords":["trending sneakers 2026","new balance 530 sneakers outfit ideas","sicko sneakers"]'
    '...junk after...'
)


class ParseHashtagPageTests(unittest.TestCase):
    def test_extracts_title_count_and_keywords(self):
        result = parse_hashtag_page(FIXTURE)
        self.assertEqual(result['title'], 'Sneakers')
        self.assertEqual(result['totalMediaCount'], '243M')
        self.assertEqual(result['relatedKeywords'],
                          ['trending sneakers 2026', 'new balance 530 sneakers outfit ideas', 'sicko sneakers'])

    def test_returns_none_when_block_absent(self):
        self.assertIsNone(parse_hashtag_page('<html>no hashtag data here</html>'))

    def test_handles_korean_unicode_escapes(self):
        fixture = ('"page_logging":{"name":"popularSearchPage","params":{}},'
                    '"title":"\\uc2e0\\ubc1c\\ucd94\\ucc9c","total_media_count_intl":"1.7M",'
                    '"initial_media_count":12,"related_keywords":[]')
        result = parse_hashtag_page(fixture)
        self.assertEqual(result['title'], '신발추천')
        self.assertEqual(result['relatedKeywords'], [])


if __name__ == '__main__':
    unittest.main()
