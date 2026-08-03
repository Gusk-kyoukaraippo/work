Attribute VB_Name = "Mvp2Config"
Option Explicit

' このモジュールには、MVP2全体で共有する名前・上限・実行中の状態だけを置きます。
Public Const MVP2_PANEL_SHEET As String = "操作パネル"
Public Const MVP2_DATA_SHEET As String = "_APP_DATA"
Public Const MVP2_META_SHEET As String = "_APP_META"
Public Const MVP2_HISTORY_SHEET As String = "_APP_HISTORY"
Public Const MVP2_TEMPLATE_RELATIVE As String = "html/app.template.html"
Public Const MVP2_CORE_RELATIVE As String = "html/mvp2-core.js"
Public Const MVP2_HISTORY_TEMPLATE_RELATIVE As String = "html/history.template.html"
Public Const MVP2_PENDING_RELATIVE As String = "html/json/.pending"
Public Const MVP2_SESSIONS_RELATIVE As String = "html/json/.sessions"
Public Const MVP2_ACCEPTED_RELATIVE As String = "html/json/accepted"
Public Const MVP2_REJECTED_RELATIVE As String = "html/json/rejected"
Public Const MVP2_FILE_PREFIX As String = "DX推進委員会アプリ一時保存_"
Public Const MVP2_FORMAT_VERSION As Long = 2
Public Const MVP2_CHUNK_SIZE As Long = 20000
Public Const MVP2_MAX_UTF8_BYTES As Double = 10485760#
Public Const MVP2_MAX_CHARS As Long = 10485760
Public Const MVP2_MAX_DEPTH As Long = 64
Public Const MVP2_PROTECT_PASSWORD As String = "mvp2-panel-2026"

Public gWorkbookRunId As String
Public gNextTimerAt As Date
Public gTimerScheduled As Boolean
Public gTimerSupported As Boolean
Public gImportInProgress As Boolean
Public gClosingApproved As Boolean

Public Type Mvp2Envelope
    FormatVersion As Long
    SaveDataId As String
    ParentSaveDataId As String
    SessionId As String
    DatabaseId As String
    DataType As String
    SchemaVersion As Long
    BaseRevision As Long
    ExportSequence As Long
    AuthorName As String
    ExportedAt As String
    SaveKind As String
    ReadOnlyFlag As Boolean
    PayloadRaw As String
End Type

Public Sub Mvp2OnOpen()
    On Error GoTo OpenFailed
    Randomize
    gWorkbookRunId = Mvp2NewId()
    gTimerSupported = True
    gClosingApproved = False

    If Not Mvp2WorkbookIsInitialized() Then Exit Sub
    Mvp2ApplyProtection

    If Mvp2MetaGet("commitState", "NONE") = "PREPARED" Then
        If Not ThisWorkbook.ReadOnly Then Mvp2ResumePreparedCommit
    End If

    If Mvp2MetaGet("commitState", "NONE") <> "PREPARED" And _
       Len(Mvp2MetaGet("activeSessionId")) > 0 Then
        If Mvp2MetaGet("sessionRunId") <> gWorkbookRunId Then
            If Not ThisWorkbook.ReadOnly Then
                Mvp2ClearActiveSession True
                ThisWorkbook.Save
            End If
        End If
    End If

    RefreshOperationPanel
    Mvp2ScheduleTimer
    Exit Sub

OpenFailed:
    MsgBox "MVP3の起動確認で問題が見つかりました。" & vbCrLf & _
           "Excelを閉じて開き直してください。" & vbCrLf & vbCrLf & _
           Err.Description, vbExclamation, "MVP3"
End Sub

Public Sub Mvp2OnActivate()
    If Not Mvp2WorkbookIsInitialized() Then Exit Sub
    RefreshOperationPanel
    If Not gTimerScheduled Then Mvp2ScheduleTimer
End Sub

Public Sub Mvp2OnBeforeClose(ByRef Cancel As Boolean)
    On Error GoTo CloseFailed
    Mvp2CancelTimer

    If gClosingApproved Then Exit Sub

    If ThisWorkbook.ReadOnly Then
        If MsgBox("このExcelは読み取り専用で開いています。" & vbCrLf & _
                  "Excelを終了しますか？", _
                  vbQuestion + vbYesNo + vbDefaultButton2, "MVP3") <> vbYes Then
            Cancel = True
            Mvp2ScheduleTimer
            Exit Sub
        End If
        Mvp2MarkWorkbookClean
        gClosingApproved = True
        Exit Sub
    End If

    If Mvp2MetaGet("commitState", "NONE") = "PREPARED" Then
        If ThisWorkbook.ReadOnly Then
            MsgBox "Excelへの正式保存処理が完了していません。" & vbCrLf & _
                   "読み取り専用では続けられないため、このExcelを閉じずに管理担当へ連絡してください。", _
                   vbExclamation, "MVP3"
            Cancel = True
            Exit Sub
        End If
        Mvp2ResumePreparedCommit
        If Mvp2MetaGet("commitState", "NONE") = "PREPARED" Then
            Cancel = True
            Exit Sub
        End If
    End If

    If Len(Mvp2MetaGet("activeSessionId")) > 0 Then
        RefreshOperationPanel
        If MsgBox("Excelへ正式保存されていない作業がある可能性があります。" & vbCrLf & _
                  "このまま終了すると、次回には引き継がれません。" & vbCrLf & vbCrLf & _
                  "保存せずに終了しますか？", _
                  vbQuestion + vbYesNo + vbDefaultButton2, "MVP3") <> vbYes Then
            Cancel = True
            Mvp2ScheduleTimer
            Exit Sub
        End If

        If ThisWorkbook.ReadOnly Then
            MsgBox "このExcelは読み取り専用のため、終了の記録を保存できません。" & vbCrLf & _
                   "Excelを閉じずに管理担当へ連絡してください。", vbExclamation, "MVP3"
            Cancel = True
            Exit Sub
        End If
        Mvp2ClearActiveSession True
        ThisWorkbook.Save
    Else
        Dim savedAt As String
        Dim savedBy As String
        savedAt = Mvp2MetaGet("lastSaveAt")
        savedBy = Mvp2MetaGet("lastSaveAuthor")

        Dim message As String
        If Len(savedAt) = 0 Then
            message = "正式保存の記録はありません。" & vbCrLf & vbCrLf & "Excelを終了しますか？"
        Else
            message = "最新版：" & Mvp2FormatDateTimeValue(savedAt, "yyyy/mm/dd hh:nn") & vbCrLf & _
                      "保存者：" & savedBy & "さん" & vbCrLf & vbCrLf & _
                      "Excelを終了しますか？"
        End If
        If MsgBox(message, vbQuestion + vbYesNo + vbDefaultButton2, "MVP3") <> vbYes Then
            Cancel = True
            Mvp2ScheduleTimer
            Exit Sub
        End If
    End If

    Mvp2MarkWorkbookClean
    gClosingApproved = True
    Exit Sub

CloseFailed:
    Cancel = True
    MsgBox "終了確認を完了できませんでした。" & vbCrLf & _
           "Excelを閉じず、もう一度お試しください。" & vbCrLf & vbCrLf & _
           Err.Description, vbExclamation, "MVP3"
    Mvp2ScheduleTimer
End Sub

Private Sub Mvp2MarkWorkbookClean()
    On Error Resume Next
    ThisWorkbook.Saved = True
    On Error GoTo 0
End Sub

Public Function Mvp2NewId() As String
    On Error Resume Next
    Mvp2NewId = Mid$(CreateObject("Scriptlet.TypeLib").Guid, 2, 36)
    On Error GoTo 0
    If Len(Mvp2NewId) = 36 Then Exit Function

    Mvp2NewId = Mvp2RandomHex(8) & "-" & Mvp2RandomHex(4) & "-4" & _
                Mvp2RandomHex(3) & "-a" & Mvp2RandomHex(3) & "-" & Mvp2RandomHex(12)
End Function

Private Function Mvp2RandomHex(ByVal length As Long) As String
    Dim i As Long
    For i = 1 To length
        Mvp2RandomHex = Mvp2RandomHex & Mid$("0123456789abcdef", Int(Rnd() * 16) + 1, 1)
    Next i
End Function

Public Function Mvp2WorkbookIsInitialized() As Boolean
    Mvp2WorkbookIsInitialized = Mvp2SheetExists(MVP2_PANEL_SHEET) And _
                                 Mvp2SheetExists(MVP2_META_SHEET) And _
                                 Mvp2SheetExists(MVP2_DATA_SHEET) And _
                                 Mvp2SheetExists(MVP2_HISTORY_SHEET)
End Function

Public Function Mvp2SheetExists(ByVal sheetName As String) As Boolean
    On Error Resume Next
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(sheetName)
    Mvp2SheetExists = Not ws Is Nothing
    On Error GoTo 0
End Function

Public Function Mvp2JoinPath(ByVal parentPath As String, ByVal childPath As String) As String
    Dim separator As String
    separator = Application.PathSeparator
    If InStr(parentPath, "/") > 0 And InStr(parentPath, "\") = 0 Then separator = "/"
    If Right$(parentPath, 1) = "/" Or Right$(parentPath, 1) = "\" Then
        Mvp2JoinPath = parentPath & childPath
    Else
        Mvp2JoinPath = parentPath & separator & childPath
    End If
End Function

Public Function Mvp2ProjectPath(ByVal relativePath As String) As String
    Mvp2ProjectPath = Mvp2JoinPath(ThisWorkbook.Path, Replace(relativePath, "/", Application.PathSeparator))
End Function

Public Function Mvp2FileExists(ByVal filePath As String) As Boolean
    On Error Resume Next
    Mvp2FileExists = (Len(Dir$(filePath, vbNormal Or vbHidden Or vbSystem Or vbReadOnly)) > 0)
    On Error GoTo 0
End Function

Public Function Mvp2FolderExists(ByVal folderPath As String) As Boolean
    On Error Resume Next
    Mvp2FolderExists = ((GetAttr(folderPath) And vbDirectory) = vbDirectory)
    On Error GoTo 0
End Function

Public Sub Mvp2EnsureFolder(ByVal folderPath As String)
    If Mvp2FolderExists(folderPath) Then Exit Sub
    Dim parent As String
    parent = Left$(folderPath, InStrRev(folderPath, Application.PathSeparator) - 1)
    If Len(parent) > 0 And Not Mvp2FolderExists(parent) Then Mvp2EnsureFolder parent
    MkDir folderPath
End Sub

Public Function Mvp2IsReadOnly() As Boolean
    On Error Resume Next
    Mvp2IsReadOnly = ThisWorkbook.ReadOnly
    On Error GoTo 0
End Function
