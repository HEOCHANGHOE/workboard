# -*- coding: utf-8 -*-
"""Rebuild the "Github 관리" feed and upload it to Supabase when it changed.

Meant to run unattended (Windows Task Scheduler, hourly). The daily report routine
updates the report folder; this script turns that folder into the feed JSON and
sends it through the `work_board_ingest_github_feed` RPC (see supabase-schema.sql).

Settings live outside the repository and outside the shared report folder:
    %USERPROFILE%\\.workboard\\github-feed.json
    {
      "reportRoot": "C:\\\\...\\\\Report",
      "supabaseUrl": "https://<project>.supabase.co",
      "anonKey": "<public anon key>",
      "token": "<feed upload token>"
    }
The token can only write this user's feed row. Its SHA-256 hash is stored in
public.work_board_feed_tokens; the plain token stays in the file above.

Usage:
    python tools/github-feed-sync.py [--force] [--dry-run]
Exit codes: 0 uploaded or unchanged, 1 error.
Standard library only.
"""
import hashlib
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
HOME_DIR = os.path.join(os.path.expanduser('~'), '.workboard')
SETTINGS = os.path.join(HOME_DIR, 'github-feed.json')
STATE = os.path.join(HOME_DIR, 'github-feed-state.json')
LOG = os.path.join(HOME_DIR, 'github-feed-sync.log')
MAX_LOG_BYTES = 256 * 1024


def log(msg):
    line = f'{datetime.now():%Y-%m-%d %H:%M:%S} {msg}'
    print(line)
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > MAX_LOG_BYTES:
            os.replace(LOG, LOG + '.old')
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass


def load_exporter():
    spec = importlib.util.spec_from_file_location('github_feed_export', os.path.join(HERE, 'github-feed-export.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def content_hash(feed):
    # generatedAt changes every run; leave it out so unchanged content is not re-uploaded.
    body = {k: v for k, v in feed.items() if k != 'generatedAt'}
    return hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()


def upload(settings, feed):
    url = settings['supabaseUrl'].rstrip('/') + '/rest/v1/rpc/work_board_ingest_github_feed'
    data = json.dumps({'p_token': settings['token'], 'p_feed': feed}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST', headers={
        'apikey': settings['anonKey'],
        'Authorization': 'Bearer ' + settings['anonKey'],
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read().decode('utf-8', 'replace')


def main():
    force = '--force' in sys.argv
    dry = '--dry-run' in sys.argv
    settings = read_json(SETTINGS)
    missing = [k for k in ('reportRoot', 'supabaseUrl', 'anonKey', 'token') if not settings.get(k)]
    if missing:
        log(f'error: {SETTINGS} is missing {", ".join(missing)}')
        return 1
    root = settings['reportRoot']
    if not os.path.isdir(os.path.join(root, '_automation')):
        log(f'error: report folder not found: {root}')
        return 1

    exporter = load_exporter()
    feed = exporter.build_feed(root)
    exporter.write_feed(feed, os.path.join(root, '_automation', 'workboard_feed.json'))
    digest = content_hash(feed)
    state = read_json(STATE)
    summary = f'runs {len(feed["runs"])}, reports {len(feed["reports"])}'
    if not force and state.get('hash') == digest:
        log(f'unchanged ({summary})')
        return 0
    if dry:
        log(f'dry run: would upload ({summary})')
        return 0
    try:
        stored_at = upload(settings, feed)
    except urllib.error.HTTPError as e:
        log(f'error: upload failed HTTP {e.code}: {e.read().decode("utf-8", "replace")[:300]}')
        return 1
    except (urllib.error.URLError, OSError) as e:
        log(f'error: upload failed: {e}')
        return 1
    os.makedirs(HOME_DIR, exist_ok=True)
    with open(STATE, 'w', encoding='utf-8') as f:
        json.dump({'hash': digest, 'uploadedAt': datetime.now().isoformat(timespec='seconds')}, f)
    log(f'uploaded ({summary}) stored_at={stored_at.strip()}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
