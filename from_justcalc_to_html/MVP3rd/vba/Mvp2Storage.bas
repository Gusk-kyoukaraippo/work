Attribute VB_Name = "Mvp2Storage"
Option Explicit

Public Function Mvp2MetaGet(ByVal keyName As String, Optional ByVal defaultValue As String = "") As String
    If Not Mvp2SheetExists(MVP2_META_SHEET) Then
        Mvp2MetaGet = defaultValue
        Exit Function
    End If

    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_META_SHEET)
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
    Dim rowNumber As Long
    For rowNumber = 2 To lastRow
        If CStr(ws.Cells(rowNumber, 1).Value2) = keyName Then
            Dim storedValue As Variant
            storedValue = ws.Cells(rowNumber, 2).Value2
            If keyName = "lastSaveAt" Or keyName = "sessionStartedAt" Then
                Mvp2MetaGet = Mvp2FormatDateTimeValue(storedValue, "yyyy-mm-dd hh:nn:ss")
            Else
                Mvp2MetaGet = CStr(storedValue)
            End If
            Exit Function
        End If
    Next rowNumber
    Mvp2MetaGet = defaultValue
End Function

Public Sub Mvp2MetaSet(ByVal keyName As String, ByVal value As Variant)
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_META_SHEET)
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
    Dim rowNumber As Long
    For rowNumber = 2 To lastRow
        If CStr(ws.Cells(rowNumber, 1).Value2) = keyName Then
            Mvp2WriteMetaCell ws.Cells(rowNumber, 2), value
            Exit Sub
        End If
    Next rowNumber
    rowNumber = lastRow + 1
    If rowNumber < 2 Then rowNumber = 2
    Mvp2WriteMetaCell ws.Cells(rowNumber, 1), keyName
    Mvp2WriteMetaCell ws.Cells(rowNumber, 2), value
End Sub

Private Sub Mvp2WriteMetaCell(ByVal target As Object, ByVal value As Variant)
    target.NumberFormat = "@"
    target.Value2 = CStr(value)
End Sub

Public Function Mvp2TryDateTime(ByVal storedValue As Variant, ByRef parsedValue As Date) As Boolean
    On Error GoTo NotDateTime
    If VarType(storedValue) = vbDate Then
        parsedValue = CDate(storedValue)
    ElseIf IsNumeric(storedValue) Then
        Dim serialValue As Double
        serialValue = CDbl(storedValue)
        If serialValue <= 0 Or serialValue >= 2958466# Then GoTo NotDateTime
        parsedValue = CDate(serialValue)
    Else
        Dim textValue As String
        textValue = Trim$(CStr(storedValue))
        If Len(textValue) >= 16 And Mid$(textValue, 5, 1) = "-" And Mid$(textValue, 8, 1) = "-" And _
           Mid$(textValue, 11, 1) = " " And Mid$(textValue, 14, 1) = ":" Then
            Dim secondValue As Long
            If Len(textValue) >= 19 And Mid$(textValue, 17, 1) = ":" Then secondValue = CLng(Mid$(textValue, 18, 2))
            parsedValue = DateSerial(CLng(Mid$(textValue, 1, 4)), CLng(Mid$(textValue, 6, 2)), CLng(Mid$(textValue, 9, 2))) + _
                          TimeSerial(CLng(Mid$(textValue, 12, 2)), CLng(Mid$(textValue, 15, 2)), secondValue)
        ElseIf IsDate(textValue) Then
            parsedValue = CDate(textValue)
        Else
            GoTo NotDateTime
        End If
    End If
    Mvp2TryDateTime = True
    Exit Function

NotDateTime:
    Mvp2TryDateTime = False
End Function

Public Function Mvp2FormatDateTimeValue(ByVal storedValue As Variant, ByVal outputFormat As String) As String
    Dim parsedValue As Date
    If Mvp2TryDateTime(storedValue, parsedValue) Then
        Mvp2FormatDateTimeValue = Format$(parsedValue, outputFormat)
    Else
        Mvp2FormatDateTimeValue = CStr(storedValue)
    End If
End Function

Public Sub Mvp2EnsureInternalSheets()
    Dim panel As Object
    Dim dataSheet As Object
    Dim metaSheet As Object
    Dim historySheet As Object
    Set panel = Mvp2GetOrCreateSheet(MVP2_PANEL_SHEET)
    Set dataSheet = Mvp2GetOrCreateSheet(MVP2_DATA_SHEET)
    Set metaSheet = Mvp2GetOrCreateSheet(MVP2_META_SHEET)
    Set historySheet = Mvp2GetOrCreateSheet(MVP2_HISTORY_SHEET)

    dataSheet.Cells.Clear
    dataSheet.Cells(1, 1).Value2 = "chunkIndex"
    dataSheet.Cells(1, 2).Value2 = "jsonText"
    metaSheet.Cells.Clear
    metaSheet.Cells(1, 1).Value2 = "key"
    metaSheet.Cells(1, 2).Value2 = "value"
    historySheet.Cells.Clear
    Dim headers As Variant
    headers = Array("revision", "savedAt", "authorName", "saveDataId", "saveKind", "acceptedFile", "state", "exportSequence", "sessionId")
    Dim headerIndex As Long
    For headerIndex = 0 To UBound(headers)
        historySheet.Cells(1, headerIndex + 1).Value2 = headers(headerIndex)
    Next headerIndex

    Mvp2MetaSet "databaseId", Mvp2NewId()
    Mvp2MetaSet "dataType", "generic-json"
    Mvp2MetaSet "schemaVersion", 1
    Mvp2MetaSet "revision", 0
    Mvp2MetaSet "chunkCount", 0
    Mvp2MetaSet "jsonLength", 0
    Mvp2MetaSet "crc32", ""
    Mvp2MetaSet "activeSessionId", ""
    Mvp2MetaSet "sessionRunId", ""
    Mvp2MetaSet "sessionStartedAt", ""
    Mvp2MetaSet "sessionBaseRevision", 0
    Mvp2MetaSet "lastImportSequence", 0
    Mvp2MetaSet "lastImportedSaveDataId", ""
    Mvp2MetaSet "sessionMarkerFile", ""
    Mvp2MetaSet "commitState", "NONE"
    Mvp2MetaSet "pendingFile", ""
    Mvp2MetaSet "preparedAcceptedFile", ""
    Mvp2MetaSet "preparedFileCrc", ""
    Mvp2MetaSet "preparedSaveKind", ""
    Mvp2MetaSet "preparedAuthorName", ""
    Mvp2MetaSet "preparedSaveDataId", ""
    Mvp2MetaSet "preparedRevision", 0
    Mvp2MetaSet "lastSaveAt", ""
    Mvp2MetaSet "lastSaveAuthor", ""
End Sub

Private Function Mvp2GetOrCreateSheet(ByVal sheetName As String) As Object
    On Error Resume Next
    Set Mvp2GetOrCreateSheet = ThisWorkbook.Worksheets(sheetName)
    On Error GoTo 0
    If Not Mvp2GetOrCreateSheet Is Nothing Then Exit Function
    Set Mvp2GetOrCreateSheet = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
    Mvp2GetOrCreateSheet.Name = sheetName
End Function

Public Sub Mvp2StoreCompactJson(ByVal compactJson As String)
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_DATA_SHEET)
    ws.Rows("2:" & ws.Rows.Count).ClearContents

    Dim position As Long
    Dim chunkIndex As Long
    Dim takeLength As Long
    position = 1
    chunkIndex = 1
    Do While position <= Len(compactJson)
        takeLength = MVP2_CHUNK_SIZE
        If position + takeLength - 1 > Len(compactJson) Then takeLength = Len(compactJson) - position + 1
        If takeLength > 0 And position + takeLength - 1 < Len(compactJson) Then
            Dim finalCode As Long
            finalCode = AscW(Mid$(compactJson, position + takeLength - 1, 1))
            If finalCode >= &HD800 And finalCode <= &HDBFF Then takeLength = takeLength - 1
        End If
        ws.Cells(chunkIndex + 1, 1).Value2 = chunkIndex
        ws.Cells(chunkIndex + 1, 2).Value2 = Mid$(compactJson, position, takeLength)
        position = position + takeLength
        chunkIndex = chunkIndex + 1
    Loop

    Mvp2MetaSet "chunkCount", chunkIndex - 1
    Mvp2MetaSet "jsonLength", Len(compactJson)
    Mvp2MetaSet "crc32", Mvp2Crc32Utf8(compactJson)
End Sub

Public Function Mvp2LoadCompactJson() As String
    Dim chunkCount As Long
    chunkCount = CLng(Val(Mvp2MetaGet("chunkCount", "0")))
    If chunkCount = 0 Then Exit Function

    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_DATA_SHEET)
    Dim chunks() As String
    ReDim chunks(0 To chunkCount - 1)
    Dim i As Long
    For i = 1 To chunkCount
        If CLng(Val(CStr(ws.Cells(i + 1, 1).Value2))) <> i Then Err.Raise vbObjectError + 2300, , "Excel内のJSON分割番号が壊れています。"
        chunks(i - 1) = CStr(ws.Cells(i + 1, 2).Value2)
    Next i
    Mvp2LoadCompactJson = Join(chunks, vbNullString)
    If Len(Mvp2LoadCompactJson) <> CLng(Val(Mvp2MetaGet("jsonLength", "-1"))) Then Err.Raise vbObjectError + 2301, , "Excel内のJSON文字数が一致しません。"
    If UCase$(Mvp2Crc32Utf8(Mvp2LoadCompactJson)) <> UCase$(Mvp2MetaGet("crc32")) Then Err.Raise vbObjectError + 2302, , "Excel内のJSON整合性を確認できません。"
End Function

Public Sub Mvp2StartActiveSession(ByVal sessionId As String)
    Dim markerFolder As String
    markerFolder = Mvp2ProjectPath(MVP2_SESSIONS_RELATIVE)
    Mvp2EnsureFolder markerFolder
    Dim markerFile As String
    markerFile = Mvp2JoinPath(markerFolder, sessionId & ".json")
    Dim startedAt As String
    startedAt = Format$(Now, "yyyy-mm-dd hh:nn:ss")
    Dim markerJson As String
    markerJson = "{""sessionId"":" & Mvp2JsonQuote(sessionId) & _
                 ",""workbookRunId"":" & Mvp2JsonQuote(gWorkbookRunId) & _
                 ",""startedAt"":" & Mvp2JsonQuote(startedAt) & _
                 ",""baseRevision"":" & CStr(CLng(Val(Mvp2MetaGet("revision", "0")))) & "}"
    Mvp2WriteUtf8File markerFile, markerJson

    Mvp2MetaSet "activeSessionId", sessionId
    Mvp2MetaSet "sessionRunId", gWorkbookRunId
    Mvp2MetaSet "sessionStartedAt", startedAt
    Mvp2MetaSet "sessionBaseRevision", CLng(Val(Mvp2MetaGet("revision", "0")))
    Mvp2MetaSet "lastImportSequence", 0
    Mvp2MetaSet "lastImportedSaveDataId", ""
    Mvp2MetaSet "sessionMarkerFile", markerFile
End Sub

Public Sub Mvp2ClearActiveSession(Optional ByVal deleteMarker As Boolean = True)
    If deleteMarker Then
        Dim markerFile As String
        markerFile = Mvp2MetaGet("sessionMarkerFile")
        If Len(markerFile) > 0 And Mvp2FileExists(markerFile) Then
            On Error Resume Next
            Kill markerFile
            On Error GoTo 0
        End If
    End If
    Mvp2MetaSet "activeSessionId", ""
    Mvp2MetaSet "sessionRunId", ""
    Mvp2MetaSet "sessionStartedAt", ""
    Mvp2MetaSet "sessionBaseRevision", 0
    Mvp2MetaSet "lastImportSequence", 0
    Mvp2MetaSet "lastImportedSaveDataId", ""
    Mvp2MetaSet "sessionMarkerFile", ""
End Sub

Public Sub Mvp2CommitImportedFile(ByVal sourceFile As String, ByVal compactJson As String, ByRef envelope As Mvp2Envelope)
    If ThisWorkbook.ReadOnly Then Err.Raise vbObjectError + 2310, , "このExcelは読み取り専用です。"
    Mvp2CheckFolderWritable Mvp2ProjectPath(MVP2_PENDING_RELATIVE)

    Dim pendingFile As String
    pendingFile = Mvp2JoinPath(Mvp2ProjectPath(MVP2_PENDING_RELATIVE), envelope.SaveDataId & ".json")
    Mvp2CopyRawVerified sourceFile, pendingFile

    Dim monthFolder As String
    monthFolder = Mvp2JoinPath(Mvp2ProjectPath(MVP2_ACCEPTED_RELATIVE), Format$(Now, "yyyy-mm"))
    Mvp2EnsureFolder monthFolder
    Mvp2CheckFolderWritable monthFolder

    Dim acceptedFile As String
    acceptedFile = Mvp2JoinPath(monthFolder, Mvp2BaseName(sourceFile))
    Dim fileCrc As String
    fileCrc = Mvp2Crc32File(pendingFile)
    If Mvp2FileExists(acceptedFile) Then
        If FileLen(acceptedFile) <> FileLen(pendingFile) Or UCase$(Mvp2Crc32File(acceptedFile)) <> UCase$(fileCrc) Then
            Err.Raise vbObjectError + 2311, , "同じ保存先に内容の異なるファイルがあります。上書きせず停止しました。"
        End If
    End If

    Dim nextRevision As Long
    nextRevision = CLng(Val(Mvp2MetaGet("revision", "0"))) + 1
    Mvp2StoreCompactJson compactJson
    Mvp2MetaSet "revision", nextRevision
    Mvp2MetaSet "lastImportSequence", envelope.ExportSequence
    Mvp2MetaSet "lastImportedSaveDataId", envelope.SaveDataId
    Mvp2MetaSet "commitState", "PREPARED"
    Mvp2MetaSet "pendingFile", pendingFile
    Mvp2MetaSet "preparedAcceptedFile", acceptedFile
    Mvp2MetaSet "preparedFileCrc", fileCrc
    Mvp2MetaSet "preparedSaveKind", envelope.SaveKind
    Mvp2MetaSet "preparedAuthorName", envelope.AuthorName
    Mvp2MetaSet "preparedSaveDataId", envelope.SaveDataId
    Mvp2MetaSet "preparedRevision", nextRevision
    Mvp2AppendPreparedHistory nextRevision, envelope, acceptedFile

    ThisWorkbook.Save
    Mvp2PublishPreparedFile
    Mvp2FinalizePreparedCommit
End Sub

Private Sub Mvp2AppendPreparedHistory(ByVal revision As Long, ByRef envelope As Mvp2Envelope, ByVal acceptedFile As String)
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_HISTORY_SHEET)
    Dim rowNumber As Long
    rowNumber = ws.Cells(ws.Rows.Count, 1).End(-4162).Row + 1
    ws.Cells(rowNumber, 1).Value2 = revision
    ws.Cells(rowNumber, 2).Value2 = ""
    ws.Cells(rowNumber, 3).Value2 = envelope.AuthorName
    ws.Cells(rowNumber, 4).Value2 = envelope.SaveDataId
    ws.Cells(rowNumber, 5).Value2 = envelope.SaveKind
    ws.Cells(rowNumber, 6).Value2 = acceptedFile
    ws.Cells(rowNumber, 7).Value2 = "PREPARED"
    ws.Cells(rowNumber, 8).Value2 = envelope.ExportSequence
    ws.Cells(rowNumber, 9).Value2 = envelope.SessionId
End Sub

Private Sub Mvp2PublishPreparedFile()
    Dim pendingFile As String
    Dim acceptedFile As String
    pendingFile = Mvp2MetaGet("pendingFile")
    acceptedFile = Mvp2MetaGet("preparedAcceptedFile")
    If Not Mvp2FileExists(pendingFile) Then Err.Raise vbObjectError + 2320, , "正式保存待ちの一時保存ファイルが見つかりません。"
    If UCase$(Mvp2Crc32File(pendingFile)) <> UCase$(Mvp2MetaGet("preparedFileCrc")) Then Err.Raise vbObjectError + 2321, , "正式保存待ちの一時保存ファイルが変化しています。"

    If Mvp2FileExists(acceptedFile) Then
        If FileLen(acceptedFile) = FileLen(pendingFile) And UCase$(Mvp2Crc32File(acceptedFile)) = UCase$(Mvp2MetaGet("preparedFileCrc")) Then Exit Sub
        Err.Raise vbObjectError + 2322, , "保存先に内容の異なるファイルがあります。"
    End If

    Dim temporaryFile As String
    temporaryFile = acceptedFile & ".tmp-" & Mvp2NewId()
    Mvp2CopyRawVerified pendingFile, temporaryFile
    Name temporaryFile As acceptedFile
End Sub

Private Sub Mvp2FinalizePreparedCommit()
    Dim revision As Long
    revision = CLng(Val(Mvp2MetaGet("preparedRevision", "0")))
    Dim saveDataId As String
    saveDataId = Mvp2MetaGet("preparedSaveDataId")
    Dim savedAt As Date
    savedAt = Now

    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_HISTORY_SHEET)
    Dim rowNumber As Long
    For rowNumber = ws.Cells(ws.Rows.Count, 1).End(-4162).Row To 2 Step -1
        If CLng(Val(CStr(ws.Cells(rowNumber, 1).Value2))) = revision And _
           CStr(ws.Cells(rowNumber, 4).Value2) = saveDataId Then
            ws.Cells(rowNumber, 2).Value = savedAt
            ws.Cells(rowNumber, 2).NumberFormat = "yyyy/mm/dd hh:mm:ss"
            ws.Cells(rowNumber, 7).Value2 = "SUCCESS"
            Exit For
        End If
    Next rowNumber
    If rowNumber < 2 Then Err.Raise vbObjectError + 2330, , "確定する正式保存ログが見つかりません。"

    Mvp2MetaSet "lastSaveAt", Format$(savedAt, "yyyy-mm-dd hh:nn:ss")
    Mvp2MetaSet "lastSaveAuthor", Mvp2MetaGet("preparedAuthorName")
    If Mvp2MetaGet("preparedSaveKind") = "complete" Then Mvp2ClearActiveSession True
    Mvp2MetaSet "commitState", "NONE"
    Dim pendingFile As String
    pendingFile = Mvp2MetaGet("pendingFile")
    Mvp2ClearPreparedMeta
    ThisWorkbook.Save

    If Len(pendingFile) > 0 And Mvp2FileExists(pendingFile) Then
        On Error Resume Next
        Kill pendingFile
        On Error GoTo 0
    End If
End Sub

Private Sub Mvp2ClearPreparedMeta()
    Mvp2MetaSet "pendingFile", ""
    Mvp2MetaSet "preparedAcceptedFile", ""
    Mvp2MetaSet "preparedFileCrc", ""
    Mvp2MetaSet "preparedSaveKind", ""
    Mvp2MetaSet "preparedAuthorName", ""
    Mvp2MetaSet "preparedSaveDataId", ""
    Mvp2MetaSet "preparedRevision", 0
End Sub

Public Sub Mvp2ResumePreparedCommit()
    If Mvp2MetaGet("commitState", "NONE") <> "PREPARED" Then Exit Sub
    On Error GoTo ResumeFailed
    Mvp2PublishPreparedFile
    Mvp2FinalizePreparedCommit
    RefreshOperationPanel
    MsgBox "前回中断したExcelへの正式保存を完了しました。", vbInformation, "MVP3"
    Exit Sub
ResumeFailed:
    MsgBox "Excelへの正式保存処理が途中で止まっています。" & vbCrLf & _
           "Excelを閉じず、共有フォルダへの接続を確認してから、もう一度お試しください。" & vbCrLf & vbCrLf & _
           Err.Description, vbExclamation, "MVP3"
End Sub

Public Sub Mvp2ArchiveRejected(ByVal sourceFile As String, ByVal reason As String)
    On Error Resume Next
    Dim monthFolder As String
    monthFolder = Mvp2JoinPath(Mvp2ProjectPath(MVP2_REJECTED_RELATIVE), Format$(Now, "yyyy-mm"))
    Mvp2EnsureFolder monthFolder
    Dim rejectedFile As String
    rejectedFile = Mvp2JoinPath(monthFolder, Format$(Now, "yyyymmdd_hhnnss_") & Mvp2BaseName(sourceFile))
    Mvp2CopyRawVerified sourceFile, rejectedFile
    Mvp2WriteUtf8File rejectedFile & ".reason.txt", reason
    On Error GoTo 0
End Sub

Public Sub Mvp2CheckFolderWritable(ByVal folderPath As String)
    If Not Mvp2FolderExists(folderPath) Then Err.Raise vbObjectError + 2340, , "共有フォルダが見つかりません。"
    Dim probe As String
    probe = Mvp2JoinPath(folderPath, ".mvp2-write-test-" & Mvp2NewId() & ".tmp")
    Dim fileNumber As Integer
    fileNumber = FreeFile
    On Error GoTo NotWritable
    Open probe For Output As #fileNumber
    Print #fileNumber, "MVP3"
    Close #fileNumber
    Kill probe
    Exit Sub
NotWritable:
    On Error Resume Next
    Close #fileNumber
    If Mvp2FileExists(probe) Then Kill probe
    On Error GoTo 0
    Err.Raise vbObjectError + 2341, , "共有フォルダへ保存できません。接続または書き込み権限を確認してください。"
End Sub

Public Sub Mvp2CopyRawVerified(ByVal sourceFile As String, ByVal destinationFile As String)
    If Not Mvp2FileExists(sourceFile) Then Err.Raise vbObjectError + 2350, , "コピー元ファイルが見つかりません。"
    If Mvp2FileExists(destinationFile) Then
        If FileLen(sourceFile) = FileLen(destinationFile) And UCase$(Mvp2Crc32File(sourceFile)) = UCase$(Mvp2Crc32File(destinationFile)) Then Exit Sub
        Err.Raise vbObjectError + 2351, , "コピー先に内容の異なるファイルがあります。"
    End If
    FileCopy sourceFile, destinationFile
    If FileLen(sourceFile) <> FileLen(destinationFile) Or UCase$(Mvp2Crc32File(sourceFile)) <> UCase$(Mvp2Crc32File(destinationFile)) Then
        On Error Resume Next
        Kill destinationFile
        On Error GoTo 0
        Err.Raise vbObjectError + 2352, , "ファイルのコピー結果を確認できませんでした。"
    End If
End Sub

Public Function Mvp2BaseName(ByVal filePath As String) As String
    Dim slashPosition As Long
    slashPosition = InStrRev(filePath, "\")
    If InStrRev(filePath, "/") > slashPosition Then slashPosition = InStrRev(filePath, "/")
    Mvp2BaseName = Mid$(filePath, slashPosition + 1)
End Function

Public Function Mvp2HistoryJson() As String
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_HISTORY_SHEET)
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
    Dim items() As String
    Dim maximumIndex As Long
    maximumIndex = lastRow - 2
    If maximumIndex < 0 Then maximumIndex = 0
    ReDim items(0 To maximumIndex)
    Dim count As Long
    Dim rowNumber As Long
    For rowNumber = lastRow To 2 Step -1
        If CStr(ws.Cells(rowNumber, 7).Value2) = "SUCCESS" Then
            Dim label As String
            If CStr(ws.Cells(rowNumber, 5).Value2) = "complete" Then
                label = "作業終了後に正式保存"
            Else
                label = "作業途中で正式保存"
            End If
            items(count) = "{""revision"":" & CStr(CLng(Val(CStr(ws.Cells(rowNumber, 1).Value2)))) & _
                           ",""savedAt"":" & Mvp2JsonQuote(Format$(ws.Cells(rowNumber, 2).Value, "yyyy/mm/dd hh:nn:ss")) & _
                           ",""authorName"":" & Mvp2JsonQuote(CStr(ws.Cells(rowNumber, 3).Value2)) & _
                           ",""label"":" & Mvp2JsonQuote(label) & "}"
            count = count + 1
        End If
    Next rowNumber
    If count = 0 Then
        Mvp2HistoryJson = "[]"
    Else
        ReDim Preserve items(0 To count - 1)
        Mvp2HistoryJson = "[" & Join(items, ",") & "]"
    End If
End Function
