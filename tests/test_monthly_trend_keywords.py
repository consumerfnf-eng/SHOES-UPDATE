import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from collect_trend_keywords import (growth_for, normalise, parse_abbreviated_count,
                                    validate_candidate)


class AbbreviatedCountTests(unittest.TestCase):
    def test_the_suffix_carries_almost_the_whole_number(self):
        # Instagram returns "243M", not digits. Stripping to digits gave 243
        # for #sneakers and 619 for #러닝화, ranking the smaller tag first.
        self.assertEqual(parse_abbreviated_count('243M'), 243_000_000)
        self.assertEqual(parse_abbreviated_count('619K'), 619_000)
        self.assertEqual(parse_abbreviated_count('1.2B'), 1_200_000_000)
        self.assertGreater(parse_abbreviated_count('243M'), parse_abbreviated_count('619K'))

    def test_plain_and_korean_magnitudes(self):
        self.assertEqual(parse_abbreviated_count('12'), 12)
        self.assertEqual(parse_abbreviated_count('1,234'), 1234)
        self.assertEqual(parse_abbreviated_count('3.5만'), 35_000)

    def test_a_floor_keeps_its_number(self):
        # Small tags come back as "350+", a real number with a direction.
        self.assertEqual(parse_abbreviated_count('350+'), 350)
        self.assertEqual(parse_abbreviated_count('1.5K+'), 1500)

    def test_an_unreadable_value_is_none_not_a_guess(self):
        for value in ('', None, 'weird', '12 posts', '1.2X', '+'):
            self.assertIsNone(parse_abbreviated_count(value), value)


class GrowthTests(unittest.TestCase):
    def history(self, rows):
        return [{'platform': 'instagram', 'hashtag': 'x', 'day': day, 'value': str(value)}
                for day, value in rows]

    def test_compares_against_the_observation_closest_to_a_week_back(self):
        history = self.history([('2026-10-22', 100), ('2026-10-15', 50)])
        growth, since, before = growth_for(history, 'instagram', 'x', '2026-10-29', 150)
        self.assertEqual((since, before), ('2026-10-22', 100))
        self.assertEqual(growth, 50.0)

    def test_a_first_sighting_has_no_rate_rather_than_zero(self):
        self.assertEqual(growth_for([], 'instagram', 'x', '2026-10-29', 150), (None, None, None))

    def test_observations_too_close_together_do_not_produce_a_rate(self):
        history = self.history([('2026-10-27', 100)])
        self.assertEqual(growth_for(history, 'instagram', 'x', '2026-10-29', 150)[0], None)

    def test_a_zero_baseline_does_not_divide_by_zero(self):
        history = self.history([('2026-10-22', 0)])
        growth, _, before = growth_for(history, 'instagram', 'x', '2026-10-29', 150)
        self.assertIsNone(growth)
        self.assertEqual(before, 0)

    def test_a_shrinking_tag_reports_a_negative_rate(self):
        history = self.history([('2026-10-22', 200)])
        self.assertEqual(growth_for(history, 'instagram', 'x', '2026-10-29', 150)[0], -25.0)


class CandidateValidationTests(unittest.TestCase):
    VOCAB = {'스피드캣', 'speedcat', '삼바'}

    def test_one_excluded_term_is_enough_to_reject(self):
        ok, reason = validate_candidate('가을로퍼', ['스니커즈', '운동화', '러닝화'], self.VOCAB)
        self.assertFalse(ok)
        self.assertEqual(reason, 'excluded-term')

    def test_a_mule_sneaker_survives_the_mule_exclusion(self):
        ok, _ = validate_candidate('뮬스니커즈코디', ['뮬 스니커즈', '스니커즈'], self.VOCAB)
        self.assertTrue(ok)

    def test_an_ecommerce_product_name_passes_immediately(self):
        ok, reason = validate_candidate('스피드캣', [], self.VOCAB)
        self.assertTrue(ok)
        self.assertEqual(reason, 'ecommerce-name-match')

    def test_otherwise_a_third_of_related_keywords_must_be_sneaker_words(self):
        ok, _ = validate_candidate('어글리슈즈', ['어글리 슈즈', '청키 스니커즈', '운동화'], self.VOCAB)
        self.assertTrue(ok)
        ok, reason = validate_candidate('가을코디', ['가을 코디', '데일리룩', '가방', '니트'], self.VOCAB)
        self.assertFalse(ok)
        self.assertTrue(reason.startswith('include-share-'))

    def test_a_candidate_with_nothing_to_judge_is_rejected(self):
        ok, reason = validate_candidate('무엇', [], self.VOCAB)
        self.assertFalse(ok)
        self.assertEqual(reason, 'no-related-keywords')


class NormaliseTests(unittest.TestCase):
    def test_hashes_spaces_and_case_fall_away(self):
        self.assertEqual(normalise('#Ballet Sneakers'), 'balletsneakers')
        self.assertEqual(normalise('발레 스니커즈'), '발레스니커즈')


if __name__ == '__main__':
    unittest.main()
