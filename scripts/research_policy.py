"""Publication exclusions applied before downloading Fashion Feed assets."""
import json
from pathlib import Path
import unicodedata
import re

POLICY = json.loads((Path(__file__).resolve().parents[1]/'config/research-publication.json').read_text(encoding='utf-8'))

def allowed_feed_record(record):
    blocked = {str(t).lstrip('#').casefold() for t in POLICY['excludedFeedHashtags']}
    tags = [token.lstrip('#').casefold() for tag in record.get('hashtags', [])
            for token in re.split(r'[\s,]+', unicodedata.normalize('NFKC', str(tag)))]
    return not any(tag in blocked for tag in tags)
