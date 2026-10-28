import sys, unittest
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from common import is_sneaker_title, canonical_url, kst_three_months_ago, short_id


class SneakerClassificationTests(unittest.TestCase):
    def test_includes_sneaker_terms(self):
        self.assertTrue(is_sneaker_title('Black Low-Top Sneakers'))
        self.assertTrue(is_sneaker_title('White TTNM EVO Running Shoes'))
        self.assertTrue(is_sneaker_title('Grey Trainers'))

    def test_excludes_other_footwear(self):
        self.assertFalse(is_sneaker_title('Black Wallabee Boots'))
        self.assertFalse(is_sneaker_title('Brown Suede Desert Boots'))
        self.assertFalse(is_sneaker_title('Black Loafers'))
        self.assertFalse(is_sneaker_title('Red Heels'))

    def test_mixed_terms_require_explicit_sneaker_word(self):
        # A boot/sandal word with no sneaker word anywhere must not pass.
        self.assertFalse(is_sneaker_title('Hiking Boots'))


class CanonicalUrlTests(unittest.TestCase):
    def test_strips_tracking_params_and_www(self):
        a = canonical_url('https://www.example.com/products/shoe?utm_source=ig&color=black')
        b = canonical_url('https://example.com/products/shoe?color=black')
        self.assertEqual(a, b)

    def test_rejects_non_https(self):
        self.assertEqual(canonical_url('http://example.com/x'), '')


class ThreeMonthsAgoTests(unittest.TestCase):
    def test_calendar_month_subtraction(self):
        self.assertEqual(kst_three_months_ago(datetime(2026, 10, 27)).strftime('%Y-%m-%d'), '2026-07-27')

    def test_handles_month_shorter_than_source_day(self):
        # May 31 - 3 months = Feb (28/29 days); must clamp, not crash or roll over.
        result = kst_three_months_ago(datetime(2026, 5, 31))
        self.assertEqual((result.year, result.month), (2026, 2))
        self.assertLessEqual(result.day, 28)


class ShortIdTests(unittest.TestCase):
    def test_deterministic_and_distinct(self):
        a = short_id('monthly-ssense', 'Nike', 'https://example.com/a')
        b = short_id('monthly-ssense', 'Nike', 'https://example.com/a')
        c = short_id('monthly-ssense', 'Nike', 'https://example.com/b')
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertTrue(a.startswith('monthly-ssense-'))


if __name__ == '__main__':
    unittest.main()
