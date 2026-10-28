"""Thin ScrapingBee client shared by the monthly collectors, mirroring
scripts/scrapingbee-reader.mjs's light-then-premium escalation and per-run
credit budget (same design, kept in sync by hand - there is no cross-language
import here). Only used for sources that have failed every unauthenticated
method (curl_cffi TLS impersonation, headless/headful Playwright): Lyst here,
and a future Farfetch/Mytheresa collector once their real page structure has
actually been observed through a live key, not guessed at.
"""
import os
import time

from curl_cffi import requests as curl_requests


DEFAULT_RUN_BUDGET = 125


def env_budget(default=DEFAULT_RUN_BUDGET):
    """Per-collector credit ceiling, overridable with SCRAPINGBEE_RUN_BUDGET.

    Credits are the user's money, so the ceiling is explicit and per-run. The
    125 default is only enough for four premium page loads, which is why the
    multi-retailer collector asks for more: with five listings to try, a
    shared 125 meant the first one consumed the budget and the other four
    never got a single attempt.
    """
    raw = os.environ.get('SCRAPINGBEE_RUN_BUDGET', '')
    try:
        return max(0, int(raw)) if raw.strip() else default
    except ValueError:
        return default


class ScrapingBeeClient:
    def __init__(self, api_key=None, max_credits_per_run=None, sleep=time.sleep):
        self.api_key = api_key if api_key is not None else os.environ.get('SCRAPINGBEE_API_KEY', '')
        self.max_credits_per_run = DEFAULT_RUN_BUDGET if max_credits_per_run is None else max_credits_per_run
        self.sleep = sleep
        self.credits_used = 0
        self.attempted = 0
        self.quota_stopped = False

    @property
    def has_key(self):
        return bool(self.api_key)

    def fetch(self, url, validate=None):
        """Fetch `url`, trying the light request first and escalating to the
        premium (render_js + premium_proxy) request only if the light result
        fails `validate` (a callable(html) -> bool; default: non-trivial length).
        Returns the HTML text. Raises RuntimeError with a stable error code as
        the message on any failure, mirroring the JS reader's error names."""
        if not self.has_key:
            raise RuntimeError('SCRAPINGBEE_NO_KEY')
        if self.quota_stopped:
            raise RuntimeError('SCRAPINGBEE_QUOTA_STOPPED')
        if self.credits_used >= self.max_credits_per_run:
            raise RuntimeError('SCRAPINGBEE_RUN_BUDGET_EXHAUSTED')
        validate = validate or (lambda html: len(html) > 2000)
        if self.attempted:
            self.sleep(1.5)
        self.attempted += 1
        html = self._request(url, render_js=False, premium_proxy=False)
        self.credits_used += 1
        if html is not None and validate(html):
            return html
        if self.credits_used + 25 > self.max_credits_per_run:
            raise RuntimeError('SCRAPINGBEE_RUN_BUDGET_WOULD_EXCEED_PREMIUM')
        html = self._request(url, render_js=True, premium_proxy=True, wait=3500, block_ads=True)
        self.credits_used += 25
        if html is None:
            raise RuntimeError('SCRAPINGBEE_PREMIUM_FETCH_FAILED')
        if not validate(html):
            raise RuntimeError('SCRAPINGBEE_STILL_INVALID')
        return html

    def _request(self, url, **params):
        query = {'api_key': self.api_key, 'url': url,
                 **{k: ('true' if v is True else 'false' if v is False else v) for k, v in params.items()}}
        try:
            r = curl_requests.get('https://app.scrapingbee.com/api/v1/', params=query, timeout=65)
        except Exception:
            return None
        if r.status_code in (401, 402):
            self.quota_stopped = True
            raise RuntimeError(f'SCRAPINGBEE_HTTP_{r.status_code}')
        if r.status_code != 200:
            return None
        return r.text
