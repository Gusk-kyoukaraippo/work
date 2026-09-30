"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const vbaDir = path.join(__dirname, "..", "vba");
const utf8Dir = path.join(vbaDir, "utf8");
const moduleNames = ["Mvp2Config.bas", "Mvp2Json.bas", "Mvp2Main.bas", "Mvp2Panel.bas", "Mvp2Storage.bas"];
const cp932Decoder = new TextDecoder("shift_jis", { fatal: true });

test("直接インポート用basはCP932で、UTF-8保守版と同じ内容である", () => {
  for (const name of moduleNames) {
    const importBytes = fs.readFileSync(path.join(vbaDir, name));
    const importText = cp932Decoder.decode(importBytes).replace(/\r\n/g, "\n");
    const sourceText = fs.readFileSync(path.join(utf8Dir, name), "utf8").replace(/\r\n/g, "\n");
    assert.equal(importText, sourceText, `${name} のCP932版とUTF-8版が一致しません`);
    assert.match(importText, /^Attribute VB_Name = /);
  }
});

test("CP932版をUTF-8として誤読すると置換文字が出る", () => {
  const bytes = fs.readFileSync(path.join(vbaDir, "Mvp2Main.bas"));
  assert.match(bytes.toString("utf8"), /�/);
});
