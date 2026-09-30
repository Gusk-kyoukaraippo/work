Attribute VB_Name = "Mvp2Main"
Option Explicit

Public Sub OpenReadOnlyHtml()
    On Error GoTo OpenFailed
    RefreshOperationPanel
    Dim payloadRaw As String
    payloadRaw = Mvp2CurrentPayloadRaw()
    Dim contextJson As String
    contextJson = Mvp2BuildAppContext("view", "", payloadRaw)
    Dim htmlFile As String
    htmlFile = Mvp2CreateRuntimeHtml(contextJson, "view")
    Mvp2OpenLocalFile htmlFile
    Exit Sub
OpenFailed:
    MsgBox "閲覧画面を開けませんでした。" & vbCrLf & _
           "Excel内のデータに問題がある場合は、acceptedに残したJSONからの復旧を管理担当へ依頼してください。" & vbCrLf & vbCrLf & _
           Err.Description, vbExclamation, "MVP2"
End Sub

Public Sub OpenEditHtml()
    On Error GoTo OpenFailed
    RefreshOperationPanel
    If ThisWorkbook.ReadOnly Then Err.Raise vbObjectError + 2500, , "このExcelは読み取り専用です。編集できる状態で開き直してください。"
    If Len(ThisWorkbook.Path) = 0 Then Err.Raise vbObjectError + 2501, , "Excelファイルの保存場所が決まっていません。"
    If Len(Mvp2MetaGet("activeSessionId")) > 0 Then
        MsgBox "すでに編集作業が始まっています。" & vbCrLf & _
               "開いているHTMLを使用してください。" & vbCrLf & vbCrLf & _
               "HTMLを閉じてしまった場合は、Excelを保存せずに終了し、開き直してから編集してください。", _
               vbExclamation, "MVP2"
        Exit Sub
    End If

    Mvp2EditPreflight
    Dim payloadRaw As String
    payloadRaw = Mvp2CurrentPayloadRaw()
    If Len(gWorkbookRunId) = 0 Then gWorkbookRunId = Mvp2NewId()
    Dim sessionId As String
    sessionId = Mvp2NewId()
    Dim contextJson As String
    contextJson = Mvp2BuildAppContext("edit", sessionId, payloadRaw)
    Dim htmlFile As String
    htmlFile = Mvp2CreateRuntimeHtml(contextJson, sessionId)

    Mvp2StartActiveSession sessionId
    ThisWorkbook.Save
    RefreshOperationPanel
    Mvp2OpenLocalFile htmlFile
    Exit Sub

OpenFailed:
    If Len(sessionId) > 0 And Mvp2MetaGet("activeSessionId") = sessionId Then
        On Error Resume Next
        Mvp2ClearActiveSession True
        ThisWorkbook.Save
        RefreshOperationPanel
        On Error GoTo 0
    End If
    MsgBox "編集画面を開けませんでした。" & vbCrLf & vbCrLf & Err.Description, vbExclamation, "MVP2"
End Sub

Public Sub ImportSaveData()
    If gImportInProgress Then Exit Sub
    gImportInProgress = True
    Mvp2CancelTimer

    Dim sourceFile As String
    Dim identityMatched As Boolean
    Dim validationComplete As Boolean
    On Error GoTo ImportFailed
    RefreshOperationPanel
    If ThisWorkbook.ReadOnly Then Err.Raise vbObjectError + 2510, , "このExcelは読み取り専用です。"
    If Len(Mvp2MetaGet("activeSessionId")) = 0 Then
        MsgBox "保存する作業が始まっていません。" & vbCrLf & _
               "先に「編集する」からHTMLを開いてください。", vbInformation, "MVP2"
        GoTo ImportDone
    End If
    If Mvp2MetaGet("sessionRunId") <> gWorkbookRunId Then Err.Raise vbObjectError + 2511, , "前回のExcelで始めた作業は保存できません。Excelを開き直して、もう一度編集してください。"
    If Mvp2MetaGet("commitState", "NONE") = "PREPARED" Then
        Mvp2ResumePreparedCommit
        GoTo ImportDone
    End If
    Mvp2CheckFolderWritable Mvp2ProjectPath(MVP2_PENDING_RELATIVE)

    Dim downloadsFolder As String
    downloadsFolder = Mvp2DownloadsFolder()
    Dim candidateProblem As String
    sourceFile = Mvp2FindBestDownloadCandidate(downloadsFolder, candidateProblem)
    If Len(candidateProblem) > 0 Then Err.Raise vbObjectError + 2512, , candidateProblem

    If Len(sourceFile) > 0 Then
        Dim previewEnvelope As Mvp2Envelope
        Dim previewCompact As String
        Mvp2ValidateCandidateFile sourceFile, previewEnvelope, previewCompact, identityMatched
        Dim label As String
        label = IIf(previewEnvelope.SaveKind = "complete", "作業を終えて作ったデータ", "作業中にPCへ保存したデータ")
        If MsgBox("次のセーブデータが見つかりました。" & vbCrLf & vbCrLf & _
                  "保存者：" & previewEnvelope.AuthorName & "さん" & vbCrLf & _
                  "出力日時：" & previewEnvelope.ExportedAt & vbCrLf & _
                  "内容　　：" & label & vbCrLf & _
                  "ファイル：" & Mvp2BaseName(sourceFile) & vbCrLf & vbCrLf & _
                  "このデータをExcelに保存しますか？", _
                  vbQuestion + vbYesNo + vbDefaultButton1, "MVP2") <> vbYes Then
            sourceFile = vbNullString
        End If
    End If

    If Len(sourceFile) = 0 Then sourceFile = Mvp2ChooseJsonFile(downloadsFolder)
    If Len(sourceFile) = 0 Then GoTo ImportDone

    Dim envelope As Mvp2Envelope
    Dim compactJson As String
    identityMatched = False
    Mvp2ValidateCandidateFile sourceFile, envelope, compactJson, identityMatched
    Mvp2ValidateSelectedSequence sourceFile, envelope, downloadsFolder
    validationComplete = True

    Mvp2CommitImportedFile sourceFile, compactJson, envelope
    RefreshOperationPanel
    If envelope.SaveKind = "complete" Then
        MsgBox "今回の作業内容をExcelに保存しました。" & vbCrLf & _
               "保存は完了しています。", vbInformation, "MVP2"
    Else
        MsgBox "この時点の内容をExcelに保存しました。" & vbCrLf & _
               "HTMLで始めた作業は、まだ終了していません。", vbInformation, "MVP2"
    End If
    GoTo ImportDone

ImportFailed:
    Dim errorText As String
    errorText = Err.Description
    If identityMatched And Not validationComplete And Len(sourceFile) > 0 Then Mvp2ArchiveRejected sourceFile, errorText
    RefreshOperationPanel
    If Mvp2MetaGet("commitState", "NONE") = "PREPARED" Then
        MsgBox "Excelへの保存処理が途中で止まりました。" & vbCrLf & _
               "成功した保存としてはまだ表示していません。" & vbCrLf & _
               "共有フォルダへの接続を確認し、Excelを閉じずにもう一度保存ボタンを押してください。" & vbCrLf & vbCrLf & _
               errorText, vbExclamation, "MVP2"
    Else
        MsgBox "セーブデータをExcelへ保存できませんでした。" & vbCrLf & vbCrLf & errorText, vbExclamation, "MVP2"
    End If

ImportDone:
    gImportInProgress = False
    Mvp2ScheduleTimer
End Sub

Public Sub OpenSaveHistory()
    On Error GoTo OpenFailed
    RefreshOperationPanel
    Dim templatePath As String
    templatePath = Mvp2ProjectPath(MVP2_HISTORY_TEMPLATE_RELATIVE)
    If Not Mvp2FileExists(templatePath) Then Err.Raise vbObjectError + 2520, , "履歴画面のテンプレートが見つかりません。"
    Dim htmlText As String
    htmlText = Mvp2ReadUtf8File(templatePath)
    htmlText = Replace(htmlText, "__HISTORY_JSON__", Replace(Mvp2HistoryJson(), "</", "<\/"), 1, 1, vbBinaryCompare)
    Dim runtimeFolder As String
    runtimeFolder = Mvp2RuntimeFolder("history-" & Mvp2NewId())
    Dim htmlFile As String
    htmlFile = Mvp2JoinPath(runtimeFolder, "history.html")
    Mvp2WriteUtf8File htmlFile, htmlText
    Mvp2OpenLocalFile htmlFile
    Exit Sub
OpenFailed:
    MsgBox "保存履歴を開けませんでした。" & vbCrLf & vbCrLf & Err.Description, vbExclamation, "MVP2"
End Sub

Public Sub ExitWorkbook()
    gClosingApproved = False
    ThisWorkbook.Close
End Sub

Private Sub Mvp2EditPreflight()
    If Not Mvp2FileExists(Mvp2ProjectPath(MVP2_TEMPLATE_RELATIVE)) Then Err.Raise vbObjectError + 2530, , "HTMLテンプレートが見つかりません。"
    If Not Mvp2FileExists(Mvp2ProjectPath(MVP2_CORE_RELATIVE)) Then Err.Raise vbObjectError + 2531, , "HTMLの共通処理ファイルが見つかりません。"
    If Not Mvp2FolderExists(Mvp2ProjectPath(MVP2_PENDING_RELATIVE)) Then Err.Raise vbObjectError + 2532, , "共有フォルダへ接続できません。"
    Mvp2CheckFolderWritable Mvp2ProjectPath(MVP2_PENDING_RELATIVE)
End Sub

Private Function Mvp2CurrentPayloadRaw() As String
    Dim compactJson As String
    compactJson = Mvp2LoadCompactJson()
    If Len(compactJson) = 0 Then
        Mvp2CurrentPayloadRaw = "{}"
    Else
        compactJson = Mvp2ValidateAndMinifyJson(compactJson)
        Mvp2CurrentPayloadRaw = Mvp2JsonTopLevelRaw(compactJson, "payload")
    End If
End Function

Private Function Mvp2BuildAppContext(ByVal modeName As String, ByVal sessionId As String, ByVal payloadRaw As String) As String
    Dim contextJson As String
    contextJson = "{"
    contextJson = contextJson & """mode"":" & Mvp2JsonQuote(modeName)
    contextJson = contextJson & ",""databaseId"":" & Mvp2JsonQuote(Mvp2MetaGet("databaseId"))
    contextJson = contextJson & ",""dataType"":" & Mvp2JsonQuote(Mvp2MetaGet("dataType"))
    contextJson = contextJson & ",""schemaVersion"":" & CStr(CLng(Val(Mvp2MetaGet("schemaVersion", "1"))))
    contextJson = contextJson & ",""baseRevision"":" & CStr(CLng(Val(Mvp2MetaGet("revision", "0"))))
    contextJson = contextJson & ",""sessionId"":" & Mvp2JsonQuote(sessionId)
    contextJson = contextJson & ",""payload"":" & payloadRaw & "}"
    Mvp2BuildAppContext = contextJson
End Function

Private Function Mvp2CreateRuntimeHtml(ByVal contextJson As String, ByVal folderName As String) As String
    Dim templatePath As String
    templatePath = Mvp2ProjectPath(MVP2_TEMPLATE_RELATIVE)
    If Not Mvp2FileExists(templatePath) Then Err.Raise vbObjectError + 2540, , "HTMLテンプレートが見つかりません。"
    Dim htmlText As String
    htmlText = Mvp2ReadUtf8File(templatePath)
    htmlText = Replace(htmlText, "__APP_CONTEXT_JSON__", Replace(contextJson, "</", "<\/"), 1, 1, vbBinaryCompare)

    Dim runtimeFolder As String
    runtimeFolder = Mvp2RuntimeFolder(folderName)
    Dim coreSource As String
    Dim coreDestination As String
    coreSource = Mvp2ProjectPath(MVP2_CORE_RELATIVE)
    coreDestination = Mvp2JoinPath(runtimeFolder, "mvp2-core.js")
    If Mvp2FileExists(coreDestination) Then Kill coreDestination
    FileCopy coreSource, coreDestination

    Mvp2CreateRuntimeHtml = Mvp2JoinPath(runtimeFolder, "app.html")
    Mvp2WriteUtf8File Mvp2CreateRuntimeHtml, htmlText
End Function

Private Function Mvp2RuntimeFolder(ByVal childName As String) As String
    Dim tempRoot As String
    tempRoot = Environ$("TEMP")
    If Len(tempRoot) = 0 Then tempRoot = Environ$("TMPDIR")
    If Len(tempRoot) = 0 Then tempRoot = ThisWorkbook.Path
    Dim rootFolder As String
    rootFolder = Mvp2JoinPath(tempRoot, "MVP2nd")
    Mvp2EnsureFolder rootFolder
    Mvp2RuntimeFolder = Mvp2JoinPath(rootFolder, childName)
    Mvp2EnsureFolder Mvp2RuntimeFolder
End Function

Private Sub Mvp2OpenLocalFile(ByVal filePath As String)
    On Error GoTo HyperlinkFallback
    Dim shell As Object
    Set shell = CreateObject("WScript.Shell")
    shell.Run Chr$(34) & filePath & Chr$(34), 1, False
    Exit Sub
HyperlinkFallback:
    Err.Clear
    ThisWorkbook.FollowHyperlink Address:=filePath, NewWindow:=True
End Sub

Private Function Mvp2DownloadsFolder() As String
    On Error Resume Next
    Dim shell As Object
    Dim folder As Object
    Set shell = CreateObject("Shell.Application")
    Set folder = shell.Namespace("shell:Downloads")
    If Not folder Is Nothing Then Mvp2DownloadsFolder = folder.Self.Path
    On Error GoTo 0
    If Len(Mvp2DownloadsFolder) = 0 And Len(Environ$("USERPROFILE")) > 0 Then Mvp2DownloadsFolder = Mvp2JoinPath(Environ$("USERPROFILE"), "Downloads")
    If Len(Mvp2DownloadsFolder) = 0 And Len(Environ$("HOME")) > 0 Then Mvp2DownloadsFolder = Mvp2JoinPath(Environ$("HOME"), "Downloads")
    If Not Mvp2FolderExists(Mvp2DownloadsFolder) Then Mvp2DownloadsFolder = ThisWorkbook.Path
End Function

Private Function Mvp2FindBestDownloadCandidate(ByVal downloadsFolder As String, ByRef problemText As String) As String
    Dim candidates As New Collection
    Dim parentMap As Object
    Dim sequenceMap As Object
    Dim idMap As Object
    Set parentMap = CreateObject("Scripting.Dictionary")
    Set sequenceMap = CreateObject("Scripting.Dictionary")
    Set idMap = CreateObject("Scripting.Dictionary")

    Dim fileName As String
    fileName = Dir$(Mvp2JoinPath(downloadsFolder, MVP2_FILE_PREFIX & "*.json"), vbNormal Or vbReadOnly)
    Do While Len(fileName) > 0
        Dim filePath As String
        filePath = Mvp2JoinPath(downloadsFolder, fileName)
        Dim item As Object
        Dim currentIdentity As Boolean
        Set item = Mvp2CandidateMetadata(filePath, currentIdentity)
        If Not item Is Nothing Then
            If CLng(item("sequence")) > CLng(Val(Mvp2MetaGet("lastImportSequence", "0"))) Then
                Dim parentKey As String
                parentKey = "P:" & CStr(item("parentId"))
                If parentMap.Exists(parentKey) Then
                    Dim existing As Object
                    Set existing = parentMap(parentKey)
                    If CStr(existing("saveDataId")) <> CStr(item("saveDataId")) Then
                        problemText = Mvp2BranchMessage()
                        Exit Function
                    End If
                    If UCase$(CStr(existing("fileCrc"))) <> UCase$(CStr(item("fileCrc"))) Then
                        problemText = Mvp2BranchMessage()
                        Exit Function
                    End If
                Else
                    parentMap.Add parentKey, item
                End If

                Dim sequenceKey As String
                sequenceKey = CStr(item("sequence"))
                If sequenceMap.Exists(sequenceKey) Then
                    Set existing = sequenceMap(sequenceKey)
                    If CStr(existing("saveDataId")) <> CStr(item("saveDataId")) Then
                        problemText = Mvp2BranchMessage()
                        Exit Function
                    End If
                Else
                    sequenceMap.Add sequenceKey, item
                    candidates.Add item
                End If

                Dim idKey As String
                idKey = CStr(item("saveDataId"))
                If idMap.Exists(idKey) Then
                    Set existing = idMap(idKey)
                    If CStr(existing("parentId")) <> CStr(item("parentId")) Or UCase$(CStr(existing("fileCrc"))) <> UCase$(CStr(item("fileCrc"))) Then
                        problemText = Mvp2BranchMessage()
                        Exit Function
                    End If
                Else
                    idMap.Add idKey, item
                End If
            End If
        ElseIf currentIdentity Then
            ' 詳細エラーは、利用者がファイルを明示的に選んだときに案内する。
        End If
        fileName = Dir$()
    Loop

    Dim expectedSequence As Long
    expectedSequence = CLng(Val(Mvp2MetaGet("lastImportSequence", "0"))) + 1
    Dim expectedParent As String
    expectedParent = Mvp2MetaGet("lastImportedSaveDataId")
    Dim best As Object
    Do While sequenceMap.Exists(CStr(expectedSequence))
        Set best = sequenceMap(CStr(expectedSequence))
        If CStr(best("parentId")) <> expectedParent Then
            problemText = "保存用データのつながりを確認できません。" & vbCrLf & _
                          "HTMLへ戻り、もう一度保存操作を行ってください。"
            Exit Function
        End If
        expectedParent = CStr(best("saveDataId"))
        expectedSequence = expectedSequence + 1
    Loop

    Dim candidate As Variant
    For Each candidate In candidates
        If CLng(candidate("sequence")) >= expectedSequence Then
            problemText = "保存用データの一部が見つかりません。" & vbCrLf & _
                          "HTMLへ戻り、もう一度保存操作を行ってください。"
            Exit Function
        End If
    Next candidate
    If Not best Is Nothing Then Mvp2FindBestDownloadCandidate = CStr(best("path"))
End Function

Private Function Mvp2CandidateMetadata(ByVal filePath As String, ByRef currentIdentity As Boolean) As Object
    On Error GoTo InvalidCandidate
    If LCase$(Right$(filePath, 5)) <> ".json" Then Exit Function
    If LCase$(Right$(filePath, 11)) = ".crdownload" Or LCase$(Right$(filePath, 5)) = ".part" Then Exit Function
    Dim compact As String
    compact = Mvp2ValidateAndMinifyJson(Mvp2ReadUtf8File(filePath))
    Dim databaseId As String
    Dim sessionId As String
    databaseId = Mvp2JsonTopLevelString(compact, "databaseId")
    sessionId = Mvp2JsonTopLevelString(compact, "sessionId")
    currentIdentity = (databaseId = Mvp2MetaGet("databaseId") And sessionId = Mvp2MetaGet("activeSessionId"))
    If Not currentIdentity Then Exit Function

    Dim envelope As Mvp2Envelope
    Mvp2ParseEnvelope compact, envelope
    Mvp2ValidateEnvelopeForCurrentSession envelope
    Dim result As Object
    Set result = CreateObject("Scripting.Dictionary")
    result.Add "path", filePath
    result.Add "sequence", envelope.ExportSequence
    result.Add "saveDataId", envelope.SaveDataId
    result.Add "parentId", envelope.ParentSaveDataId
    result.Add "fileCrc", Mvp2Crc32File(filePath)
    Set Mvp2CandidateMetadata = result
    Exit Function
InvalidCandidate:
    Set Mvp2CandidateMetadata = Nothing
End Function

Private Sub Mvp2ValidateCandidateFile(ByVal filePath As String, ByRef envelope As Mvp2Envelope, ByRef compactJson As String, ByRef identityMatched As Boolean)
    If Not Mvp2FileExists(filePath) Then Err.Raise vbObjectError + 2550, , "選んだファイルが見つかりません。"
    If LCase$(Right$(filePath, 5)) <> ".json" Then Err.Raise vbObjectError + 2551, , "JSONファイルを選んでください。"
    compactJson = Mvp2ValidateAndMinifyJson(Mvp2ReadUtf8File(filePath))

    Dim formatVersion As Long
    Dim databaseId As String
    Dim dataType As String
    Dim sessionId As String
    formatVersion = Mvp2JsonTopLevelLong(compactJson, "formatVersion")
    databaseId = Mvp2JsonTopLevelString(compactJson, "databaseId")
    dataType = Mvp2JsonTopLevelString(compactJson, "dataType")
    sessionId = Mvp2JsonTopLevelString(compactJson, "sessionId")
    identityMatched = (formatVersion = MVP2_FORMAT_VERSION And _
                       databaseId = Mvp2MetaGet("databaseId") And _
                       dataType = Mvp2MetaGet("dataType") And _
                       sessionId = Mvp2MetaGet("activeSessionId"))
    If Not identityMatched Then Err.Raise vbObjectError + 2552, , "この作業で作った保存用データではありません。"

    Mvp2ParseEnvelope compactJson, envelope
    Mvp2ValidateEnvelopeForCurrentSession envelope
End Sub

Private Sub Mvp2ValidateEnvelopeForCurrentSession(ByRef envelope As Mvp2Envelope)
    If envelope.DatabaseId <> Mvp2MetaGet("databaseId") Then Err.Raise vbObjectError + 2560, , "別のExcel用の保存データです。"
    If envelope.DataType <> Mvp2MetaGet("dataType") Then Err.Raise vbObjectError + 2561, , "データの種類が一致しません。"
    If envelope.SchemaVersion <> CLng(Val(Mvp2MetaGet("schemaVersion", "1"))) Then Err.Raise vbObjectError + 2562, , "データ形式の版が一致しません。"
    If envelope.SessionId <> Mvp2MetaGet("activeSessionId") Then Err.Raise vbObjectError + 2563, , "前回または別の編集作業で作ったデータです。"
    If envelope.BaseRevision <> CLng(Val(Mvp2MetaGet("sessionBaseRevision", "0"))) Then Err.Raise vbObjectError + 2564, , "編集開始時のデータ版が一致しません。"
End Sub

Private Sub Mvp2ValidateSelectedSequence(ByVal sourceFile As String, ByRef envelope As Mvp2Envelope, ByVal downloadsFolder As String)
    Dim lastSequence As Long
    lastSequence = CLng(Val(Mvp2MetaGet("lastImportSequence", "0")))
    If envelope.ExportSequence <= lastSequence Then
        If envelope.SaveDataId = Mvp2MetaGet("lastImportedSaveDataId") Or envelope.ExportSequence = lastSequence Then
            Err.Raise vbObjectError + 2570, , "このデータはすでにExcelへ保存されています。"
        End If
        Err.Raise vbObjectError + 2571, , "新しい保存用データを選んでください。"
    End If

    If envelope.ExportSequence = lastSequence + 1 Then
        If envelope.ParentSaveDataId <> Mvp2MetaGet("lastImportedSaveDataId") Then Err.Raise vbObjectError + 2572, , Mvp2BranchMessage()
        Exit Sub
    End If

    Dim problemText As String
    Dim bestPath As String
    bestPath = Mvp2FindBestDownloadCandidate(downloadsFolder, problemText)
    If Len(problemText) > 0 Then Err.Raise vbObjectError + 2573, , problemText
    If Len(bestPath) = 0 Or UCase$(Mvp2Crc32File(bestPath)) <> UCase$(Mvp2Crc32File(sourceFile)) Then
        Err.Raise vbObjectError + 2574, , "保存用データのつながりを確認できません。HTMLへ戻り、もう一度保存してください。"
    End If
End Sub

Private Function Mvp2BranchMessage() As String
    Mvp2BranchMessage = "編集画面が複数に分かれています。" & vbCrLf & _
                        "どちらが正しい内容かExcelでは判断できません。" & vbCrLf & vbCrLf & _
                        "開いているHTMLとExcelをすべて閉じて、" & vbCrLf & _
                        "Excelを開き直してから編集してください。"
End Function

Private Function Mvp2ChooseJsonFile(ByVal initialFolder As String) As String
    On Error GoTo GetOpenFilenameFallback
    Dim dialog As Object
    Set dialog = Application.FileDialog(3)
    dialog.AllowMultiSelect = False
    dialog.Title = "HTMLから作ったセーブデータを選んでください"
    dialog.Filters.Clear
    dialog.Filters.Add "MVP2 セーブデータ", "MVP2SAVE_*.json"
    dialog.InitialFileName = Mvp2JoinPath(initialFolder, MVP2_FILE_PREFIX)
    If dialog.Show = -1 Then Mvp2ChooseJsonFile = CStr(dialog.SelectedItems(1))
    Exit Function

GetOpenFilenameFallback:
    On Error GoTo PickerFailed
    Dim originalFolder As String
    originalFolder = CurDir$
    ChDir initialFolder
    Dim selected As Variant
    selected = Application.GetOpenFilename("JSONファイル (*.json),*.json", , "HTMLから作ったセーブデータを選んでください")
    ChDir originalFolder
    If VarType(selected) <> vbBoolean Then Mvp2ChooseJsonFile = CStr(selected)
    Exit Function
PickerFailed:
    On Error Resume Next
    If Len(originalFolder) > 0 Then ChDir originalFolder
    On Error GoTo 0
    Err.Raise vbObjectError + 2580, , "ファイル選択画面を開けませんでした。"
End Function
