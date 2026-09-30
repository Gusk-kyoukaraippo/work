const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const panel = fs.readFileSync(path.join(__dirname, '../vba/utf8/GatePanel.bas'), 'utf8');
const routine = name => {
  const match = panel.match(new RegExp('(?:Public|Private) (Sub|Function) '+name+'\\b[\\s\\S]*?End (?:Sub|Function)'));
  assert.ok(match, name);
  return match[0];
};
// Source contracts; native storage and relocation checks have separate fixtures.
test('repeat setup routes to settings before storage initialization', () => {
  const setup=routine('InitializeGate');
  assert.match(setup,/If GateWorkbookIsInitialized\(\) Then\s+ReconfigureGate\s+Exit Sub/);
  assert.ok(setup.indexOf('ReconfigureGate')<setup.indexOf('GateEnsureInternalSheets'));
  const settings=routine('GateApplySettings');
  assert.doesNotMatch(settings,/GateEnsureInternalSheets|GateStoreCompactJson|\.Delete|\.Clear|GateNewId|GateClearActiveSession/);
  assert.deepEqual([...settings.matchAll(/GateMetaSet "([^"]+)"/g)].map(m=>m[1]), ['canonicalPath','csvSourcePath','canonicalPath','csvSourcePath']);
});
test('settings validate idle state and matching schema before mutation, and restore failed changes', () => {
  const guard=routine('GateAssertSettingsEditable');
  for(const flag of ['ReadOnly','gImportInProgress','gGateHandoffBusy','gGateWaitLoopRunning','activeSessionId','commitState','dataSource','dataType','schemaVersion','GateLoadCompactJson']) assert.ok(guard.includes(flag),flag);
  const apply=routine('GateApplySettings');
  assert.ok(apply.indexOf('GateAssertSettingsEditable')<apply.indexOf('changed = True'));
  assert.ok(apply.indexOf('folder.Files.Count')<apply.indexOf('changed = True'));
  assert.match(apply,/GateSaveWorkbook "reconfigure"/);
  assert.match(apply,/Failed:[\s\S]*GateMetaSet "canonicalPath", oldLocation[\s\S]*GateMetaSet "csvSourcePath", oldCsvPath[\s\S]*Err.Raise number/);
  assert.ok(routine('ReconfigureGate').indexOf('vbDefaultButton2')<routine('ReconfigureGate').indexOf('GateApplySettings'));
});
test('primary panel uses one bound action and fixed anchor across current-state transitions', () => {
  const build=routine('GateBuildOperationPanel').split('Exit Sub')[1];
  assert.match(build,/"GatePrimaryAction", ws.Range\("B10:J12"\)/);
  assert.doesNotMatch(routine('RefreshOperationPanel'),/GateAddButton|\.Left\s*=|\.Top\s*=|\.Width\s*=|\.Height\s*=/);
  assert.match(routine('GatePrimaryAction'),/Select Case GatePanelPrimaryAction\(\)/);
  for(const name of ['SaveAndClose','SaveAndContinue','ResumeExitPreparation','ReconfigureGate']) assert.ok(routine('GatePrimaryAction').includes('Case "'+name+'"'));
  assert.match(routine('GateAddButton'),/IIf\(primary, 16, 12\)/);
});
