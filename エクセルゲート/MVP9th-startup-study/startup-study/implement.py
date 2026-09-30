from pathlib import Path
root=Path(__file__).resolve().parents[1]
v=root/'vba/utf8'
def edit(name, old, new, count=1):
 p=v/name; s=p.read_text(); assert old in s,(name,old); p.write_text(s.replace(old,new,count))
edit('GateDeployment.bas','configJson = GateValidateAndMinifyJson(GateReadUtf8File(GateProjectPath("gate.config.json")))','configJson = GateStartupConfigJson()',3)
edit('GateDeployment.bas','GateAppConfig = GateJsonTopLevelString(configJson, key)','GateAppConfig = CStr(GateStartupConfigValue(configJson, key, "string"))')
edit('GateDeployment.bas','GateConfigVersion = GateJsonTopLevelLong(configJson, "dataVersion")','GateConfigVersion = CLng(GateStartupConfigValue(configJson, "dataVersion", "long"))')
edit('GateDeployment.bas','GateAuthorRequired = GateJsonTopLevelBoolean(configJson, "authorRequired")','GateAuthorRequired = CBool(GateStartupConfigValue(configJson, "authorRequired", "boolean"))')
edit('GateStorage.bas','    If Not GateSheetExists(GATE_META_SHEET) Then','    If GateStartupFast() Then\n        GateMetaGet = GateStartupMetaGet(keyName, defaultValue)\n        Exit Function\n    End If\n    If Not GateSheetExists(GATE_META_SHEET) Then')
edit('GateStorage.bas','Public Sub GateMetaSet(ByVal keyName As String, ByVal value As Variant)\n','Public Sub GateMetaSet(ByVal keyName As String, ByVal value As Variant)\n    GateStartupInvalidateMeta\n')
edit('GateStorage.bas','Public Sub GateEnsureInternalSheets()\n','Public Sub GateEnsureInternalSheets()\n    GateStartupInvalidateMeta\n')
edit('GateStorage.bas','Private Sub GateRestoreSheet(ByVal sheetName As String, ByVal values As Variant)\n','Private Sub GateRestoreSheet(ByVal sheetName As String, ByVal values As Variant)\n    GateStartupInvalidateMeta\n')
edit('GateStorage.bas','    FileCopy sourceFile, destinationFile\n','    Dim copyStarted As Double\n    copyStarted = GateStartupClock()\n    FileCopy sourceFile, destinationFile\n    GateStartupAddCopy GateStartupClock() - copyStarted, FileLen(sourceFile)\n')
# CRC file detail includes stream read; keep the original comparisons and error paths.
edit('GateJson.bas','Public Function GateCrc32File(ByVal filePath As String) As String\n','Public Function GateCrc32File(ByVal filePath As String) As String\n    Dim crcStarted As Double\n    crcStarted = GateStartupClock()\n')
edit('GateJson.bas','    GateCrc32File = GateCrc32Bytes(bytes)\n','    GateCrc32File = GateCrc32Bytes(bytes)\n    GateStartupAddCrc GateStartupClock() - crcStarted\n')
edit('GateJson.bas','Private Function GateCrc32Bytes(ByVal bytes As Variant) As String\n','Private Function GateCrc32Bytes(ByVal bytes As Variant) As String\n    If GateStartupFast() Then\n        GateCrc32Bytes = GateCrc32TableBytes(bytes)\n        Exit Function\n    End If\n')
# Each completion/error exit clears operation-local caches before other work.
edit('GateMain.bas','Public Sub OpenEditHtml()\n    On Error GoTo OpenFailed\n','Public Sub OpenEditHtml()\n    On Error GoTo OpenFailed\n    GateStartupBegin\n')
edit('GateMain.bas','               vbExclamation, GateDialogTitle()\n        Exit Sub','               vbExclamation, GateDialogTitle()\n        GateStartupEnd\n        Exit Sub')
edit('GateMain.bas','    GateEditPreflight\n    Dim payloadRaw As String','    GateEditPreflight\n    GateStartupMark "settingsAndPanel"\n    Dim payloadRaw As String')
edit('GateMain.bas','    payloadRaw = GateCurrentPayloadRaw()\n','    payloadRaw = GateCurrentPayloadRaw()\n    GateStartupMark "payloadReadValidate"\n')
edit('GateMain.bas','    contextJson = GateBuildAppContext("edit", sessionId, payloadRaw)\n','    contextJson = GateBuildAppContext("edit", sessionId, payloadRaw)\n    GateStartupMark "contextBuild"\n')
edit('GateMain.bas','    htmlFile = GateCreateRuntimeHtml(contextJson, sessionId)\n','    htmlFile = GateCreateRuntimeHtml(contextJson, sessionId)\n    GateStartupMark "runtimeCopyAndVerify"\n')
edit('GateMain.bas','    GateStartActiveSession sessionId\n    GateSaveWorkbook "start-session"\n','    GateStartActiveSession sessionId\n    GateStartupMark "sessionRecord"\n    GateSaveWorkbook "start-session"\n    GateStartupMark "workbookSave"\n')
edit('GateMain.bas','    gCompletionNotified = False\n    RefreshOperationPanel\n    GateOpenLocalFile htmlFile','    gCompletionNotified = False\n    RefreshOperationPanel\n    GateStartupMark "finalPanel"\n    GateStartupWriteReport htmlFile\n    GateStartupEnd\n    GateOpenLocalFile htmlFile')
edit('GateMain.bas','    openError = Err.Description\n','    openError = Err.Description\n    GateStartupEnd\n')
# Timing script is loaded only in the study app; business HTML/embedded images unchanged apart from this script tag.
p=root/'apps/rehab-inventory/index.html';s=p.read_text();assert '<head>' in s;s=s.replace('<head>','<head>\n<script src="excel-gate-timing.js"></script>\n<script src="excel-gate-benchmark.js"></script>',1);p.write_text(s)
p=root/'shared/excel-gate.js';s=p.read_text();s=s.replace('return controller.connect(adapter);','return controller.connect(adapter).then(function () {\n        if (win.ExcelGateBenchmark) win.ExcelGateBenchmark.ready();\n      });',1);p.write_text(s)
