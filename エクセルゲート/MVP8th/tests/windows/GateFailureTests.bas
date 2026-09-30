Attribute VB_Name = "GateFailureTests"
Option Explicit

' Import only into a NEW TEST workbook. Enable GATE_TESTING in GateDeployment.
Public Sub GateRunFailureTests()
    On Error GoTo Failed
    GateAssertCanonical True
    If CLng(GateMetaGet("revision", "0")) <> 0 Or Len(GateMetaGet("activeSessionId")) > 0 Then
        Err.Raise vbObjectError + 2900, , "Use a newly initialized empty TEST workbook."
    End If
    If MsgBox("This creates and saves TEST data. Continue on this empty test workbook?", vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    GateStartActiveSession GateNewId()
    GateSaveWorkbook "test-start"
    Dim stages As Variant, stage As Variant, json As String, source As String, e As GateEnvelope
    Dim beforeJson As String, beforeRevision As Long, session As String, marker As String, failedNumber As Long
    stages = Array("baseline", "pending", "prepare", "publish", "finalize")
    For Each stage In stages
        beforeJson = GateLoadCompactJson()
        beforeRevision = CLng(GateMetaGet("revision", "0"))
        session = GateMetaGet("activeSessionId")
        marker = GateMetaGet("sessionMarkerFile")
        json = FixtureJson(CStr(stage))
        source = GateProjectPath("data/backups/test-" & GateNewId() & ".json")
        GateWriteUtf8File source, json
        GateParseEnvelope json, e
        If stage <> "baseline" Then
            gGateTestFailStage = CStr(stage)
            failedNumber = TryCommit(source, json, e)
            Require failedNumber = vbObjectError + 2799, "Expected injected failure: " & stage
            Require GateLoadCompactJson() = beforeJson, "Committed data changed after " & stage
            Require CLng(GateMetaGet("revision", "0")) = beforeRevision, "Revision changed after " & stage
            Require GateMetaGet("activeSessionId") = session, "Session cleared after " & stage
            Require GateFileExists(marker), "Session marker removed after " & stage
            If stage = "pending" Then
                Require GateMetaGet("commitState") = "NONE", "Pending failure advanced PREPARED"
            Else
                Require GateMetaGet("commitState") = "PREPARED", "PREPARED lost after " & stage
                Require GateFileExists(GateMetaGet("pendingFile")), "Recovery file lost after " & stage
                Require LatestHistoryStatus() = "PREPARED", "False SUCCESS after " & stage
            End If
        End If
        If GateMetaGet("commitState") = "PREPARED" Then
            GateResumePreparedCommit False
        Else
            GateCommitImportedFile source, json, e
        End If
        Require GateLoadCompactJson() = json, "Payload mismatch after retry: " & stage
        Require CLng(GateMetaGet("revision")) = beforeRevision + 1, "Revision did not advance exactly once"
        Require GateMetaGet("commitState") = "NONE", "PREPARED remains after success"
        Require LatestHistoryStatus() = "SUCCESS", "Success not persisted"
        Require Not GateFileExists(GateProjectPath("data/.pending/" & e.SaveDataId & ".json")), "Pending cleanup failed"
        If stage = "finalize" Then
            Require Len(GateMetaGet("activeSessionId")) = 0, "Complete did not end session"
            Require Not GateFileExists(marker), "Complete marker cleanup failed"
        End If
    Next stage
    GateWriteUtf8File GateProjectPath("data/backups/failure-test-result.txt"), "PASS " & Format$(Now, "yyyy-mm-dd hh:nn:ss") & vbCrLf & "In-process injection and retry only. Not a network or restart test."
    RefreshOperationPanel
    MsgBox "PASS: four injected failures and same-process retry; final complete cleanup."
    Exit Sub
Failed:
    gGateTestFailStage = ""
    MsgBox "FAIL: " & Err.Description, vbCritical
End Sub

Private Function TryCommit(ByVal source As String, ByVal json As String, ByRef envelope As GateEnvelope) As Long
    On Error GoTo Failed
    GateCommitImportedFile source, json, envelope
    Exit Function
Failed:
    TryCommit = Err.Number
End Function

Private Sub Require(ByVal condition As Boolean, ByVal message As String)
    If Not condition Then Err.Raise vbObjectError + 2901, , message
End Sub

Private Function LatestHistoryStatus() As String
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(GATE_HISTORY_SHEET)
    LatestHistoryStatus = CStr(ws.Cells(ws.Cells(ws.Rows.Count, 1).End(-4162).Row, 7).Value2)
End Function

Private Function FixtureJson(ByVal stage As String) As String
    Dim result As String, saveKind As String
    saveKind = IIf(stage = "finalize", "complete", "workCopy")
    result = "{""formatVersion"":2,""saveDataId"":" & GateJsonQuote(GateNewId())
    result = result & ",""parentSaveDataId"":" & GateJsonQuote(GateMetaGet("lastImportedSaveDataId"))
    result = result & ",""databaseId"":" & GateJsonQuote(GateMetaGet("databaseId"))
    result = result & ",""sessionId"":" & GateJsonQuote(GateMetaGet("activeSessionId"))
    result = result & ",""dataType"":" & GateJsonQuote(GateMetaGet("dataType"))
    result = result & ",""schemaVersion"":" & GateMetaGet("schemaVersion")
    result = result & ",""baseRevision"":" & GateMetaGet("sessionBaseRevision")
    result = result & ",""exportSequence"":" & CStr(CLng(GateMetaGet("lastImportSequence")) + 1)
    result = result & ",""authorName"":""TEST ONLY"",""exportedAt"":""2026-09-21T00:00:00Z"""
    result = result & ",""saveKind"":" & GateJsonQuote(saveKind) & ",""readOnly"":false"
    result = result & ",""payload"": {""testStage"":" & GateJsonQuote(stage) & ",""text"":""=not-a-formula""}}"
    FixtureJson = GateValidateAndMinifyJson(result)
End Function

Public Sub GateRunSaveKindTests()
    On Error GoTo Failed
    GateRequireSaveKind "complete", "complete"
    GateRequireSaveKind "workCopy", "workCopy"
    Require KindError("complete", "workCopy") = vbObjectError + 2516, "Final output accepted by continue"
    Require KindError("workCopy", "complete") = vbObjectError + 2515, "Intermediate output accepted by close"
    Require KindError("invalid", "complete") = vbObjectError + 2517, "Unknown file kind accepted"
    MsgBox "PASS: save-kind validation."
    Exit Sub
Failed:
    MsgBox "FAIL: " & Err.Description, vbCritical
End Sub

Private Function KindError(ByVal actualKind As String, ByVal expectedKind As String) As Long
    On Error GoTo Failed
    GateRequireSaveKind actualKind, expectedKind
    Exit Function
Failed:
    KindError = Err.Number
End Function

Public Sub GateRunImporterTests()
    On Error GoTo Failed
    GateAssertCanonical True
    Require CLng(GateMetaGet("revision", "0")) = 0, "Use a NEW empty TEST workbook"
    Require Len(GateMetaGet("activeSessionId")) = 0, "An edit is already active"
    If MsgBox("Creates TEST data on this empty test workbook. Continue?", vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    GateStartActiveSession GateNewId()
    GateSaveWorkbook "test-start"
    Dim source As String, json As String, revision As Long
    source = GateProjectPath("data/backups/importer-" & GateNewId() & ".json")
    json = FixtureJson("baseline")
    GateWriteUtf8File source, json
    Require TrySaveOutput("complete", source) = vbObjectError + 2515, "Wrong kind was not stopped"
    Require CLng(GateMetaGet("revision", "0")) = 0, "Wrong kind changed revision"
    Require GateSavePendingOutput("workCopy", source), "Intermediate save failed"
    Require CLng(GateMetaGet("revision", "0")) = 1, "Intermediate revision wrong"
    Require Len(GateMetaGet("activeSessionId")) > 0, "Intermediate closed session"
    Require TrySaveOutput("workCopy", source) = vbObjectError + 2570, "Duplicate was not rejected"
    json = FixtureJson("finalize")
    source = GateProjectPath("data/backups/importer-" & GateNewId() & ".json")
    GateWriteUtf8File source, json
    gGateTestFailStage = "finalize"
    Require TrySaveOutput("complete", source) = vbObjectError + 2799, "Final save injection did not fail"
    Require GateMetaGet("commitState") = "PREPARED", "Recovery state missing"
    Require TrySaveOutput("workCopy", source) = vbObjectError + 2516, "Wrong retry kind accepted"
    Require GateMetaGet("commitState") = "PREPARED", "Wrong retry lost recovery state"
    Require GateSavePendingOutput("complete", source), "Final retry failed"
    revision = CLng(GateMetaGet("revision"))
    Require revision = 2, "Final save not committed exactly once"
    Require gCompletedSaveReady, "Close retry not armed"
    Require GateSavePendingOutput("complete", source), "Committed final could not retry closing"
    Require CLng(GateMetaGet("revision")) = revision, "Close retry duplicated save"
    Require Len(GateMetaGet("activeSessionId")) = 0, "Final save did not end session"
    MsgBox "PASS: importer kind checks, duplicate refusal, prepared recovery, idempotent final retry."
    Exit Sub
Failed:
    gGateTestFailStage = ""
    MsgBox "FAIL: " & Err.Description, vbCritical
End Sub

Private Function TrySaveOutput(ByVal kind As String, ByVal source As String) As Long
    On Error GoTo Failed
    Dim saved As Boolean
    saved = GateSavePendingOutput(kind, source)
    Exit Function
Failed:
    TrySaveOutput = Err.Number
End Function
