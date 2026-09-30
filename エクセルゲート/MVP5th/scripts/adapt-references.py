"""Explicit patches for the two checked-in references, not a general HTML converter."""
from pathlib import Path
import difflib
ROOT = Path(__file__).resolve().parents[1]
BOOT = '''<!-- EXCEL_GATE_START -->
  <script src="../../shared/standalone-boot.js"></script>
  <script src="../../shared/excel-gate-core.js"></script>
  <script src="../../shared/excel-gate.js"></script>
  <!-- EXCEL_GATE_END -->'''

def change(text, before, after, count=1):
    assert text.count(before) >= count, before
    return text.replace(before, after, count)

def write(name, source, text):
    (ROOT/'apps'/name/'index.html').write_text(text)
    diff = ''.join(difflib.unified_diff(source.splitlines(True), text.splitlines(True), fromfile=f'reference/{name}.html', tofile=f'apps/{name}/index.html'))
    (ROOT/'docs/diffs'/f'{name}.patch').write_text(diff)

s = (ROOT/'reference/progress-board.html').read_text()
t = change(s, '<meta charset="utf-8">', '<meta charset="utf-8">\n  '+BOOT)
t = change(t, 'let state = loadState();', '''let gateReadOnly = false;
      let state = ExcelGate.isLinked ? { schemaVersion: 2, app: 'kaizen-project-progress-board', projects: [] } : loadState();
      function assertEditable() { if (gateReadOnly) throw new Error('閲覧専用では変更できません。'); }
      function gateViewControls() {
        if (!ExcelGate.isLinked) return;
        ['addProjectBtn', 'emptyAddBtn', 'detailEditBtn', 'importBtn', 'exportBtn'].forEach(id => { $('#'+id).disabled = gateReadOnly; });
        $('#exportBtn').classList.add('hidden');
        $('#saveStatus').textContent = gateReadOnly ? '正式保存済みデータを閲覧中' : '保存はブックで行います';
      }''')
t = change(t, 'function saveState() {', '''function saveState() {
        if (ExcelGate.isLinked) { gateViewControls(); return; }''')
t = change(t, 'function render() {', 'function render() {\n        gateViewControls();')
for signature in ['function openProjectDialog(id = null) {', 'function submitProject(event) {', 'function deletePendingProject() {', 'async function importData(file) {']:
    t = change(t, signature, signature+'\n        assertEditable();')
t = change(t, 'function exportData() {', '''function exportData() {
        if (ExcelGate.isLinked) { return ExcelGate.exportFile().catch(error => toast(error.message, true)); }''')
t = change(t, 'const register = (tool) => {', '''const register = (tool) => {
          if (!tool.annotations.readOnlyHint) {
            const execute = tool.execute;
            tool.execute = function (input) { assertEditable(); return execute(input); };
          }''')
t = change(t, '      setup();', '''      setup();
      ExcelGate.connect({
        load(payload, info) {
          if (info.hasPayload) state = normalizeState(payload);
          render();
        },
        exportData() {
          if ($('#projectDialog').open || $('#confirmDialog').open) throw new Error('プロジェクトの入力・削除確認を確定またはキャンセルしてから出力してください。');
          return state;
        },
        setReadOnly(value) { gateReadOnly = value; gateViewControls(); }
      }).catch(error => console.error('ExcelGate:', error.message));''')
# The reference has a separate guide link. The packaged guide keeps that role.
t = t.replace('DXプロジェクト8段階ガイド.html', 'guide.html')
write('progress-board', s, t)

s = (ROOT/'reference/workflow-studio.html').read_text()
t = change(s, '<meta charset="utf-8">', '<meta charset="utf-8">\n  '+BOOT)
t = change(t, 'let state=null,', '''let gateReadOnly=false;
  function assertEditable(){if(gateReadOnly)throw new Error('閲覧専用では変更できません。')}
  function gateViewControls(){
    if(!ExcelGate.isLinked)return;
    ['newProjectBtn','saveBtn','applyPrint','executePrint'].forEach(id=>{if($('#'+id))$('#'+id).disabled=gateReadOnly});
    if($('#fileInput'))$('#fileInput').disabled=gateReadOnly;
    if($('#dropzone'))$('#dropzone').setAttribute('aria-disabled',String(gateReadOnly));
    $('#saveBtn').style.display='none';
    // Cross-app navigation must start from that app's own shared workbook.
    $('#dashboardBtn').hidden=true;
    $$('[data-edit]').forEach(el=>{el.setAttribute('aria-disabled',String(gateReadOnly));el.style.cursor=gateReadOnly?'default':''});
  }
  let state=null,''')
t = change(t, 'function updateDirty(){', '''function updateDirty(){
    if(ExcelGate.isLinked){$('#dirtyStatus').textContent=gateReadOnly?'正式保存済みデータを閲覧中':'保存はブックで行います';gateViewControls();return}''')
for signature in ['function openEditor(kind,keyOrId){', 'function confirmEditor(){', 'function loadFile(file){', 'function applyPrintSettings(){']:
    t = change(t, signature, signature+'assertEditable();')
t = change(t, 'function saveJSON(){', '''function saveJSON(){if(ExcelGate.isLinked){return ExcelGate.exportFile().catch(e=>toast(e.message,'error'))}''')
t = change(t, 'const register=tool=>{', '''const register=tool=>{const execute=tool.execute;tool.execute=function(input){assertEditable();return execute(input)};''')
t = change(t, "$('#newProjectForm').onsubmit=e=>{", "$('#newProjectForm').onsubmit=e=>{assertEditable();")
t = change(t, "if(edit&&state&&!edit.closest('#referencePanel'))", "if(edit&&state&&!gateReadOnly&&!edit.closest('#referencePanel'))")
t = change(t, "const del=e.target.closest('[data-delete-person]');", "if(gateReadOnly)return;const del=e.target.closest('[data-delete-person]');")
t = change(t, "if(dirty){e.preventDefault();", "if(dirty&&!ExcelGate.isLinked){e.preventDefault();")
t = change(t, '  registerWebMCP();', '''  registerWebMCP();
  ExcelGate.connect({
    load(payload,info){
      if(info.hasPayload)startProject(normalizeProject(payload));
      else if(gateReadOnly){$('#welcome').innerHTML='<h2>正式保存されたデータはありません</h2><p>Excelを閉じてください。</p>'}
      gateViewControls();
    },
    exportData(){
      if(editor||$('#newProjectDialog').open||$('#printDialog').open)throw new Error('開いている入力・印刷調整を確定または閉じてから出力してください。');
      if(!state)throw new Error('先にプロジェクトを作成してください。');
      return createProjectPackage();
    },
    setReadOnly(value){gateReadOnly=value;gateViewControls()}
  }).catch(error=>console.error('ExcelGate:',error.message));''')
write('workflow-studio', s, t)
print('Adapted 2 reference applications; exact diffs written.')
