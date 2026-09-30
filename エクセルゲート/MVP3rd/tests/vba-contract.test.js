"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const vbaRoot = path.join(__dirname, "..", "vba");
const vbaDir = path.join(vbaRoot, "utf8");
const read = (name) => fs.readFileSync(path.join(vbaDir, name), "utf8");
const main = read("Mvp2Main.bas");
const storage = read("Mvp2Storage.bas");
const panel = read("Mvp2Panel.bas");
const events = fs.readFileSync(path.join(vbaRoot, "ThisWorkbook.txt"), "utf8");

const hasUnclosedStringLiteral = (line) => {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !inString) break;
    if (character !== '"') continue;
    if (inString && line[index + 1] === '"') {
      index += 1;
    } else {
      inString = !inString;
    }
  }
  return inString;
};

test("利用者向けマクロはDXガイドを含む6操作を公開する", () => {
  for (const name of ["OpenDxGuide", "OpenReadOnlyHtml", "OpenEditHtml", "ImportSaveData", "OpenSaveHistory", "ExitWorkbook"]) {
    assert.match(main, new RegExp(`Public Sub ${name}\\(\\)`));
  }
  for (const removed of ["Restore", "ShowAppMeta", "DiscardSession", "SafeClose"]) {
    assert.doesNotMatch(main, new RegExp(`Public Sub ${removed}`));
  }
  assert.match(panel, /一時保存ファイルをExcelに正式保存する/);
  assert.match(panel, /ログチェック（管理者向け）/);
});

test("HTMLへ渡すJSONはVBEで不安定な長い継続式を使わず組み立てる", () => {
  const start = main.indexOf("Private Function Mvp2BuildAppContext");
  const end = main.indexOf("End Function", start);
  const body = main.slice(start, end);
  assert.match(body, /Dim contextJson As String/);
  assert.match(body, /Mvp2BuildAppContext = contextJson/);
  assert.match(body, /contextJson = contextJson & ",""payload"":" & payloadRaw & "}"/);
  assert.doesNotMatch(body, /&\s*_\s*$/m);
});

test("VBAの各行に閉じ忘れた文字列リテラルがない", () => {
  for (const name of fs.readdirSync(vbaDir).filter((entry) => entry.endsWith(".bas"))) {
    const lines = read(name).split(/\r?\n/);
    lines.forEach((line, index) => {
      assert.equal(hasUnclosedStringLiteral(line), false, `${name}:${index + 1}`);
    });
  }
});

test("ThisWorkbookは起動・再アクティブ化・終了を共通処理へ渡す", () => {
  assert.match(events, /Workbook_Open\(\)[\s\S]*Mvp2OnOpen/);
  assert.match(events, /Workbook_Activate\(\)[\s\S]*Mvp2OnActivate/);
  assert.match(events, /Workbook_BeforeClose\(Cancel As Boolean\)[\s\S]*Mvp2OnBeforeClose Cancel/);
});

test("操作パネルは1分タイマーを一つだけ予約し終了前に解除する", () => {
  assert.match(panel, /If gImportInProgress Or gTimerScheduled Or Not gTimerSupported Then Exit Sub/);
  assert.match(panel, /Application\.OnTime[\s\S]*Schedule:=True/);
  assert.match(panel, /Application\.OnTime[\s\S]*Schedule:=False/);
});

test("操作パネルは利用順に縦配置し、最新版だけを穏やかな状態色で表示する", () => {
  assert.match(panel, /Mvp2AddButton ws, "DXプロジェクト8段階ガイドを開く", "OpenDxGuide", ws\.Range\("B8:N9"\)/);
  assert.match(panel, /Mvp2AddButton ws, "閲覧する", "OpenReadOnlyHtml", ws\.Range\("B20:G22"\)/);
  assert.match(panel, /Mvp2AddButton ws, "編集する", "OpenEditHtml", ws\.Range\("H20:N22"\)/);
  assert.match(panel, /Mvp2AddButton ws, "一時保存ファイルをExcelに正式保存する", "ImportSaveData", ws\.Range\("B24:N26"\)/);
  assert.match(panel, /Mvp2AddButton ws, "終了する", "ExitWorkbook", ws\.Range\("B28:N30"\)/);
  assert.match(panel, /Mvp2AddButton ws, "ログチェック（管理者向け）", "OpenSaveHistory", ws\.Range\("B42:F44"\)/);
  assert.match(panel, /Mvp2FormatCard ws\.Range\("B10:N15"\), "正式保存：最新版"/);
  assert.doesNotMatch(panel, /正式保存：1つ前|1つ前の正式保存/);
  assert.match(panel, /Mvp2EnsureOperationPanelLayout ws[\s\S]*Mvp2MoveButton ws, "ImportSaveData", ws\.Range\("B24:N26"\)/);
  assert.match(panel, /statusColor = RGB\(237, 244, 250\)/);
  assert.match(panel, /statusDetail = "参考：前回の正式保存から /);
  assert.doesNotMatch(panel, /RGB\(253, 230, 228\)|RGB\(145, 36, 27\)|MVP2_STALE_HOURS/);
});

test("読み取り専用では編集・保存ボタンを無効化し、閲覧操作だけを残す", () => {
  assert.match(panel, /このExcelは読み取り専用で開いています。閲覧のみ利用できます。/);
  assert.match(panel, /Mvp2SetButtonEnabled ws, "OpenEditHtml", Not readOnlyMode/);
  assert.match(panel, /Mvp2SetButtonEnabled ws, "ImportSaveData", Not readOnlyMode/);
  assert.match(panel, /Mvp2SetButtonEnabled ws, "OpenReadOnlyHtml", True/);
  assert.match(panel, /Mvp2SetButtonEnabled ws, "OpenDxGuide", True/);
  assert.match(panel, /button\.OnAction = ""/);
  assert.match(panel, /このExcelでは閲覧だけできます。作業中の内容は変更できません。/);
  assert.match(panel, /このExcelではデータの入力・編集・正式保存はできません/);
  assert.match(main, /If ThisWorkbook\.ReadOnly Then Err\.Raise[\s\S]*読み取り専用/);
  assert.match(panel, /Mvp2SetButtonCaption ws, "ImportSaveData", "一時保存ファイルをExcelに正式保存する"/);
  assert.match(panel, /Mvp2SetButtonCaption ws, "OpenSaveHistory", "ログチェック（管理者向け）"/);
  assert.match(panel, /Private Sub Mvp2SetButtonCaption[\s\S]*button\.TextFrame2\.TextRange\.Text = caption/);
});

test("DXガイドはブック直下の相対パスから開く", () => {
  const config = read("Mvp2Config.bas");
  assert.match(config, /MVP2_DX_GUIDE_RELATIVE As String = "html\/dx-guide\/DXプロジェクト8段階ガイド\.html"/);
  const guideStart = main.indexOf("Public Sub OpenDxGuide");
  const guideEnd = main.indexOf("End Sub", guideStart);
  const guideBody = main.slice(guideStart, guideEnd);
  assert.match(guideBody, /Mvp2ProjectPath\(MVP2_DX_GUIDE_RELATIVE\)/);
  assert.match(guideBody, /Mvp2OpenLocalFile guideFile/);
});

test("相対パスはWindowsとMacの実パス区切りに合わせる", () => {
  const config = read("Mvp2Config.bas");
  assert.match(config, /separator = Mvp2PathSeparatorFor\(ThisWorkbook\.Path\)/);
  assert.match(config, /relativePath = Replace\(relativePath, "\/", separator\)/);
  assert.doesNotMatch(config, /Replace\(relativePath, "\/", Application\.PathSeparator\)/);
  assert.match(config, /separator = Mvp2PathSeparatorFor\(folderPath\)/);
});

test("読み取り専用の終了では他の利用者の作業中記録を変更しない", () => {
  const config = read("Mvp2Config.bas");
  const readOnlyClose = config.indexOf("If ThisWorkbook.ReadOnly Then");
  const preparedClose = config.indexOf('If Mvp2MetaGet("commitState", "NONE") = "PREPARED" Then', readOnlyClose);
  assert.ok(readOnlyClose >= 0 && preparedClose > readOnlyClose);
  assert.match(config.slice(readOnlyClose, preparedClose), /gClosingApproved = True[\s\S]*Exit Sub/);
});

test("表示更新と保護設定だけではブックを変更済みにしない", () => {
  const protectionStart = panel.indexOf("Public Sub Mvp2ApplyProtection");
  const protectionEnd = panel.indexOf("End Sub", protectionStart);
  const protection = panel.slice(protectionStart, protectionEnd);
  assert.match(protection, /wasSaved = ThisWorkbook\.Saved/);
  assert.match(protection, /ThisWorkbook\.Saved = wasSaved/);

  const config = read("Mvp2Config.bas");
  assert.match(config, /Private Sub Mvp2MarkWorkbookClean\(\)[\s\S]*ThisWorkbook\.Saved = True/);
  assert.match(config, /If ThisWorkbook\.ReadOnly Then[\s\S]*Mvp2MarkWorkbookClean[\s\S]*gClosingApproved = True/);
});

test("閲覧起動は画面更新と保存済みJSONの再minifyを省略する", () => {
  const viewStart = main.indexOf("Public Sub OpenReadOnlyHtml");
  const viewEnd = main.indexOf("End Sub", viewStart);
  const viewBody = main.slice(viewStart, viewEnd);
  assert.doesNotMatch(viewBody, /RefreshOperationPanel/);
  assert.match(viewBody, /Mvp2CurrentPayloadRaw\(False\)/);

  const payloadStart = main.indexOf("Private Function Mvp2CurrentPayloadRaw");
  const payloadEnd = main.indexOf("End Function", payloadStart);
  const payloadBody = main.slice(payloadStart, payloadEnd);
  assert.match(payloadBody, /Optional ByVal validateAgain As Boolean = True/);
  assert.match(payloadBody, /If validateAgain Then compactJson = Mvp2ValidateAndMinifyJson\(compactJson\)/);
  assert.match(main, /""readOnly"":" & IIf\(modeName = "view", "true", "false"\)/);
});

test("終了ボタンは最後のブックならJUST Calc自体を終了する", () => {
  const exitStart = main.indexOf("Public Sub ExitWorkbook");
  const exitEnd = main.indexOf("End Sub", exitStart);
  const exitBody = main.slice(exitStart, exitEnd);
  assert.match(exitBody, /If Application\.Workbooks\.Count <= 1 Then[\s\S]*Application\.Quit/);
  assert.match(exitBody, /Else[\s\S]*ThisWorkbook\.Close/);
  assert.match(exitBody, /CloseWorkbookOnly:[\s\S]*ThisWorkbook\.Close/);
});

test("日本語の一時保存名だけを自動検出・選択対象にする", () => {
  const config = read("Mvp2Config.bas");
  assert.match(config, /MVP2_FILE_PREFIX As String = "DX推進委員会アプリ一時保存_"/);
  assert.doesNotMatch(config, /MVP2_LEGACY_FILE_PREFIX/);
  assert.match(main, /Dir\$\(Mvp2JoinPath\(downloadsFolder, MVP2_FILE_PREFIX & "\*\.json"\)/);
  assert.match(main, /dialog\.Filters\.Add "DX推進委員会アプリの一時保存ファイル", MVP2_FILE_PREFIX/);
  assert.doesNotMatch(main, /MVP2_LEGACY_FILE_PREFIX|以前のMVP3セーブデータ/);
  assert.match(panel, /ファイル名の「削除目安」を過ぎた「DX推進委員会アプリ一時保存_～\.json」だけを整理してください/);
  assert.match(panel, /Private Sub Mvp2FormatGuidanceArea[\s\S]*Range\("B33:N37"\)\.Merge/);
  assert.match(panel, /Private Sub Mvp2UpdateReadOnlyControls[\s\S]*Mvp2FormatGuidanceArea ws/);
});

test("正式履歴はPREPARED保存後、accepted確定後にSUCCESSになる", () => {
  const prepared = storage.indexOf('Mvp2MetaSet "commitState", "PREPARED"');
  const firstSave = storage.indexOf("ThisWorkbook.Save", prepared);
  const publish = storage.indexOf("Mvp2PublishPreparedFile", firstSave);
  const success = storage.indexOf('Value2 = "SUCCESS"', publish);
  const secondSave = storage.indexOf("ThisWorkbook.Save", success);
  assert.ok(prepared >= 0 && firstSave > prepared && publish > firstSave && success > publish && secondSave > success);
});

test("ブック内JSONは20,000文字分割・文字数・CRC32で確認する", () => {
  assert.match(read("Mvp2Config.bas"), /MVP2_CHUNK_SIZE As Long = 20000/);
  assert.match(storage, /jsonLength/);
  assert.match(storage, /Mvp2Crc32Utf8/);
  assert.match(storage, /&HD800[\s\S]*&HDBFF/);
});

test("メタ情報は文字列として保存し、Excelの日付シリアル値も日時へ戻す", () => {
  assert.match(storage, /Private Sub Mvp2WriteMetaCell[\s\S]*target\.NumberFormat = "@"[\s\S]*target\.Value2 = CStr\(value\)/);
  assert.match(storage, /keyName = "lastSaveAt" Or keyName = "sessionStartedAt"/);
  assert.match(storage, /Public Function Mvp2TryDateTime[\s\S]*IsNumeric\(storedValue\)[\s\S]*CDate\(serialValue\)/);
  assert.match(storage, /DateSerial[\s\S]*TimeSerial/);
  assert.match(storage, /Public Function Mvp2FormatDateTimeValue[\s\S]*Format\$\(parsedValue, outputFormat\)/);
});

test("Excel終了確認は最終保存時刻を日付表示へ整形する", () => {
  const config = read("Mvp2Config.bas");
  assert.match(config, /"最新版：" & Mvp2FormatDateTimeValue\(savedAt, "yyyy\/mm\/dd hh:nn"\)/);
  assert.doesNotMatch(config, /"最新版：" & savedAt & vbCrLf/);
});
