"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "html", "app.template.html"), "utf8");
const history = fs.readFileSync(path.join(__dirname, "..", "html", "history.template.html"), "utf8");
const core = fs.readFileSync(path.join(__dirname, "..", "html", "mvp2-core.js"), "utf8");

test("編集HTMLはVBAが差し込むcontextと共通処理を参照する", () => {
  assert.match(html, /id="app-context">__APP_CONTEXT_JSON__<\/script>/);
  assert.match(html, /src="mvp2-core\.js"/);
});

test("利用者名は毎回空欄から入力し、ブラウザへ保存しない", () => {
  assert.match(html, /id="author-input"[^>]*autocomplete="off"/);
  assert.doesNotMatch(html, /localStorage/);
  assert.match(html, /MVP2Core\.normalizeAuthorName/);
});

test("閲覧モードは記名を自動スキップし、万一モーダルが残っても閲覧ボタンで抜けられる", () => {
  assert.match(html, /id="name-skip-button"[^>]*hidden>記名せず閲覧する/);
  assert.match(html, /const isReadOnly = context\.mode === "view" \|\| context\.readOnly === true/);
  assert.match(html, /function skipNameEntryForReadOnly\(\)[\s\S]*hide\(nameModal\)/);
  assert.match(html, /if \(isReadOnly\) skipNameEntryForReadOnly\(\);[\s\S]*else beginNameEntry\(\)/);
  assert.match(html, /nameSkipButton\.addEventListener\("click", skipNameEntryForReadOnly\)/);
});

test("旧Edge系でも名前入力と保存処理を開始できる", () => {
  assert.doesNotMatch(html, /\?\./);
  assert.match(html, /function focusFirstBusinessInput\(\)[\s\S]*if \(firstInput\) firstInput\.focus\(\)/);
  assert.match(html, /\.modal-backdrop \{[^}]*top: 0;[^}]*right: 0;[^}]*bottom: 0;[^}]*left: 0;[^}]*display: flex/);
  assert.match(html, /function readSessionState\(\)[\s\S]*try \{ return MVP2Core\.readState\(window\.sessionStorage/);
  assert.match(core, /const api = factory\(root\)/);
  assert.doesNotMatch(core, /globalThis\.crypto/);
});

test("旧Edge系にないDOM置換・複数追加メソッドを使わない", () => {
  assert.doesNotMatch(html, /\.replaceChildren\(/);
  assert.doesNotMatch(html, /\.append\(/);
  assert.doesNotMatch(html, /anchor\.remove\(/);
  assert.match(html, /while \(form\.firstChild\) form\.removeChild\(form\.firstChild\)/);
  assert.match(html, /form\.appendChild\(createNode\(businessPayload/);
});

test("作業を続ける保存と、作業を終える保存を分ける", () => {
  assert.match(html, /作業途中の内容を一時保存して、編集を続ける/);
  assert.match(html, /id="complete-button">作業終了用に一時保存して終了</);
  assert.match(html, /openConfirm\("workCopy"\)/);
  assert.match(html, /openConfirm\("complete"\)/);
});

test("作業終了用に一時保存すると編集画面を隠して最小画面へ切り替える", () => {
  assert.match(html, /id="completion-screen"[\s\S]*作業終了用の一時保存ファイルを作成しました/);
  assert.match(html, /function showCompletionScreen\(fileName\)/);
  assert.match(html, /document\.querySelector\("\.site-header"\)\.hidden = true/);
  assert.match(html, /document\.querySelector\("main"\)\.hidden = true/);
  assert.match(html, /if \(isComplete\) \{[\s\S]*showCompletionScreen\(fileName\);[\s\S]*return;/);
  assert.match(html, /id="completion-redownload-button"/);
});

test("利用者向け用語を一時保存・正式保存・管理者向けログに統一する", () => {
  assert.match(html, /どちらもPCに一時保存ファイルを作る操作で、Excelへの正式保存は別に行います/);
  assert.match(html, /一時保存ファイルをExcelに正式保存する/);
  assert.doesNotMatch(html, /セーブデータ/);
  assert.match(history, /管理者向け 保存ログチェック/);
  assert.match(history, /通常の利用者は操作する必要がありません/);
});

test("保存終了画面は閉じる操作と自動終了できない場合の案内を持つ", () => {
  assert.match(html, /id="completion-close-button">この画面を閉じる/);
  assert.match(html, /function closeCompletionScreen\(\)[\s\S]*window\.close\(\)/);
  assert.match(html, /completion-close-note[\s\S]*ブラウザの制限で自動的に閉じられませんでした/);
  assert.match(html, /completion-close-button"\)\.addEventListener\("click", closeCompletionScreen\)/);
});

test("再ダウンロードは直前に生成した同じ文字列を使う", () => {
  assert.match(html, /lastDownload = \{ fileName, text, saveKind: pendingKind \}/);
  assert.match(html, /downloadText\(lastDownload\.fileName, lastDownload\.text\)/);
});

test("編集後だけbeforeunload警告を有効にする", () => {
  assert.match(html, /let dirtySinceDownload = false/);
  assert.match(html, /editor\.addEventListener\("input"[\s\S]*dirtySinceDownload = true/);
  assert.match(html, /if \(!isReadOnly && dirtySinceDownload\)/);
});

test("履歴画面は復元操作を持たず、成功履歴だけを表示する説明を持つ", () => {
  assert.match(history, /ここから過去版へ戻す操作はできません/);
  assert.doesNotMatch(history, /復元する|restore-button/);
});

test("履歴画面は確認後に閉じる操作と、閉じられない場合の終了画面を持つ", () => {
  assert.match(history, /id="history-close-button">閲覧を終了/);
  assert.match(history, /window\.close\(\)/);
  assert.match(history, /id="history-finished"[\s\S]*このブラウザ画面を閉じて、Excelへ戻ってください/);
  assert.match(history, /document\.querySelector\("main"\)\.hidden = true/);
});
