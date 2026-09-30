"""Prepare UTF-8 paste files for manual assembly in Excel for Mac.

This copies reviewed source text; it does not assemble or approve a workbook.
Run on the AI/developer's computer, not on the deployment PCs.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def prepare(root=ROOT):
    sources = sorted((root / 'vba/utf8').glob('*.bas'))
    imports = sorted((root / 'vba').glob('*.bas'))
    if not sources or {p.name for p in sources} != {p.name for p in imports}:
        raise ValueError('UTF-8 and CP932 module sets differ')
    copies = {}
    for source in sources:
        text = source.read_text(encoding='utf-8')
        if text != (root / 'vba' / source.name).read_text(encoding='cp932'):
            raise ValueError(f'Run encode-vba.py before preparation: {source.name}')
        lines = text.splitlines(keepends=True)
        if lines[0].strip() != f'Attribute VB_Name = "{source.stem}"':
            raise ValueError(f'Unexpected module header: {source.name}')
        body = ''.join(lines[1:])
        if not body.startswith('Option Explicit\n') or re.search(r'^Attribute\b', body, re.M):
            raise ValueError(f'Unexpected paste source: {source.name}')
        # Excel for Mac changed ASCII 92 to 0x80 in a manually pasted project.
        # Keep source operators and string literals safe for that paste route.
        if chr(92) in body or chr(128) in body:
            raise ValueError(f'Use paste-safe character construction and division: {source.name}')
        copies[source.stem + '.txt'] = (source, body)
    events = root / 'vba/ThisWorkbook.txt'
    copies['ThisWorkbook.txt'] = (events, events.read_text(encoding='utf-8'))

    destination = root / 'workbook/mac-manual'
    destination.mkdir(parents=True, exist_ok=True)
    extra = {p.name for p in destination.glob('*.txt')} - copies.keys()
    if extra:
        raise ValueError(f'Unexpected paste files; review before continuing: {sorted(extra)}')
    manifest = {'purpose': 'manual-paste-sources-only', 'files': {}}
    for name, (source, body) in copies.items():
        data = body.encode('utf-8')
        (destination / name).write_bytes(data)
        manifest['files'][name] = {
            'source': source.relative_to(root).as_posix(),
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'pasteSha256': hashlib.sha256(data).hexdigest(),
        }
    (destination / 'source-manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return destination, len(copies)


if __name__ == '__main__':
    folder, count = prepare()
    print(f'Prepared {count} UTF-8 paste files in {folder}. No workbook was assembled or verified.')
