const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

// Node/controller fault injection only: no JUST Calc/VBA, workbook commit,
// browser download implementation, or shared-folder locking is exercised.
const root = path.resolve(__dirname, '..');
const jsFiles = ['excel-gate.js', 'excel-gate-core.js'];
const utf8Limit = 10 * 1024 * 1024;
const author = '境界試験 担当者';
let gate, core, checkedFiles, temporaryRoot;
const context = () => ({
  runtimeVersion: '0.8.0', mode: 'edit', readOnly: false,
  databaseId: '00000000-0000-4000-a000-000000000091',
  sessionId: '00000000-0000-4000-a000-000000000092',
  dataType: 'controller-test-app', schemaVersion: 2,
  baseRevision: 7, hasPayload: false, authorRequired: true
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test.before(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'excel-gate-core-candidates-'));
  const { buildApp } = await import('../scripts/package.mjs');
  const recorded = { outputs: [] };
  for (const appName of ['community-care', 'handoff-notes']) recorded.outputs.push({ appName, folder: await buildApp(appName, temporaryRoot, { mode: 'candidate' }) });
  checkedFiles = [];
  for (const name of jsFiles) {
    const source = path.join(root, 'shared', name);
    const expected = await fs.readFile(source);
    checkedFiles.push({ path: source, sha256: digest(expected) });
    for (const candidate of recorded.outputs) {
      const candidatePath = path.join(candidate.folder, 'runtime', name);
      const actual = await fs.readFile(candidatePath);
      assert.deepEqual(actual, expected, `${candidate.appName} candidate ${name} must match the current shared JS byte-for-byte`);
      checkedFiles.push({ path: candidatePath, sha256: digest(actual) });
    }
  }
  const candidate = recorded.outputs.find(output => output.appName === 'handoff-notes');
  assert.ok(candidate);
  // Execute the candidate itself after proving it equals the working source.
  gate = require(path.join(candidate.folder, 'runtime/excel-gate.js'));
  core = require(path.join(candidate.folder, 'runtime/excel-gate-core.js'));
  console.log(JSON.stringify({
    recordedAt: new Date().toISOString(), node: process.version,
    scope: 'Pure JavaScript candidate controller; injected download failures; no JUST Calc/VBA or shared-PC acceptance',
    candidateMatchesWorkingSource: true, checkedFiles
  }));
});

test.after(async () => {
  try {
    for (const entry of checkedFiles || []) {
      assert.equal(digest(await fs.readFile(entry.path)), entry.sha256, `Tested JS must remain unchanged: ${entry.path}`);
    }
  } finally {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

async function fixture(download, payload = { value: '初期値' }) {
  let value = payload, exports = 0;
  const controller = gate.createController(context(), { download });
  await controller.connect({
    load() {},
    exportData() { exports++; return value; }
  });
  return { controller, replace(next) { value = next; }, exportCalls() { return exports; } };
}

test('candidate controller: failed replay after completion cannot reopen editing or replace the finalized snapshot', async () => {
  const attempts = [];
  let failDownload = false;
  const f = await fixture(async output => {
    attempts.push(output);
    if (failDownload) throw Error('Injected redownload failure');
  }, { text: '最終確定データ', nested: [1, '日本語😀'] });
  const completed = await f.controller.exportFile(author, 'complete');
  const expectedState = { phase: 'exported', exportSequence: 1, hasOutput: true, inFlight: false };
  assert.deepEqual(f.controller.state(), expectedState);
  failDownload = true;
  await assert.rejects(f.controller.redownload(), /Injected redownload failure/);
  assert.deepEqual(f.controller.state(), expectedState);
  assert.throws(() => f.controller.assertEditable(), /入力を終えた/);
  await assert.rejects(f.controller.exportFile(author, 'workCopy'), /現在は出力できません/);
  assert.equal(f.exportCalls(), 1, 'Neither failed replay nor blocked export re-reads mutable app data');
  failDownload = false;
  const retried = await f.controller.redownload();
  assert.strictEqual(retried, completed);
  assert.deepEqual(f.controller.state(), expectedState);
  assert.equal(attempts.length, 3);
  assert.ok(attempts.every(output => output.text === completed.text && output.fileName === completed.fileName));
  assert.equal(JSON.parse(retried.text).parentSaveDataId, null);
  assert.equal(f.exportCalls(), 1);
});

test('candidate controller: failed next download keeps the previous replay and resumes its parent chain exactly once', async () => {
  const attempts = [];
  let rejectNext;
  const f = await fixture(async output => {
    attempts.push(output);
    if (rejectNext) { const error = rejectNext; rejectNext = null; throw error; }
  }, { version: 1, notes: ['1回目'] });
  const first = await f.controller.exportFile(author, 'workCopy');
  f.replace({ version: 2, notes: ['2回目・未ダウンロード'] });
  rejectNext = Error('Injected next download failure');
  await assert.rejects(f.controller.exportFile(author, 'complete'), /Injected next download failure/);
  const failedAttempt = attempts[1];
  assert.equal(failedAttempt.envelope.exportSequence, 2);
  assert.equal(failedAttempt.envelope.parentSaveDataId, first.envelope.saveDataId);
  assert.deepEqual(f.controller.state(), { phase: 'editing', exportSequence: 1, hasOutput: true, inFlight: false });
  assert.equal(f.controller.assertEditable(), true);
  const replay = await f.controller.redownload();
  assert.strictEqual(replay, first);
  assert.equal(replay.text, first.text);
  assert.equal(f.exportCalls(), 2, 'Replay must not consume or regenerate business data');
  f.replace({ version: 3, notes: ['失敗後に訂正して確定'] });
  const final = await f.controller.exportFile(author, 'complete');
  assert.equal(final.envelope.exportSequence, 2);
  assert.equal(final.envelope.parentSaveDataId, first.envelope.saveDataId);
  assert.notEqual(final.envelope.saveDataId, failedAttempt.envelope.saveDataId);
  assert.deepEqual(final.envelope.payload, { version: 3, notes: ['失敗後に訂正して確定'] });
  assert.equal(final.envelope.baseRevision, first.envelope.baseRevision);
  assert.equal(final.envelope.sessionId, first.envelope.sessionId);
  assert.deepEqual(first.envelope.payload, { version: 1, notes: ['1回目'] });
  assert.deepEqual(f.controller.state(), { phase: 'exported', exportSequence: 2, hasOutput: true, inFlight: false });
});

test('candidate controller: full UTF-8 file accepts exactly 10 MiB and rejects one byte more before download', async () => {
  // UUIDs and ISO timestamps have fixed widths. Calculate envelope overhead
  // independently, without mocking the production serializer or size check.
  const envelope = core.createEnvelope(context(), { exportSequence: 0, lastSaveDataId: null }, author, 'workCopy', { text: '' });
  const overhead = Buffer.byteLength(JSON.stringify(envelope, null, 2), 'utf8');
  const available = utf8Limit - overhead;
  const text = 'あ'.repeat(Math.floor(available / 3)) + 'x'.repeat(available % 3);
  assert.equal(Buffer.byteLength(text, 'utf8'), available);
  assert.ok(text.length < available, 'The payload must exercise multibyte UTF-8 rather than an ASCII character limit');
  let acceptedDownloads = 0;
  const exact = await fixture(async output => {
    acceptedDownloads++;
    assert.equal(Buffer.byteLength(output.text, 'utf8'), utf8Limit);
  }, { text });
  const accepted = await exact.controller.exportFile(author, 'workCopy');
  assert.equal(acceptedDownloads, 1);
  assert.equal(Buffer.byteLength(accepted.text, 'utf8'), 10485760);
  assert.equal(accepted.envelope.payload.text, text);
  assert.equal(exact.controller.state().exportSequence, 1);

  let oversizedDownloads = 0;
  const oversized = await fixture(async output => {
    oversizedDownloads++;
    assert.equal(Buffer.byteLength(output.text, 'utf8'), utf8Limit);
  }, { text: text + 'x' });
  const expectedOversized = { ...envelope, payload: { text: text + 'x' } };
  assert.equal(Buffer.byteLength(JSON.stringify(expectedOversized, null, 2), 'utf8'), utf8Limit + 1);
  assert.ok(Buffer.byteLength(JSON.stringify({ text: text + 'x' }), 'utf8') < utf8Limit, 'Only the complete transfer file exceeds the limit');
  await assert.rejects(oversized.controller.exportFile(author, 'workCopy'), /10MiB/);
  assert.equal(oversizedDownloads, 0);
  assert.deepEqual(oversized.controller.state(), { phase: 'editing', exportSequence: 0, hasOutput: false, inFlight: false });
  assert.equal(oversized.controller.assertEditable(), true);
  await assert.rejects(oversized.controller.redownload(), /再出力できるファイルはありません/);
  oversized.replace({ text });
  const corrected = await oversized.controller.exportFile(author, 'workCopy');
  assert.equal(oversizedDownloads, 1);
  assert.equal(corrected.envelope.exportSequence, 1);
  assert.equal(corrected.envelope.parentSaveDataId, null);
  assert.equal(Buffer.byteLength(corrected.text, 'utf8'), utf8Limit);
});
