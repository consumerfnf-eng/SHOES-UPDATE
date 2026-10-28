import os, sys, unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from scrapingbee_client import DEFAULT_RUN_BUDGET, ScrapingBeeClient, env_budget


class EnvBudgetTests(unittest.TestCase):
    def test_falls_back_to_the_callers_default(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(env_budget(), DEFAULT_RUN_BUDGET)
            self.assertEqual(env_budget(400), 400)

    def test_an_operator_can_cap_the_spend(self):
        with mock.patch.dict(os.environ, {'SCRAPINGBEE_RUN_BUDGET': '50'}, clear=True):
            self.assertEqual(env_budget(400), 50)

    def test_zero_is_honoured_as_a_hard_stop(self):
        with mock.patch.dict(os.environ, {'SCRAPINGBEE_RUN_BUDGET': '0'}, clear=True):
            self.assertEqual(env_budget(400), 0)

    def test_nonsense_and_blank_values_do_not_remove_the_ceiling(self):
        for value in ('', '   ', 'lots', '-10'):
            with mock.patch.dict(os.environ, {'SCRAPINGBEE_RUN_BUDGET': value}, clear=True):
                self.assertIn(env_budget(400), (400, 0), value)


class ClientBudgetTests(unittest.TestCase):
    def test_the_default_is_unchanged_for_callers_that_pass_nothing(self):
        self.assertEqual(ScrapingBeeClient(api_key='k').max_credits_per_run, DEFAULT_RUN_BUDGET)

    def test_an_explicit_budget_is_respected(self):
        self.assertEqual(ScrapingBeeClient(api_key='k', max_credits_per_run=400).max_credits_per_run, 400)

    def test_a_zero_budget_refuses_before_spending_anything(self):
        client = ScrapingBeeClient(api_key='k', max_credits_per_run=0, sleep=lambda _: None)
        with self.assertRaises(RuntimeError) as caught:
            client.fetch('https://example.com/')
        self.assertIn('BUDGET', str(caught.exception))
        self.assertEqual(client.credits_used, 0)


if __name__ == '__main__':
    unittest.main()
