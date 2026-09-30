"""Verify a native macro master against the reviewed sources.

Usage: python verify-workbook.py [workbook.xlsm]
oletools is required only after the workbook structure passes inspection.
This writes a build receipt, never a Windows/JUST Calc acceptance receipt.
"""
from pathlib import Path
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile, BadZipFile

ROOT = Path(__file__).resolve().parents[1]
MAIN = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


class VerificationError(ValueError):
    pass


def require(condition, message):
    # Do not use assert: python -O must not bypass the release checks.
    if not condition:
        raise VerificationError(message)


def tokens(source):
    source = '\n'.join(line for line in source.splitlines() if not line.startswith('Attribute '))
    result = []
    for token in re.findall(r'"(?:[^"\n]|"")*"|\x27[^\n]*|[A-Za-z_][A-Za-z_0-9]*|[^\s]', source):
        if token.startswith("'"):
            continue
        result.append(token if token.startswith('"') else token.lower())
    return result


def inspect_structure(book):
    require(book.suffix.lower() == '.xlsm', 'A native .xlsm master is required; an .xlsx template is not a completed workbook')
    require(book.is_file(), f'Native master has not been assembled: {book}')
    with ZipFile(book) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Duplicate workbook archive entries')
        require('xl/vbaProject.bin' in names, 'No embedded VBA project; renaming an .xlsx does not assemble macros')
        content_types = ET.fromstring(archive.read('[Content_Types].xml'))
        require(any(item.get('PartName') == '/xl/workbook.xml' and
                    item.get('ContentType') == 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
                    for item in content_types), 'Workbook is not declared as macro-enabled')
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        require(any(item.get('Type', '').endswith('/vbaProject') and
                    item.get('Target') in ('vbaProject.bin', '/xl/vbaProject.bin') and
                    item.get('TargetMode') != 'External'
                    for item in relationships), 'Missing embedded VBA relationship')
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = workbook.findall(MAIN + 'sheets/' + MAIN + 'sheet')
        require(len(sheets) == 1 and sheets[0].get('name') == '操作パネル',
                'Only an uninitialized, single-panel master may be released')
        workbook_props = workbook.find(MAIN + 'workbookPr')
        workbook_module = workbook_props.get('codeName', 'ThisWorkbook') if workbook_props is not None else 'ThisWorkbook'
        sheet_id = sheets[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        sheet_target = next((item.get('Target', '') for item in relationships if item.get('Id') == sheet_id), '')
        require(bool(sheet_target), 'Missing panel worksheet relationship')
        sheet_path = sheet_target.lstrip('/') if sheet_target.startswith('/') else 'xl/' + sheet_target
        sheet = ET.fromstring(archive.read(sheet_path))
        sheet_props = sheet.find(MAIN + 'sheetPr')
        sheet_module = sheet_props.get('codeName', 'Sheet1') if sheet_props is not None else 'Sheet1'
        bound_button = False
        ns = '{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}'
        for name in names:
            if name.startswith('xl/drawings/') and name.endswith('.xml'):
                for shape in ET.fromstring(archive.read(name)).iter(ns + 'sp'):
                    props = shape.find(ns + 'nvSpPr/' + ns + 'cNvPr')
                    if (props is not None and props.get('name') == 'gate_InitializeGate' and
                            re.search(r'(?:^|[!.])InitializeGate$', shape.get('macro', ''))):
                        bound_button = True
        require(bound_button, 'Missing bound setup button')
    return workbook_module, sheet_module


def reviewed_sources(root, workbook_module):
    utf8_files = sorted((root / 'vba/utf8').glob('*.bas'))
    import_files = sorted((root / 'vba').glob('*.bas'))
    require({p.name for p in utf8_files} == {p.name for p in import_files}, 'UTF-8 and CP932 module sets differ')
    require(bool(utf8_files), 'No reviewed VBA modules found')
    for source in utf8_files:
        imported = root / 'vba' / source.name
        require(source.read_text(encoding='utf-8') == imported.read_text(encoding='cp932'),
                f'Run encode-vba.py before verifying: {source.name}')
    sources = {p.name: p.read_text(encoding='utf-8') for p in utf8_files}
    sources[workbook_module + '.cls'] = (root / 'vba/ThisWorkbook.txt').read_text(encoding='utf-8')
    return sources, [*utf8_files, *import_files, root / 'vba/ThisWorkbook.txt']


def verify_modules(macros, sources, sheet_module):
    found = set()
    sheet_seen = False
    for _, _, name, code in macros:
        require(isinstance(code, str), 'VBA extractor must return decoded source text')
        if name == sheet_module + '.cls':
            require(not sheet_seen, f'Duplicate worksheet module: {name}')
            require(not tokens(code), 'Unexpected worksheet code')
            sheet_seen = True
            continue
        require(name in sources, f'Unexpected VBA module: {name}')
        require(name not in found, f'Duplicate VBA module: {name}')
        require(tokens(code) == tokens(sources[name]), f'Workbook/source mismatch: {name}')
        found.add(name)
    require(found == set(sources), f'Missing modules: {sorted(set(sources) - found)}')


def verify(book, root=ROOT):
    workbook_module, sheet_module = inspect_structure(book)
    sources, files = reviewed_sources(root, workbook_module)
    try:
        from oletools.olevba import VBA_Parser
    except ImportError as error:
        raise VerificationError('oletools is required on the build PC to inspect embedded VBA source') from error
    parser = VBA_Parser(str(book))
    try:
        verify_modules(parser.extract_macros(), sources, sheet_module)
    finally:
        parser.close()
    receipt = {
        'workbook': book.name,
        'sha256': hashlib.sha256(book.read_bytes()).hexdigest(),
        'validation': {'embeddedSourceMatches': True, 'uninitialized': True, 'setupButton': True,
                       'windowsJustCalcExecution': False},
        'sourceHashes': {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    }
    target = book.with_suffix('.build.json')
    temporary = target.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)
    return target


if __name__ == '__main__':
    book = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'workbook/MVP7th.xlsm'
    try:
        target = verify(book)
    except (VerificationError, OSError, ValueError, KeyError, ET.ParseError, BadZipFile) as error:
        print(f'NOT VERIFIED: {error}', file=sys.stderr)
        sys.exit(1)
    print(f'PASS: embedded sources and setup button verified; {target.name}')
