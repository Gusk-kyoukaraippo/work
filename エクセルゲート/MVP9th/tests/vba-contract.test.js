const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = path.join(__dirname,'../vba/utf8');
const read = name=>fs.readFileSync(path.join(dir,name),'utf8');
const body = (source,name)=>source.slice(source.indexOf(name), source.indexOf('End Sub',source.indexOf(name)));
test('Mac paste sources match reviewed VBA and exclude the character corrupted during assembly',()=>{
  const crypto=require('node:crypto');
  const pasteDir=path.join(__dirname,'../workbook/mac-manual');
  const manifest=JSON.parse(fs.readFileSync(path.join(pasteDir,'source-manifest.json'),'utf8'));
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.bas'))){
    const source=read(name), pasteName=name.replace(/\.bas$/,'.txt');
    const paste=fs.readFileSync(path.join(pasteDir,pasteName));
    assert.equal(paste.toString('utf8'),source.replace(/^Attribute VB_Name = "[^"]+"\n/,''));
    assert.doesNotMatch(paste.toString('utf8'),/[\\\u0080]/,name);
    assert.equal(manifest.files[pasteName].sourceSha256,sha(fs.readFileSync(path.join(dir,name))));
    assert.equal(manifest.files[pasteName].pasteSha256,sha(paste));
  }
  assert.equal(fs.readFileSync(path.join(pasteDir,'ThisWorkbook.txt'),'utf8'),fs.readFileSync(path.join(dir,'../ThisWorkbook.txt'),'utf8'));
});
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
  for(const name of fs.readdirSync(dir)) assert.doesNotMatch(read(name),/kaizen-project-progress-board|dx-project-package/);
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

test('native source verifier rejects altered, extra and missing modules even with Python optimization',()=>{
  const script = path.join(__dirname,'../scripts/verify-workbook.py');
  const check = spawnSync(process.env.PYTHON || 'python3', ['-O','-c', String.raw`
import importlib.util, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location('verify_master', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sources = {'Gate.bas': 'Sub Test()\nMsgBox "確定"\nEnd Sub', 'ThisWorkbook.cls': ''}
macros = [(None, None, name, source) for name, source in sources.items()]
module.verify_modules(macros, sources, 'Sheet1')
cases = [
    (macros[:1], 'Missing modules'),
    (macros + [macros[0]], 'Duplicate VBA module'),
    (macros + [(None, None, 'Unreviewed.bas', '')], 'Unexpected VBA module'),
    (macros + [(None, None, 'Sheet1.cls', 'Sub Unreviewed()\nEnd Sub')], 'Unexpected worksheet code'),
    ([(None, None, 'Gate.bas', sources['Gate.bas'].replace('確定', '変更'))] + macros[1:], 'Workbook/source mismatch')
]
for values, expected in cases:
    try:
        module.verify_modules(values, sources, 'Sheet1')
    except module.VerificationError as error:
        if expected not in str(error): raise
    else:
        raise RuntimeError('Invalid macro project was accepted: ' + expected)
with tempfile.TemporaryDirectory() as folder:
    renamed = pathlib.Path(folder) / 'renamed.xlsm'
    renamed.write_bytes(pathlib.Path(sys.argv[2]).read_bytes())
    try:
        module.verify(renamed)
    except module.VerificationError as error:
        if 'No embedded VBA project' not in str(error): raise
    else:
        raise RuntimeError('Renamed template was accepted')
    if renamed.with_suffix('.build.json').exists():
        raise RuntimeError('Failed verification produced a receipt')
print('native verification rejection cases passed')
`, script, path.join(__dirname,'../workbook/MVP9th-template.xlsx')], { encoding:'utf8' });
  assert.equal(check.status,0,check.stderr || check.error?.message);
  assert.match(check.stdout,/rejection cases passed/);
});
