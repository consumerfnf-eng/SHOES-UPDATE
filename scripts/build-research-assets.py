"""Build internal research renditions from a reviewed, local source inventory."""
import sys
import json
import hashlib
import urllib.request
import io
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageOps
from curl_cffi import requests
from research_policy import allowed_feed_record

ROOT = Path(__file__).resolve().parents[1]
WORK = Path(sys.argv[1])
NOW = datetime.now(timezone.utc).isoformat()
source_file = WORK/'feed-source.json'
FEED_SOURCE = json.loads(source_file.read_text(encoding='utf-8')) if source_file.exists() else {'season': 'Spring/Summer 2027', 'expectedCount': 112}
FEED_SEASON = FEED_SOURCE['season']
SEASON_KEY = ''.join(c if c.isalnum() else '-' for c in FEED_SEASON)


def download(url, target):
    if target.exists() and target.stat().st_size > 1000:
        return target
    response = requests.get(url, impersonate='chrome124', headers={'referer': 'https://www.wgsn.com/'}, timeout=120)
    response.raise_for_status()
    temporary = target.with_suffix(target.suffix+'.tmp')
    temporary.write_bytes(response.content)
    temporary.replace(target)
    return target


def report_assets(record):
    import pymupdf as fitz
    identifier = record['url'].rstrip('/').split('/')[-1]
    pdf = WORK / (identifier+'.pdf')
    download(record['pdf'][0], pdf)
    document = fitz.open(pdf)
    out = ROOT / 'public/forecast' / identifier
    out.mkdir(parents=True, exist_ok=True)
    pages = []
    for i, page in enumerate(document):
        destination = out / f'{i+1:03}.jpg'
        valid = False
        if destination.exists():
            try:
                with Image.open(destination) as previous:
                    previous.verify()
                valid = True
            except Exception:
                pass
        if not valid:
            pix = page.get_pixmap(matrix=fitz.Matrix(2200/page.rect.width, 2200/page.rect.width), alpha=False)
            pix.save(str(destination), jpg_quality=90)
        pages.append('/forecast/'+identifier+'/'+destination.name)
    with Image.open(out/'001.jpg') as opened:
        image = opened.copy()
        image.thumbnail((720, 720))
        image.save(out/'cover.webp', quality=85)
    return {'id': identifier, 'title': record['title'], 'url': record['url'], 'headings': record['headings'],
            'cover': '/forecast/'+identifier+'/cover.webp', 'pages': pages}


def feed_asset(record):
    identifier = record['url'].split('/images/')[1].split('/')[0]
    checkpoint = WORK / (identifier+'-rendition.json')
    if checkpoint.exists():
        saved = json.loads(checkpoint.read_text(encoding='utf-8'))
        with Image.open(ROOT/'public'/saved['image'].lstrip('/')) as previous:
            previous.verify()
        if saved['season'] == FEED_SEASON:
            return saved
    raw = WORK / (identifier+'.original')
    rendition = 'original'
    try:
        download(record['url'], raw)
    except Exception:
        # The observed feed rendition is a truthful fallback when the source
        # does not make its Download original available. Never label it HD.
        download(record['image'], raw)
        rendition = 'feed'
    with Image.open(raw) as opened:
        image = ImageOps.exif_transpose(opened).convert('RGB')
        original_size = image.size
        image.thumbnail((2200, 2200), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        image.save(buf, 'JPEG', quality=90)
        data = buf.getvalue()
    name = 'feed-'+hashlib.sha256(data).hexdigest()[:24]+'.jpg'
    (ROOT/'public/catwalk'/name).write_bytes(data)
    result = {'id': 'feed-'+identifier, 'collection': 'fashion-feed', 'shelf': 'fashion-feed',
            'brand': (record.get('credit') or '').strip(', ') or 'WGSN', 'season': FEED_SEASON,
            'city': '', 'image': '/catwalk/'+name, 'width': image.width, 'height': image.height,
            'originalWidth': original_size[0], 'originalHeight': original_size[1], 'rendition': rendition,
            'hashtags': record['hashtags'], 'sourceUrl': record['url'], 'sourceDate': record.get('date', '')}
    checkpoint.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    raw.unlink()  # Rebuildable task download; the validated rendition is retained.
    return result


if '--feed' in sys.argv:
    inventory = json.loads((WORK/'feed.json').read_text(encoding='utf-8'))
    expected = FEED_SOURCE['expectedCount']
    assert expected > 0 and len(inventory) == expected, f'Expected {expected} feed images, found {len(inventory)}'
    assert len({r['url'] for r in inventory}) == expected
    accepted = [record for record in inventory if allowed_feed_record(record)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        looks = list(pool.map(feed_asset, accepted))
    for look in looks:
        with Image.open(ROOT/'public'/look['image'].lstrip('/')) as opened:
            card = opened.copy()
            card.thumbnail((480, 640), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            card.save(buffer, 'JPEG', quality=80)
            encoded = buffer.getvalue()
        name = 'thumb-'+hashlib.sha256(encoded).hexdigest()[:24]+'.jpg'
        (ROOT/'public/catwalk'/name).write_bytes(encoded)
        look['thumbnail'] = '/catwalk/'+name
    fragment = {'season': FEED_SEASON, 'collection': 'fashion-feed', 'sourceUrl': FEED_SOURCE.get('url', ''), 'collectedAt': NOW, 'looks': looks}
    fragments = ROOT/'data/catwalk'
    fragments.mkdir(parents=True, exist_ok=True)
    (fragments/('fashion-feed-'+SEASON_KEY+'.json')).write_text(json.dumps(fragment, ensure_ascii=False), encoding='utf-8')
    print(f'Feed: {len(looks)} published; {len(inventory)-len(accepted)} excluded by hashtag policy', flush=True)
else:
    records = json.loads((WORK/'reports.json').read_text(encoding='utf-8'))
    # Download concurrently, render sequentially: MuPDF documents are not shared
    # across threads, and a very large source PDF never goes into Pages itself.
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda r: download(r['pdf'][0], WORK/(r['url'].split('/')[-1]+'.pdf')), records))
    reports = [report_assets(record) for record in records]
    snapshot = {'schemaVersion': 1, 'checkedAt': NOW, 'reports': reports}
    (ROOT/'public/data/forecast.json').write_text(json.dumps(snapshot, ensure_ascii=False), encoding='utf-8')
    print(f'Forecast: {len(reports)} reports / {sum(len(r["pages"]) for r in reports)} high-resolution pages', flush=True)
