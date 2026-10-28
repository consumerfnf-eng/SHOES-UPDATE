"""Collect top posts for configured sneaker hashtags via Instaloader.

Requires the user's own Instagram session (never a password) either as:
  --session-file <path>      a session file made with:
                              python -m instaloader --login USERNAME --sessionfile <path>
  or env IG_USERNAME + IG_SESSION_B64 (base64 of that same file; used by the
  GitHub Actions workflow, which restores it to a temp file and deletes it
  when the job ends).

If no session is available, or Instagram reports the session expired/blocked,
this writes status 'requires_session' / 'blocked' and 0 items. It never
invents like-counts or falls back to unauthenticated guesses: a missing
real measurement stays missing, it does not become a fabricated zero or an
estimate.
"""
import argparse
import base64
import json
import os
import re
import sys
import tempfile
import time

from common import atomic_write_json, kst_now

HASHTAGS = ['신발추천', '고프코어슈즈', '스니커즈추천', '신상스니커즈']
POSTS_PER_HASHTAG = 30


def resolve_session_file(args):
    if args.session_file and os.path.exists(args.session_file):
        return args.session_file, args.username
    b64 = os.environ.get('IG_SESSION_B64')
    username = os.environ.get('IG_USERNAME')
    if b64 and username:
        fd, path = tempfile.mkstemp(prefix='ig-session-')
        with os.fdopen(fd, 'wb') as f:
            f.write(base64.b64decode(b64))
        return path, username
    return None, None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--session-file')
    parser.add_argument('--username')
    args = parser.parse_args()

    checked_at = kst_now().isoformat()
    session_path, username = resolve_session_file(args)
    temp_session = session_path if not args.session_file else None

    if not session_path or not username:
        atomic_write_json(args.out, {
            'status': 'requires_session',
            'checkedAt': checked_at,
            'items': [],
            'diagnostics': [{'error': 'No Instagram session file/username available. Run: '
                             'python -m instaloader --login YOUR_USERNAME --sessionfile <path>, '
                             'then pass --session-file/--username or set IG_USERNAME + IG_SESSION_B64.'}],
        })
        print('Instagram collection: requires_session (no session provided)', file=sys.stderr)
        return

    import instaloader

    loader = instaloader.Instaloader(download_pictures=False, download_videos=False,
                                      download_video_thumbnails=False, download_geotags=False,
                                      download_comments=False, save_metadata=False,
                                      compress_json=False, quiet=True)
    diagnostics = []
    items = []
    overall_status = 'ok'
    try:
        loader.load_session_from_file(username, session_path)
    except Exception as e:
        atomic_write_json(args.out, {
            'status': 'blocked', 'checkedAt': checked_at, 'items': [],
            'diagnostics': [{'error': f'session-load-failed: {e}'}],
        })
        print(f'Instagram collection: blocked (session load failed: {e})', file=sys.stderr)
        if temp_session:
            os.remove(temp_session)
        return

    for tag in HASHTAGS:
        status = {'hashtag': tag, 'posts': 0, 'errors': []}
        try:
            hashtag = instaloader.Hashtag.from_name(loader.context, tag)
            count = 0
            for post in hashtag.get_top_posts():
                if count >= POSTS_PER_HASHTAG:
                    break
                count += 1
                caption = (post.caption or '').strip()
                items.append({
                    'hashtag': tag,
                    'shortcode': post.shortcode,
                    'url': f'https://www.instagram.com/p/{post.shortcode}/',
                    'caption': caption,
                    'likeCount': post.likes,
                    'takenAt': post.date_utc.isoformat() + 'Z',
                    'checkedAt': checked_at,
                })
                status['posts'] += 1
                time.sleep(0.5)
        except instaloader.exceptions.LoginRequiredException as e:
            status['errors'].append({'error': f'requires_session: {e}'})
            overall_status = 'requires_session'
        except instaloader.exceptions.ConnectionException as e:
            status['errors'].append({'error': f'blocked: {e}'})
            overall_status = 'blocked' if overall_status == 'ok' else overall_status
        except Exception as e:
            status['errors'].append({'error': str(e)})
        diagnostics.append(status)
        time.sleep(2)

    if temp_session:
        os.remove(temp_session)

    result = {
        'status': overall_status if items or overall_status != 'ok' else 'partial',
        'checkedAt': checked_at,
        'items': items,
        'diagnostics': diagnostics,
    }
    atomic_write_json(args.out, result)
    print(f"Instagram collection: {result['status']} — {len(items)} posts across {len(HASHTAGS)} hashtags",
          file=sys.stderr)


if __name__ == '__main__':
    main()
