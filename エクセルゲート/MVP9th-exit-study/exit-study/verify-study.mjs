import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {sha256,verifiedWorkbook} from '../scripts/package.mjs';
import {REQUIRED_CHECKS} from '../scripts/browser-harness.mjs';
import {zipFolder} from '../scripts/zip.mjs';
import {verifyBusinessCopy} from './business-copy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]);
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const manifest=await json(path.join(out,'study-manifest.json'));
const native=await verifiedWorkbook();
assert.equal(manifest.nativeMasterSha256,native.receipt.sha256);
assert.equal(manifest.businessHtmlSha256,sha256(await fs.readFile(path.join(root,'apps/rehab-inventory/index.html'))));
const preservation=verifyBusinessCopy(await fs.readFile(path.join(root,'apps/rehab-inventory/index.html')),await fs.readFile(path.join(root,'../MVP9th/apps/rehab-inventory/index.html')));
assert.deepEqual(manifest.businessHtmlPreservation,preservation);
assert.equal(sha256(await fs.readFile(path.join(root,'../MVP9th/workbook/MVP9th.xlsm'))),'819a6dbde1b7d2ac46ec54cf00ce2010c4a1fb69203d6b61801d5bc109e55c25');
const revision=manifest.revision||'r1';
const commonLogPath=path.join(root,'exit-study',revision==='r1'?'all-tests.log':'all-tests-'+revision+'.log');
const commonLog=await fs.readFile(commonLogPath,'utf8');
const commonCount=Number(commonLog.match(/ℹ tests (\d+)\s/)?.[1]);
assert.ok(commonCount>0);assert.equal(Number(commonLog.match(/ℹ pass (\d+)\s/)?.[1]),commonCount);assert.match(commonLog,/ℹ fail 0\s/);
assert.match(commonLog,/✔ all three modes keep every transition at the bottom/);
const books=[];
const appReports=[];
await fs.mkdir(path.join(out,'検証記録'),{recursive:false});
await fs.copyFile(commonLogPath,path.join(out,'検証記録/共通試験.log'));
for(const profile of manifest.profiles){
  const folder=path.join(out,profile.folder),release=await json(path.join(folder,'release-manifest.json'));
  const config=await json(path.join(folder,'gate.config.json'));
  assert.equal(config.exitMode,profile.exitMode);
  assert.equal(release.mode,'candidate');assert.equal(release.distributionReady,false);assert.equal(release.operationalPackageReady,false);
  assert.equal(release.targetPlatformValidation,'pending');assert.equal(release.siteReady,false);
  assert.deepEqual(profile.identity,release.identity);
  for(const [relative,expected] of Object.entries(release.hashes))assert.equal(sha256(await fs.readFile(path.join(folder,relative))),expected,profile.folder+'/'+relative);
  async function checkEmptyData(dir){
    for(const entry of await fs.readdir(dir,{withFileTypes:true})){
      assert.ok(entry.isDirectory(),'Unexpected business data in package');
      await checkEmptyData(path.join(dir,entry.name));
    }
  }
  await checkEmptyData(path.join(folder,'data'));
  const guide=await fs.readFile(path.join(folder,'runtime/物品管理の使い方.md'),'utf8');
  assert.doesNotMatch(guide,/ダウンロード完了を確認|保存して終了/);
  const log=await fs.readFile(path.join(root,'exit-study',profile.folder+'-browser-'+revision+'.log'),'utf8');
  assert.match(log,/ℹ tests 8\s/);assert.match(log,/ℹ pass 8\s/);assert.match(log,/ℹ fail 0\s/);
  const checks=(await fs.readFile(path.join(root,'exit-study',profile.folder+'-checks-'+revision+'.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(checks.length,REQUIRED_CHECKS.length);
  for(const key of REQUIRED_CHECKS)assert.equal(checks.filter(c=>c.key===key&&c.passed).length,1,key);
  const logName=profile.folder+'-業務試験.log';
  await fs.writeFile(path.join(out,'検証記録',logName),log);
  const report={schemaVersion:1,status:'passed',method:'automated browser, macOS Chrome file URLs',
    profile:profile.folder,exitMode:profile.exitMode,identity:release.identity,
    acceptanceTestSha256:sha256(await fs.readFile(path.join(root,'integrations/rehab-inventory/acceptance.test.mjs'))),
    harnessSha256:sha256(await fs.readFile(path.join(root,'scripts/browser-harness.mjs'))),
    checks,logSha256:sha256(Buffer.from(log)),vbaRuntimeExecuted:false,windowsJustCalcExecution:false};
  const receiptName=profile.folder+'-業務試験.json';
  await fs.writeFile(path.join(out,'検証記録',receiptName),JSON.stringify(report,null,2)+'\n');
  appReports.push({profile:profile.folder,checks:checks.length,report:'検証記録/'+receiptName});
  books.push({file:path.join(folder,profile.workbook),expectedVba:profile.vbaProjectSha256,name:release.presentation.displayName});
}
// Inspect the embedded project and saved titles independently of generation receipts.
const bookAudit=JSON.parse(execFileSync('python3',['-c',String.raw`
import json,sys,hashlib,xml.etree.ElementTree as ET
from zipfile import ZipFile
n='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
results=[]
for b in json.load(sys.stdin):
 with ZipFile(b['file']) as z:
  assert hashlib.sha256(z.read('xl/vbaProject.bin')).hexdigest()==b['expectedVba']
  wb=ET.fromstring(z.read('xl/workbook.xml'))
  sheets=wb.findall(n+'sheets/'+n+'sheet')
  assert len(sheets)==1 and sheets[0].get('name')=='操作パネル'
  strings=[''.join(i.itertext()) for i in ET.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
  ws=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
  def value(address):
   c=ws.find('.//'+n+'c[@r="'+address+'"]')
   assert c is not None and c.find(n+'f') is None
   return strings[int(c.find(n+'v').text)] if c.get('t')=='s' else ''.join(c.find(n+'is').itertext()) if c.get('t')=='inlineStr' else c.find(n+'v').text
  assert value('B2')==b['name']
  assert value('B4')=='DX推進委員会 Excelゲート'
  drawings=b''.join(z.read(f) for f in z.namelist() if f.startswith('xl/drawings/') and f.endswith('.xml'))
  assert b'InitializeGate' in drawings
  results.append({'workbook':b['file'],'uninitialized':True,'savedTitles':True,'nativeVbaMatches':True,'setupButton':True})
print(json.dumps(results,ensure_ascii=False))
`],{input:JSON.stringify(books),encoding:'utf8'}));
const preview=await json(path.join(out,'preview-record.json'));
assert.equal(preview.records.length,13);
assert.equal(sha256(await fs.readFile(path.join(out,preview.workbookPreview.file))),preview.workbookPreview.sha256);
const nativeCompile=await json(path.join(root,'exit-study/native-compile-r4.json'));
assert.equal(nativeCompile.success,true);
assert.equal(nativeCompile.vbaProjectSha256,manifest.profiles[0].vbaProjectSha256);
await fs.copyFile(path.join(root,'exit-study/native-compile-r4.json'),path.join(out,'検証記録/Excel-VBA-コンパイル.json'));
for(const profile of manifest.profiles){
  const records=preview.records.filter(r=>r.profile===profile.folder),editing=records.find(r=>r.state==='editing');
  assert.equal(editing.geometry.dock.height,72);
  for(const record of records){
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(record.geometry.primarySlot[key]-editing.geometry.primarySlot[key])<1,profile.folder+' '+record.state+' fixed '+key);
    const g=record.geometry;
    assert.ok(g.businessViewport.y+g.businessViewport.height<=g.dock.y+1);
  }
}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(out,'画面を比較.html')).href);
  for(const p of ['A','B','C']){
    await page.locator('[data-profile="'+p+'"]').click();
    for(const state of p==='A'?['editing','name','after']:['editing','name','after','slow','ready']){
      await page.locator('#state').selectOption(state);
      await page.locator('#screen').evaluate(img=>img.decode());
      assert.equal(await page.locator('#screen').evaluate(img=>img.naturalWidth),1200);
      assert.equal(await page.locator('[data-profile="'+p+'"]').getAttribute('aria-pressed'),'true');
    }
  }
  await page.locator('[data-profile="B"]').click();await page.locator('#state').selectOption('ready');
  await page.screenshot({path:path.join(out,'画面/比較ページ.png'),fullPage:true});
  for(const width of [1440,900,390]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Preview overflow at '+width);
  }
  assert.deepEqual(errors,[]);
  await page.goto(pathToFileURL(path.join(out,'Excel側の画面.html')).href);
  await page.locator('img').evaluate(img=>img.decode());
  assert.ok(await page.locator('img').evaluate(img=>img.naturalWidth)>1000);
  for(const width of [900,390]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Workbook preview overflow at '+width);
  }
}finally{await browser.close()}
const report={schemaVersion:1,createdAt:new Date().toISOString(),status:'prototype-complete',
  commonTests:{passed:commonCount,failed:0,log:'検証記録/共通試験.log'},
  appTests:appReports,nativeSourceVerification:native.receipt.validation,
  nativeCompile,settingsValidation:{sourceContracts:true,windowsFixture:'tests/windows/GateSettingsTests.bas',windowsRuntimeExecuted:false,macRuntimeAttempt:'cached-config fixture stopped at Windows-oriented entry-file check; no success claim'},
  workbookAudit:bookAudit.map((b,i)=>({...b,workbook:manifest.profiles[i].folder+'/'+manifest.profiles[i].workbook})),
  businessHtmlPreservation:preservation,ui:manifest.ui,bottomDockTransitionTests:true,primaryButtonGeometryVerified:true,editingBarHeightVerified:72,previewScreenshots:13,previewReceiptWriter:'simulated',
  windowsJustCalcExecution:false,edgeWindowsExecution:false,sharedLockReleaseVerified:false};
await fs.writeFile(path.join(out,'study-report.json'),JSON.stringify(report,null,2)+'\n');
await fs.writeFile(path.join(out,'確認結果.md'),`# 終了UI試作 ${revision}の確認結果\n\nA（通常UI）、B（OnTime）、C（VBA待機）の編集中のバーを高さ72pxの一段にしました。保存を始めたときだけ案内欄が上へ広がり、名前入力・準備中・次の操作・再試行は同じ下部で切り替わります。進む・再試行・閉じるの主ボタンの位置と大きさを保ちます。業務HTMLは保存案内文2か所だけ更新し、それ以外の画面構成・機能・業務コード・JSON形式・アプリIDを保っています。r4ではExcel側の説明を主ボタンの直上に置き、主操作を同じ位置の大きなボタンへ集約しました。「設定を見直す」で保存済みデータ・履歴・データベースIDを保って保存先を再登録できます。各案の受け取り・正式保存方式とEdge側のUIはr3から変えていません。\n\n| 確認 | 結果 |\n| --- | --- |\n| 共通試験 | ${commonCount} / ${commonCount} 合格 |\n| 各案の物品管理の業務試験 | A・B・Cそれぞれ8 / 8、計24 / 24 合格 |\n| 下部バーの遷移 | 3方式、幅1200・900・390・320で72pxの編集バー、名前入力・入力エラー・終了案内・再試行・準備完了における主ボタンの位置と大きさ、業務領域の確保を検査 |\n| ネイティブExcelのVBAコンパイル | 今回の変更をMac版Excelでコンパイルし、完了後のコンパイル項目が無効になったことを確認 |\n| 保存済みブックのVBAとソースの照合 | 10標準モジュールとThisWorkbookが一致 |\n| 3案の同梱ブック | 同じVBA、未初期化、データなし、アプリ名と初回設定ボタンを検査 |\n| 比較ページ | Edgeの13画面の切替と、実際のExcel表示プレビューの画像読込・表示幅を確認 |\n| 設定の見直し | 更新項目・中断条件・失敗時復元のソース契約試験。Windowsでデータ保存・再設定・再読込の実行は未確認 |\n| Windows / JUST Calc / Edge | 未実施 |\n| 共有フォルダ・二台編集交代・ロック解除 | 未実施 |\n\n業務試験は、貸出・返却・延長・履歴・物品と職員の操作を元HTMLと比較し、保存データの往復、未確定入力の停止、閲覧制限、キャッシュ禁止、非同期処理、終了後の更新拒否を確認しています。\n\n受け取り通知のブラウザ試験では、file://での通知読込、古い通知・別作業の拒否、待機中の終了警告、30秒後の再試行、準備完了の表示を確認しています。通知の書き込みは試験用に模擬しているため、VBAの実際のダウンロード検出やOnTime・待機ループの動作保証にはしません。\n\nMacのExcel画面は確認用の設定と作業状態を与えて表示しました。再設定のMac実行試験はWindows向けの入口ファイル検証で止まったため、成功とは記録していません。保存済みデータ・履歴の保持と保存失敗の復元は、実機用のGateSettingsTests.basおよび実機比較の項目で確認します。\n\nログは [検証記録](検証記録/)、照合情報はstudy-manifest.jsonとstudy-report.jsonにあります。Windowsでの採用判断は [実機比較・記録.md](実機比較・記録.md) に沿って行います。\n`);
const fileHashes={};
async function inventory(relative=''){
  for(const entry of await fs.readdir(path.join(out,relative),{withFileTypes:true})){
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())await inventory(name);
    else if(name!=='bundle-files.json')fileHashes[name]=sha256(await fs.readFile(path.join(out,name)));
  }
}
await inventory();
await fs.writeFile(path.join(out,'bundle-files.json'),JSON.stringify({schemaVersion:1,files:fileHashes},null,2)+'\n');
const zip=await zipFolder(out,out+'.zip');
console.log(JSON.stringify({zip,commonTests:commonCount,appTests:24,screenshots:13,targetValidation:'pending'},null,2));
