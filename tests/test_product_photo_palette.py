import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from product_photo_palette import color_name


class ProductPhotoPaletteTests(unittest.TestCase):
    def test_reported_upper_samples(self):
        for sample, expected in {
            '#47332d': 'Brown', '#bb8095': 'Pink', '#a27c60': 'Brown',
        }.items():
            with self.subTest(sample=sample):
                self.assertEqual(color_name(sample), expected)

    def test_dark_chromatic_samples_retain_hue(self):
        for sample, expected in {
            '#302119': 'Brown', '#47332d': 'Brown',
            '#14263f': 'Navy', '#293646': 'Navy', '#0b1830': 'Navy',
            '#163c27': 'Green', '#102b18': 'Green', '#123030': 'Blue',
            '#482238': 'Red', '#392349': 'Purple',
        }.items():
            with self.subTest(sample=sample):
                self.assertEqual(color_name(sample), expected)

    def test_neutrals(self):
        for sample, expected in {
            '#000000': 'Black', '#242424': 'Black', '#30302e': 'Black',
            '#555555': 'Grey', '#8d8d8b': 'Grey', '#bbbbbb': 'Grey',
            '#ffffff': 'White', '#efefeb': 'White', '#f9f8f4': 'White',
        }.items():
            with self.subTest(sample=sample):
                self.assertEqual(color_name(sample), expected)

    def test_warm_pale_cream_is_distinct_from_beige_and_brown(self):
        for sample, expected in {
            '#fff9e8': 'Cream', '#dfd7be': 'Cream', '#f2e6cc': 'Cream',
            '#bbab8b': 'Beige', '#d1bfa0': 'Beige',
            '#a27c60': 'Brown', '#715744': 'Brown',
        }.items():
            with self.subTest(sample=sample):
                self.assertEqual(color_name(sample), expected)

    def test_distinct_hue_families(self):
        for sample, expected in {
            '#486383': 'Blue', '#647350': 'Green', '#d6ba43': 'Yellow',
            '#aa3639': 'Red', '#d3a8b4': 'Pink', '#e9a6a6': 'Pink',
            '#85668e': 'Purple', '#c8773e': 'Orange',
        }.items():
            with self.subTest(sample=sample):
                self.assertEqual(color_name(sample), expected)

    def test_semantics_hold_across_brightness_for_chromatic_colors(self):
        for channels, expected in [((120, 75, 45), 'Brown'), ((40, 70, 115), 'Navy'), ((45, 105, 60), 'Green')]:
            for scale in (0.4, 0.6, 0.8, 1.0):
                sample = '#' + ''.join(f'{round(c * scale):02x}' for c in channels)
                with self.subTest(sample=sample):
                    self.assertEqual(color_name(sample), expected)

    def test_uppercase_and_invalid_input(self):
        self.assertEqual(color_name('#BB8095'), 'Pink')
        for invalid in (None, '', '47332d', '#fff', '#zzzzzz', '#47332d00', (71, 51, 45)):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    color_name(invalid)


if __name__ == '__main__':
    unittest.main()
