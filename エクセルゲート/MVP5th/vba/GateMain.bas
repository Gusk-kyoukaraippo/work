Attribute VB_Name = "GateMain"
Option Explicit

Public Sub OpenGateHelp()
    On Error GoTo OpenFailed
    Dim guideFile As String
    guideFile = GateProjectPath(GATE_HELP_RELATIVE)
    ' Mac版ExcelのDir関数は日本語ファイル名を存在しないと誤判定する場合があるため、
    ' POSIXパスはブラウザへ直接渡す。Windowsでは従来どおり存在確認する。
    If Left$(guideFile, 1) <> "/" Then
        If Not GateFileExists(guideFile) Then Err.Raise vbObjectError + 2490, , "使い方が見つかりません。"
    End If
    GateOpenLocalFile guideFile
    Exit Sub
OpenFailed:
    MsgBox "使い方を開けませんでした。" & vbCrLf & vbCrLf & _
           Err.Description, vbExclamation, "Excelゲート MVP5"
End Sub

Public Sub OpenReadOnlyHtml()
    On Error GoTo OpenFailed
    GateAssertCanonical
    If GateAppConfig("viewPolicy") <> "view" Then Err.Raise vbObjectError + 2491, , "この配布版は閲覧に対応していません。"
    Dim payloadRaw As String
    payloadRaw = GateCurrentPayloadRaw(False)
    Dim contextJson As String
    contextJson = GateBuildAppContext("view", "", payloadRaw)
    Dim htmlFile As String
    htmlFile = GateCreateRuntimeHtml(contextJson, "view")
    GateOpenLocalFile htmlFile
    Exit Sub
OpenFailed:
    MsgBox "閲覧画面を開けませんでした。" & vbCrLf & _
           "Excel内のデータに問題がある場合は、acceptedに残したJSONからの復旧を管理担当へ依頼してください。" & vbCrLf & vbCrLf & _
           Err.Description, vbExclamation, "Excelゲート MVP5"
End Sub

Public Sub OpenEditHtml()
    On Error GoTo OpenFailed
    RefreshOperationPanel
    GateAssertCanonical True
    If GateMetaGet("commitState", "NONE") = "PREPARED" Then Err.Raise vbObjectError + 2492, , "中断した正式保存を先に再開してください。"
    If ThisWorkbook.ReadOnly Then Err.Raise vbObjectError + 2500, , "このExcelは読み取り専用です。編集できる状態で開き直してください。"
    If Len(ThisWorkbook.Path) = 0 Then Err.Raise vbObjectError + 2501, , "Excelファイルの保存場所が決まっていません。"
    If Len(GateMetaGet("activeSessionId")) > 0 Then
        MsgBox "すでに編集作業が始まっています。" & vbCrLf & _
               "開いているHTMLを使用してください。" & vbCrLf & vbCrLf & _
               "HTMLを閉じてしまった場合は、Excelを保存せずに終了し、開き直してから編集してください。", _
               vbExclamation, "Excelゲート MVP5"
        Exit Sub
    End If

    GateEditPreflight
    Dim payloadRaw As String
    payloadRaw = GateCurrentPayloadRaw()
    If Len(gWorkbookRunId) = 0 Then gWorkbookRunId = GateNewId()
    Dim sessionId As String
    sessionId = GateNewId()
    Dim contextJson As String
    contextJson = GateBuildAppContext("edit", sessionId, payloadRaw)
    Dim htmlFile As String
    htmlFile = GateCreateRuntimeHtml(contextJson, sessionId)

    GateStartActiveSession sessionId
    GateSaveWorkbook "start-session"
    gCompletedSaveReady = False
    gCompletionNotified = False
    RefreshOperationPanel
    GateOpenLocalFile htmlFile
    Exit Sub

OpenFailed:
    Dim openError As String
    openError = Err.Description
    If Len(sessionId) > 0 And GateMetaGet("activeSessionId") = sessionId Then
        On Error Resume Next
        GateEndSessionPersisted
        RefreshOperationPanel
        On Error GoTo 0
    End If
    MsgBox "編集画面を開けませんでした。" & vbCrLf & vbCrLf & openError, vbExclamation, "Excelゲート MVP5"
End Sub

Public Sub SaveAndClose()
    GateSaveAction "complete"
End Sub

Public Sub SaveAndContinue()
    GateSaveAction "workCopy"
End Sub

' Compatibility entry point for old macro shortcuts. Never guesses the save kind.
Public Sub ImportSaveData()
    SaveAndClose
End Sub

Private Sub GateSaveAction(ByVal expectedKind As String)
    If gImportInProgress Then Exit Sub
    gImportInProgress = True
    On Error GoTo ImportFailed
    If Not GateSavePendingOutput(expectedKind) Then GoTo ImportDone
    RefreshOperationPanel
    If expectedKind = "complete" Then
        gImportInProgress = False
        GateCloseAfterSave
        Exit Sub
    Else
        MsgBox "途中の内容をブックに保存しました。" & vbCrLf & _
               "ブックを開いたまま、同じEdgeの画面で作業を続けられます。", vbInformation, "Excelゲート MVP5"
    End If
    GoTo ImportDone
ImportFailed:
    Dim errorText As String
    errorText = Err.Description
    RefreshOperationPanel
    If GateMetaGet("commitState", "NONE") = "PREPARED" Then
        MsgBox "保存が完了していません。ブックは閉じないでください。" & vbCrLf & _
               "接続を確認し、同じ保存ボタンで再試行できます。" & vbCrLf & vbCrLf & _
               errorText, vbExclamation, "Excelゲート MVP5"
    Else
        MsgBox "保存できませんでした。" & vbCrLf & vbCrLf & errorText, vbExclamation, "Excelゲート MVP5"
    End If
ImportDone:
    gImportInProgress = False
End Sub

' Returns True only when the requested operation has durably committed.
' No success message or workbook close belongs to this shared save operation.
Public Function GateSavePendingOutput(ByVal expectedKind As String, Optional ByVal selectedFile As String = "") As Boolean
    Dim sourceFile As String, compactJson As String, downloadsFolder As String
    Dim identityMatched As Boolean, validationComplete As Boolean
    Dim envelope As GateEnvelope
    On Error GoTo SaveFailed
    GateAssertCanonical True
    GateRequireSaveKind expectedKind, expectedKind
    If GateMetaGet("commitState", "NONE") = "PREPARED" Then
        GateRequireSaveKind GateMetaGet("preparedSaveKind"), expectedKind
        GateResumePreparedCommit False
        If expectedKind = "complete" Then gCompletedSaveReady = True
        GateSavePendingOutput = True
        Exit Function
    End If
    ' A close failure must not re-import the already committed final output.
    If expectedKind = "complete" And gCompletedSaveReady And Len(GateMetaGet("activeSessionId")) = 0 Then
        GateSavePendingOutput = True
        Exit Function
    End If
    If Len(GateMetaGet("activeSessionId")) = 0 Then Err.Raise vbObjectError + 2510, , "先に「編集する」から作業を始めてください。"
    If GateMetaGet("sessionRunId") <> gWorkbookRunId Then Err.Raise vbObjectError + 2511, , "前回の編集作業は保存できません。共有ブックから開き直してください。"
    downloadsFolder = GateDownloadsFolder()
    sourceFile = GateSelectSaveFile(downloadsFolder, selectedFile)
    If Len(sourceFile) = 0 Then Exit Function
    GateValidateCandidateFile sourceFile, envelope, compactJson, identityMatched
    GateValidateSelectedSequence sourceFile, envelope, downloadsFolder
    validationComplete = True
    GateRequireSaveKind envelope.SaveKind, expectedKind
    GateCommitImportedFile sourceFile, compactJson, envelope
    If expectedKind = "complete" Then gCompletedSaveReady = True
    GateSavePendingOutput = True
    Exit Function
SaveFailed:
    Dim failureNumber As Long, failureText As String
    failureNumber = Err.Number
    failureText = Err.Description
    If identityMatched And Not validationComplete And Len(sourceFile) > 0 Then GateArchiveRejected sourceFile, failureText
    Err.Raise failureNumber, "GateSavePendingOutput", failureText
End Function

Private Function GateSelectSaveFile(ByVal downloadsFolder As String, ByVal selectedFile As String) As String
    Dim problem As String, candidate As String
    candidate = GateFindBestDownloadCandidate(downloadsFolder, problem)
    If Len(problem) > 0 Then Err.Raise vbObjectError + 2512, , problem
    If Len(selectedFile) > 0 Then
        If Len(candidate) > 0 Then
            If UCase$(GateCrc32File(candidate)) <> UCase$(GateCrc32File(selectedFile)) Then Err.Raise vbObjectError + 2513, , "今回の最新ファイルと一致しません。Edgeで最後に出力したファイルを確認してください。"
        End If
        GateSelectSaveFile = selectedFile
    ElseIf Len(candidate) > 0 Then
        GateSelectSaveFile = candidate
    Else
        If MsgBox("今回の保存用ファイルがまだ見つかりません。" & vbCrLf & _
                  "Edgeのダウンロード完了を確認してください。別の場所に保存した場合は、ファイルを選べます。" & vbCrLf & vbCrLf & _
                  "ファイルを選びますか？", vbYesNo + vbDefaultButton2, "Excelゲート MVP5") = vbYes Then
            GateSelectSaveFile = GateChooseJsonFile(downloadsFolder)
        End If
    End If
End Function

Public Sub GateRequireSaveKind(ByVal actualKind As String, ByVal expectedKind As String)
    If expectedKind <> "complete" And expectedKind <> "workCopy" Then Err.Raise vbObjectError + 2514, , "保存操作が不正です。"
    If actualKind = expectedKind Then Exit Sub
    If actualKind = "workCopy" Then
        Err.Raise vbObjectError + 2515, , "これは途中保存の準備です。「保存して続ける」を押してください。終了する場合は、先にEdgeで「入力を終える」を押してください。"
    ElseIf actualKind = "complete" Then
        Err.Raise vbObjectError + 2516, , "入力を終えたデータです。「保存して終了」を押してください。"
    Else
        Err.Raise vbObjectError + 2517, , "保存方法を確認できません。"
    End If
End Sub

Private Sub GateCloseAfterSave()
    On Error GoTo CloseFailed
    If Not gCompletedSaveReady Or Len(GateMetaGet("activeSessionId")) > 0 Or GateMetaGet("commitState", "NONE") <> "NONE" Then Err.Raise vbObjectError + 2518, , "保存完了を確認できません。"
    If Not gCompletionNotified Then
        MsgBox "ブックに保存しました。このブックを閉じます。" & vbCrLf & _
               "残っているEdgeの作業タブも閉じてください。", vbInformation, "Excelゲート MVP5"
        gCompletionNotified = True
    End If
    GateTestFault "close"
    gClosingApproved = True
    ThisWorkbook.Close SaveChanges:=False
    ' If another close handler cancelled closing, allow the same button to retry.
    gClosingApproved = False
    Exit Sub
CloseFailed:
    gClosingApproved = False
    MsgBox "保存は完了しましたが、ブックを閉じられませんでした。" & vbCrLf & _
           "「保存して終了」をもう一度押すと、保存を重複させずに終了を再試行します。" & vbCrLf & vbCrLf & _
           Err.Description, vbExclamation, "Excelゲート MVP5"
End Sub

Public Sub OpenSaveHistory()
    On Error GoTo OpenFailed
    RefreshOperationPanel
    Dim templatePath As String
    templatePath = GateProjectPath(GATE_HISTORY_TEMPLATE_RELATIVE)
    If Not GateFileExists(templatePath) Then Err.Raise vbObjectError + 2520, , "保存ログチェック画面のテンプレートが見つかりません。"
    Dim htmlText As String
    htmlText = GateReadUtf8File(templatePath)
    htmlText = Replace(htmlText, "__HISTORY_JSON__", Replace(GateHistoryJson(), "</", "<\/"), 1, 1, vbBinaryCompare)
    Dim runtimeFolder As String
    runtimeFolder = GateRuntimeFolder("history-" & GateNewId())
    Dim htmlFile As String
    htmlFile = GateJoinPath(runtimeFolder, "history.html")
    GateWriteUtf8File htmlFile, htmlText
    GateOpenLocalFile htmlFile
    Exit Sub
OpenFailed:
    MsgBox "保存ログチェックを開けませんでした。" & vbCrLf & vbCrLf & Err.Description, vbExclamation, "Excelゲート MVP5"
End Sub

Public Sub ExitWorkbook()
    gClosingApproved = False
    ThisWorkbook.Close
End Sub

Private Sub GateEditPreflight()
    GateValidateDeployment
    If Not GateFileExists(GateProjectPath(GATE_CORE_RELATIVE)) Then Err.Raise vbObjectError + 2531, , "HTMLの共通処理ファイルが見つかりません。"
    If Not GateFolderExists(GateProjectPath(GATE_PENDING_RELATIVE)) Then Err.Raise vbObjectError + 2532, , "共有フォルダへ接続できません。"
    GateCheckFolderWritable GateProjectPath(GATE_PENDING_RELATIVE)
End Sub

Private Function GateCurrentPayloadRaw(Optional ByVal validateAgain As Boolean = True) As String
    Dim compactJson As String
    compactJson = GateLoadCompactJson()
    If Len(compactJson) = 0 Then
        GateCurrentPayloadRaw = "{}"
    Else
        If validateAgain Then compactJson = GateValidateAndMinifyJson(compactJson)
        GateCurrentPayloadRaw = GateJsonTopLevelRaw(compactJson, "payload")
    End If
End Function

Private Function GateBuildAppContext(ByVal modeName As String, ByVal sessionId As String, ByVal payloadRaw As String) As String
    Dim contextJson As String
    contextJson = "{"
    contextJson = contextJson & """mode"":" & GateJsonQuote(modeName)
    contextJson = contextJson & ",""readOnly"":" & IIf(modeName = "view", "true", "false")
    contextJson = contextJson & ",""databaseId"":" & GateJsonQuote(GateMetaGet("databaseId"))
    contextJson = contextJson & ",""dataType"":" & GateJsonQuote(GateMetaGet("dataType"))
    contextJson = contextJson & ",""schemaVersion"":" & CStr(CLng(Val(GateMetaGet("schemaVersion", "1"))))
    contextJson = contextJson & ",""baseRevision"":" & CStr(CLng(Val(GateMetaGet("revision", "0"))))
    contextJson = contextJson & ",""sessionId"":" & GateJsonQuote(sessionId)
    contextJson = contextJson & ",""runtimeVersion"":" & GateJsonQuote(GATE_RUNTIME_VERSION)
    contextJson = contextJson & ",""displayName"":" & GateJsonQuote(GateAppConfig("displayName"))
    contextJson = contextJson & ",""authorRequired"":" & IIf(GateAuthorRequired(), "true", "false")
    contextJson = contextJson & ",""hasPayload"":" & IIf(CLng(GateMetaGet("chunkCount", "0")) > 0, "true", "false")
    contextJson = contextJson & ",""payload"":" & payloadRaw & "}"
    GateBuildAppContext = contextJson
End Function

Private Function GateCreateRuntimeHtml(ByVal contextJson As String, ByVal folderName As String) As String
    GateCreateRuntimeHtml = GateCreateRuntime(contextJson, folderName)
End Function

Private Function GateRuntimeFolder(ByVal childName As String) As String
    Dim tempRoot As String
    tempRoot = Environ$("TEMP")
    If Len(tempRoot) = 0 Then tempRoot = Environ$("TMPDIR")
    If Len(tempRoot) = 0 Then tempRoot = ThisWorkbook.Path
    Dim rootFolder As String
    rootFolder = GateJoinPath(tempRoot, "MVP5th")
    GateEnsureFolder rootFolder
    GateRuntimeFolder = GateJoinPath(rootFolder, childName)
    GateEnsureFolder GateRuntimeFolder
End Function

Private Sub GateOpenLocalFile(ByVal filePath As String)
    If Left$(filePath, 1) = "/" Then
        ' Mac版ExcelではPOSIXパスをそのままFollowHyperlinkへ渡すと失敗するため、
        ' ローカルファイルURLへ変換して既定のブラウザで開く。
        ThisWorkbook.FollowHyperlink Address:="file://" & Replace(filePath, " ", "%20"), NewWindow:=True
        Exit Sub
    End If

    On Error GoTo HyperlinkFallback
    Dim shell As Object
    Set shell = CreateObject("WScript.Shell")
    shell.Run Chr$(34) & filePath & Chr$(34), 1, False
    Exit Sub
HyperlinkFallback:
    Err.Clear
    ThisWorkbook.FollowHyperlink Address:=filePath, NewWindow:=True
End Sub

Private Function GateDownloadsFolder() As String
    On Error Resume Next
    Dim shell As Object
    Dim folder As Object
    Set shell = CreateObject("Shell.Application")
    Set folder = shell.Namespace("shell:Downloads")
    If Not folder Is Nothing Then GateDownloadsFolder = folder.Self.Path
    On Error GoTo 0
    If Len(GateDownloadsFolder) = 0 And Len(Environ$("USERPROFILE")) > 0 Then GateDownloadsFolder = GateJoinPath(Environ$("USERPROFILE"), "Downloads")
    If Len(GateDownloadsFolder) = 0 And Len(Environ$("HOME")) > 0 Then GateDownloadsFolder = GateJoinPath(Environ$("HOME"), "Downloads")
    If Not GateFolderExists(GateDownloadsFolder) Then GateDownloadsFolder = ThisWorkbook.Path
End Function

Private Function GateFindBestDownloadCandidate(ByVal downloadsFolder As String, ByRef problemText As String) As String
    Dim candidates As New Collection
    Dim parentMap As Object
    Dim sequenceMap As Object
    Dim idMap As Object
    Set parentMap = CreateObject("Scripting.Dictionary")
    Set sequenceMap = CreateObject("Scripting.Dictionary")
    Set idMap = CreateObject("Scripting.Dictionary")

    Dim fileName As String
    fileName = Dir$(GateJoinPath(downloadsFolder, GATE_FILE_PREFIX & "*.json"), vbNormal Or vbReadOnly)
    Do While Len(fileName) > 0
        Dim filePath As String
        filePath = GateJoinPath(downloadsFolder, fileName)
        Dim item As Object
        Dim currentIdentity As Boolean
        Set item = GateCandidateMetadata(filePath, currentIdentity)
        If Not item Is Nothing Then
            If CLng(item("sequence")) > CLng(Val(GateMetaGet("lastImportSequence", "0"))) Then
                Dim parentKey As String
                parentKey = "P:" & CStr(item("parentId"))
                If parentMap.Exists(parentKey) Then
                    Dim existing As Object
                    Set existing = parentMap(parentKey)
                    If CStr(existing("saveDataId")) <> CStr(item("saveDataId")) Then
                        problemText = GateBranchMessage()
                        Exit Function
                    End If
                    If UCase$(CStr(existing("fileCrc"))) <> UCase$(CStr(item("fileCrc"))) Then
                        problemText = GateBranchMessage()
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
                        problemText = GateBranchMessage()
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
                        problemText = GateBranchMessage()
                        Exit Function
                    End If
                Else
                    idMap.Add idKey, item
                End If
            End If
        ElseIf currentIdentity Then
            problemText = "今回の保存用ファイルに不整合があります。古い候補へ戻して保存せず、ファイルを保全して管理者に確認してください。"
            Exit Function
        End If
        fileName = Dir$()
    Loop

    Dim expectedSequence As Long
    expectedSequence = CLng(Val(GateMetaGet("lastImportSequence", "0"))) + 1
    Dim expectedParent As String
    expectedParent = GateMetaGet("lastImportedSaveDataId")
    Dim best As Object
    Do While sequenceMap.Exists(CStr(expectedSequence))
        Set best = sequenceMap(CStr(expectedSequence))
        If CStr(best("parentId")) <> expectedParent Then
            problemText = "受け渡しファイルのつながりを確認できません。" & vbCrLf & _
                          "出力途中のファイルを含め、同じ編集作業のJSONがそろっているか確認してください。"
            Exit Function
        End If
        expectedParent = CStr(best("saveDataId"))
        expectedSequence = expectedSequence + 1
    Loop

    Dim candidate As Variant
    For Each candidate In candidates
        If CLng(candidate("sequence")) >= expectedSequence Then
            problemText = "受け渡しファイルの一部が見つかりません。" & vbCrLf & _
                          "出力途中のファイルを含め、同じ編集作業のJSONがそろっているか確認してください。"
            Exit Function
        End If
    Next candidate
    If Not best Is Nothing Then GateFindBestDownloadCandidate = CStr(best("path"))
End Function

Private Function GateCandidateMetadata(ByVal filePath As String, ByRef currentIdentity As Boolean) As Object
    On Error GoTo InvalidCandidate
    currentIdentity = False
    If LCase$(Right$(filePath, 5)) <> ".json" Then Exit Function
    If LCase$(Right$(filePath, 11)) = ".crdownload" Or LCase$(Right$(filePath, 5)) = ".part" Then Exit Function
    Dim compact As String
    compact = GateValidateAndMinifyJson(GateReadUtf8File(filePath))
    Dim databaseId As String
    Dim sessionId As String
    databaseId = GateJsonTopLevelString(compact, "databaseId")
    sessionId = GateJsonTopLevelString(compact, "sessionId")
    currentIdentity = (databaseId = GateMetaGet("databaseId") And sessionId = GateMetaGet("activeSessionId"))
    If Not currentIdentity Then Exit Function

    Dim envelope As GateEnvelope
    GateParseEnvelope compact, envelope
    GateValidateEnvelopeForCurrentSession envelope
    Dim result As Object
    Set result = CreateObject("Scripting.Dictionary")
    result.Add "path", filePath
    result.Add "sequence", envelope.ExportSequence
    result.Add "saveDataId", envelope.SaveDataId
    result.Add "parentId", envelope.ParentSaveDataId
    result.Add "fileCrc", GateCrc32File(filePath)
    Set GateCandidateMetadata = result
    Exit Function
InvalidCandidate:
    Set GateCandidateMetadata = Nothing
End Function

Private Sub GateValidateCandidateFile(ByVal filePath As String, ByRef envelope As GateEnvelope, ByRef compactJson As String, ByRef identityMatched As Boolean)
    If Not GateFileExists(filePath) Then Err.Raise vbObjectError + 2550, , "選んだファイルが見つかりません。"
    If LCase$(Right$(filePath, 5)) <> ".json" Then Err.Raise vbObjectError + 2551, , "JSONファイルを選んでください。"
    compactJson = GateValidateAndMinifyJson(GateReadUtf8File(filePath))

    Dim formatVersion As Long
    Dim databaseId As String
    Dim dataType As String
    Dim sessionId As String
    formatVersion = GateJsonTopLevelLong(compactJson, "formatVersion")
    databaseId = GateJsonTopLevelString(compactJson, "databaseId")
    dataType = GateJsonTopLevelString(compactJson, "dataType")
    sessionId = GateJsonTopLevelString(compactJson, "sessionId")
    identityMatched = (formatVersion = GATE_FORMAT_VERSION And _
                       databaseId = GateMetaGet("databaseId") And _
                       dataType = GateMetaGet("dataType") And _
                       sessionId = GateMetaGet("activeSessionId"))
    If Not identityMatched Then Err.Raise vbObjectError + 2552, , "この作業で作った受け渡しファイルではありません。"

    GateParseEnvelope compactJson, envelope
    GateValidateEnvelopeForCurrentSession envelope
End Sub

Public Sub GateValidateEnvelopeForCurrentSession(ByRef envelope As GateEnvelope)
    If Len(GateMetaGet("activeSessionId")) = 0 Then Err.Raise vbObjectError + 2559, , "有効な編集セッションがありません。"
    If envelope.DatabaseId <> GateMetaGet("databaseId") Then Err.Raise vbObjectError + 2560, , "別のExcel用の受け渡しファイルです。"
    If envelope.DataType <> GateMetaGet("dataType") Then Err.Raise vbObjectError + 2561, , "データの種類が一致しません。"
    If envelope.SchemaVersion <> CLng(Val(GateMetaGet("schemaVersion", "1"))) Then Err.Raise vbObjectError + 2562, , "データ形式の版が一致しません。"
    If envelope.SessionId <> GateMetaGet("activeSessionId") Then Err.Raise vbObjectError + 2563, , "前回または別の編集作業で作ったデータです。"
    If envelope.BaseRevision <> CLng(Val(GateMetaGet("sessionBaseRevision", "0"))) Then Err.Raise vbObjectError + 2564, , "編集開始時のデータ版が一致しません。"
End Sub

Private Sub GateValidateSelectedSequence(ByVal sourceFile As String, ByRef envelope As GateEnvelope, ByVal downloadsFolder As String)
    Dim lastSequence As Long
    lastSequence = CLng(Val(GateMetaGet("lastImportSequence", "0")))
    If envelope.ExportSequence <= lastSequence Then
        If envelope.SaveDataId = GateMetaGet("lastImportedSaveDataId") Or envelope.ExportSequence = lastSequence Then
            Err.Raise vbObjectError + 2570, , "この受け渡しファイルはすでにExcelへ正式保存されています。"
        End If
        Err.Raise vbObjectError + 2571, , "新しい受け渡しファイルを選んでください。"
    End If

    If envelope.ExportSequence = lastSequence + 1 Then
        If envelope.ParentSaveDataId <> GateMetaGet("lastImportedSaveDataId") Then Err.Raise vbObjectError + 2572, , GateBranchMessage()
        Exit Sub
    End If

    Dim problemText As String
    Dim bestPath As String
    bestPath = GateFindBestDownloadCandidate(downloadsFolder, problemText)
    If Len(problemText) > 0 Then Err.Raise vbObjectError + 2573, , problemText
    If Len(bestPath) = 0 Or UCase$(GateCrc32File(bestPath)) <> UCase$(GateCrc32File(sourceFile)) Then
        Err.Raise vbObjectError + 2574, , "受け渡しファイルのつながりを確認できません。出力途中のファイルを含め、同じ編集作業のJSONがそろっているか確認してください。"
    End If
End Sub

Private Function GateBranchMessage() As String
    GateBranchMessage = "編集画面が複数に分かれています。" & vbCrLf & _
                        "どちらが正しい内容かExcelでは判断できません。" & vbCrLf & vbCrLf & _
                        "ブックと作業画面を閉じず、保存用ファイルを残して、" & vbCrLf & _
                        "どの入力を残すか管理者に確認してください。"
End Function

Private Function GateChooseJsonFile(ByVal initialFolder As String) As String
    On Error GoTo GetOpenFilenameFallback
    Dim dialog As Object
    Set dialog = Application.FileDialog(3)
    dialog.AllowMultiSelect = False
    dialog.Title = "HTMLから作った受け渡しファイルを選んでください"
    dialog.Filters.Clear
    dialog.Filters.Add "Excelゲートの受け渡しファイル", GATE_FILE_PREFIX & "*.json"
    dialog.InitialFileName = GateJoinPath(initialFolder, GATE_FILE_PREFIX)
    If dialog.Show = -1 Then GateChooseJsonFile = CStr(dialog.SelectedItems(1))
    Exit Function

GetOpenFilenameFallback:
    On Error GoTo PickerFailed
    Dim originalFolder As String
    originalFolder = CurDir$
    ChDir initialFolder
    Dim selected As Variant
    selected = Application.GetOpenFilename("受け渡しファイル (*.json)," & GATE_FILE_PREFIX & "*.json", , "HTMLから作った受け渡しファイルを選んでください")
    ChDir originalFolder
    If VarType(selected) <> vbBoolean Then GateChooseJsonFile = CStr(selected)
    Exit Function
PickerFailed:
    On Error Resume Next
    If Len(originalFolder) > 0 Then ChDir originalFolder
    On Error GoTo 0
    Err.Raise vbObjectError + 2580, , "ファイル選択画面を開けませんでした。"
End Function
