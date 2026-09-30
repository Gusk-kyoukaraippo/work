"""Verify the natively compiled launcher and package only user-facing files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
import hashlib
import json
import re
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/01a0c900-623e-71d2-9af0-a2392f990288/fullscreen-r4'
BUILD = OUT / '.build'
DEPS = OUT.with_name('fullscreen') / '.build/python-deps'
if DEPS.exists():
    sys.path.insert(0, str(DEPS))
from oletools.olevba import VBA_Parser

FILE_NAME = 'DXアプリホーム-全画面検証版-r4.xlsm'
BOOK = next(p for p in OUT.glob('*.xlsm')
            if unicodedata.normalize('NFC', p.name) == FILE_NAME)
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'xdr': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'}

def normalized_code(code):
    lines = []
    for line in code.splitlines():
        line = line.strip()
        if not line or line.startswith('Attribute '):
            continue
        # VBE canonicalizes identifier case; preserve the actual string literals.
        parts = re.split(r'("(?:[^"\n]|"")*")', line)
        lines.append(''.join(part if i % 2 else part.lower()
                             for i, part in enumerate(parts)))
    return '\n'.join(lines)

parser = VBA_Parser(str(BOOK))
modules = {name: code for _, _, name, code in parser.extract_macros()}
parser.close()
assert set(modules) == {'ThisWorkbook.cls', 'Sheet1.cls', 'Sheet2.cls', 'DXLauncher.bas'}, modules.keys()
for module, source in [('DXLauncher.bas', 'DXLauncher.txt'), ('ThisWorkbook.cls', 'ThisWorkbook.txt')]:
    assert normalized_code(modules[module]) == normalized_code((BUILD / source).read_text()), module
for sheet in ('Sheet1.cls', 'Sheet2.cls'):
    assert not normalized_code(modules[sheet]), sheet
runtime = modules['DXLauncher.bas'].lower()
for forbidden in ('shell(', 'application.quit', 'savechanges:=false', 'regwrite', 'vbproject'):
    assert forbidden not in runtime, forbidden
assert '.characters.font.color' not in runtime, 'Runtime Font.Color compatibility regression'

expected = json.loads((BUILD / 'source-data.json').read_text())
with ZipFile(BOOK) as z:
    assert z.testzip() is None
    assert len(z.read('xl/vbaProject.bin')) > 10000
    strings = [''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
    admin = ET.fromstring(z.read('xl/worksheets/sheet2.xml'))
    values = {}
    for cell in admin.findall('.//s:c', NS):
        value = cell.find('s:v', NS)
        raw = value.text if value is not None else None
        values[cell.get('r')] = strings[int(raw)] if cell.get('t') == 's' and raw is not None else raw
    actual = [[values.get(f'{col}{row}') or None for col in 'BCDEF'] for row in range(13, 37)]
    assert actual == expected['records'], 'Registration changed'
    assert (values.get('C5') or '') == expected['notice']
    assert values.get('C8') == expected['guide']
    assert len(admin.findall('.//s:f', NS)) == 24
    assert len(admin.findall('.//s:dataValidation', NS)) == 5
    limits = {'B13:B36': '28', 'C13:C36': '50', 'F13:F36': '1', 'C5': '100'}
    for rule in admin.findall('.//s:dataValidation', NS):
        if rule.get('sqref') in limits:
            assert rule.get('operator') == 'lessThanOrEqual', 'Length rule was inverted'
            assert rule.get('showInputMessage', '0') == '0'
            assert rule.get('showErrorMessage') == '1'
            assert rule.find('s:formula1', NS).text == limits[rule.get('sqref')]
    assert '28' not in values['B11']
    assert values['F12'] == 'アイコン'
    for name in ('xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'):
        sheet = ET.fromstring(z.read(name))
        assert not sheet.findall('.//s:c[@t="e"]', NS), f'Cached formula error: {name}'
    home = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    protection = home.find('s:sheetProtection', NS)
    assert protection is not None and protection.get('sheet') == '1'
    assert protection.get('selectLockedCells') == '1' and protection.get('selectUnlockedCells') == '1'
    drawing = ET.fromstring(z.read('xl/drawings/drawing1.xml'))
    assert 'Test app ' not in z.read('xl/drawings/drawing1.xml').decode(), 'Hidden test labels remain'
    shapes = {}
    for shape in drawing.findall('.//xdr:sp', NS):
        name = shape.find('xdr:nvSpPr/xdr:cNvPr', NS).get('name')
        shapes[name] = shape
    assert len(shapes) == 51
    for slot in range(1, 7):
        for part in ('card', 'icon', 'category', 'name', 'desc', 'open'):
            props = shapes[f'dx_{part}{slot}'].find('xdr:nvSpPr/xdr:cNvPr', NS)
            assert props.get('hidden', '0') == ('1' if slot > 2 else '0')
    for name, macro in [('guide', 'DXGuide'), ('admin', 'DXManage'), ('mode', 'DXResume'), ('close', 'DXClose')]:
        assert shapes['dx_' + name].get('macro') == '[0]!' + macro
    for slot in (1, 2):
        for part in ('card', 'icon', 'category', 'name', 'desc', 'open'):
            assert not shapes[f'dx_{part}{slot}'].get('macro'), 'Pending card can launch'
        label = ''.join(shapes[f'dx_name{slot}'].findall('.//a:t', NS)[0].itertext())
        assert label, 'Missing card title'
        for part, size in [('name', '2100'), ('desc', '1300')]:
            properties = shapes[f'dx_{part}{slot}'].findall('.//a:rPr', NS)
            assert properties and all(p.get('sz') == size for p in properties)
            for prop in properties:
                assert prop.find('a:latin', NS).get('typeface') == 'Meiryo UI'
                assert prop.find('a:ea', NS).get('typeface') == 'Meiryo UI'
    admin_drawing = ET.fromstring(z.read('xl/drawings/drawing2.xml'))
    assert [s.get('macro') for s in admin_drawing.findall('.//xdr:sp', NS)] == ['[0]!DXHome']

for name in ('DXアプリホーム.xlsx', 'DX活動ガイド.html'):
    assert (ROOT / name).read_bytes() == (OUT / name).read_bytes(), name

native = (BUILD / 'native-tests.txt').read_bytes().decode('cp932')
assert 'PASS: native functional suite complete' in native and 'FAIL:' not in native
for assertion in ('PASS: $B$13 length 28', 'PASS: $B$13 length 29', 'PASS: $C$13 length 51',
                  'PASS: $F$13 length 2', 'PASS: $C$5 length 101',
                  'PASS: runtime retains original shape identities',
                  'PASS: clearing target removes old actions',
                  'PASS: empty state hides old cards',
                  'PASS: third app update completes',
                  'PASS: third app visible and bound dx_card3',
                  'PASS: third app Japanese title',
                  'PASS: 28 Japanese characters fit title', 'PASS: 50 Japanese characters fit description'):
    assert assertion in native, assertion
(BUILD / 'native-tests-utf8.txt').write_text(native)

docs = ['全画面版-使い方', '全画面版-実機確認', '全画面版-検証記録']
for doc in docs:
    content = (ROOT / 'excel-launcher' / (doc + '.md')).read_text()
    # UTF-8 BOM and CRLF work well in standard Windows editors.
    (OUT / (doc + '.txt')).write_bytes(b'\xef\xbb\xbf' + content.replace('\n', '\r\n').encode('utf-8'))
files = [BOOK, OUT / 'DXアプリホーム.xlsx', OUT / 'DX活動ガイド.html']
files += [OUT / (doc + '.txt') for doc in docs]
archive = OUT / 'DXアプリホーム-全画面検証版-r4-配布一式.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as z:
    for path in files:
        z.write(path, unicodedata.normalize('NFC', path.name))
with ZipFile(archive) as z:
    assert z.testzip() is None and len(z.namelist()) == 6
    assert z.read(FILE_NAME) == BOOK.read_bytes()
manifest = {unicodedata.normalize('NFC', p.name): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(BUILD / 'verified-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print('PASS: native VBA source, registry, shapes, protection, formula caches, fallback copies, ZIP integrity')
print(archive)
