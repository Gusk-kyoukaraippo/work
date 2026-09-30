"""Set native XLSX view/input settings not exposed by the artifact API.

All worksheet contents, styling and formulas are authored by artifact-tool.
This pass configures native views, input limits, home-sheet protection and
recalculation on open. Artifact-tool cannot calculate HYPERLINK; its displayed
labels are calculated there, and actual native HYPERLINK formulas are installed
here with the same IF logic and cached labels for Excel/JUST Calc to recalculate.
"""
import sys
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

source = Path(sys.argv[1])
formulas = json.loads(Path(sys.argv[2]).read_text())
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
ET.register_namespace('', NS)
ET.register_namespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
def tag(name): return '{' + NS + '}' + name

with zipfile.ZipFile(source) as archive:
    contents = {name: archive.read(name) for name in archive.namelist()}

for name in ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']:
    sheet = ET.fromstring(contents[name])
    sheet_name = 'アプリホーム' if name.endswith('sheet1.xml') else 'アプリ登録'
    for instruction in [item for item in formulas if item['sheet'] == sheet_name]:
        cell = sheet.find('.//' + tag('c') + '[@r="' + instruction['cell'] + '"]')
        assert cell is not None, instruction
        existing = cell.find(tag('f'))
        if existing is None:
            inline = cell.find(tag('is'))
            if inline is not None:
                cached = ''.join(inline.itertext())
                cell.remove(inline)
                ET.SubElement(cell,tag('v')).text = cached
            existing = ET.Element(tag('f'))
            cell.insert(0,existing)
        existing.text = instruction['formula'].lstrip('=')
        cell.set('t','str')
    views = sheet.find(tag('sheetViews'))
    if views is None:
        views = ET.Element(tag('sheetViews'))
        before = next((i for i,e in enumerate(sheet) if e.tag in [tag('sheetFormatPr'),tag('cols'),tag('sheetData')]), 0)
        sheet.insert(before, views)
    view = views.find(tag('sheetView'))
    if view is None: view = ET.SubElement(views, tag('sheetView'), {'workbookViewId':'0'})
    view.set('showGridLines','0')
    view.set('zoomScale', '90' if name.endswith('sheet1.xml') else '80')
    view.set('tabSelected', '1' if name.endswith('sheet1.xml') else '0')
    view.set('showRowColHeaders', '0' if name.endswith('sheet1.xml') else '1')
    if name.endswith('sheet1.xml'):
        for old in list(view.findall(tag('selection'))): view.remove(old)
        ET.SubElement(view,tag('selection'), {'activeCell':'AB1','sqref':'AB1'})
        protection=ET.Element(tag('sheetProtection'), {'sheet':'1','objects':'1','scenarios':'1','selectLockedCells':'0','selectUnlockedCells':'0'})
        insert_at=next((i for i,e in enumerate(sheet) if e.tag in [tag('autoFilter'),tag('sortState'),tag('mergeCells'),tag('conditionalFormatting'),tag('dataValidations'),tag('hyperlinks'),tag('printOptions'),tag('pageMargins')]), len(sheet))
        sheet.insert(insert_at,protection)
    else:
        validations = sheet.find(tag('dataValidations'))
        if validations is None:
            validations = ET.Element(tag('dataValidations'))
            before = next((i for i,e in enumerate(sheet) if e.tag in [tag('hyperlinks'),tag('printOptions'),tag('pageMargins'),tag('pageSetup'),tag('drawing'),tag('extLst')]), len(sheet))
            sheet.insert(before,validations)
        for address, maximum, label in [('B13:B36',28,'アプリ名'),('C13:C36',50,'説明'),('F13:F36',1,'アイコン文字'),('C5',100,'一言')]:
            validation = ET.SubElement(validations, tag('dataValidation'), {'type':'textLength','operator':'lessThanOrEqual','allowBlank':'1','showErrorMessage':'1','showInputMessage':'1','sqref':address,'errorTitle':label+'が長すぎます','error':str(maximum)+'文字以内で入力してください。','promptTitle':label,'prompt':str(maximum)+'文字以内で入力します。'})
            ET.SubElement(validation,tag('formula1')).text=str(maximum)
        validations.set('count',str(len(validations)))
    contents[name] = ET.tostring(sheet, encoding='utf-8', xml_declaration=True)

book = ET.fromstring(contents['xl/workbook.xml'])
calc = book.find(tag('calcPr'))
if calc is None: calc=ET.SubElement(book,tag('calcPr'))
calc.attrib.update({'calcMode':'auto','fullCalcOnLoad':'1','forceFullCalc':'1'})
contents['xl/workbook.xml']=ET.tostring(book,encoding='utf-8',xml_declaration=True)
temporary=source.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED) as archive:
    for name, data in contents.items(): archive.writestr(name,data)
temporary.replace(source)
assert not any('vbaProject' in name for name in contents)
assert not any(name.startswith('xl/externalLinks/') for name in contents)
print('XLSXビュー設定・入力文字数を確認。VBAと外部ブック参照はありません。')
