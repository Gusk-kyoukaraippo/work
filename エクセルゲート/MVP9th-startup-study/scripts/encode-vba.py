from pathlib import Path
root = Path(__file__).resolve().parents[1] / 'vba'
for source in (root / 'utf8').glob('*.bas'):
    text = source.read_text(encoding='utf-8')
    (root / source.name).write_bytes(text.replace('\r\n', '\n').replace('\n', '\r\n').encode('cp932'))
print('VBA: UTF-8 → CP932 (strict)')
