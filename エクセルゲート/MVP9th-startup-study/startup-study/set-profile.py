"""Select a study path in an uninitialized generated book; never rewrite VBA."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, json, re, sys
import xml.etree.ElementTree as ET
p=Path(sys.argv[1]); profile=sys.argv[2]
if profile not in ('baseline','minimal','direct'): raise ValueError('Invalid profile')
with ZipFile(p) as z: members={n:z.read(n) for n in z.namelist()}
ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
xml=members['xl/workbook.xml'].decode(); root=ET.fromstring(xml)
if len(root.findall(ns+'sheets/'+ns+'sheet'))!=1: raise ValueError('Refuse initialized workbook')
if '_GateStartupProfile' in xml: raise ValueError('Already profiled')
if '</definedNames>' not in xml: raise ValueError('Missing presentation names')
original=hashlib.sha256(p.read_bytes()).hexdigest();vba=members['xl/vbaProject.bin']
xml=xml.replace('</definedNames>','<definedName name="_GateStartupProfile" hidden="1">"'+profile+'"</definedName></definedNames>')
ET.fromstring(xml);members['xl/workbook.xml']=xml.encode()
tmp=p.with_suffix('.profile-stage.xlsm')
with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
 for n,b in members.items(): z.writestr(n,b)
with ZipFile(tmp) as z:
 if z.read('xl/vbaProject.bin')!=vba: raise ValueError('VBA changed')
 if z.testzip(): raise ValueError('Archive invalid')
tmp.replace(p)
print(json.dumps({'profile':profile,'beforeSha256':original,'afterSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'vbaProjectSha256':hashlib.sha256(vba).hexdigest(),'changedMembers':['xl/workbook.xml']}))
