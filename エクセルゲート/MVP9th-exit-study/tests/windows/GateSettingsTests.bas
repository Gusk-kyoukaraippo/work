Attribute VB_Name = "GateSettingsTests"
Option Explicit

' Use only a disposable COPY of a workbook with saved TEST data and history.
' Enable GATE_TESTING in GateDeployment on that copy. Never import into production.
Public Sub GateRunSettingsTests()
    On Error GoTo Failed
    GateAssertCanonical True
    If Len(GateLoadCompactJson()) = 0 Then Err.Raise 5, , "Save TEST data before this test."
    If MsgBox("Reconfigures and saves this TEST copy. Continue?", vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    Dim payload As String, metadata As String, history As String, oldLocation As String, i As Long
    payload = GateLoadCompactJson()
    metadata = PreservedMetadata()
    history = SheetSnapshot(GATE_HISTORY_SHEET)
    For i = 1 To 2
        GateApplySettings ""
        Require GateLoadCompactJson() = payload, "Payload changed"
        Require PreservedMetadata() = metadata, "Metadata changed"
        Require SheetSnapshot(GATE_HISTORY_SHEET) = history, "History changed"
    Next i
    oldLocation = GateMetaGet("canonicalPath")
    GateMetaSet "canonicalPath", "TEST OLD LOCATION"
    gGateTestFailStage = "reconfigure"
    Require ApplyError() = vbObjectError + 2799, "Injected save failure missing"
    Require GateMetaGet("canonicalPath") = "TEST OLD LOCATION", "Location rollback missing"
    Require GateLoadCompactJson() = payload And PreservedMetadata() = metadata, "Save failure changed data"
    Require SheetSnapshot(GATE_HISTORY_SHEET) = history, "Save failure changed history"
    GateApplySettings ""
    Require GateMetaGet("canonicalPath") = oldLocation, "Location not registered"
    GateMetaSet "activeSessionId", "TEST ACTIVE"
    Require ApplyError() = vbObjectError + 2407, "Active reconfiguration accepted"
    GateMetaSet "activeSessionId", ""
    GateMetaSet "commitState", "PREPARED"
    Require ApplyError() = vbObjectError + 2407, "Prepared reconfiguration accepted"
    GateMetaSet "commitState", "NONE"
    GateMetaSet "schemaVersion", CLng(GateMetaGet("schemaVersion")) + 1
    Require ApplyError() = vbObjectError + 2408, "Different schema accepted"
    GateMetaSet "schemaVersion", GateConfigVersion()
    GateApplySettings ""
    Require GateLoadCompactJson() = payload And PreservedMetadata() = metadata, "Final data changed"
    Require SheetSnapshot(GATE_HISTORY_SHEET) = history, "Final history changed"
    MsgBox "PASS: repeated settings, relocation, save failure rollback, active/prepared/schema refusal. Reopen and compare saved TEST data/history."
    Exit Sub
Failed:
    gGateTestFailStage = ""
    MsgBox "FAIL: " & Err.Description
End Sub

Private Function ApplyError() As Long
    On Error GoTo Failed
    GateApplySettings ""
    Exit Function
Failed:
    ApplyError = Err.Number
End Function

Private Function PreservedMetadata() As String
    Dim key As Variant
    For Each key In Array("databaseId", "dataType", "schemaVersion", "dataSource", "revision", "chunkCount", "jsonLength", "crc32", "lastSaveAt", "lastSaveAuthor", "lastImportedSaveDataId", "lastImportSequence")
        PreservedMetadata = PreservedMetadata & GateJsonQuote(CStr(key)) & GateJsonQuote(GateMetaGet(CStr(key)))
    Next key
End Function

Private Function SheetSnapshot(ByVal name As String) As String
    Dim value As Variant, row As Long, column As Long
    value = ThisWorkbook.Worksheets(name).UsedRange.Value2
    For row = 1 To UBound(value, 1)
        For column = 1 To UBound(value, 2)
            SheetSnapshot = SheetSnapshot & GateJsonQuote(CStr(value(row, column)))
        Next column
    Next row
End Function

Private Sub Require(ByVal condition As Boolean, ByVal message As String)
    If Not condition Then Err.Raise 5, , message
End Sub
