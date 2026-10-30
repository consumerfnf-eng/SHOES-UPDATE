import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from footwear_scope import classify, split_ko_listing_title


class InScopeTests(unittest.TestCase):
    def test_plain_sneakers(self):
        self.assertEqual(classify('Black Gabe Sneakers')[0], 'sneaker')
        self.assertEqual(classify('나이키 에어포스1 스니커즈')[0], 'sneaker')

    def test_hybrid_silhouettes_keep_their_own_display_type(self):
        for title, expected in [('Tan S-D-Ollie Mule Sneakers', 'mule-sneaker'),
                                ('Mary Jane Sneakers in white', 'mary-jane-sneaker'),
                                ('Platform Ballet Sneaker', 'ballet-sneaker')]:
            kind, types, _ = classify(title)
            self.assertEqual(kind, 'hybrid', title)
            self.assertIn('sneaker', types)
            self.assertIn(expected, types)

    def test_platform_is_an_extra_type_not_a_category(self):
        kind, types, _ = classify('Chunky Platform Sneakers')
        self.assertEqual(kind, 'sneaker')
        self.assertEqual(sorted(types), ['platform', 'sneaker'])

    def test_jelly_needs_a_flat_or_sneaker_construction(self):
        self.assertEqual(classify('Jelly Flats')[0], 'jelly')
        self.assertEqual(classify('젤리 슈즈 플랫')[0], 'jelly')
        self.assertEqual(classify('Jelly Kitten Heel')[2], 'excluded-silhouette')


class OtherShapesInScopeTests(unittest.TestCase):
    """Loafers, clogs, slides, thongs, slippers and platform sandals were
    asked for by name, so each is a category of its own rather than something
    that has to call itself a sneaker first."""

    def test_a_loafer_is_a_loafer(self):
        for title in ['Brown Sandrine Loafers', '키높이 페니로퍼', '모카신']:
            self.assertEqual(classify(title)[0], 'loafer', title)

    def test_a_platform_loafer_keeps_both_readings(self):
        kind, types, _ = classify('Leather platform loafers')
        self.assertEqual(kind, 'loafer')
        self.assertEqual(sorted(types), ['loafer', 'platform'])

    def test_slides_thongs_and_slippers_are_in_scope(self):
        self.assertEqual(classify('Tan Dasha 2.0 Flip-Flops')[0], 'slipper')
        self.assertEqual(classify('Pool Slides')[0], 'slipper')
        self.assertEqual(classify('통굽 쪼리')[0], 'platform-slipper')

    def test_a_platform_sandal_is_in_scope_and_a_strappy_one_is_not(self):
        self.assertEqual(classify('Platform Sandals')[0], 'platform-sandal')
        self.assertEqual(classify('통굽 샌들')[0], 'platform-sandal')
        self.assertEqual(classify('Strappy Sandals')[2], 'sandal-or-clog')


class OutOfScopeTests(unittest.TestCase):
    def test_dress_footwear_is_excluded(self):
        for title in ['Silver Gilda Glass 95 Heels', 'Leather Derby',
                      'Chelsea Boots', '앵클 부츠', '정장 구두']:
            self.assertEqual(classify(title)[0], '', title)

    def test_a_heeled_loafer_is_refused_by_its_heel(self):
        # The loafer gate opened; the heel gate did not.
        self.assertEqual(classify('Heeled Loafers')[2], 'excluded-silhouette')
        self.assertEqual(classify('로퍼 힐')[2], 'excluded-silhouette')

    def test_kids_sizing_is_excluded(self):
        self.assertEqual(classify('Air Jordan 1 (GS) Sneakers')[2], 'kids')
        self.assertEqual(classify('키즈 스니커즈')[2], 'kids')


class RetailerCategoryTests(unittest.TestCase):
    """The shelf an item sits on is evidence, but never overrules its title."""

    def test_category_label_supplies_missing_sneaker_evidence(self):
        self.assertEqual(classify('클럽 C 85 빈티지')[0], '')
        self.assertEqual(classify('클럽 C 85 빈티지', '스니커즈')[0], 'sneaker')

    def test_a_misfiled_dress_shoe_is_still_dropped(self):
        # Musinsa really does carry dress shoes under 신발 > 스니커즈.
        self.assertEqual(classify('키높이 정장 구두', '스니커즈')[2], 'excluded-silhouette')
        self.assertEqual(classify('Leather Derby', 'sneakers')[2], 'excluded-silhouette')

    def test_a_sneaker_on_an_excluded_shelf_is_kept(self):
        kind, types, _ = classify('바이커 뮬 스니커즈', '여성 신발 · 뮬/슬리퍼')
        self.assertEqual(kind, 'hybrid')
        self.assertIn('mule-sneaker', types)

    def test_a_plain_slipper_on_that_shelf_is_kept_as_a_slipper(self):
        # Slippers are in scope now, so the shelf and the title agree.
        self.assertEqual(classify('퍼 뮬 슬리퍼', '여성 신발 · 뮬/슬리퍼')[0], 'slipper')


class KoreanTitleSplitTests(unittest.TestCase):
    def test_splits_model_colorway_and_style(self):
        self.assertEqual(split_ko_listing_title('푸마 태클렛 프리미엄 - 푸마 블랙:검 / 410226-01'),
                         ('푸마 태클렛 프리미엄', '푸마 블랙:검', '410226-01'))

    def test_leaves_a_plain_title_alone(self):
        self.assertEqual(split_ko_listing_title('Twister Patchwork Tee'), ('Twister Patchwork Tee', '', ''))


if __name__ == '__main__':
    unittest.main()
