"""Verify native Excel assembly against reviewed sources. Requires oletools.

Usage: python verify-workbook.py [workbook.xlsm]
Writes a source/hash receipt, not a claim that target-platform execution passed.
"""
from pathlib import Path
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile
from oletools.olevba import VBA_Parser

ROOT = Path(__file__).resolve().parents[1]
book = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'workbook/MVP5th.xlsm'

def tokens(source):
    source = '\n'.join(line for line in source.splitlines() if not line.startswith('Attribute '))
    # Preserve string literals exactly; VBA identifier case/whitespace is editor-normalized.
    result = []
    for token in re.findall(r'"(?:[^"\n]|"")*"|\x27[^\n]*|[A-Za-z_][A-Za-z_0-9]*|[^\s]', source):
        if token.startswith("'"): continue
        result.append(token if token.startswith('"') else token.lower())
    return result

sources = {p.name: p for p in (ROOT / 'vba/utf8').glob('*.bas')}
sources['ThisWorkbook.cls'] = ROOT / 'vba/ThisWorkbook.txt'
parser = VBA_Parser(str(book))
found = set()
for _, _, name, code in parser.extract_macros():
    if isinstance(code, bytes): code = code.decode('utf8')
    if name == 'Sheet1.cls':
        assert tokens(code) == [], 'Unexpected worksheet code'
        continue
    assert name in sources, f'Unexpected VBA module: {name}'
    assert tokens(code) == tokens(sources[name].read_text()), f'Workbook/source mismatch: {name}'
    found.add(name)
assert found == set(sources), f'Missing modules: {set(sources) - found}'
parser.close()
with ZipFile(book) as archive:
    workbook_xml = archive.read('xl/workbook.xml').decode()
    assert '_APP_META' not in workbook_xml, 'Only uninitialized master workbooks may be released'
    sheets = ET.fromstring(workbook_xml).findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheets/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet')
    assert len(sheets) == 1 and sheets[0].get('name') == '操作パネル', 'Unexpected master workbook sheets'
    assert 'xl/vbaProject.bin' in archive.namelist()
    bound_button = False
    for name in archive.namelist():
        if name.startswith('xl/drawings/') and name.endswith('.xml'):
            drawing = ET.fromstring(archive.read(name))
            ns = '{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
            for shape in drawing.iter(ns + 'sp'):
                props = shape.find(ns + 'nvSpPr/' + ns + 'cNvPr')
                if props is not None and props.get('name') == 'gate_InitializeGate' and shape.get('macro', '').endswith('InitializeGate'):
                    bound_button = True
    assert bound_button, 'Missing bound setup button'
files = [*sorted((ROOT / 'vba/utf8').glob('*.bas')), *sorted((ROOT / 'vba').glob('*.bas')), ROOT / 'vba/ThisWorkbook.txt']
receipt = {
    'workbook': book.name,
    'sha256': hashlib.sha256(book.read_bytes()).hexdigest(),
    'validation': {'embeddedSourceMatches': True, 'uninitialized': True, 'setupButton': True, 'windowsJustCalcExecution': False},
    'sourceHashes': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
}
target = book.with_suffix('.build.json')
target.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(f'PASS: 7 standard modules + ThisWorkbook events; {target.name}')
