import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from collect_balardi import (build_item, collect, model_name, price_label,
                             split_listing_name, style_code, tag_colorway)

# Shapes taken from live /ko-kr/collections/womens-sneakers/products.json records.
LANVIN = {
    'id': 7977828712597, 'title': '랜빈 라이트 연석 운동화', 'handle': 'lanvin-lite-curb-sneakers-3',
    'vendor': 'Lanvin', 'product_type': "Women's Sneakers",
    'published_at': '2026-10-14T16:25:47+02:00', 'created_at': '2026-10-05T02:33:23+03:00',
    'tags': ['3variants', 'DISCOUNT40', 'Gender_Women', 'Italy', 'Leather', 'New Season', 'White'],
    'variants': [{'sku': 'SKDK0BVESU-A2300-35', 'price': '336000', 'option1': '35'},
                 {'sku': 'SKDK0BVESU-A2300-36', 'price': '336000', 'option1': '36'}],
    'images': [{'src': 'https://cdn.shopify.com/s/files/1/0299/lanvin.jpg?v=1'}],
}
CHLOE = {
    'id': 1, 'title': '클로에 운동화', 'handle': 'chloe-nama-sneakers-26', 'vendor': 'Chloé',
    'product_type': "Women's Sneakers", 'published_at': '2026-10-22T00:00:00+02:00',
    'created_at': '2026-10-22T00:00:00+02:00', 'tags': ['ITSUP94', 'SHOES', 'Sneakers'],
    'variants': [{'sku': '7001017100040', 'price': '1000000'}],
    'images': [{'src': 'https://cdn.shopify.com/s/files/1/0299/nama.jpg'}],
}
OLD_STOCK = {**CHLOE, 'id': 2, 'handle': 'chloe-nama-sneakers-9',
             'created_at': '2024-06-01T00:00:00+03:00', 'published_at': '2026-10-22T00:00:00+02:00'}
KIDS = {**LANVIN, 'id': 3, 'handle': 'nike-air-force-1-toddler-shoes', 'vendor': 'Nike'}
BAG = {**LANVIN, 'id': 4, 'handle': 'lanvin-leather-tote-bag', 'vendor': 'Lanvin',
       'product_type': 'WOMAN ACCESSORIES', 'tags': ['Leather']}


class BalardiCollector(unittest.TestCase):
    def test_the_name_comes_from_the_handle_not_the_translated_title(self):
        # "라이트 연석" is this shop translating "Lite Curb" word by word.
        item, reason = build_item(LANVIN, '2026-10-30T00:00:00+09:00')
        self.assertEqual(reason, '')
        self.assertEqual(item['name'], 'Lite Curb Sneakers')
        self.assertEqual(item['fullName'], '랜빈 라이트 연석 운동화')
        self.assertEqual(item['brand'], 'Lanvin')

    def test_an_accented_brand_still_comes_off_the_front_of_its_handle(self):
        # Vendor "Chloé", handle "chloe-...": without folding the accent the
        # card was named "Chloe Nama Sneakers" and stood apart from its own
        # colourways.
        self.assertEqual(model_name('chloe-nama-sneakers-26', 'Chloé'), 'Nama Sneakers')
        self.assertEqual(model_name('tods-gommino-sneakers', "Tod's"), 'Gommino Sneakers')

    def test_a_leading_colour_and_material_are_fields_not_a_name(self):
        self.assertEqual(split_listing_name('Brown Fabric And Suede Nama Sneakers'),
                         ('Nama Sneakers', 'Brown', 'Fabric Suede'))
        self.assertEqual(split_listing_name('Antiqued Pink Leather Nama Sneakers'),
                         ('Nama Sneakers', 'Antiqued Pink', 'Leather'))
        self.assertEqual(split_listing_name('Nama Sneakers'), ('Nama Sneakers', '', ''))
        # A listing that is nothing but colour words keeps the name it has.
        self.assertEqual(split_listing_name('Black White'), ('Black White', '', ''))

    def test_the_colour_is_read_from_the_shops_own_tag_when_it_states_one(self):
        self.assertEqual(tag_colorway(LANVIN['tags'], 'Lite Curb Sneakers'), 'White')
        self.assertEqual(tag_colorway(['Color_Beige', '38'], 'X'), 'Beige')
        # The newest listings carry no colour tag at all; nothing is invented.
        self.assertEqual(tag_colorway(CHLOE['tags'], 'Nama Sneakers'), '')

    def test_the_style_is_the_sku_without_its_size(self):
        self.assertEqual(style_code(LANVIN), 'SKDK0BVESU-A2300')
        self.assertEqual(style_code(CHLOE), '7001017100040')

    def test_the_price_is_the_variant_price_in_won(self):
        self.assertEqual(price_label(LANVIN), '336,000원')
        self.assertEqual(price_label({'variants': [{'price': '0'}]}), '')

    def test_restocked_old_products_garments_and_kids_sizes_stay_out(self):
        checked = '2026-10-30T00:00:00+09:00'
        self.assertIsNone(build_item(KIDS, checked)[0])
        self.assertEqual(build_item(KIDS, checked)[1], 'kids')
        self.assertIsNone(build_item(BAG, checked)[0])
        # A 2024 record re-published this week is the shop restocking.
        status = {'pages': 0, 'candidates': 0, 'kept': 0, 'tooOld': 0, 'dropped': {}, 'errors': [],
                  'pageCapHit': False}
        pages = [[CHLOE, OLD_STOCK], []]
        import collect_balardi
        original = collect_balardi.fetch_json
        collect_balardi.fetch_json = lambda url, attempts=4: ({'products': pages.pop(0)}, '')
        try:
            items = collect(checked, '2026-07-30', status)
        finally:
            collect_balardi.fetch_json = original
        self.assertEqual([i['id'] for i in items], [build_item(CHLOE, checked)[0]['id']])
        self.assertEqual(status['tooOld'], 1)


if __name__ == '__main__':
    unittest.main()
