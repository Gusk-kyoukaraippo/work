"""Prepare ASCII imports so Mac/Windows VBE code pages cannot corrupt Japanese text."""
from pathlib import Path
import re
import os
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('DX_FULLSCREEN_BUILD',ROOT/'outputs/01a0c900-623e-71d2-9af0-a2392f990288/fullscreen-r4/.build'))
OUT.mkdir(parents=True,exist_ok=True)
for source in (ROOT/'excel-launcher/vba').glob('*.bas'):
    text=source.read_text()
    def encode(m):
        literal=m.group()[1:-1].replace('""','"')
        if literal.isascii(): return m.group()
        return 'U("'+literal.encode('utf-16-be').hex().upper()+'")'
    text=re.sub(r'"(?:[^"\n]|"")*"',encode,text)
    assert text.isascii(), source
    assert max(map(len,text.splitlines()))<1024, source
    (OUT/source.name).write_bytes(text.replace('\n','\r\n').encode('ascii'))
    (OUT/source.with_suffix('.txt').name).write_text(re.sub(r'^Attribute .*\n','',text,flags=re.M))
(OUT/'ThisWorkbook.txt').write_bytes((ROOT/'excel-launcher/vba/ThisWorkbook.txt').read_bytes())
print(OUT)
