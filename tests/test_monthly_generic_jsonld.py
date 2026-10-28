import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from collect_generic_jsonld import extract_products, to_item, SOURCES

PLAIN_HTML = f'''<html><head>
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"Product","name":"Black Low-Top Sneakers",
"sku":"ABC123","brand":{{"@type":"Brand","name":"Example Brand"}},
"image":"https://img.example/abc123.jpg",
"offers":{{"@type":"Offer","price":450,"priceCurrency":"EUR","url":"https://example.com/p/abc123"}}}}
</script></head><body></body></html>'''

GRAPH_HTML = '''<html><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"BreadcrumbList","itemListElement":[]},
  {"@type":"Product","name":"White Trainers","brand":"Other Brand",
   "image":["https://img.example/white.jpg"],
   "offers":[{"price":300,"priceCurrency":"USD","url":"https://example.com/p/white"}]}
]}
</script></html>'''

NO_PRODUCTS_HTML = '<html><script type="application/ld+json">{"@type":"WebPage"}</script></html>'


class ExtractProductsTests(unittest.TestCase):
    def test_finds_a_plain_product_block(self):
        products = extract_products(PLAIN_HTML)
        self.assertEqual(len(products), 1)
        self.assertEqual(products[0]['name'], 'Black Low-Top Sneakers')

    def test_finds_a_product_nested_in_a_graph(self):
        products = extract_products(GRAPH_HTML)
        self.assertEqual(len(products), 1)
        self.assertEqual(products[0]['name'], 'White Trainers')

    def test_returns_empty_when_no_product_type_present(self):
        self.assertEqual(extract_products(NO_PRODUCTS_HTML), [])


class ToItemTests(unittest.TestCase):
    def test_builds_an_item_from_a_full_product_block(self):
        products = extract_products(PLAIN_HTML)
        item = to_item(products[0], SOURCES[0])
        self.assertEqual(item['brand'], 'Example Brand')
        # name is the model; the leading colorway is split off into its own
        # field, matching the shape the other retail collectors emit.
        self.assertEqual(item['name'], 'Low-Top Sneakers')
        self.assertEqual(item['fullName'], 'Black Low-Top Sneakers')
        self.assertEqual(item['colorway'], 'Black')
        self.assertEqual(item['image'], 'https://img.example/abc123.jpg')
        self.assertEqual(item['url'], 'https://example.com/p/abc123')
        self.assertEqual(item['priceLabel'], 'EUR 450')
        self.assertEqual(item['sku'], 'ABC123')

    def test_handles_list_valued_image_and_offers(self):
        products = extract_products(GRAPH_HTML)
        item = to_item(products[0], SOURCES[1])
        self.assertEqual(item['image'], 'https://img.example/white.jpg')
        self.assertEqual(item['priceLabel'], 'USD 300')

    def test_rejects_a_product_missing_url_or_image(self):
        bare = {'name': 'No Image Sneakers', 'offers': {'price': 1, 'url': 'https://example.com/x'}}
        self.assertIsNone(to_item(bare, SOURCES[0]))


if __name__ == '__main__':
    unittest.main()
