import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from update import carry_forward, retail_is_published

CUTOFF_DAY = '2026-07-28'
CUTOFF_ISO = '2026-07-28T00:00:00+09:00'

PREVIOUS = {
    'sources': {'retail-ssense': {'label': 'SSENSE'}, 'retail-29cm': {'label': '29CM'}},
    'retail': [
        {'id': 'a', 'source': 'retail-ssense', 'brand': 'Nike', 'name': 'Cortez'},
        {'id': 'b', 'source': 'retail-29cm', 'brand': 'PUMA', 'name': 'Speedcat', 'listedAt': '2026-09-01T00:00:00+09:00'},
        {'id': 'c', 'source': 'retail-29cm', 'brand': 'PUMA', 'name': 'Suede', 'listedAt': '2026-02-01T00:00:00+09:00'},
    ],
    'newsletter': [
        {'id': 'n1', 'source': 'newsletter-hypebeast', 'brand': 'adidas', 'name': 'Samba',
         'publishedAt': '2026-10-01T00:00:00Z'},
    ],
}


class CarryForwardTests(unittest.TestCase):
    def test_a_blocked_source_keeps_its_last_published_items(self):
        # SSENSE collected nothing this run; 29CM collected normally.
        kept, sources = carry_forward(PREVIOUS, published=[{'source': 'retail-29cm'}],
                                      collected_by_source={'retail-29cm': 12}, cutoff_day=CUTOFF_DAY)
        self.assertEqual([k['id'] for k in kept], ['a', 'n1'])
        self.assertEqual(sources, {'retail-ssense': 1, 'newsletter-hypebeast': 1})
        self.assertTrue(all(k['carriedForward'] for k in kept))

    def test_a_source_that_collected_is_replaced_not_merged(self):
        kept, sources = carry_forward(PREVIOUS, published=[{'source': 'retail-ssense'}],
                                      collected_by_source={'retail-ssense': 900, 'retail-29cm': 12,
                                                           'newsletter-hypebeast': 40},
                                      cutoff_day=CUTOFF_DAY)
        self.assertEqual(kept, [])
        self.assertEqual(sources, {})

    def test_carried_items_still_obey_the_three_month_window(self):
        kept, _ = carry_forward(PREVIOUS, published=[], collected_by_source={}, cutoff_day=CUTOFF_DAY)
        # 'c' was listed in February; it leaves the window even while carried.
        self.assertNotIn('c', [k['id'] for k in kept])
        self.assertIn('b', [k['id'] for k in kept])

    def test_nothing_is_carried_when_there_is_no_previous_payload(self):
        self.assertEqual(carry_forward({}, [], {}, CUTOFF_DAY), ([], {}))


class PublishWindowTests(unittest.TestCase):
    def test_a_dated_item_publishes_only_inside_the_window(self):
        inside = {'newnessBasis': 'dated', 'listedAt': '2026-09-01T00:00:00+09:00'}
        outside = {'newnessBasis': 'dated', 'listedAt': '2026-02-01T00:00:00+09:00'}
        self.assertTrue(retail_is_published(inside, CUTOFF_DAY, CUTOFF_ISO))
        self.assertFalse(retail_is_published(outside, CUTOFF_DAY, CUTOFF_ISO))

    def test_an_item_with_no_date_at_all_does_not_publish(self):
        # "within three months" has to be backed by a date; a position in a
        # site's newest-first sort is not one. Musinsa's 신상품순 reaches back
        # past three months, so this is a real case, not a hypothetical.
        self.assertFalse(retail_is_published({'newnessBasis': 'dated'}, CUTOFF_DAY, CUTOFF_ISO))
        self.assertFalse(retail_is_published({'newnessBasis': 'new-sort'}, CUTOFF_DAY, CUTOFF_ISO))
        self.assertFalse(retail_is_published({}, CUTOFF_DAY, CUTOFF_ISO))

    def test_a_delta_item_needs_a_run_that_actually_saw_it_arrive(self):
        self.assertFalse(retail_is_published({'newnessBasis': 'delta'}, CUTOFF_DAY, CUTOFF_ISO))
        self.assertTrue(retail_is_published(
            {'newnessBasis': 'delta', 'firstDetectedAsNewAt': '2026-10-01T00:00:00+09:00'},
            CUTOFF_DAY, CUTOFF_ISO))
        self.assertFalse(retail_is_published(
            {'newnessBasis': 'delta', 'firstDetectedAsNewAt': '2026-01-01T00:00:00+09:00'},
            CUTOFF_DAY, CUTOFF_ISO))


if __name__ == '__main__':
    unittest.main()
