"""Personalize a verified, uninitialized XLSM without rewriting its VBA.

Only workbook constant names, panel cells/styles and local button references
may change. All other ZIP members, including vbaProject.bin, stay byte-identical.
No Excel automation, VBA project access or third-party Python package is needed.
JSON stdin: {master, output, presentation}; stdout: derivation receipt.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from io import BytesIO
import hashlib, json, re, sys, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
ALLOWED = {'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/drawings/drawing1.xml'}

def require(value, message):
    if not value: raise ValueError(message)

def sha(data): return hashlib.sha256(data).hexdigest()

def replace_cell(xml, address, text, style):
    cell = f'<c r="{address}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'
    pattern = rf'<c\b(?=[^>]*\br="{address}")(?:[^>]*?/>|[^>]*>.*?</c>)'
    changed, n = re.subn(pattern, lambda _: cell, xml, flags=re.S)
    require(n == 1, 'Missing/duplicate presentation cell: ' + address)
    return changed

def append_style(xml, group, fragment):
    pattern = rf'<{group}\b[^>]*count="(\d+)"[^>]*>(.*?)</{group}>'
    m = re.search(pattern, xml, re.S); require(m, 'Missing style group: ' + group)
    index = int(m[1])
    return xml[:m.start()] + f'<{group} count="{index+1}">' + m[2] + fragment + f'</{group}>' + xml[m.end():], index

def personalize(master, output, p):
    require(output.suffix == '.xlsm' and output.name == p['workbookFileName'], 'Unexpected workbook filename')
    require(not output.exists(), 'Refusing to overwrite a workbook')
    name, accent, credit = p['displayName'], p['accentColor'], p['workbookCredit']
    require(isinstance(name,str) and 0 < len(name) <= 256 and not re.search(r'[\x00-\x1f\x7f]',name), 'Invalid display name')
    require(re.fullmatch(r'#[0-9A-F]{6}',accent), 'Invalid accent color')
    require(credit == 'DX推進委員会 Excelゲート', 'Invalid workbook credit')
    original = master.read_bytes()
    with ZipFile(BytesIO(original)) as z:
        require(len(z.namelist()) == len(set(z.namelist())), 'Duplicate archive member')
        members = {i.filename: z.read(i.filename) for i in z.infolist()}
    require('xl/vbaProject.bin' in members, 'A native macro master is required')
    before = members.copy()
    book = members['xl/workbook.xml'].decode('utf-8')
    tree = ET.fromstring(book); sheets = tree.findall(NS+'sheets/'+NS+'sheet')
    require(len(sheets)==1 and sheets[0].get('name')=='操作パネル', 'Master must be uninitialized')
    require(not tree.findall('.//'+NS+'definedName[@name="_GateDisplayName"]'), 'Master is already personalized')
    # Keep every formula string constant well below Excel's 255-character limit,
    # including surrogate pairs and doubled quotes. VBA joins these literal chunks.
    chunks=[];chunk='';units=0
    for c in name:
        width=len(c.encode('utf-16-le'))//2
        if units+width>100: chunks.append(chunk);chunk='';units=0
        chunk+=c;units+=width
    chunks.append(chunk)
    pairs=[('_GateDisplayName'+(str(i+1) if i else ''),value) for i,value in enumerate(chunks)]+[('_GateAccentColor',accent)]
    constants = ''.join(f'<definedName name="{key}" hidden="1">{escape(chr(34)+value.replace(chr(34),chr(34)*2)+chr(34))}</definedName>' for key,value in pairs)
    if '</definedNames>' in book: book=book.replace('</definedNames>',constants+'</definedNames>',1)
    elif re.search(r'<definedNames\b[^>]*/>',book):
        book=re.sub(r'<definedNames\b[^>]*/>',lambda _: '<definedNames>'+constants+'</definedNames>',book,count=1)
    else:
        # SpreadsheetML requires functionGroups/externalReferences before
        # definedNames and calcPr after it. Inserting directly after sheets
        # produces well-formed XML that native Excel cannot open.
        require('<calcPr' in book,'Missing master calculation properties')
        book=book.replace('<calcPr','<definedNames>'+constants+'</definedNames><calcPr',1)
    members['xl/workbook.xml']=book.encode()
    styles=members['xl/styles.xml'].decode()
    initial_panel=ET.fromstring(members['xl/worksheets/sheet1.xml'])
    initial_styles=ET.fromstring(styles)
    title_cell=initial_panel.find('.//'+NS+'c[@r="B2"]')
    require(title_cell is not None,'Missing master title')
    fill=initial_styles.find(NS+'cellXfs')[int(title_cell.get('s','0'))].get('fillId','0')
    styles, font=append_style(styles,'fonts','<font><b/><sz val="20"/><color rgb="FF17324D"/><name val="Yu Gothic UI"/></font>')
    styles, border=append_style(styles,'borders',f'<border><left style="medium"><color rgb="FF{accent[1:]}"/></left><right/><top/><bottom/><diagonal/></border>')
    styles, style=append_style(styles,'cellXfs',f'<xf numFmtId="49" fontId="{font}" fillId="{fill}" borderId="{border}" xfId="0" applyNumberFormat="1" applyFill="1" applyAlignment="1" applyFont="1" applyBorder="1"><alignment horizontal="left" vertical="center" wrapText="1" indent="1"/></xf>')
    styles, small_font=append_style(styles,'fonts','<font><sz val="10"/><color rgb="FF5B748B"/><name val="Yu Gothic UI"/></font>')
    styles, small_style=append_style(styles,'cellXfs',f'<xf numFmtId="49" fontId="{small_font}" fillId="{fill}" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyAlignment="1" applyFont="1"><alignment horizontal="left" vertical="center" wrapText="1" indent="1"/></xf>')
    members['xl/styles.xml']=styles.encode()
    panel=members['xl/worksheets/sheet1.xml'].decode()
    panel=replace_cell(panel,'B2',name,style); panel=replace_cell(panel,'B4',credit,small_style)
    require('ref="B2:J3"' in panel and 'ref="B4:J4"' in panel,'Master presentation layout is outdated')
    units=sum(4 if ord(c)>65535 else 2 if ord(c)>255 else 1 for c in name)
    row_height=max(24, ((units+49)//50)*13)
    old_height=0
    for row in [2,3]:
        pattern=rf'<row\b(?=[^>]*\br="{row}")[^>]*>'
        m=re.search(pattern,panel); require(m,'Missing header row')
        hm=re.search(r'\bht="([^"]+)"',m[0]);old_height+=float(hm[1]) if hm else 15
        tag=re.sub(r'\s(?:ht|customHeight)="[^"]*"','',m[0])[:-1]+f' ht="{row_height}" customHeight="1">'
        panel=panel[:m.start()]+tag+panel[m.end():]
    members['xl/worksheets/sheet1.xml']=panel.encode()
    drawing=members['xl/drawings/drawing1.xml'].decode()
    require('name="gate_InitializeGate"' in drawing,'Missing setup button')
    # [0] is the workbook-local macro target used by native Excel; no old filename.
    drawing,n=re.subn(r'\bmacro="[^"]*InitializeGate"','macro="[0]!InitializeGate"',drawing)
    require(n==1,'Unexpected setup button binding')
    delta=round((2*row_height-old_height)*12700)
    if delta: drawing=re.sub(r'(<a:off\b[^>]*\by=")(\d+)(")',lambda m:m[1]+str(int(m[2])+delta)+m[3],drawing)
    members['xl/drawings/drawing1.xml']=drawing.encode()
    changed=[k for k in members if members[k]!=before[k]]
    require(set(changed)<=ALLOWED,'Unexpected member modified')
    for k in ALLOWED: ET.fromstring(members[k])
    require(members['xl/vbaProject.bin']==before['xl/vbaProject.bin'],'VBA changed')
    buffer=BytesIO()
    with ZipFile(buffer,'w',ZIP_DEFLATED) as z:
        for k,v in members.items(): z.writestr(k,v)
    result=buffer.getvalue()
    with ZipFile(BytesIO(result)) as z:
        require(z.testzip() is None,'Invalid workbook archive')
        require(z.namelist()==list(before),'Archive members changed')
        for k,v in before.items():
            if k not in ALLOWED: require(z.read(k)==v,'Unexpected byte change: '+k)
        root=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        for address,expected in [('B2',name),('B4',credit)]:
            c=root.find('.//'+NS+f'c[@r="{address}"]')
            require(c is not None and c.get('t')=='inlineStr' and c.find(NS+'f') is None and ''.join(c.itertext())==expected,'Presentation mismatch: '+address)
    with output.open('xb') as f: f.write(result)
    return {'schemaVersion':1,**p,'masterSha256':sha(original),'workbookSha256':sha(result),'vbaProjectSha256':sha(members['xl/vbaProject.bin']),'changedMembers':changed,'unchangedMembersVerified':True,'uninitialized':True,'setupButtonLocal':True,'headerRowHeight':row_height}

if __name__=='__main__':
    try:
        request=json.load(sys.stdin)
        print(json.dumps(personalize(Path(request['master']),Path(request['output']),request['presentation']),ensure_ascii=False))
    except (ValueError,KeyError,OSError,ET.ParseError) as e:
        print(str(e),file=sys.stderr);sys.exit(1)
