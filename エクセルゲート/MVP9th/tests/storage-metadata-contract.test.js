const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Source contracts only. Execute GateStorageValidationTests.bas on a disposable
// Excel copy for runtime evidence; these checks do not exercise Excel or COM.
const source = fs.readFileSync(path.join(__dirname, '../vba/utf8/GateStorage.bas'), 'utf8');
const load = source.split('Public Function GateLoadCompactJson() As String')[1].split('End Function')[0];
const integer = source.split('Private Function GateStoredUnsignedLong(')[1].split('End Function')[0];

test('first-use storage requires consistent zero revision, length, CRC and data rows', () => {
  const empty = load.split('If chunkCount = 0 Then')[1].split('Exit Function')[0];
  for (const invariant of ['revision <> 0', 'jsonLength <> 0', 'Len(storedCrc) <> 0', 'lastIndexRow > 1', 'lastTextRow > 1']) {
    assert.ok(empty.includes(invariant), invariant);
  }
  assert.match(empty, /Err\.Raise/);
  assert.match(load, /GateMetaGet\("crc32", "MISSING"\)/);
});

test('stored counts, lengths, revisions and indexes reject coercion and overflow', () => {
  assert.doesNotMatch(load, /\bVal\(/);
  for (const field of ['chunkCount', 'jsonLength', 'revision', 'chunkIndex']) {
    assert.match(load, new RegExp(`GateStoredUnsignedLong\\([^\\n]*"${field}"`));
  }
  assert.match(integer, /Len\(textValue\) = 0 Or Len\(textValue\) > 10/);
  assert.match(integer, /Len\(textValue\) > 1 And Left\$\(textValue, 1\) = "0"/);
  assert.match(integer, /digit < 0 Or digit > 9/);
  assert.ok(integer.indexOf('parsed > maximum') < integer.indexOf('CLng(parsed)'));
});

test('stored payload verifies row extent, chunk lengths, total length and CRC', () => {
  assert.match(load, /lastIndexRow <> chunkCount \+ 1 Or lastTextRow <> chunkCount \+ 1/);
  assert.match(load, /Len\(chunks\(i - 1\)\) = 0 Or Len\(chunks\(i - 1\)\) > GATE_CHUNK_SIZE/);
  assert.match(load, /Len\(GateLoadCompactJson\) <> jsonLength/);
  assert.match(load, /Len\(storedCrc\) <> 8/);
  assert.match(load, /"0123456789ABCDEF"/);
  assert.match(load, /UCase\$\(GateCrc32Utf8\(GateLoadCompactJson\)\) <> UCase\$\(storedCrc\)/);
});
