import sys, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'monthly'))
from scrapingbee_client import ScrapingBeeClient

URL = 'https://official.example/jp/sneakers'


class FakeResponse:
    def __init__(self, status_code, text=''):
        self.status_code = status_code
        self.text = text


def client(api_key='k', **kw):
    return ScrapingBeeClient(api_key=api_key, sleep=lambda s: None, **kw)


class ScrapingBeeClientTests(unittest.TestCase):
    def test_no_key_raises_immediately(self):
        c = client(api_key='')
        with patch('scrapingbee_client.curl_requests.get') as m:
            with self.assertRaisesRegex(RuntimeError, 'SCRAPINGBEE_NO_KEY'):
                c.fetch(URL)
            m.assert_not_called()

    def test_usable_light_fetch_does_not_escalate(self):
        c = client()
        with patch('scrapingbee_client.curl_requests.get', return_value=FakeResponse(200, 'x' * 3000)) as m:
            html = c.fetch(URL)
            self.assertEqual(html, 'x' * 3000)
            self.assertEqual(m.call_count, 1)
            self.assertEqual(c.credits_used, 1)

    def test_invalid_light_fetch_escalates_to_premium(self):
        c = client()
        calls = []

        def fake_get(url, params, timeout):
            calls.append(params)
            if params.get('render_js') == 'false':
                return FakeResponse(200, 'too short')
            return FakeResponse(200, 'x' * 3000)

        with patch('scrapingbee_client.curl_requests.get', side_effect=fake_get):
            html = c.fetch(URL)
            self.assertEqual(html, 'x' * 3000)
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[1]['render_js'], 'true')
            self.assertEqual(calls[1]['premium_proxy'], 'true')
            self.assertEqual(c.credits_used, 26)

    def test_402_stops_the_account_for_the_rest_of_the_run(self):
        c = client()
        with patch('scrapingbee_client.curl_requests.get', return_value=FakeResponse(402)):
            with self.assertRaisesRegex(RuntimeError, 'SCRAPINGBEE_HTTP_402'):
                c.fetch(URL)
        self.assertTrue(c.quota_stopped)
        with patch('scrapingbee_client.curl_requests.get') as m:
            with self.assertRaisesRegex(RuntimeError, 'QUOTA_STOPPED'):
                c.fetch(URL)
            m.assert_not_called()

    def test_run_budget_cap_stops_before_spending_more(self):
        c = client(max_credits_per_run=1)
        with patch('scrapingbee_client.curl_requests.get', return_value=FakeResponse(200, 'too short')):
            with self.assertRaisesRegex(RuntimeError, 'RUN_BUDGET_WOULD_EXCEED_PREMIUM'):
                c.fetch(URL)
        self.assertEqual(c.credits_used, 1)

    def test_custom_validator_is_honored(self):
        c = client()
        with patch('scrapingbee_client.curl_requests.get', return_value=FakeResponse(200, 'short but valid')) as m:
            html = c.fetch(URL, validate=lambda h: 'valid' in h)
            self.assertEqual(html, 'short but valid')
            self.assertEqual(m.call_count, 1)


if __name__ == '__main__':
    unittest.main()
