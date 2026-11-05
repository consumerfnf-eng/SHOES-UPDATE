"""Read-only ordinary image retrieval. Assets are returned on stdout, never cached.
Input: JSON jobs with exact observed URLs and an official product Referer.
No synthesized URLs, cookies, CAPTCHA execution, proxy rotation or denial retries.
"""
import base64
import concurrent.futures
import hashlib
import io
import json
import sys
import urllib.request
from datetime import datetime, timezone
from PIL import Image


def fetch(job):
    attempts = []
    for candidate in job['candidates']:
        url = candidate['url']
        try:
            request = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0', 'Referer': job['referer'],
                'Accept': 'image/webp,image/jpeg,image/png,*/*'})
            with urllib.request.urlopen(request, timeout=15) as response:
                if response.url != url:
                    raise ValueError('Image redirected: source binding unproven')
                data = response.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024:
                raise ValueError('Image exceeds limit')
            im = Image.open(io.BytesIO(data))
            im.load()
            ext = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp'}.get(im.format)
            if not ext or min(im.size) < 180 or im.width * im.height > 40000000:
                raise ValueError('Invalid/too small product image: ' + str(im.size))
            return {'id': job['id'], 'candidate': candidate, 'attempts': attempts,
                    'asset': {'url': url, 'referer': job['referer'], 'sha256': hashlib.sha256(data).hexdigest(),
                              'width': im.width, 'height': im.height, 'bytes': len(data), 'extension': ext,
                              'fetchedAt': datetime.now(timezone.utc).isoformat(), 'base64': base64.b64encode(data).decode('ascii')}}
        except Exception as error:
            attempts.append({'url': url, 'error': str(error)})
    return {'id': job['id'], 'attempts': attempts, 'asset': None}


if __name__ == '__main__':
    jobs = json.load(sys.stdin)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(fetch, jobs))
    print(json.dumps(results, ensure_ascii=False))
