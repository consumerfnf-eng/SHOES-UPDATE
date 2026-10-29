import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from image_signals import body_colour, colour_distance, dhash, hamming

try:
    from PIL import Image
except Exception:  # pragma: no cover - the suite skips rather than fails
    Image = None


def swatch(rgb, size=200, background=(255, 255, 255), shoe_fraction=0.6):
    """A white studio frame with a coloured block in the middle, like a
    product shot: background, subject, and nothing else."""
    img = Image.new('RGB', (size, size), background)
    edge = int(size * (1 - shoe_fraction) / 2)
    for x in range(edge, size - edge):
        for y in range(edge, size - edge):
            img.putpixel((x, y), rgb)
    return img


@unittest.skipIf(Image is None, 'Pillow is not installed')
class BodyColourTests(unittest.TestCase):
    def assertClose(self, got, expected, tolerance=40):
        self.assertLessEqual(colour_distance(got, expected), tolerance, f'{got} vs {expected}')

    def test_reads_the_subject_not_the_white_background(self):
        self.assertClose(body_colour(swatch((200, 40, 40))), '#c82828')
        self.assertClose(body_colour(swatch((40, 90, 200))), '#285ac8')

    def test_a_saturated_upper_wins_over_a_neutral_sole(self):
        # A khaki shoe came back black before saturation was weighted: the
        # sole and shadow outnumber the upper in almost every product shot.
        img = swatch((120, 130, 70), shoe_fraction=0.35)
        for x in range(200):
            for y in range(130, 190):
                img.putpixel((x, y), (45, 45, 45))
        self.assertClose(body_colour(img), '#788246', 60)

    def test_a_genuinely_grey_shoe_still_reads_grey(self):
        self.assertClose(body_colour(swatch((130, 130, 132))), '#828284')

    def test_an_empty_frame_states_nothing(self):
        self.assertEqual(body_colour(Image.new('RGB', (200, 200), (255, 255, 255))), '')


@unittest.skipIf(Image is None, 'Pillow is not installed')
class PhotoHashTests(unittest.TestCase):
    def test_the_same_shot_resized_keeps_its_hash(self):
        original = swatch((90, 140, 90))
        resized = original.resize((97, 97)).resize((200, 200))
        self.assertLessEqual(hamming(dhash(original), dhash(resized)), 3)

    def test_two_different_subjects_do_not_collide(self):
        a = swatch((200, 40, 40))
        b = swatch((200, 40, 40))
        for x in range(60, 140):            # a stripe only one of them has
            for y in range(60, 90):
                b.putpixel((x, y), (20, 20, 20))
        self.assertGreater(hamming(dhash(a), dhash(b)), 3)

    def test_padding_does_not_make_unrelated_photos_collide(self):
        # SSENSE pads every photo onto a tall white canvas, so before the
        # hash was cropped to the subject a Tennis Classic collided with an
        # Air Force 1. Two small, different subjects on a big white frame is
        # exactly that case.
        def padded(block):
            img = Image.new('RGB', (200, 200), (255, 255, 255))
            for x in range(90, 115):
                for y in range(90, 115):
                    img.putpixel((x, y), (0, 0, 0))
            for (x, y) in block:
                img.putpixel((x, y), (255, 255, 255))
            return img
        a = padded([(x, 95) for x in range(92, 112)])
        b = padded([(100, y) for y in range(92, 112)])
        self.assertGreater(hamming(dhash(a), dhash(b)), 3)

    def test_the_same_subject_photographed_larger_still_matches(self):
        # Cropping to the subject is deliberately scale-invariant: the same
        # shoe shot closer is the same shoe.
        self.assertLessEqual(
            hamming(dhash(swatch((90, 140, 90), shoe_fraction=0.6)),
                    dhash(swatch((90, 140, 90), shoe_fraction=0.35))), 3)

    def test_a_missing_hash_is_maximally_distant(self):
        self.assertEqual(hamming('', 'abc'), 64)
        self.assertEqual(hamming(None, None), 64)


class ColourDistanceTests(unittest.TestCase):
    def test_identical_colours_are_zero_apart(self):
        self.assertEqual(colour_distance('#102030', '#102030'), 0)

    def test_two_angles_of_one_shoe_stay_close_and_two_colourways_do_not(self):
        self.assertLess(colour_distance('#1d1f20', '#242424'), 42)
        self.assertGreater(colour_distance('#1d1f20', '#e29331'), 42)

    def test_a_missing_value_is_never_treated_as_a_match(self):
        self.assertEqual(colour_distance('', '#102030'), 999)
        self.assertEqual(colour_distance('#102030', 'blue'), 999)


if __name__ == '__main__':
    unittest.main()
