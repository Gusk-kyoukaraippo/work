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
  const s=body(read('GateMain.bas'),'Public Sub ImportSaveData');
  assert.ok(s.indexOf('GateAssertCanonical True')<s.indexOf('GateResumePreparedCommit'));
  assert.ok(s.indexOf('GateResumePreparedCommit')<s.indexOf('sessionRunId'));
  assert.match(body(read('GateStorage.bas'),'Public Sub GateResumePreparedCommit'), /GateAssertCanonical True[\s\S]*GateSaveWorkbook "resume-prepare"/);
});
test('panel prioritizes PREPARED over success and only generic config appears in shared VBA',()=>{
  const s=body(read('GatePanel.bas'),'Public Sub RefreshOperationPanel');
  assert.ok(s.indexOf('"PREPARED"')<s.indexOf('If Len(activeSession)'));
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
