import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from collect_musinsa import build_item, first_page_from_html, next_page_of

# Shape confirmed by hand against the live __NEXT_DATA__ payload.
NEXT_PAGE = ('https://api.musinsa.com/api2/dp/v2/plp/goods?gf=A&sortCode=NEW&category=103004'
             '&size=60&testGroup=&caller=CATEGORY&page=2&hmacId=abc123')
FIXTURE = {
    'props': {'pageProps': {'dehydratedState': {'queries': [
        {'state': {'data': {'pages': [{'data': {
            'list': [
                {'goodsNo': 1, 'goodsName': '클럽 C 85 빈티지 - 클래식 그레이 / 100278986',
                 'brandName': '리복', 'brand': 'reebok',
                 'goodsLinkUrl': 'https://www.musinsa.com/products/1', 'thumbnail': 'https://img/1.jpg',
                 'finalPrice': 179000, 'displayGenderText': '남성'},
                {'goodsNo': 2, 'goodsName': '키높이 페니로퍼', 'brandName': '착한구두', 'brand': 'chaakan',
                 'goodsLinkUrl': 'https://www.musinsa.com/products/2', 'thumbnail': 'https://img/2.jpg',
                 'finalPrice': 59900, 'displayGenderText': '여성'},
            ],
            'pagination': {'page': 1, 'hasNext': True, 'nextPageUrl': NEXT_PAGE},
        }}]}}},
    ]}}}}
HTML = '<html><script id="__NEXT_DATA__" type="application/json">' + json.dumps(FIXTURE) + '</script></html>'
SNEAKERS = {'code': '103004', 'label': '스니커즈'}


class FirstPageTests(unittest.TestCase):
    def test_finds_the_real_product_list_and_next_page_link(self):
        goods, next_url = first_page_from_html(HTML)
        self.assertEqual(len(goods), 2)
        self.assertEqual(goods[0]['goodsNo'], 1)
        self.assertEqual(next_url, NEXT_PAGE)

    def test_returns_nothing_without_next_data(self):
        self.assertEqual(first_page_from_html('<html>no next data here</html>'), (None, None))


class NextPageTests(unittest.TestCase):
    def test_reads_the_freshly_signed_link_off_an_api_response(self):
        payload = {'data': {'list': [], 'pagination': {'nextPageUrl': NEXT_PAGE}}}
        self.assertEqual(next_page_of(payload), NEXT_PAGE)

    def test_returns_none_on_the_last_page(self):
        self.assertIsNone(next_page_of({'data': {'list': [], 'pagination': {}}}))


class BuildItemTests(unittest.TestCase):
    def setUp(self):
        self.goods, _ = first_page_from_html(HTML)

    def test_splits_musinsas_model_colorway_style_title(self):
        item, reason = build_item(self.goods[0], SNEAKERS, '2026-10-28T00:00:00+09:00', 'listing', 1)
        self.assertEqual(reason, '')
        self.assertEqual(item['name'], '클럽 C 85 빈티지')
        self.assertEqual(item['colorway'], '클래식 그레이')
        self.assertEqual(item['style'], '100278986')
        self.assertEqual(item['brand'], '리복')
        self.assertEqual(item['gender'], 'men')
        self.assertEqual(item['priceLabel'], '179,000원')
        self.assertEqual(item['category'], 'sneaker')

    def test_records_the_listing_position_as_the_newness_evidence(self):
        item, _ = build_item(self.goods[0], SNEAKERS, '2026-10-28T00:00:00+09:00', 'listing', 7)
        self.assertIn('신상품순', item['retailerEvidence']['listingBasis'])
        self.assertIn('7번째', item['retailerEvidence']['listingBasis'])

    def test_drops_a_dress_shoe_filed_under_a_sneaker_category(self):
        item, reason = build_item(self.goods[1], SNEAKERS, '2026-10-28T00:00:00+09:00', 'listing', 2)
        self.assertIsNone(item)
        self.assertEqual(reason, 'excluded-silhouette')


if __name__ == '__main__':
    unittest.main()
