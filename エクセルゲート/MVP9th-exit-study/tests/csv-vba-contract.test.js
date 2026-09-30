const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Source contracts only: Windows/JUST Calc/SMB execution needs real-machine evidence.
const read = name => fs.readFileSync(path.join(__dirname, '../vba/utf8', name + '.bas'), 'utf8');
function routine(source, name) {
  const match = source.match(new RegExp(`(?:Public|Private) (Sub|Function) ${name}\\b[\\s\\S]*?End (?:Sub|Function)`));
  assert.ok(match, name);
  return match[0];
}
const sources = read('GateSources');
const deployment = read('GateDeployment');
const main = read('GateMain');
const panel = read('GatePanel');
const config = read('GateConfig');
const storage = read('GateStorage');

test('optional dataSource defaults only for absent key, and initialized mode is bound to metadata', () => {
  assert.match(routine(sources, 'GateDataSource'), /Err.Number = vbObjectError \+ 2211[\s\S]*GateDataSource = "workbook"/);
  assert.match(routine(deployment, 'GateAssertCanonical'), /GateMetaGet\("dataSource", "workbook"\) <> GateDataSource\(\)/);
  assert.match(routine(storage, 'GateEnsureInternalSheets'), /GateMetaSet "dataSource", GateDataSource\(\)/);
});

test('CSV initial setup obtains an absolute text path before mutating workbook; cancellation leaves setup untouched', () => {
  const setup = routine(panel, 'InitializeGate');
  assert.ok(setup.indexOf('csvPath = GatePromptCsvSourcePath("")') < setup.indexOf('initializationStarted = True'));
  assert.ok(setup.indexOf('If Len(csvPath) = 0 Then Exit Sub') < setup.indexOf('GateEnsureInternalSheets'));
  assert.match(routine(sources, 'GateNormalizeCsvSourcePath'), /minimumLength = 3/);
  assert.match(routine(sources, 'GatePromptCsvSourcePath'), /InputBox\(/);
  assert.doesNotMatch(sources, /FileDialog|GetOpenFilename|BrowseForFolder|Shell.Application/);
  const setting = routine(sources, 'ConfigureCsvSourceFolder');
  assert.ok(setting.indexOf('GateAssertCanonical True') < setting.indexOf('GatePromptCsvSourcePath'));
  assert.match(setting, /If Len\(newPath\) = 0 Or newPath = oldPath Then Exit Sub/);
  assert.match(setting, /Failed:[\s\S]*GateMetaSet "csvSourcePath", oldPath/);
});

test('CSV launches use canonical readonly view with no payload or session writes and explicit Edge', () => {
  const open = routine(main, 'OpenLatestCsvHtml');
  assert.match(open, /GateAssertCanonical False/);
  assert.match(open, /GateBuildAppContext\("view", "", "\{\}"\)/);
  assert.doesNotMatch(open, /GateStartActiveSession|GateSaveWorkbook|GateCurrentPayloadRaw|GateMetaSet|GateLoadCompactJson/);
  assert.ok(open.indexOf('GateCreateRuntime') < open.indexOf('GateOpenCsvInEdge'));
  assert.match(open, /OpenFailed:[\s\S]*GateDiscardRuntime htmlFile/);
  assert.match(routine(main, 'GateOpenCsvInEdge'), /msedge.exe/);
  assert.doesNotMatch(routine(main, 'GateOpenCsvInEdge'), /FollowHyperlink/);
  const context = routine(main, 'GateBuildAppContext');
  assert.match(context, /If GateUsesCsvFolder\(\) Then\s+contextJson = contextJson & ",""authorRequired"":false,""hasPayload"":false"/);
  const csvBranch = context.split('If GateUsesCsvFolder() Then')[1].split('Else')[0];
  const workbookBranch = context.split('Else')[1].split('End If')[0];
  assert.doesNotMatch(csvBranch, /""payload""/);
  assert.match(workbookBranch, /contextJson = contextJson & ",""payload"":" & payloadRaw/);
  assert.doesNotMatch(context.split('End If')[1], /""payload""/);
});

test('CSV panel excludes edit, save and history and opens/closes without stale session recovery', () => {
  const csvPanel = routine(panel, 'GateBuildOperationPanel').split('If GateUsesCsvFolder() Then')[1].split('Exit Sub')[0];
  for (const name of ['OpenLatestCsvHtml', 'ConfigureCsvSourceFolder', 'ExitWorkbook', 'OpenGateHelp']) assert.ok(csvPanel.includes(name));
  assert.doesNotMatch(csvPanel, /OpenEditHtml|SaveAndClose|SaveAndContinue|OpenSaveHistory/);
  const onOpen = routine(config, 'GateOnOpen');
  assert.ok(onOpen.indexOf('If GateUsesCsvFolder() Then') < onOpen.indexOf('GateResumePreparedCommit'));
  const onClose = routine(config, 'GateOnBeforeClose');
  const close = onClose.split('If GateUsesCsvFolder() Then')[1].split('End If')[0];
  assert.match(close, /GateMarkWorkbookClean[\s\S]*GateCleanupRuntime[\s\S]*Exit Sub/);
  assert.doesNotMatch(close, /Save|GateEndSessionPersisted/);
});

test('direct edits, imports, restore and internal persistence are blocked in CSV mode', () => {
  for (const [module, names] of [[main, ['OpenEditHtml', 'GateSavePendingOutput', 'OpenSaveHistory']], [storage, ['GateStoreCompactJson', 'GateStartActiveSession', 'GateCommitImportedFile', 'GateResumePreparedCommit']], [read('GateRecovery'), ['GateAdminRestoreAccepted']]]) {
    for (const name of names) assert.match(routine(module, name), /GateRequireWorkbookMode/, name);
  }
});

test('reader bounds raw CSV files, enumerates only direct children and rechecks complete snapshot before publishing', () => {
  assert.match(sources, /GATE_MAX_SOURCE_FILES As Long = 1000/);
  assert.match(sources, /GATE_MAX_SOURCE_BYTES As Double = 52428800#/);
  const snapshot = routine(sources, 'GateCsvFolderSnapshot');
  assert.match(snapshot, /For Each item In folder.Files/);
  assert.doesNotMatch(snapshot, /SubFolders/);
  assert.match(snapshot, /LCase\$\(fso.GetExtensionName\(CStr\(item.Name\)\)\) = "csv"/);
  assert.match(snapshot, /snapshot.Count >= GATE_MAX_SOURCE_FILES/);
  assert.match(snapshot, /total > GATE_MAX_SOURCE_BYTES/);
  assert.equal((snapshot.match(/item.Size/g) || []).length, 1, 'bound and manifest must share the captured size');
  const write = routine(sources, 'GateWriteCsvSourceScript');
  assert.ok(write.indexOf('Set before = GateCsvFolderSnapshot') < write.indexOf('GateStreamCsvBase64'));
  assert.ok(write.indexOf('GateStreamCsvBase64') < write.indexOf('Set after = GateCsvFolderSnapshot'));
  assert.ok(write.indexOf('GateAssertCsvSnapshotUnchanged before, after') < write.indexOf('stream.SaveToFile'));
  assert.match(write, /GateSortedCsvNames\(before\)/);
  const compare = routine(sources, 'GateAssertCsvSnapshotUnchanged');
  for (const check of ['before.Count <> after.Count', 'Not after.Exists', 'original(0) <> current(0)', 'original(1) <> current(1)']) assert.ok(compare.includes(check));
});

test('source bytes are binary readonly and base64 has bounded chunks, with separate runtime cleanup', () => {
  const stream = routine(sources, 'GateStreamCsvBase64');
  assert.match(stream, /For Binary Access Read Lock Write As #handle/);
  assert.match(stream, /Get #handle, , bytes/);
  assert.match(stream, /If opened Then Close #handle/);
  assert.doesNotMatch(stream, /GateReadUtf8File|Line Input|Open .* For Output|Put #/);
  assert.match(sources, /SOURCE_BLOCK_BYTES As Long = 49152/);
  assert.equal(49152 % 3, 0, 'non-final chunks must not add base64 padding');
  const runtime = routine(deployment, 'GateCreateRuntime');
  assert.match(runtime, /GateWriteCsvSourceScript GateMetaGet\("csvSourcePath"\), GateJoinPath\(targetFolder, "excel-gate-source.js"\)/);
  assert.match(runtime, /Failed:[\s\S]*fso.DeleteFolder targetFolder, True[\s\S]*Err.Raise/);
  assert.match(routine(sources, 'GateWriteCsvSourceScript'), /Failed:[\s\S]*fso.DeleteFile targetFile, True[\s\S]*Err.Raise/);
  assert.match(routine(sources, 'GateSourceTimestamp'), /"yyyy-mm-dd"[\s\S]*"T"[\s\S]*"hh:nn:ss"/);
  assert.doesNotMatch(routine(sources, 'GateSourceTimestamp'), /"Z"/);
});
