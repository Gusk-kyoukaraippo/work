import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.DX_EXCEL_OUTPUT || path.join(root, 'outputs/01a0c900-623e-71d2-9af0-a2392f990288'));
const work = path.join(output, '.build');
const dependencies = process.env.DX_WORKSPACE_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
await fs.mkdir(work, { recursive: true });
try { await fs.symlink(dependencies, path.join(work, 'node_modules')); } catch (error) { if (error.code !== 'EEXIST') throw error; }
const require = createRequire(path.join(work, 'builder.mjs'));
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);

const CAPACITY = 24;
const DATA_ROW = 13;
const FILE_NAME = 'DXアプリホーム.xlsx';
const workbook = Workbook.create();
const nativeFormulas = [];
const home = workbook.worksheets.add('アプリホーム');
const admin = workbook.worksheets.add('アプリ登録');
const colors = [
  { light: '#E4F5EE', ink: '#176B53', button: '#227A60' },
  { light: '#E8EEFF', ink: '#455EA1', button: '#4F64AC' },
  { light: '#FDEDDC', ink: '#985B22', button: '#AC6329' },
  { light: '#F0E9FC', ink: '#77549D', button: '#8060AB' },
  { light: '#FBE7EC', ink: '#A34867', button: '#A95372' },
  { light: '#E0F2F5', ink: '#267480', button: '#327E89' },
];
const canvas = '#F4F6F8', ink = '#263B4B', muted = '#687988';
const font = 'Yu Gothic';
function value(sheet, cell, text) { sheet.getRange(cell).values = [[text]]; }
function formula(sheet, cell, text) { sheet.getRange(cell).formulas = [[text]]; }
function box(sheet, address, { text, expression, nativeExpression, fill, size = 13, color = ink, bold = false, align = 'left', wrap = false } = {}) {
  const range = sheet.getRange(address); range.merge();
  range.format = { font: { name: font, size, bold, color }, horizontalAlignment: align, verticalAlignment: 'center', wrapText: wrap };
  if (fill) range.format.fill = fill;
  const first = address.split(':')[0];
  if (expression) formula(sheet, first, expression);
  else if (text !== undefined) value(sheet, first, text);
  if (nativeExpression) nativeFormulas.push({ sheet: sheet.name, cell: first, formula: nativeExpression });
  return range;
}
const column = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const ref = (col, row) => `'アプリ登録'!$${col}$${row}`;
const cards = [];

// The card view is ordinary cells and formulas. No VBA, external program or add-in.
home.showGridLines = false;
home.tabColor = '#227A60';
home.getRange('A1:AB106').format = { fill: canvas, font: { name: font, size: 13, color: ink }, verticalAlignment: 'center' };
const widths = [24, 14, 56, 12, 60, 60, 60, 60, 14, 20, 14, 56, 12, 60, 60, 60, 60, 14, 20, 14, 56, 12, 60, 60, 60, 60, 14, 24];
widths.forEach((width, index) => home.getRange(`${column(index)}1:${column(index)}106`).format.columnWidthPx = width);
for (const [row, height] of [[1,12],[2,22],[3,38],[4,12],[5,30],[6,23],[7,29],[8,18]]) home.getRange(`A${row}:AB${row}`).format.rowHeightPx = height;
box(home, 'B2:I2', { text: 'DX推進委員会', color: muted, size: 11, bold: true });
box(home, 'B3:I3', { text: 'DX アプリホーム', size: 25, bold: true });
box(home, 'K2:R3', { expression: '=IF(\'アプリ登録\'!$C$8="","進め方・進行状況","進め方・進行状況を見る  ↗")', nativeExpression: '=IF(\'アプリ登録\'!$C$8="","進め方・進行状況",HYPERLINK(\'アプリ登録\'!$C$8,"進め方・進行状況を見る  ↗"))', fill: '#E4F5EE', color: '#176B53', size: 12, bold: true, align: 'center' });
box(home, 'U3:AA3', { text: 'アプリの登録・編集', nativeExpression: '=HYPERLINK("#\'アプリ登録\'!B2","アプリの登録・編集")', size: 11, color: muted, align: 'right' });
box(home, 'B5:R5', { text: '使いたいアプリを選んでください', size: 14, bold: true });
box(home, 'T5:AA5', { expression: `=(${CAPACITY}-COUNTBLANK('アプリ登録'!$B$${DATA_ROW}:$B$${DATA_ROW + CAPACITY - 1}))&" アプリ"`, color: muted, size: 12, align: 'right' });
box(home, 'B6:F7', { text: 'DX推進委員会から一言', color: '#647285', size: 10, bold: true });
box(home, 'G6:AA7', { expression: '=IF(\'アプリ登録\'!$C$5="","",\'アプリ登録\'!$C$5)', color: '#526474', size: 12, wrap: true });

for (let index = 0; index < CAPACITY; index++) {
  const source = DATA_ROW + index, band = Math.floor(index / 3), left = [1,10,19][index % 3], row = 9 + band * 12;
  const c = offset => column(left + offset), palette = colors[index % colors.length];
  const name = ref('B', source), description = ref('C', source), category = ref('D', source), target = ref('E', source), mark = ref('F', source);
  const full = `${c(0)}${row}:${c(7)}${row + 10}`;
  const localName = `$${c(1)}$${row+3}`;
  home.getRange(full).format.fill = '#FFFFFF';
  home.getRange(full).conditionalFormats.addCustom(`${localName}=""`, { fill: canvas });
  [9,40,7,28,28,18,18,18,9,34,12,18].forEach((height, offset) => home.getRange(`A${row+offset}:AB${row+offset}`).format.rowHeightPx = height);
  const icon = box(home, `${c(1)}${row+1}:${c(1)}${row+2}`, { expression: `=IF(${name}="","",IF(${mark}="",LEFT(${name},1),${mark}))`, size: 26, bold: true, align: 'center', color: palette.ink, fill: palette.light });
  const label = box(home, `${c(3)}${row+1}:${c(6)}${row+2}`, { expression: `=IF(${name}="","",IF(${category}="","アプリ",${category}))`, color: palette.ink, size: 11, bold: true });
  const title = box(home, `${c(1)}${row+3}:${c(6)}${row+4}`, { expression: `=IF(${name}="","",${name})`, size: 16, bold: true, wrap: true });
  const summary = box(home, `${c(1)}${row+5}:${c(6)}${row+7}`, { expression: `=IF(${name}="","",${description})`, size: 12, color: muted, wrap: true });
  const launch = box(home, `${c(1)}${row+9}:${c(6)}${row+9}`, { expression: `=IF(${name}="","",IF(${target}="","準備中","開く  ↗"))`, nativeExpression: `=IF(${name}="","",IF(${target}="","準備中",HYPERLINK(${target},"開く  ↗")))`, size: 13, bold: true, align: 'center' });
  launch.conditionalFormats.addCustom(`$${c(1)}$${row+9}="開く  ↗"`, { fill: palette.button, font: { color: '#FFFFFF', bold: true } });
  launch.conditionalFormats.addCustom(`$${c(1)}$${row+9}="準備中"`, { fill: '#EDF0F3', font: { color: '#70808D', bold: true } });
  cards.push({ source, row, full, name: `${c(1)}${row+3}`, description: `${c(1)}${row+5}`, mark: `${c(1)}${row+1}`, button: `${c(1)}${row+9}` });
}

admin.showGridLines = false;
admin.tabColor = '#90A4AE';
admin.getRange('A1:G49').format = { font: { name: font, size: 11, color: ink }, fill: '#FFFFFF', verticalAlignment: 'center' };
const adminWidths = [48,240,340,140,480,90,140];
adminWidths.forEach((width, i) => admin.getRange(`${column(i)}1:${column(i)}49`).format.columnWidthPx = width);
admin.getRange('A1:G49').format.rowHeightPx = 32;
admin.getRange('A1:G1').format.rowHeightPx = 12;
box(admin, 'B2:D2', { text: 'アプリの登録・編集', size: 20, bold: true });
box(admin, 'F2:G2', { text: 'ホームに戻る  ↗', nativeExpression: '=HYPERLINK("#\'アプリホーム\'!B2","ホームに戻る  ↗")', color: '#176B53', bold: true, align: 'center', size: 11 });
box(admin, 'B3:G3', { text: '黄色の欄を編集して保存すると、ホームのカードに反映されます。並び順は下の行順です。', size: 11, color: muted });
value(admin, 'B5', '委員会から一言');
box(admin, 'C5:G6', { text: '', fill: '#FFF5D9', wrap: true, size: 12 });
value(admin, 'B8', '進め方・進行状況のHTML');
box(admin, 'C8:G8', { text: 'DX活動ガイド.html', fill: '#FFF5D9', size: 11 });
box(admin, 'B9:G9', { text: '同梱のHTMLを同じフォルダに置きます。別の場所を使う場合は、上のリンク先を変更してください。', size: 11, color: muted });
box(admin, 'B10:G10', { text: '起動先には共有元のブック（.xlsmなど）かHTMLのパスを入力します。Excelゲートはruntime内のHTMLを指定しません。', size: 11, color: muted });
box(admin, 'B11:G11', { text: '名前は28文字、説明は50文字、アイコン文字は1文字まで。パスの前後に付く引用符は外してください。', size: 11, color: muted });
admin.getRange('A12:G12').values = [['順番','アプリ名','できること','分類','起動先','アイコン文字','登録状況']];
admin.getRange('A12:G12').format = { fill: '#334D61', font: { name: font, color: '#FFFFFF', bold: true, size: 11 }, horizontalAlignment: 'center', verticalAlignment: 'center' };
const initial = [
  ['引継ぎメモ','引継ぎ事項を入力・保存・確認できます。','記録・共有','','引'],
  ['地ケア・病床機能\n指標モニター','CSVから病棟・月別の指標を確認します。','集計・確認','','集'],
];
for (let i = 0; i < CAPACITY; i++) {
  const row = DATA_ROW + i;
  value(admin, `A${row}`, i+1);
  admin.getRange(`B${row}:F${row}`).values = [initial[i] || ['', '', '', '', '']];
  admin.getRange(`B${row}:F${row}`).format.fill = '#FFF8E7';
  admin.getRange(`B${row}:C${row}`).format.wrapText = true;
  admin.getRange(`A${row}:G${row}`).format.rowHeightPx = 60;
  admin.getRange(`A${row}:A${row}`).format.horizontalAlignment = 'center';
  admin.getRange(`F${row}:G${row}`).format.horizontalAlignment = 'center';
  formula(admin, `G${row}`, `=IF(B${row}="","未登録",IF(E${row}="","起動先未登録","登録済み"))`);
}
admin.getRange('D13:D36').dataValidation = { rule: { type: 'list', values: ['記録・共有','集計・確認','申請・管理','業務支援','資料・ガイド'] } };
admin.freezePanes.freezeRows(12);
box(admin, 'B39:G39', { text: '利用者はホームから開くだけで使えます。登録内容の変更は管理担当者が共有元のこのブックで行ってください。', size: 11, color: muted });
box(admin, 'B40:G40', { text: '登録済みは「パスの入力済み」を表します。実際に開けることは、職場のJUST Calcで確認してください。', size: 11, color: muted });
box(admin, 'B42:G42', { text: '初期登録の出典：ExcelゲートMVP8thの引継ぎメモ・地ケア版の配布設定と利用案内。職場の配置先は未登録です。', size: 10, color: muted });

// Exercise real input dependencies before restoring the delivered state.
const tests = [];
for (const index of [0, 5, 12, 23]) {
  const card = cards[index], original = admin.getRange(`B${card.source}:F${card.source}`).values;
  const name = `検証用アプリ${index + 1}`;
  admin.getRange(`B${card.source}:F${card.source}`).values = [[name,'入力変更の確認','業務支援','\\\\server\\共有フォルダ\\検証 ブック.xlsm','検']];
  assert.equal(home.getRange(card.name).values[0][0], name);
  assert.equal(home.getRange(card.description).values[0][0], '入力変更の確認');
  assert.equal(home.getRange(card.mark).values[0][0], '検');
  assert.equal(home.getRange(card.button).values[0][0], '開く  ↗');
  value(admin, `E${card.source}`, '');
  assert.equal(home.getRange(card.button).values[0][0], '準備中');
  value(admin, `B${card.source}`, '');
  assert.equal(home.getRange(card.name).values[0][0], '');
  assert.equal(home.getRange(card.button).values[0][0], '');
  admin.getRange(`B${card.source}:F${card.source}`).values = original;
  tests.push(`カード${index+1}：名前・説明・アイコン・起動先変更、起動先なし、名前なしを確認`);
}
value(admin, 'C5', 'テストのお知らせ'); assert.equal(home.getRange('G6').values[0][0], 'テストのお知らせ'); value(admin, 'C5', '');
// A populated visual stress test stays in support files, never in the deliverable.
// Run it in a fresh process: this renderer caches conditional-format styles.
if (process.env.DX_VISUAL_STRESS === '1') {
const initialMatrix = admin.getRange('B13:F36').values;
const sampleNames = ['引継ぎメモ','地ケア・病床機能\n指標モニター','申請アプリの表示検証','業務支援の表示検証','記録アプリの表示検証','資料アプリの表示検証'];
for (let i=0; i<CAPACITY; i++) admin.getRange(`B${DATA_ROW+i}:F${DATA_ROW+i}`).values = [[sampleNames[i] || `追加枠の表示検証 ${i+1}`, i===2 ? 'あいうえお'.repeat(10) : 'これはカード表示の検証用データです。', ['記録・共有','集計・確認','申請・管理','業務支援','記録・共有','資料・ガイド'][i%6], '\\\\server\\共有\\検証用.xlsm', ['引','集','申','業','記','資'][i%6]]];
value(admin,'C5','お知らせの表示を確認します。'.repeat(6).slice(0,100));
workbook.recalculate();
assert.equal(home.getRange('T5').values[0][0], '24 アプリ');
assert.equal(home.getRange(cards[23].button).values[0][0], '開く  ↗');
for (const [range, name] of [['A1:AB32','six-cards-layout-check.png'],['A93:AB103','last-cards-layout-check.png']]) {
  const image = await workbook.render({sheetName:'アプリホーム',range,scale:1.5,format:'png'});
  await fs.writeFile(path.join(work,name),new Uint8Array(await image.arrayBuffer()));
}
admin.getRange('B13:F36').values = initialMatrix;
value(admin,'C5','');
workbook.recalculate();
console.log('24件・長文・最終行の表示検証を完了しました（検証データは配布しません）。');
process.exit(0);
}
workbook.recalculate();
assert.equal(home.getRange('T5').values[0][0], '2 アプリ');
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 50 }, maxChars: 3000, summary: 'final formula scan' });
await fs.writeFile(path.join(work, 'formula-check.ndjson'), errors.ndjson);
console.log(errors.ndjson);
console.log((await workbook.inspect({ kind: 'table', range: "'アプリホーム'!B9:AA19", include: 'values,formulas', tableMaxRows: 11, tableMaxCols: 27, maxChars: 2500 })).ndjson);
for (const [sheetName, range, filename] of [['アプリホーム','A1:AB32','home-preview.png'],['アプリ登録','A1:G15','registration-preview.png']]) {
  const image = await workbook.render({ sheetName, range, scale: 1.5, format: 'png' });
  await fs.writeFile(path.join(work, filename), new Uint8Array(await image.arrayBuffer()));
}
const result = await SpreadsheetFile.exportXlsx(workbook);
await result.save(path.join(output, FILE_NAME));
try { await fs.rename(path.join(output, FILE_NAME + '.inspect.ndjson'), path.join(work,'export-inspect.ndjson')); } catch(error) { if(error.code !== 'ENOENT') throw error; }
await fs.writeFile(path.join(work, 'native-formulas.json'), JSON.stringify(nativeFormulas));
const python = process.env.DX_PYTHON || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
const native = spawnSync(python, [path.join(root, 'scripts/finalize-excel-launcher.py'), path.join(output, FILE_NAME), path.join(work, 'native-formulas.json')], { encoding: 'utf8' });
if (native.status !== 0) throw new Error(native.stderr || native.stdout);
console.log(native.stdout);
await fs.writeFile(path.join(work, 'verification.json'), JSON.stringify({ generatedAt: new Date().toISOString(), capacity: CAPACITY, initialApps: initial.map(x=>x[0]), tests, formulaScan: errors.ndjson, nativeWindowsJustCalc: '未実測', cards }, null, 2));
console.log(`作成しました: ${path.join(output, FILE_NAME)}`);
