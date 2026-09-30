Attribute VB_Name = "GateCandidateSelectionTests"
Option Explicit

' WINDOWS ONLY. Import into a NEW disposable TEST workbook with GATE_TESTING=True.
' Writes two uniquely named files into the same Downloads folder the importer scans.
' It never removes other downloads. An unrelated malformed Gate file blocks this test.
' Each successful candidate selection is stopped by the "pending" fault BEFORE copying
' a file or changing formal data. Session start/end are saved to the TEST workbook.
Public Sub GateRunCandidateSelectionTests()
    Dim firstFile As String, secondFile As String, started As Boolean, ownsPaths As Boolean, failure As String
    Dim checks As Long, session As String, firstJson As String, secondJson As String, firstId As String
    On Error GoTo Failed
    GateAssertCanonical True
    If CLng(GateMetaGet("revision", "0")) <> 0 Or Len(GateMetaGet("activeSessionId")) > 0 Or GateMetaGet("commitState") <> "NONE" Then
        Err.Raise vbObjectError + 2920, , "Use a NEW empty TEST workbook"
    End If
    If MsgBox("Uses two temporary test downloads and a new TEST session. Continue on this disposable workbook?", vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    session = GateNewId()
    GateStartActiveSession session
    started = True
    GateSaveWorkbook "test-start"
    Dim folder As String, token As String
    folder = CandidateTestDownloadsFolder()
    token = GateNewId()
    firstFile = GateJoinPath(folder, GATE_FILE_PREFIX & "TEST-" & token & "-1.json")
    secondFile = GateJoinPath(folder, GATE_FILE_PREFIX & "TEST-" & token & "-2.json")
    If GateFileExists(firstFile) Or GateFileExists(secondFile) Then Err.Raise vbObjectError + 2921, , "Test filename collision"
    ownsPaths = True
    firstId = GateNewId()
    firstJson = CandidateTestJson(firstId, "", 1, session, GateMetaGet("databaseId"))
    secondJson = CandidateTestJson(GateNewId(), firstId, 2, session, GateMetaGet("databaseId"))
    GateWriteUtf8File firstFile, firstJson
    CandidateExpectSelection firstFile, vbObjectError + 2799, "One valid candidate", session, checks

    GateWriteUtf8File secondFile, secondJson
    CandidateExpectSelection secondFile, vbObjectError + 2799, "Valid chain chooses latest", session, checks
    CandidateExpectSelection firstFile, vbObjectError + 2513, "Manual old selection refused", session, checks
    GateWriteUtf8File secondFile, Left$(secondJson, Len(secondJson) - 1)
    CandidateExpectSelection "", vbObjectError + 2512, "Truncated latest blocks automatic fallback", session, checks
    CandidateExpectSelection firstFile, vbObjectError + 2512, "Manual selection cannot bypass truncation", session, checks

    GateWriteUtf8File secondFile, Replace(secondJson, """payload"":{}", """payload"":1 2")
    CandidateExpectSelection firstFile, vbObjectError + 2512, "Broken number blocks fallback", session, checks
    GateWriteUtf8File secondFile, "{""payload"":{}}"
    CandidateExpectSelection firstFile, vbObjectError + 2512, "Missing ownership blocks fallback", session, checks
    GateWriteUtf8File secondFile, Replace(secondJson, """workCopy""", """invalid""")
    CandidateExpectSelection firstFile, vbObjectError + 2512, "Current invalid envelope blocks fallback", session, checks

    Dim invalidId As Variant
    For Each invalidId In Array("", String$(7, "x"), String$(101, "x"))
        GateWriteUtf8File secondFile, CandidateTestJson(GateNewId(), firstId, 2, CStr(invalidId), GateMetaGet("databaseId"))
        CandidateExpectSelection firstFile, vbObjectError + 2512, "Invalid session ID length " & Len(CStr(invalidId)), session, checks
        GateWriteUtf8File secondFile, CandidateTestJson(GateNewId(), firstId, 2, session, CStr(invalidId))
        CandidateExpectSelection firstFile, vbObjectError + 2512, "Invalid database ID length " & Len(CStr(invalidId)), session, checks
    Next invalidId

    Dim foreignJson As String
    foreignJson = CandidateTestJson(GateNewId(), "", 1, GateNewId(), GateMetaGet("databaseId"))
    GateWriteUtf8File secondFile, foreignJson
    CandidateExpectSelection firstFile, vbObjectError + 2799, "Valid other session ignored", session, checks
    GateWriteUtf8File secondFile, CandidateTestJson(GateNewId(), "", 1, session, GateNewId())
    CandidateExpectSelection firstFile, vbObjectError + 2799, "Valid other database ignored", session, checks
    GateWriteUtf8File secondFile, Left$(foreignJson, Len(foreignJson) - 1)
    CandidateExpectSelection firstFile, vbObjectError + 2512, "Malformed foreign file remains unknown", session, checks
    GateWriteUtf8File secondFile, firstJson
    CandidateExpectSelection firstFile, vbObjectError + 2799, "Identical duplicate allowed", session, checks
    GateWriteUtf8File secondFile, CandidateTestJson(GateNewId(), "", 1, session, GateMetaGet("databaseId"))
    CandidateExpectSelection firstFile, vbObjectError + 2512, "Competing same-sequence branch refused", session, checks
    GoTo Cleanup
Failed:
    failure = Err.Description
Cleanup:
    gGateTestFailStage = ""
    On Error GoTo CleanupFailed
    If ownsPaths Then
        If GateFileExists(firstFile) Then Kill firstFile
        If GateFileExists(secondFile) Then Kill secondFile
    End If
    If started Then GateEndSessionPersisted
    If Len(failure) > 0 Then
        MsgBox "FAIL: " & failure, vbCritical
    Else
        MsgBox "PASS: " & checks & " native candidate-selection checks. Formal saves stopped before pending copy."
    End If
    Exit Sub
CleanupFailed:
    MsgBox "FAIL cleaning TEST files/session. " & failure & " / " & Err.Description, vbCritical
End Sub

Private Sub CandidateExpectSelection(ByVal selectedFile As String, ByVal expected As Long, ByVal label As String, ByVal session As String, ByRef checks As Long)
    Dim actual As Long, saved As Boolean
    gGateTestFailStage = "pending"
    On Error Resume Next
    saved = GateSavePendingOutput("workCopy", selectedFile)
    actual = Err.Number
    Err.Clear
    On Error GoTo 0
    gGateTestFailStage = ""
    If actual <> expected Then Err.Raise vbObjectError + 2922, , label & ": expected " & expected & ", actual " & actual
    If saved Or GateLoadCompactJson() <> "" Or GateMetaGet("revision") <> "0" Or GateMetaGet("commitState") <> "NONE" Or GateMetaGet("activeSessionId") <> session Or GateMetaGet("lastImportSequence") <> "0" Then
        Err.Raise vbObjectError + 2923, , "Formal state changed: " & label
    End If
    checks = checks + 1
End Sub

Private Function CandidateTestJson(ByVal id As String, ByVal parent As String, ByVal sequence As Long, ByVal session As String, ByVal database As String) As String
    Dim json As String
    json = "{""formatVersion"":2,""saveDataId"":" & GateJsonQuote(id)
    json = json & ",""parentSaveDataId"":" & GateJsonQuote(parent)
    json = json & ",""databaseId"":" & GateJsonQuote(database)
    json = json & ",""sessionId"":" & GateJsonQuote(session)
    json = json & ",""dataType"":" & GateJsonQuote(GateMetaGet("dataType"))
    json = json & ",""schemaVersion"":" & GateMetaGet("schemaVersion")
    json = json & ",""baseRevision"":0,""exportSequence"":" & CStr(sequence)
    json = json & ",""authorName"":""TEST ONLY"",""exportedAt"":""2026-09-21T00:00:00Z"""
    json = json & ",""saveKind"":""workCopy"",""readOnly"":false,""payload"":{}}"
    CandidateTestJson = json
End Function

Private Function CandidateTestDownloadsFolder() As String
    On Error Resume Next
    Dim shell As Object, folder As Object
    Set shell = CreateObject("Shell.Application")
    Set folder = shell.Namespace("shell:Downloads")
    If Not folder Is Nothing Then CandidateTestDownloadsFolder = folder.Self.Path
    On Error GoTo 0
    If Len(CandidateTestDownloadsFolder) = 0 And Len(Environ$("USERPROFILE")) > 0 Then CandidateTestDownloadsFolder = GateJoinPath(Environ$("USERPROFILE"), "Downloads")
    If Not GateFolderExists(CandidateTestDownloadsFolder) Then CandidateTestDownloadsFolder = ThisWorkbook.Path
End Function
