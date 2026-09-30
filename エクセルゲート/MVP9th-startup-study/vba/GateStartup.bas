Attribute VB_Name = "GateStartup"
Option Explicit

' Study only: selected by a literal name in the separately generated test books.
' No timers, background preparation, changed security settings or extra saves.
Private profile As String
Private measuring As Boolean
Private fastOperation As Boolean
Private started As Double, lastMark As Double
Private phases As String
Private copyMs As Double, crcMs As Double, copiedBytes As Double
Private configJson As String
Private configKeys() As String, configValues() As Variant, configCount As Long
Private metaRows As Variant, metaLoaded As Boolean

Public Function GateStartupClock() As Double
    ' Local civil milliseconds; the browser uses the same PC's local clock.
    ' Read date on both sides of Timer to handle a midnight crossing.
    Dim dayBefore As Date, dayAfter As Date, seconds As Double
    Do
        dayBefore = Date
        seconds = CDbl(Timer)
        dayAfter = Date
    Loop While dayBefore <> dayAfter
    GateStartupClock = CDbl(dayAfter - DateSerial(1970, 1, 1)) * 86400000# + seconds * 1000#
End Function

Public Sub GateStartupBegin()
    GateStartupEnd
    started = GateStartupClock()
    lastMark = started
    profile = GatePresentationValue("_GateStartupProfile")
    measuring = (profile = "baseline" Or profile = "minimal")
    fastOperation = (profile = "minimal")
    phases = ""
    copyMs = 0: crcMs = 0: copiedBytes = 0
End Sub

Public Sub GateStartupEnd()
    measuring = False
    fastOperation = False
    configJson = ""
    configCount = 0
    Erase configKeys
    Erase configValues
    GateStartupInvalidateMeta
End Sub

Public Function GateStartupFast() As Boolean
    GateStartupFast = fastOperation
End Function

Public Sub GateStartupInvalidateMeta()
    metaLoaded = False
    metaRows = Empty
End Sub

Public Function GateStartupMetaGet(ByVal keyName As String, ByVal defaultValue As String) As String
    GateStartupMetaGet = defaultValue
    If Not metaLoaded Then
        If Not GateSheetExists(GATE_META_SHEET) Then Exit Function
        Dim ws As Object, lastRow As Long
        Set ws = ThisWorkbook.Worksheets(GATE_META_SHEET)
        lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
        If lastRow >= 2 Then metaRows = ws.Range(ws.Cells(2, 1), ws.Cells(lastRow, 2)).Value2
        metaLoaded = True
    End If
    If IsEmpty(metaRows) Then Exit Function
    Dim i As Long
    For i = LBound(metaRows, 1) To UBound(metaRows, 1)
        If CStr(metaRows(i, 1)) = keyName Then
            If keyName = "lastSaveAt" Or keyName = "sessionStartedAt" Then
                GateStartupMetaGet = GateFormatDateTimeValue(metaRows(i, 2), "yyyy-mm-dd hh:nn:ss")
            Else
                GateStartupMetaGet = CStr(metaRows(i, 2))
            End If
            Exit Function
        End If
    Next i
End Function

Public Function GateStartupConfigJson() As String
    If fastOperation And Len(configJson) > 0 Then
        GateStartupConfigJson = configJson
        Exit Function
    End If
    Dim value As String
    value = GateValidateAndMinifyJson(GateReadUtf8File(GateProjectPath("gate.config.json")))
    If fastOperation Then configJson = value
    GateStartupConfigJson = value
End Function

Public Function GateStartupConfigValue(ByVal json As String, ByVal key As String, ByVal kind As String) As Variant
    Dim cacheKey As String, i As Long, value As Variant
    cacheKey = kind & ":" & key
    If fastOperation Then
        For i = 1 To configCount
            If configKeys(i) = cacheKey Then
                GateStartupConfigValue = configValues(i)
                Exit Function
            End If
        Next i
    End If
    Select Case kind
        Case "string": value = GateJsonTopLevelString(json, key)
        Case "long": value = GateJsonTopLevelLong(json, key)
        Case "boolean": value = GateJsonTopLevelBoolean(json, key)
        Case Else: Err.Raise vbObjectError + 2900, , "Unknown configuration type"
    End Select
    If fastOperation Then
        configCount = configCount + 1
        ReDim Preserve configKeys(1 To configCount)
        ReDim Preserve configValues(1 To configCount)
        configKeys(configCount) = cacheKey
        configValues(configCount) = value
    End If
    GateStartupConfigValue = value
End Function

Public Sub GateStartupMark(ByVal name As String)
    If Not measuring Then Exit Sub
    Dim nowMs As Double
    nowMs = GateStartupClock()
    If Len(phases) > 0 Then phases = phases & ","
    phases = phases & GateJsonQuote(name) & ":" & GateStartupNumber(nowMs - lastMark)
    lastMark = nowMs
End Sub

Public Sub GateStartupAddCopy(ByVal elapsed As Double, ByVal byteCount As Double)
    If Not measuring Then Exit Sub
    copyMs = copyMs + elapsed
    copiedBytes = copiedBytes + byteCount
End Sub

Public Sub GateStartupAddCrc(ByVal elapsed As Double)
    If measuring Then crcMs = crcMs + elapsed
End Sub

Private Function GateStartupNumber(ByVal value As Double) As String
    ' Str uses a period irrespective of the Windows decimal separator.
    GateStartupNumber = Trim$(Str$(value))
End Function

Public Sub GateStartupWriteReport(ByVal htmlFile As String)
    If Not measuring Then Exit Sub
    Dim report As String, timingFile As String, fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    timingFile = GateJoinPath(fso.GetParentFolderName(htmlFile), "excel-gate-timing.js")
    report = "{" & GateJsonQuote("schemaVersion") & ":1," & _
        GateJsonQuote("profile") & ":" & GateJsonQuote(profile) & "," & _
        GateJsonQuote("startedLocalMs") & ":" & GateStartupNumber(started) & "," & _
        GateJsonQuote("handoffLocalMs") & ":" & GateStartupNumber(lastMark) & "," & _
        GateJsonQuote("phasesMs") & ":{" & phases & "}," & _
        GateJsonQuote("detailMs") & ":{" & GateJsonQuote("fileCopy") & ":" & GateStartupNumber(copyMs) & "," & _
        GateJsonQuote("crcWithFileRead") & ":" & GateStartupNumber(crcMs) & "}," & _
        GateJsonQuote("runtimeBytes") & ":" & GateStartupNumber(copiedBytes) & "}"
    ' Output after the measured saves, without saving the workbook again.
    ' Report writing and OS launch are included in the browser handoff interval.
    GateWriteUtf8File timingFile, "window.__EXCEL_GATE_TIMING__=" & report & ";"
End Sub

Public Sub GateStartupOpenDirect()
    ' Dedicated study package only. Uses the same OS launcher as the gate.
    GateStartupBegin
    profile = "direct"
    measuring = True
    Dim htmlFile As String
    htmlFile = GateProjectPath("direct/index.html")
    If Not GateFileExists(htmlFile) Then Err.Raise vbObjectError + 2901, , "íºäJÇ´î‰ärópHTMLÇ™å©Ç¬Ç©ÇËÇ‹ÇπÇÒÅB"
    GateStartupMark "directLaunchPreparation"
    GateStartupWriteReport htmlFile
    GateStartupEnd
    GateOpenLocalFile htmlFile
End Sub
