# -*- coding: utf-8 -*-
"""Build the Work Board "Github 관리" feed from the algorithm-update report folder.

The daily report routine writes .docx reports plus _automation/{config,state}.json
and run_log.md into a report folder. This script reads that folder and writes one
JSON file that the Work Board tab imports (stored per user in Supabase, never in
this public repository).

Usage:
    python tools/github-feed-export.py <REPORT_ROOT> [output.json]

Default output: <REPORT_ROOT>/_automation/workboard_feed.json
Standard library only.
"""
import json
import os
import re
import sys
import zipfile
from datetime import datetime, timezone, timedelta
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
KST = timezone(timedelta(hours=9))
FILE_PREFIX = '알고리즘 업데이트 검토 보고서_'
# Reports dated before this get listed without their summary text (keeps the feed small;
# the first run back-filled ~800 historical commit reports).
SUMMARY_FROM = '20260601'
MAX_SUMMARY_ITEMS = 8
MAX_ITEM_CHARS = 600


def read_json(path, fallback):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def docx_paragraphs(path, limit=80):
    try:
        with zipfile.ZipFile(path) as z:
            root = ET.fromstring(z.read('word/document.xml'))
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError):
        return []
    out = []
    for p in root.iter(W + 'p'):
        text = ''.join(t.text or '' for t in p.iter(W + 't')).strip()
        if text:
            out.append(text)
            if len(out) >= limit:
                break
    return out


def parse_report(path):
    """Pull subtitle, request date, summary bullets and overview fields from a report."""
    paras = docx_paragraphs(path)
    info = {}
    if len(paras) > 1:
        info['title'] = paras[1]
    for p in paras[:6]:
        m = re.match(r'검토 요청일:\s*(\S+)', p)
        if m:
            info['requested'] = m.group(1)
    summary, in_summary = [], False
    for p in paras:
        if re.sub(r'\s', '', p) == '요약':
            in_summary = True
            continue
        if in_summary:
            if re.match(r'^\d+\.\s', p):
                break
            summary.append(p.lstrip('▪•·- ').strip()[:MAX_ITEM_CHARS])
    if summary:
        info['summary'] = summary[:MAX_SUMMARY_ITEMS]
    labels = {'버전': 'version', '변경 규모': 'scale', '코드 수정자': 'authors'}
    for i, p in enumerate(paras[:-1]):
        key = labels.get(p)
        if key and key not in info:
            info[key] = paras[i + 1][:200]
    return info


def report_key(repo, name):
    stem = name[:-5] if name.lower().endswith('.docx') else name
    revised = stem.endswith('(개정)')
    stem = stem.replace('(개정)', '').strip()
    if stem.startswith(FILE_PREFIX):
        stem = stem[len(FILE_PREFIX):]
    if repo and stem.startswith(repo + '_'):
        stem = stem[len(repo) + 1:]
    return stem, revised


def collect_reports(root):
    reports = []
    for repo in sorted(os.listdir(root)):
        repo_dir = os.path.join(root, repo)
        if not os.path.isdir(repo_dir) or repo.startswith('_'):
            continue
        for kind_dir, kind in (('commits', 'commit'), ('releases', 'release')):
            folder = os.path.join(repo_dir, kind_dir)
            if not os.path.isdir(folder):
                continue
            for name in os.listdir(folder):
                if not name.lower().endswith('.docx') or name.startswith('~$'):
                    continue
                full = os.path.join(folder, name)
                key, revised = report_key(repo, name)
                date = key if re.fullmatch(r'\d{8}', key) else ''
                mtime = datetime.fromtimestamp(os.path.getmtime(full), KST)
                item = {
                    'repo': repo,
                    'kind': kind,
                    'key': key,
                    'file': f'{repo}/{kind_dir}/{name}',
                    'modified': mtime.strftime('%Y-%m-%d %H:%M'),
                }
                if revised:
                    item['revised'] = True
                if date:
                    item['date'] = f'{date[:4]}-{date[4:6]}-{date[6:]}'
                if kind == 'release' or (date and date >= SUMMARY_FROM):
                    item.update(parse_report(full))
                reports.append(item)
    quarterly = os.path.join(root, '_quarterly')
    if os.path.isdir(quarterly):
        for name in sorted(os.listdir(quarterly)):
            if name.lower().endswith('.docx') and not name.startswith('~$'):
                full = os.path.join(quarterly, name)
                key, _ = report_key('', name)
                item = {
                    'repo': '',
                    'kind': 'quarterly',
                    'key': key.replace('분기종합_', ''),
                    'file': f'_quarterly/{name}',
                    'modified': datetime.fromtimestamp(os.path.getmtime(full), KST).strftime('%Y-%m-%d %H:%M'),
                }
                item.update(parse_report(full))
                reports.append(item)
    return reports


RUN_HEAD = re.compile(r'^- (\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\s*(\([^)]*\))?\s*\|\s*(.*)$')


def parse_run_log(path):
    try:
        with open(path, encoding='utf-8') as f:
            lines = f.read().splitlines()
    except OSError:
        return []
    entries, cur = [], None
    for line in lines:
        m = RUN_HEAD.match(line)
        if m:
            if cur:
                entries.append(cur)
            date, time, mode, rest = m.groups()
            cur = {'date': date, 'time': time or '', 'mode': (mode or '').strip('()'), 'text': rest.strip()}
        elif cur and line.strip() and not line.startswith('#'):
            cur['text'] += '\n' + line.strip()
    if cur:
        entries.append(cur)
    for e in entries:
        parts = [p.strip() for p in e['text'].split('|')]
        m = re.search(r'확인\s*(\d+)\s*개', e['text'])
        if m:
            e['checked'] = int(m.group(1))
        m = re.search(r'신규 보고서\s*(\d+)\s*건', e['text'])
        e['newReports'] = int(m.group(1)) if m else 0
        e['changed'] = not ('변경 없음' in e['text'][:200] and e['newReports'] == 0)
        m = re.search(r'보고서 수\s*([\d,]+)\s*→\s*([\d,]+)', e['text'])
        if m:
            e['totalAfter'] = int(m.group(2).replace(',', ''))
        e['headline'] = ' | '.join(parts[:3])[:300]
    entries.sort(key=lambda e: (e['date'], e['time']), reverse=True)
    return entries


def build_feed(root):
    """Return the feed dict for a report folder."""
    auto = os.path.join(root, '_automation')
    config = read_json(os.path.join(auto, 'config.json'), {})
    state = read_json(os.path.join(auto, 'state.json'), {})
    reports = collect_reports(root)
    counts = {}
    for r in reports:
        if r['repo']:
            c = counts.setdefault(r['repo'], {'commit': 0, 'release': 0})
            c[r['kind']] += 1
    repos = []
    for full_name in config.get('repos') or list((state.get('repos') or {}).keys()):
        s = (state.get('repos') or {}).get(full_name, {})
        short = full_name.split('/')[-1]
        repos.append({
            'name': full_name,
            'short': short,
            'lastChecked': s.get('last_checked'),
            'lastCommit': s.get('last_commit'),
            'lastTag': s.get('last_tag'),
            'lastRelease': s.get('last_release'),
            'commitReports': counts.get(short, {}).get('commit', 0),
            'releaseReports': counts.get(short, {}).get('release', 0),
        })
    return {
        'type': 'workboard-github-feed',
        'version': 1,
        'generatedAt': datetime.now(KST).isoformat(timespec='seconds'),
        'schedule': config.get('schedule', ''),
        'baseline': state.get('baseline', ''),
        'repos': repos,
        'runs': parse_run_log(os.path.join(auto, 'run_log.md')),
        'reports': sorted(reports, key=lambda r: (r.get('date') or r['modified'][:10], r['modified']), reverse=True),
    }


def write_feed(feed, out):
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(feed, f, ensure_ascii=False, separators=(',', ':'))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    root = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, '_automation', 'workboard_feed.json')
    feed = build_feed(root)
    write_feed(feed, out)
    print(f'{out}: repos {len(feed["repos"])}, runs {len(feed["runs"])}, reports {len(feed["reports"])}, '
          f'{os.path.getsize(out) // 1024} KB')


if __name__ == '__main__':
    main()
