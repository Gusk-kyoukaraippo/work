Attribute VB_Name = "GateConfig"
Option Explicit

' このモジュールには、GATE全体で共有する名前・上限・実行中の状態だけを置きます。
Public Const GATE_PANEL_SHEET As String = "操作パネル"
Public Const GATE_DATA_SHEET As String = "_APP_DATA"
Public Const GATE_META_SHEET As String = "_APP_META"
Public Const GATE_HISTORY_SHEET As String = "_APP_HISTORY"
Public Const GATE_TEMPLATE_RELATIVE As String = "runtime/index.html"
Public Const GATE_CORE_RELATIVE As String = "runtime/excel-gate-core.js"
Public Const GATE_HISTORY_TEMPLATE_RELATIVE As String = "shared/history.template.html"
Public Const GATE_HELP_RELATIVE As String = "shared/help.html"
Public Const GATE_PENDING_RELATIVE As String = "data/.pending"
Public Const GATE_SESSIONS_RELATIVE As String = "data/.sessions"
Public Const GATE_ACCEPTED_RELATIVE As String = "data/accepted"
Public Const GATE_REJECTED_RELATIVE As String = "data/rejected"
Public Const GATE_FILE_PREFIX As String = "Excelゲート受け渡し_"
Public Const GATE_FORMAT_VERSION As Long = 2
Public Const GATE_CHUNK_SIZE As Long = 20000
Public Const GATE_MAX_UTF8_BYTES As Double = 10485760#
Public Const GATE_MAX_CHARS As Long = 10485760
Public Const GATE_MAX_DEPTH As Long = 64
Public Const GATE_PROTECT_PASSWORD As String = "mvp2-panel-2026"

Public gWorkbookRunId As String
Public gImportInProgress As Boolean
Public gClosingApproved As Boolean
Public gCompletedSaveReady As Boolean
Public gCompletionNotified As Boolean

Public Type GateEnvelope
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

Public Sub GateOnOpen()
    On Error GoTo OpenFailed
    Randomize
    gWorkbookRunId = GateNewId()
    gClosingApproved = False
    gCompletedSaveReady = False
    gCompletionNotified = False

    If Not GateWorkbookIsInitialized() Then
        GateShowSetupPanel
        Exit Sub
    End If
    GateApplyProtection
    GateAssertCanonical
    If GateUsesCsvFolder() Then
        RefreshOperationPanel
        Exit Sub
    End If

    If GateMetaGet("commitState", "NONE") = "PREPARED" Then
        If Not ThisWorkbook.ReadOnly Then GateResumePreparedCommit
    End If

    If GateMetaGet("commitState", "NONE") <> "PREPARED" And _
       Len(GateMetaGet("activeSessionId")) > 0 Then
        If GateMetaGet("sessionRunId") <> gWorkbookRunId Then
            If Not ThisWorkbook.ReadOnly Then
                GateEndSessionPersisted
            End If
        End If
    End If

    RefreshOperationPanel
    Exit Sub

OpenFailed:
    MsgBox "Excelゲート MVP8thの起動確認で問題が見つかりました。" & vbCrLf & _
           "Excelを閉じて開き直してください。" & vbCrLf & vbCrLf & _
           Err.Description, vbExclamation, GateDialogTitle()
End Sub

Public Sub GateOnActivate()
    If Not GateWorkbookIsInitialized() Then Exit Sub
    RefreshOperationPanel
End Sub

Public Sub GateOnBeforeClose(ByRef Cancel As Boolean)
    If Not GateWorkbookIsInitialized() Then Exit Sub
    On Error GoTo CloseFailed

    If gClosingApproved Then
        GateCleanupRuntime
        Exit Sub
    End If

    If GateUsesCsvFolder() Then
        GateMarkWorkbookClean
        GateCleanupRuntime
        gClosingApproved = True
        Exit Sub
    End If

    If ThisWorkbook.ReadOnly Then
        GateMarkWorkbookClean
        GateCleanupRuntime
        gClosingApproved = True
        Exit Sub
    End If

    If GateMetaGet("commitState", "NONE") = "PREPARED" Then
        If ThisWorkbook.ReadOnly Then
            MsgBox "Excelへの正式保存処理が完了していません。" & vbCrLf & _
                   "読み取り専用では続けられないため、このExcelを閉じずに管理担当へ連絡してください。", _
                   vbExclamation, GateDialogTitle()
            Cancel = True
            Exit Sub
        End If
        GateResumePreparedCommit
        If GateMetaGet("commitState", "NONE") = "PREPARED" Then
            Cancel = True
            Exit Sub
        End If
    End If

    If Len(GateMetaGet("activeSessionId")) > 0 Then
        RefreshOperationPanel
        If MsgBox("「" & GateDisplayName() & "」に正式保存されていない作業がある可能性があります。" & vbCrLf & _
                  "このまま終了すると、次回には引き継がれません。" & vbCrLf & vbCrLf & _
                  "保存せずに終了しますか？", _
                  vbQuestion + vbYesNo + vbDefaultButton2, GateDialogTitle()) <> vbYes Then
            Cancel = True
            Exit Sub
        End If

        If ThisWorkbook.ReadOnly Then
            MsgBox "このExcelは読み取り専用のため、終了の記録を保存できません。" & vbCrLf & _
                   "Excelを閉じずに管理担当へ連絡してください。", vbExclamation, GateDialogTitle()
            Cancel = True
            Exit Sub
        End If
        GateEndSessionPersisted
    End If

    GateMarkWorkbookClean
    GateCleanupRuntime
    gClosingApproved = True
    Exit Sub

CloseFailed:
    Cancel = True
    MsgBox "終了確認を完了できませんでした。" & vbCrLf & _
           "Excelを閉じず、もう一度お試しください。" & vbCrLf & vbCrLf & _
           Err.Description, vbExclamation, GateDialogTitle()
End Sub

Private Sub GateMarkWorkbookClean()
    On Error Resume Next
    ThisWorkbook.Saved = True
    On Error GoTo 0
End Sub

Public Function GateNewId() As String
    On Error Resume Next
    GateNewId = Mid$(CreateObject("Scriptlet.TypeLib").Guid, 2, 36)
    On Error GoTo 0
    If Len(GateNewId) = 36 Then Exit Function

    GateNewId = GateRandomHex(8) & "-" & GateRandomHex(4) & "-4" & _
                GateRandomHex(3) & "-a" & GateRandomHex(3) & "-" & GateRandomHex(12)
End Function

Private Function GateRandomHex(ByVal length As Long) As String
    Dim i As Long
    For i = 1 To length
        GateRandomHex = GateRandomHex & Mid$("0123456789abcdef", Int(Rnd() * 16) + 1, 1)
    Next i
End Function

Public Function GateWorkbookIsInitialized() As Boolean
    GateWorkbookIsInitialized = GateSheetExists(GATE_PANEL_SHEET) And _
                                 GateSheetExists(GATE_META_SHEET) And _
                                 GateSheetExists(GATE_DATA_SHEET) And _
                                 GateSheetExists(GATE_HISTORY_SHEET)
End Function

Public Function GateSheetExists(ByVal sheetName As String) As Boolean
    On Error Resume Next
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(sheetName)
    GateSheetExists = Not ws Is Nothing
    On Error GoTo 0
End Function

Public Function GateJoinPath(ByVal parentPath As String, ByVal childPath As String) As String
    Dim separator As String
    separator = GatePathSeparatorFor(parentPath)
    If Right$(parentPath, 1) = "/" Or Right$(parentPath, 1) = Chr$(92) Then
        GateJoinPath = parentPath & childPath
    Else
        GateJoinPath = parentPath & separator & childPath
    End If
End Function

Public Function GateProjectPath(ByVal relativePath As String) As String
    Dim separator As String
    separator = GatePathSeparatorFor(ThisWorkbook.Path)
    relativePath = Replace(relativePath, Chr$(92), separator)
    relativePath = Replace(relativePath, "/", separator)
    GateProjectPath = GateJoinPath(ThisWorkbook.Path, relativePath)
End Function

Public Function GatePathSeparatorFor(ByVal pathValue As String) As String
    If InStr(pathValue, "/") > 0 And InStr(pathValue, Chr$(92)) = 0 Then
        GatePathSeparatorFor = "/"
    ElseIf InStr(pathValue, Chr$(92)) > 0 Then
        GatePathSeparatorFor = Chr$(92)
    Else
        GatePathSeparatorFor = Application.PathSeparator
    End If
End Function

Public Function GateFileExists(ByVal filePath As String) As Boolean
    On Error Resume Next
    GateFileExists = (Len(Dir$(filePath, vbNormal Or vbHidden Or vbSystem Or vbReadOnly)) > 0)
    On Error GoTo 0
End Function

Public Function GateFolderExists(ByVal folderPath As String) As Boolean
    On Error Resume Next
    GateFolderExists = ((GetAttr(folderPath) And vbDirectory) = vbDirectory)
    On Error GoTo 0
End Function

Public Sub GateEnsureFolder(ByVal folderPath As String)
    If GateFolderExists(folderPath) Then Exit Sub
    Dim parent As String
    Dim separator As String
    Dim separatorPosition As Long
    separator = GatePathSeparatorFor(folderPath)
    separatorPosition = InStrRev(folderPath, separator)
    If separatorPosition <= 0 Then Err.Raise 76, , "フォルダーのパスが無効です: " & folderPath
    parent = Left$(folderPath, separatorPosition - 1)
    If Len(parent) > 0 And Not GateFolderExists(parent) Then GateEnsureFolder parent
    MkDir folderPath
End Sub

Public Function GateIsReadOnly() As Boolean
    On Error GoTo UnknownState
    GateIsReadOnly = ThisWorkbook.ReadOnly
    Exit Function
UnknownState:
    GateIsReadOnly = True
End Function

Public Sub GateOnBeforeSave(ByVal SaveAsUI As Boolean, ByRef Cancel As Boolean)
    If Not GateWorkbookIsInitialized() Then Exit Sub
    On Error GoTo SaveBlocked
    GateAssertCanonical True
    If SaveAsUI Then Err.Raise vbObjectError + 2711, , "初期化後の別名保存は使えません。管理者の移設手順に従ってください。"
    Exit Sub
SaveBlocked:
    Cancel = True
    MsgBox Err.Description, vbExclamation, GateDialogTitle()
End Sub
