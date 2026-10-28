import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from collect_lyst_scrapingbee import parse_card, valid_lyst_page

# Real markup pattern confirmed by hand against the live Lyst "Newest" sort
# (JS-evaluated DOM extraction during this project's research session).
REAL_CARD = (
    '"><div><div class="bqic2g1 bqic2g5"><div data-testid="campaign-children">'
    '<a href="https://www.lyst.com/track/lead/1245702002/?pageViewId=x" '
    'data-testid="product-card-lead-link" class="afcm1b1" target="_blank" '
    'aria-label="View PUMA Jil Sander X Speedcat Low-Top Sneakers - Black at VITKAC">'
    '<span data-testid="product-card-image"><img width="300" height="375" '
    'src="https://cdna.lystit.com/300/375/tr/photos/vitkac/puma-speedcat.jpeg" '
    'alt="PUMA Jil Sander X Speedcat Low-Top Sneakers - Black"></span></a></div>'
    '<div data-testid="product-price"><div data-testid="not-on-sale">$418</div></div>'
    '<a href="/shoes/puma-jil-sander-x-speedcat-low-top-trainers/">link</a></div>'
)


class ParseCardTests(unittest.TestCase):
    def test_extracts_brand_name_price_url_image_retailer(self):
        result = parse_card(REAL_CARD)
        self.assertEqual(result['brand'], 'PUMA Jil Sander')
        self.assertEqual(result['name'], 'PUMA Jil Sander X Speedcat Low-Top Sneakers')
        self.assertEqual(result['priceLabel'], '$418')
        self.assertEqual(result['url'], 'https://www.lyst.com/shoes/puma-jil-sander-x-speedcat-low-top-trainers/')
        self.assertEqual(result['image'], 'https://cdna.lystit.com/300/375/tr/photos/vitkac/puma-speedcat.jpeg')
        self.assertEqual(result['retailer'], 'VITKAC')

    def test_returns_none_without_image_or_url(self):
        self.assertIsNone(parse_card('<div>no product markers here</div>'))


class ValidLystPageTests(unittest.TestCase):
    def test_real_page_is_valid(self):
        self.assertTrue(valid_lyst_page('<div data-testid="product-card">...</div>'))

    def test_block_page_is_invalid(self):
        self.assertFalse(valid_lyst_page('<html><body>Access Denied</body></html>'))


if __name__ == '__main__':
    unittest.main()
