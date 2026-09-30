"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const core = require(path.join(__dirname, "..", "html", "mvp2-core.js"));

test("保存者名は前後空白を除き、1～50文字に制限する", () => {
  assert.equal(core.normalizeAuthorName("  山田 太郎  "), "山田 太郎");
  assert.throws(() => core.normalizeAuthorName("   "), /名前を入力/);
  assert.throws(() => core.normalizeAuthorName("a".repeat(51)), /50文字以内/);
  assert.throws(() => core.normalizeAuthorName("山田\n太郎"), /使用できない文字/);
});

test("ファイル名に使えない文字だけを除去する", () => {
  assert.equal(core.sanitizeFilePart(" 山田:太郎 / 営業 "), "山田太郎_営業");
  assert.equal(core.sanitizeFilePart("***"), "user");
});

test("異なる形のpayloadをそのまま共通外枠へ入れる", () => {
  const context = {
    sessionId: "session-12345678",
    databaseId: "database-12345678",
    dataType: "generic-json",
    schemaVersion: 3,
    baseRevision: 12
  };
  const state = { exportSequence: 0, lastSaveDataId: null };
  const payload = {
    rows: [{ id: 1, enabled: true, amount: 1.25 }],
    settings: { note: "改行\n文字", empty: null },
    arbitraryArray: [1, "2", false, null, { nested: ["x"] }]
  };
  const envelope = core.createEnvelope(context, state, "山田 太郎", "workCopy", payload, new Date("2026-07-15T01:00:00.000Z"));
  assert.equal(envelope.formatVersion, 2);
  assert.equal(envelope.exportSequence, 1);
  assert.equal(envelope.parentSaveDataId, null);
  assert.deepEqual(envelope.payload, payload);
  assert.equal(envelope.exportedAt, "2026-07-15T01:00:00.000Z");
});

test("同じ編集作業の次の出力は番号と親IDがつながる", () => {
  const context = {
    sessionId: "session-12345678",
    databaseId: "database-12345678",
    dataType: "generic-json",
    schemaVersion: 1,
    baseRevision: 0
  };
  const first = core.createEnvelope(context, { exportSequence: 0, lastSaveDataId: null }, "佐藤 花子", "workCopy", {}, new Date("2026-07-15T01:00:00.000Z"));
  const second = core.createEnvelope(context, { exportSequence: 1, lastSaveDataId: first.saveDataId }, "佐藤 花子", "complete", [], new Date("2026-07-15T01:05:00.000Z"));
  assert.equal(second.exportSequence, 2);
  assert.equal(second.parentSaveDataId, first.saveDataId);
  assert.match(core.makeFileName(first), /^DX推進委員会アプリ一時保存_20260715-1000_作業途中_佐藤_花子_削除目安20260722_database_r0_s1_[0-9a-f]{8}\.json$/);
  assert.match(core.makeFileName(second), /^DX推進委員会アプリ一時保存_20260715-1005_作業終了_佐藤_花子_削除目安20260722_database_r0_s2_[0-9a-f]{8}\.json$/);
});

test("sessionStorageには番号と直前IDだけを保存する", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  core.writeState(storage, "session-1", { exportSequence: 4, lastSaveDataId: "save-4", authorName: "残してはいけない" });
  assert.deepEqual(core.readState(storage, "session-1"), { exportSequence: 4, lastSaveDataId: "save-4" });
  assert.doesNotMatch(values.get("mvp3:session-1"), /authorName|残してはいけない/);
});
