import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const out = path.join(root, 'outputs/01a0c900-623e-71d2-9af0-a2392f990288/fullscreen');
const work = path.join(out, '.build');
await fs.mkdir(work, {recursive:true});
try { await fs.symlink(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), path.join(work,'node_modules')); } catch(e) { if(e.code!=='EEXIST') throw e; }
const require = createRequire(path.join(work,'builder.mjs'));
const {Workbook,SpreadsheetFile,FileBlob} = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const source = path.join(root, 'DXアプリホーム.xlsx');
const old = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const sourceAdmin = old.worksheets.getItem('アプリ登録');
const records = sourceAdmin.getRange('B13:F36').values;
const notice = sourceAdmin.getRange('C5').values[0][0] || '';
const guide = sourceAdmin.getRange('C8').values[0][0] || 'DX活動ガイド.html';
const originalView = await old.render({sheetName:'アプリホーム',range:'A1:AB32',scale:1,format:'png'});
await fs.writeFile(path.join(work,'before.png'),new Uint8Array(await originalView.arrayBuffer()));
await fs.writeFile(path.join(work,'source-data.json'),JSON.stringify({records,notice,guide},null,2));

const wb=Workbook.create(), home=wb.worksheets.add('アプリホーム'), admin=wb.worksheets.add('アプリ登録');
const font='Meiryo UI', ink='#263B4B', muted='#687988', bg='#F4F6F8';
for(const s of [home,admin]) s.showGridLines=false;
home.getRange('A1:AF38').format={fill:bg,font:{name:font,size:12,color:ink},columnWidthPx:40,rowHeightPx:20};
function box(s,area,text,size=12,color=ink,fill) {
  const r=s.getRange(area);r.merge();r.values=[[text]];r.format={font:{name:font,size,color},verticalAlignment:'center',wrapText:true};if(fill)r.format.fill=fill;
}
box(home,'B2:L3','DX アプリホーム',28);
box(home,'B5:AD6','全画面ランチャー 検証版',15);
box(home,'B8:AD10','職場の運用に沿って、このブックのマクロを実行してください。マクロを利用しない場合は、同梱の「DXアプリホーム.xlsx」を開きます。',14);
box(home,'B12:AD14','起動後はカードからアプリを開けます。表示を戻すには画面右上の「通常表示」を押します。',14);
home.tabColor='#227A60';
admin.getRange('A1:G43').format={font:{name:font,size:11,color:ink},fill:'#FFFFFF',verticalAlignment:'center',rowHeightPx:28};
['A','B','C','D','E','F','G'].forEach((c,i)=>admin.getRange(`${c}1:${c}43`).format.columnWidthPx=[46,235,350,145,390,92,150][i]);
box(admin,'B2:E2','アプリの登録・編集',21);
box(admin,'B3:G3','黄色の欄を編集し、「ホームに戻る」で表示を確認して保存します。',11,muted);
admin.getRange('B5').values=[['委員会から一言']];box(admin,'C5:G6',notice,12,ink,'#FFF5D9');
admin.getRange('B8').values=[['進め方・進行状況のHTML']];box(admin,'C8:G8',guide,11,ink,'#FFF5D9');
box(admin,'B9:G9','HTMLはブックと同じフォルダに置けます。別の場所の場合は上の欄にパスを入力します。',11,muted);
box(admin,'B10:G10','起動先には共有元のブックのパスを登録します。Excelゲートのruntime内のHTMLは指定しません。',11,muted);
box(admin,'B11:G11','アプリは上から順に表示されます。名前が空欄の行は表示しません。',11,muted);
admin.getRange('A12:G12').values=[['順番','アプリ名','できること','分類','起動先','アイコン','登録状況']];
admin.getRange('A12:G12').format={fill:'#334D61',font:{name:font,size:11,bold:true,color:'#FFFFFF'}};
admin.getRange('B13:F36').values=records;
admin.getRange('B13:F36').format.fill='#FFF8E7';
admin.getRange('B13:C36').format.wrapText=true;
admin.getRange('A13:G36').format.rowHeightPx=60;
for(let i=13;i<=36;i++) {
  admin.getRange(`A${i}`).values=[[i-12]];
  admin.getRange(`G${i}`).formulas=[[`=IF(B${i}="","未登録",IF(E${i}="","起動先未登録","登録済み"))`]];
}
admin.getRange('D13:D36').dataValidation={rule:{type:'list',values:['記録・共有','集計・確認','申請・管理','業務支援','資料・ガイド']}};
admin.freezePanes.freezeRows(12);
box(admin,'B39:G39','起動先未登録のアプリは「準備中」です。登録済みはパス入力済みを表し、起動の成功を保証するものではありません。',11,muted);
box(admin,'B40:G40','利用者は保存不要です。登録内容を変えた管理担当者が共有元のこのブックを保存してください。',11,muted);
box(admin,'B42:G42','初期登録の出典：ExcelゲートMVP8thの配布設定と利用案内。既存ランチャーから登録内容を引き継いでいます。',10,muted);
wb.recalculate();
console.log((await wb.inspect({kind:'table',range:"'アプリ登録'!B13:G15",include:'values,formulas',tableMaxRows:3,tableMaxCols:6,maxChars:2000})).ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:20},maxChars:2000});
await fs.writeFile(path.join(work,'template-formulas.ndjson'),errors.ndjson);
for(const [sheetName,range,name] of [['アプリホーム','A1:AF38','template-home.png'],['アプリ登録','A1:G15','admin.png']]) {
  const rendered=await wb.render({sheetName,range,scale:1,format:'png'});
  await fs.writeFile(path.join(work,name),new Uint8Array(await rendered.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(work,'launcher-template.xlsx'));
await fs.copyFile(source,path.join(out,'DXアプリホーム.xlsx'));
await fs.copyFile(path.join(root,'DX活動ガイド.html'),path.join(out,'DX活動ガイド.html'));
console.log(work);
