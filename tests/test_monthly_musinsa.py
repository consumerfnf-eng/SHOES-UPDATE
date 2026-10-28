import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from collect_musinsa import extract_list, NON_SNEAKER_RE

# Shape confirmed by hand against the live __NEXT_DATA__ payload.
FIXTURE = {
    'props': {'pageProps': {'dehydratedState': {'queries': [
        {'state': {'data': {'pages': [{'data': {'list': [
            {'goodsNo': 1, 'goodsName': 'Club C 85 Vintage', 'brandName': '리복', 'brand': 'reebok',
             'goodsLinkUrl': 'https://www.musinsa.com/products/1', 'thumbnail': 'https://img/1.jpg',
             'finalPrice': 179000, 'displayGenderText': '남성'},
            {'goodsNo': 2, 'goodsName': '키높이 페니로퍼', 'brandName': '착한구두', 'brand': 'chaakan',
             'goodsLinkUrl': 'https://www.musinsa.com/products/2', 'thumbnail': 'https://img/2.jpg',
             'finalPrice': 59900, 'displayGenderText': '여성'},
        ]}}]}}},
    ]}}}}
HTML = '<html><script id="__NEXT_DATA__" type="application/json">' + json.dumps(FIXTURE) + '</script></html>'


class ExtractListTests(unittest.TestCase):
    def test_finds_the_real_product_list_path(self):
        result = extract_list(HTML)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['goodsName'], 'Club C 85 Vintage')

    def test_returns_none_without_next_data(self):
        self.assertIsNone(extract_list('<html>no next data here</html>'))


class NonSneakerExclusionTests(unittest.TestCase):
    def test_excludes_loafers_and_dress_shoes(self):
        self.assertTrue(NON_SNEAKER_RE.search('키높이 페니로퍼'))
        self.assertTrue(NON_SNEAKER_RE.search('정장 구두'))

    def test_allows_genuine_sneaker_names(self):
        self.assertFalse(NON_SNEAKER_RE.search('Club C 85 Vintage'))
        self.assertFalse(NON_SNEAKER_RE.search('척 테일러 올스타 번트 허니'))


if __name__ == '__main__':
    unittest.main()
