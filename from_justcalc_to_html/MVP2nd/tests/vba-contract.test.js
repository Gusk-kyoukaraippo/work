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

test("利用者向けマクロは計画した5操作を公開する", () => {
  for (const name of ["OpenReadOnlyHtml", "OpenEditHtml", "ImportSaveData", "OpenSaveHistory", "ExitWorkbook"]) {
    assert.match(main, new RegExp(`Public Sub ${name}\\(\\)`));
  }
  for (const removed of ["Restore", "ShowAppMeta", "DiscardSession", "SafeClose"]) {
    assert.doesNotMatch(main, new RegExp(`Public Sub ${removed}`));
  }
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

test("読み取り専用では編集・保存ボタンを無効化し、閲覧操作だけを残す", () => {
  assert.match(panel, /このExcelは読み取り専用で開いています。閲覧のみ利用できます。/);
  assert.match(panel, /Mvp2SetButtonEnabled ws, "OpenEditHtml", Not readOnlyMode/);
  assert.match(panel, /Mvp2SetButtonEnabled ws, "ImportSaveData", Not readOnlyMode/);
  assert.match(panel, /Mvp2SetButtonEnabled ws, "OpenReadOnlyHtml", True/);
  assert.match(panel, /button\.OnAction = ""/);
  assert.match(panel, /このExcelでは閲覧だけできます。作業中の内容は変更できません。/);
  assert.match(panel, /このExcelではデータの入力・編集・保存はできません/);
  assert.match(main, /If ThisWorkbook\.ReadOnly Then Err\.Raise[\s\S]*読み取り専用/);
});

test("読み取り専用の終了では他の利用者の作業中記録を変更しない", () => {
  const config = read("Mvp2Config.bas");
  const readOnlyClose = config.indexOf("If ThisWorkbook.ReadOnly Then");
  const preparedClose = config.indexOf('If Mvp2MetaGet("commitState", "NONE") = "PREPARED" Then', readOnlyClose);
  assert.ok(readOnlyClose >= 0 && preparedClose > readOnlyClose);
  assert.match(config.slice(readOnlyClose, preparedClose), /gClosingApproved = True[\s\S]*Exit Sub/);
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
