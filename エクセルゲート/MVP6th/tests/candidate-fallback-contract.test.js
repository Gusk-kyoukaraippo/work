const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// These are source contracts, not execution of VBA, Windows COM or Downloads.
// Native coverage lives in windows/GateCandidateSelectionTests.bas.
const source = fs.readFileSync(path.join(__dirname, '../vba/utf8/GateMain.bas'), 'utf8');
function body(name) {
  const match = source.match(new RegExp(`(?:Public|Private) Function ${name}\\([^]*?\\nEnd Function`));
  assert.ok(match, `${name} exists`);
  return match[0].replace(/^\s*'.*$/gm, '');
}
const metadata = body('GateCandidateMetadata');
const scan = body('GateFindBestDownloadCandidate');
const select = body('GateSelectSaveFile');

test('unreadable or malformed candidate ownership blocks older-file fallback', () => {
  assert.ok(metadata.indexOf('currentIdentity = True') < metadata.indexOf('GateReadUtf8File('));
  assert.ok(metadata.indexOf('currentIdentity = True') < metadata.indexOf('GateValidateAndMinifyJson('));
  assert.doesNotMatch(metadata, /currentIdentity\s*=\s*False/);
  const handler = metadata.split('InvalidCandidate:')[1];
  assert.match(handler, /Set GateCandidateMetadata = Nothing/);
  assert.doesNotMatch(handler, /currentIdentity\s*=/);
});

test('only structurally valid JSON with a known foreign identity is ignored', () => {
  const validate = metadata.indexOf('compact = GateValidateAndMinifyJson(GateReadUtf8File(filePath))');
  const database = metadata.indexOf('databaseId = GateJsonTopLevelString(compact, "databaseId")');
  const session = metadata.indexOf('sessionId = GateJsonTopLevelString(compact, "sessionId")');
  const identity = metadata.indexOf('currentIdentity = (databaseId = GateMetaGet("databaseId") And sessionId = GateMetaGet("activeSessionId"))');
  const foreignReturn = metadata.indexOf('If Not currentIdentity Then Exit Function');
  assert.ok(validate >= 0 && validate < database && database < session && session < identity && identity < foreignReturn);
  assert.ok(foreignReturn < metadata.indexOf('GateParseEnvelope compact, envelope'));
  assert.equal((metadata.match(/currentIdentity\s*=/g) || []).length, 2);
});

for (const field of ['databaseId', 'sessionId']) {
  for (const length of [0, 7, 101]) {
    test(`${field} length ${length} cannot be classified as foreign`, () => {
      const guard = metadata.match(new RegExp(`If Len\\(${field}\\) < (\\d+) Or Len\\(${field}\\) > (\\d+) Then Exit Function`));
      assert.ok(guard, `${field} has a length guard`);
      assert.ok(length < Number(guard[1]) || length > Number(guard[2]), 'invalid length is rejected');
      assert.equal(Number(guard[1]), 8);
      assert.equal(Number(guard[2]), 100);
      const parsed = metadata.indexOf(`${field} = GateJsonTopLevelString(compact, "${field}")`);
      const classified = metadata.indexOf('currentIdentity = (databaseId =');
      assert.ok(parsed >= 0 && parsed < guard.index && guard.index < classified);
      assert.ok(metadata.indexOf('currentIdentity = True') < guard.index);
    });
  }
}

test('candidate scanning stops on unknown ownership before returning any best path', () => {
  assert.match(scan, /ElseIf currentIdentity Then\s+problemText = "[^\n]+"\s+Exit Function/);
  const stop = scan.indexOf('ElseIf currentIdentity Then');
  const finishedScanning = scan.indexOf('\n    Loop', stop);
  const best = scan.indexOf('GateFindBestDownloadCandidate = CStr(best("path"))');
  assert.ok(stop >= 0 && stop < finishedScanning && finishedScanning < best);
  assert.equal((scan.match(/GateFindBestDownloadCandidate\s*=/g) || []).length, 1);
});

test('manual selection cannot bypass a broken scanned candidate', () => {
  const scanAt = select.indexOf('candidate = GateFindBestDownloadCandidate(downloadsFolder, problem)');
  const errorAt = select.indexOf('If Len(problem) > 0 Then Err.Raise');
  const manualAt = select.indexOf('If Len(selectedFile) > 0 Then');
  assert.ok(scanAt >= 0 && scanAt < errorAt && errorAt < manualAt);
  const save = body('GateSavePendingOutput');
  assert.ok(save.indexOf('sourceFile = GateSelectSaveFile(') < save.indexOf('GateCommitImportedFile sourceFile'));
});

test('candidate validation checks full current-session envelope before yielding metadata', () => {
  const parse = metadata.indexOf('GateParseEnvelope compact, envelope');
  const validate = metadata.indexOf('GateValidateEnvelopeForCurrentSession envelope');
  const result = metadata.indexOf('Set GateCandidateMetadata = result');
  assert.ok(parse >= 0 && parse < validate && validate < result);
  for (const name of ['metadata', 'scan', 'select']) {
    const text = { metadata, scan, select }[name];
    assert.doesNotMatch(text, /\b(?:Kill|FileCopy|GateCommitImportedFile|GateStoreCompactJson|GateMetaSet)\b/, name);
  }
});
