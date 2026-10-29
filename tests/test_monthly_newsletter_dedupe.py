import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from collect_newsletter import drop_translated_duplicates, image_join_key

CDN = 'https://image-cdn.hypb.st/https%3A%2F%2Fhypebeast.com%2Fimage%2F2026%2F10%2F28%2F'


def article(item_id, publisher_id, publisher, image, headline='x'):
    return {'id': item_id, 'publisher': publisher, 'url': f'https://example.com/{item_id}',
            'fullName': headline, 'image': image,
            'mediaEvidence': {'publisherId': publisher_id}}


class ImageJoinKeyTests(unittest.TestCase):
    def test_the_tw_prefix_and_suffix_do_not_change_the_key(self):
        a = image_join_key(CDN + 'TWNike-Dunk-Low-Basketball-Charm-ja3772-658-Official-Images.jpg')
        b = image_join_key(CDN + 'Nike-Dunk-Low-Basketball-Charm-ja3772-658-Official-Images-tw.jpg')
        self.assertTrue(a)
        self.assertEqual(a, b)

    def test_query_strings_and_extensions_are_ignored(self):
        a = image_join_key(CDN + 'Nike-Air-Max-90-Orewood-Release-Info.jpg?w=1080&q=90')
        b = image_join_key(CDN + 'Nike-Air-Max-90-Orewood-Release-Info.webp')
        self.assertEqual(a, b)

    def test_two_different_photos_do_not_share_a_key(self):
        self.assertNotEqual(image_join_key(CDN + 'Nike-Air-Max-90-Orewood-Release-Info.jpg'),
                            image_join_key(CDN + 'Nike-Dunk-Low-Panda-Release-Info.jpg'))

    def test_a_name_too_short_to_identify_anything_is_not_a_key(self):
        self.assertEqual(image_join_key('https://x/a.jpg'), '')
        self.assertEqual(image_join_key(''), '')


class TranslatedDuplicateTests(unittest.TestCase):
    def test_the_korean_edition_is_the_one_that_stays(self):
        items = [
            article('en', 'hypebeast', 'Hypebeast', CDN + 'Nike-Shox-R419-official-look-release-info-tw.jpg',
                    'Official Look at Corteiz x Nike Shox R419'),
            article('kr', 'hypebeast-kr', 'Hypebeast Korea', CDN + 'TWNike-Shox-R419-official-look-release-info.jpg',
                    'Corteiz x Nike Shox R419 오피셜 룩 공개'),
        ]
        status = {}
        kept = drop_translated_duplicates(items, status)
        self.assertEqual([i['id'] for i in kept], ['kr'])
        self.assertEqual(status['translatedDuplicatesDropped'], 1)

    def test_the_english_article_is_recorded_not_discarded(self):
        items = [
            article('en', 'hypebeast', 'Hypebeast', CDN + 'Nike-Shox-R419-official-look-release-info-tw.jpg'),
            article('kr', 'hypebeast-kr', 'Hypebeast Korea', CDN + 'TWNike-Shox-R419-official-look-release-info.jpg'),
        ]
        kept = drop_translated_duplicates(items, {})
        self.assertEqual([t['publisher'] for t in kept[0]['alsoPublishedAs']], ['Hypebeast'])

    def test_two_english_publishers_sharing_a_photo_are_both_kept(self):
        # Without a Korean edition there is nothing to consolidate into, and
        # dropping one publisher's coverage in favour of another's would be
        # an editorial choice this pipeline does not make.
        items = [
            article('a', 'hypebeast', 'Hypebeast', CDN + 'Nike-Shox-R419-official-look-release-info.jpg'),
            article('b', 'sneaker-news', 'Sneaker News', CDN + 'Nike-Shox-R419-official-look-release-info.jpg'),
        ]
        self.assertEqual(len(drop_translated_duplicates(items, {})), 2)

    def test_different_articles_are_left_alone(self):
        items = [
            article('a', 'hypebeast', 'Hypebeast', CDN + 'Nike-Air-Max-90-Orewood-Release-Info.jpg'),
            article('b', 'hypebeast-kr', 'Hypebeast Korea', CDN + 'Nike-Dunk-Low-Panda-Release-Info.jpg'),
        ]
        self.assertEqual(len(drop_translated_duplicates(items, {})), 2)

    def test_an_article_with_no_usable_image_is_never_merged_away(self):
        items = [
            article('a', 'hypebeast', 'Hypebeast', ''),
            article('b', 'hypebeast-kr', 'Hypebeast Korea', ''),
        ]
        self.assertEqual(len(drop_translated_duplicates(items, {})), 2)


if __name__ == '__main__':
    unittest.main()
