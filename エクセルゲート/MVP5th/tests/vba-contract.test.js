const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname,'../vba/utf8');
const read = name=>fs.readFileSync(path.join(dir,name),'utf8');
const body = (source,name)=>source.slice(source.indexOf(name), source.indexOf('End Sub',source.indexOf(name)));
test('VBA import files are strict CP932 copies and string literals close',()=>{
  const decoder=new TextDecoder('shift_jis',{fatal:true});
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.bas'))){
    const source=read(name);assert.equal(decoder.decode(fs.readFileSync(path.join(dir,'..',name))).replace(/\r\n/g,'\n'),source);
    source.split('\n').forEach((line,n)=>{
      let inside=false;for(let i=0;i<line.length;i++){if(line[i]==="'"&&!inside)break;if(line[i]==='"'){if(inside&&line[i+1]==='"')i++;else inside=!inside;}}
      assert.equal(inside,false,`${name}:${n+1}`);
    });
  }
});
test('PREPARED never overwrites the committed data or advances revision',()=>{
  const s=body(read('GateStorage.bas'),'Public Sub GateCommitImportedFile');
  assert.doesNotMatch(s,/GateStoreCompactJson|GateMetaSet "revision"|GateMetaSet "lastImportSequence"/);
  assert.ok(s.indexOf('"PREPARED"')<s.indexOf('GateSaveWorkbook "prepare"'));
});
test('final save failure restores payload, metadata and history; cleanup follows persistence',()=>{
  const s=body(read('GateStorage.bas'),'Private Sub GateFinalizePreparedCommit');
  assert.match(s,/On Error GoTo FinalizeFailed/);
  for(const sheet of ['DATA','META','HISTORY'])assert.match(s,new RegExp(`GateRestoreSheet GATE_${sheet}_SHEET`));
  assert.match(s,/GateClearActiveSession False/);assert.doesNotMatch(s,/GateClearActiveSession True/);
  assert.ok(s.indexOf('GateSaveWorkbook "finalize"')<s.indexOf('Kill markerFile'));
  assert.ok(s.indexOf('GateSaveWorkbook "finalize"')<s.indexOf('Kill pendingFile'));
});
test('resume precedes old-session rejection and is canonical/write checked',()=>{
  const s=read('GateMain.bas').split('Public Function GateSavePendingOutput')[1].split('End Function')[0];
  assert.ok(s.indexOf('GateAssertCanonical True')<s.indexOf('GateResumePreparedCommit'));
  assert.ok(s.indexOf('GateResumePreparedCommit')<s.indexOf('sessionRunId'));
  assert.match(body(read('GateStorage.bas'),'Public Sub GateResumePreparedCommit'), /GateAssertCanonical True[\s\S]*GateSaveWorkbook "resume-prepare"/);
});
test('panel prioritizes PREPARED over success and only generic config appears in shared VBA',()=>{
  const s=body(read('GatePanel.bas'),'Public Sub RefreshOperationPanel');
  assert.ok(s.indexOf('"PREPARED"')<s.indexOf('Len(GateMetaGet("activeSessionId"))'));
  for(const name of fs.readdirSync(dir)) assert.doesNotMatch(read(name),/kaizen-project-progress-board|dx-project-package|DX推進委員会/);
  assert.match(read('GateDeployment.bas'),/If Not ThisWorkbook.Saved Then Err.Raise/);
});
test('old, foreign, duplicate and branch outputs remain rejected by the common importer',()=>{
  const s=read('GateMain.bas');
  for(const field of ['DatabaseId','DataType','SchemaVersion','SessionId','BaseRevision'])assert.match(s,new RegExp(`If envelope\\.${field} <>`));
  assert.match(s,/If envelope.ExportSequence <= lastSequence Then/);
  assert.match(s,/envelope.ParentSaveDataId <> GateMetaGet\("lastImportedSaveDataId"\)/);
  assert.match(read('GateJson.bas'),/Like "\[A-Za-z0-9_-\]"/);
});
test('history strings are stored as text before writing user-provided author names',()=>{
  const s=body(read('GateStorage.bas'),'Private Sub GateAppendPreparedHistory');
  assert.ok(s.indexOf('NumberFormat = "@"') < s.indexOf('.Value2 = envelope.AuthorName'));
  assert.match(read('GateConfig.bas'), /Public Sub GateOnBeforeClose\(ByRef Cancel As Boolean\)\s+If Not GateWorkbookIsInitialized\(\) Then Exit Sub/);
});
test('save commands enforce kind before both new commits and prepared retries',()=>{
  const source=read('GateMain.bas');
  assert.match(body(source,'Public Sub SaveAndClose'),/GateSaveAction "complete"/);
  assert.match(body(source,'Public Sub SaveAndContinue'),/GateSaveAction "workCopy"/);
  const saving=source.split('Public Function GateSavePendingOutput')[1].split('End Function')[0];
  assert.ok(saving.indexOf('GateRequireSaveKind GateMetaGet("preparedSaveKind")')<saving.indexOf('GateResumePreparedCommit False'));
  assert.ok(saving.indexOf('GateRequireSaveKind envelope.SaveKind')<saving.indexOf('GateCommitImportedFile'));
  assert.match(saving,/gCompletedSaveReady And Len\(GateMetaGet\("activeSessionId"\)\) = 0/);
  assert.doesNotMatch(saving,/MsgBox|ThisWorkbook.Close/);
});
test('successful final save closes only this workbook and resets close approval on failure',()=>{
  const source=read('GateMain.bas');
  const close=body(source,'Private Sub GateCloseAfterSave');
  assert.ok(close.indexOf('gCompletedSaveReady')<close.indexOf('MsgBox'));
  assert.ok(close.indexOf('gCompletionNotified = True')<close.indexOf('ThisWorkbook.Close SaveChanges:=False'));
  assert.ok(close.indexOf('GateTestFault "close"')<close.indexOf('gClosingApproved = True'));
  assert.match(close,/CloseFailed:\s+gClosingApproved = False/);
  assert.doesNotMatch(source,/Application.Quit/);
  assert.match(body(read('GateConfig.bas'),'Public Sub GateOnBeforeClose'),/If gClosingApproved Then\s+GateCleanupRuntime\s+Exit Sub/);
});
test('automatic import and timer dependencies are absent; first-use panel exposes setup',()=>{
  for(const name of fs.readdirSync(dir))assert.doesNotMatch(read(name),/Application.OnTime/);
  assert.match(body(read('GateConfig.bas'),'Public Sub GateOnOpen'),/If Not GateWorkbookIsInitialized\(\) Then\s+GateShowSetupPanel/);
  assert.match(body(read('GatePanel.bas'),'Public Sub GateShowSetupPanel'),/GateAddButton ws, "初回設定", "InitializeGate"/);
});
