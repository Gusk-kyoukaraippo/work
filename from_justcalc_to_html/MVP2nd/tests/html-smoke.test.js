"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "html", "app.template.html"), "utf8");
const history = fs.readFileSync(path.join(__dirname, "..", "html", "history.template.html"), "utf8");

test("編集HTMLはVBAが差し込むcontextと共通処理を参照する", () => {
  assert.match(html, /id="app-context">__APP_CONTEXT_JSON__<\/script>/);
  assert.match(html, /src="mvp2-core\.js"/);
});

test("利用者名は毎回空欄から入力し、ブラウザへ保存しない", () => {
  assert.match(html, /id="author-input"[^>]*autocomplete="off"/);
  assert.doesNotMatch(html, /localStorage/);
  assert.match(html, /MVP2Core\.normalizeAuthorName/);
});

test("作業を続ける保存と、作業を終える保存を分ける", () => {
  assert.match(html, /作業中のデータをPCに保存して、編集を続ける/);
  assert.match(html, /作業を終えて、Excelへ渡すデータを作る/);
  assert.match(html, /openConfirm\("workCopy"\)/);
  assert.match(html, /openConfirm\("complete"\)/);
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
