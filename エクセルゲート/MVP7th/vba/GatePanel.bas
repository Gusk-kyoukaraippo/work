Attribute VB_Name = "GatePanel"
Option Explicit

Public Sub InitializeGate()
    Dim initializationStarted As Boolean, csvPath As String, csvMode As Boolean
    On Error GoTo InitializeFailed
    If ThisWorkbook.ReadOnly Then Err.Raise vbObjectError + 2400, , "読み取り専用です。共有ブックを編集できる状態で開き直してください。"
    If Len(ThisWorkbook.Path) = 0 Then Err.Raise vbObjectError + 2401, , "フォルダ一式を共有場所へ配置してから初回設定してください。"
    If GateWorkbookIsInitialized() Then Err.Raise vbObjectError + 2402, , "初回設定は完了しています。操作パネルのボタンを使ってください。"
    If GateSheetExists(GATE_DATA_SHEET) Or GateSheetExists(GATE_META_SHEET) Or GateSheetExists(GATE_HISTORY_SHEET) Then Err.Raise vbObjectError + 2403, , "既存の管理情報があります。上書きせず、管理者に復旧を依頼してください。"
    GateValidateDeployment
    If MsgBox("この場所を全員で使う保存先として登録します。" & vbCrLf & vbCrLf & _
              ThisWorkbook.FullName & vbCrLf & vbCrLf & "ここで初回設定しますか？", vbYesNo + vbDefaultButton2, "初回設定") <> vbYes Then Exit Sub
    csvMode = GateUsesCsvFolder()
    If csvMode Then
        csvPath = GatePromptCsvSourcePath("")
        If Len(csvPath) = 0 Then Exit Sub
    End If
    Application.ScreenUpdating = False
    initializationStarted = True
    GateEnsureInternalSheets
    If csvMode Then
        GateMetaSet "csvSourcePath", csvPath
    Else
        GateEnsureFolder GateProjectPath(GATE_ACCEPTED_RELATIVE)
        GateEnsureFolder GateProjectPath(GATE_REJECTED_RELATIVE)
        GateEnsureFolder GateProjectPath(GATE_PENDING_RELATIVE)
        GateEnsureFolder GateProjectPath(GATE_SESSIONS_RELATIVE)
        GateEnsureFolder GateProjectPath("data/backups")
    End If
    If Len(gWorkbookRunId) = 0 Then gWorkbookRunId = GateNewId()
    GateBuildOperationPanel
    GateApplyProtection
    RefreshOperationPanel
    GateSaveWorkbook "initialize"
    Application.ScreenUpdating = True
    If csvMode Then
        MsgBox "初回設定が完了しました。「最新CSVで開く」から使えます。", vbInformation, "Excelゲート MVP7th"
    Else
        MsgBox "初回設定が完了しました。「編集する」から使えます。", vbInformation, "Excelゲート MVP7th"
    End If
    Exit Sub
InitializeFailed:
    Dim initializationError As String
    initializationError = Err.Description
    If initializationStarted Then GateRollbackInitialization
    Application.ScreenUpdating = True
    MsgBox "初回設定を完了できませんでした。" & vbCrLf & initializationError & vbCrLf & _
           "共有場所への接続を確認してください。保存結果が不明な場合は、ブックを保存せずに閉じ、開き直して状態を確認してください。", vbExclamation, "Excelゲート MVP7th"
End Sub

Private Sub GateRollbackInitialization()
    Dim alerts As Boolean, sheetName As Variant
    alerts = Application.DisplayAlerts
    On Error Resume Next
    ThisWorkbook.Unprotect GATE_PROTECT_PASSWORD
    Application.DisplayAlerts = False
    For Each sheetName In Array(GATE_DATA_SHEET, GATE_META_SHEET, GATE_HISTORY_SHEET)
        If GateSheetExists(CStr(sheetName)) Then ThisWorkbook.Worksheets(CStr(sheetName)).Delete
    Next sheetName
    Application.DisplayAlerts = alerts
    GateShowSetupPanel
End Sub

' Also run once when assembling the uninitialized master so the button is saved.
Public Sub GateShowSetupPanel()
    If GateWorkbookIsInitialized() Then Exit Sub
    Dim ws As Object, wasSaved As Boolean
    wasSaved = ThisWorkbook.Saved
    Set ws = ThisWorkbook.Worksheets(GATE_PANEL_SHEET)
    GateBasePanel ws
    GateText ws.Range("B5:J8"), "はじめに一度だけ設定します" & vbLf & _
             "フォルダ一式を全員が使う共有場所に置いてから、下のボタンを押してください。", RGB(255, 245, 204), 14
    GateAddButton ws, "初回設定", "InitializeGate", ws.Range("B14:J16"), RGB(23, 105, 170)
    GateText ws.Range("B22:J25"), "設定後は操作パネルからEdgeを開きます。" & vbLf & _
             "CSVフォルダ閲覧型では、初回にローカルまたは共有フォルダのパスを登録します。", RGB(237, 244, 250), 12
    ThisWorkbook.Saved = wasSaved
End Sub

Public Sub GateBuildOperationPanel()
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(GATE_PANEL_SHEET)
    GateBasePanel ws
    If GateUsesCsvFolder() Then
        GateAddButton ws, "最新CSVで開く", "OpenLatestCsvHtml", ws.Range("B10:J13"), RGB(23, 105, 170)
        GateAddButton ws, "読込先の設定", "ConfigureCsvSourceFolder", ws.Range("B16:F18"), RGB(91, 116, 139)
        GateAddButton ws, "閉じる", "ExitWorkbook", ws.Range("G16:J18"), RGB(91, 116, 139)
        GateAddButton ws, "使い方", "OpenGateHelp", ws.Range("B27:J28"), RGB(91, 116, 139)
        ws.Cells.Locked = True
        Exit Sub
    End If
    GateAddButton ws, "編集する", "OpenEditHtml", ws.Range("B10:F12"), RGB(23, 105, 170)
    GateAddButton ws, "閲覧する", "OpenReadOnlyHtml", ws.Range("G10:J12"), RGB(91, 116, 139)
    GateAddButton ws, "保存して終了", "SaveAndClose", ws.Range("B14:J16"), RGB(20, 122, 85)
    GateAddButton ws, "保存して続ける", "SaveAndContinue", ws.Range("B18:F20"), RGB(91, 116, 139)
    GateAddButton ws, "閉じる", "ExitWorkbook", ws.Range("G18:J20"), RGB(91, 116, 139)
    GateAddButton ws, "使い方", "OpenGateHelp", ws.Range("B27:F28"), RGB(91, 116, 139)
    GateAddButton ws, "保存履歴（管理者）", "OpenSaveHistory", ws.Range("G27:J28"), RGB(91, 116, 139)
    ws.Cells.Locked = True
End Sub

Private Sub GateBasePanel(ByVal ws As Object)
    ws.Unprotect GATE_PROTECT_PASSWORD
    ws.Cells.UnMerge
    ws.Cells.Clear
    Dim shape As Object
    For Each shape In ws.Shapes
        shape.Delete
    Next shape
    ws.Cells.Font.Name = "Yu Gothic UI"
    ws.Cells.Font.Size = 12
    ws.Columns("A").ColumnWidth = 3
    ws.Columns("B:J").ColumnWidth = 10
    ws.Columns("K").ColumnWidth = 3
    ws.Rows("1:32").RowHeight = 24
    ws.Range("A1:K32").Interior.Color = RGB(247, 249, 251)
    GateText ws.Range("B2:J3"), "Excelゲート", RGB(247, 249, 251), 24
    ws.Range("B2").Font.Bold = True
    ws.Activate
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.Zoom = 90
End Sub

Private Sub GateText(ByVal area As Object, ByVal text As String, ByVal fill As Long, ByVal size As Long)
    area.Merge
    area.Cells(1, 1).Value2 = text
    area.WrapText = True
    area.Font.Size = size
    area.Font.Color = RGB(23, 50, 77)
    area.Interior.Color = fill
    area.VerticalAlignment = -4108
    area.HorizontalAlignment = -4131
    area.IndentLevel = 1
End Sub

Private Sub GateAddButton(ByVal ws As Object, ByVal caption As String, ByVal macroName As String, ByVal area As Object, ByVal fill As Long)
    Dim button As Object
    Set button = ws.Shapes.AddShape(5, area.Left + 3, area.Top + 3, area.Width - 6, area.Height - 6)
    button.Name = "gate_" & macroName
    button.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!" & macroName
    button.Fill.ForeColor.RGB = fill
    button.Line.Visible = 0
    On Error Resume Next
    button.TextFrame2.TextRange.Text = caption
    button.TextFrame2.TextRange.Font.Name = "Yu Gothic UI"
    button.TextFrame2.TextRange.Font.Size = 14
    button.TextFrame2.TextRange.Font.Bold = True
    button.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(255, 255, 255)
    button.TextFrame2.VerticalAnchor = 3
    button.TextFrame2.TextRange.ParagraphFormat.Alignment = 2
    If Err.Number <> 0 Then
        Err.Clear
        button.TextFrame.Characters.Text = caption
        button.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
        button.TextFrame.Characters.Font.Size = 14
    End If
    On Error GoTo 0
End Sub

Public Sub GateApplyProtection()
    If Not GateWorkbookIsInitialized() Then Exit Sub
    Dim wasSaved As Boolean, ws As Object
    wasSaved = ThisWorkbook.Saved
    On Error Resume Next
    ThisWorkbook.Unprotect GATE_PROTECT_PASSWORD
    For Each ws In ThisWorkbook.Worksheets
        ws.Unprotect GATE_PROTECT_PASSWORD
        If ws.Name = GATE_PANEL_SHEET Then
            ws.Visible = -1
            ws.Protect Password:=GATE_PROTECT_PASSWORD, DrawingObjects:=False, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
        Else
            ws.Visible = 2
            ws.Protect Password:=GATE_PROTECT_PASSWORD, DrawingObjects:=True, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
        End If
    Next ws
    ThisWorkbook.Protect Password:=GATE_PROTECT_PASSWORD, Structure:=True, Windows:=False
    ThisWorkbook.Saved = wasSaved
    On Error GoTo 0
End Sub

Public Sub RefreshOperationPanel()
    If Not GateWorkbookIsInitialized() Then Exit Sub
    Dim wasSaved As Boolean, ws As Object, status As String, fill As Long
    wasSaved = ThisWorkbook.Saved
    On Error GoTo RefreshFailed
    Set ws = ThisWorkbook.Worksheets(GATE_PANEL_SHEET)
    ws.Unprotect GATE_PROTECT_PASSWORD
    If GateUsesCsvFolder() Then
        GateRefreshCsvPanel ws
        ThisWorkbook.Saved = wasSaved
        Exit Sub
    End If
    fill = RGB(237, 244, 250)
    If GateMetaGet("commitState", "NONE") = "PREPARED" Then
        fill = RGB(255, 245, 204)
        status = "保存が完了していません。" & vbLf & "接続を確認し、同じ保存ボタンで再試行してください。"
    ElseIf Len(GateMetaGet("activeSessionId")) > 0 Then
        status = "Edgeで入力中です。ブックは開いたままにしてください。" & vbLf & _
                 "Edgeで「入力を終える」を押したら、ここで「保存して終了」を押します。"
    ElseIf gCompletedSaveReady Then
        fill = RGB(224, 245, 234)
        status = "保存は完了しています。" & vbLf & "「保存して終了」で、このブックを閉じられます。"
    Else
        status = "「編集する」または「閲覧する」から始めます。" & vbLf & "保存先はこの共有ブックです。"
    End If
    If ThisWorkbook.ReadOnly Then
        status = "閲覧専用で開いています。" & vbLf & "「閲覧する」で、最後に保存された内容を確認できます。"
        fill = RGB(237, 244, 250)
    End If
    GateText ws.Range("B5:J8"), status, fill, 13
    GateText ws.Range("B22:J25"), "通常：Edgeで「入力を終える」 → このブックで「保存して終了」" & vbLf & _
             "途中：Edgeで「途中保存の準備」 → このブックで「保存して続ける」", RGB(237, 244, 250), 11
    Dim latest As String
    latest = "まだ保存されていません。"
    If Len(GateMetaGet("lastSaveAt")) > 0 Then latest = "最終保存：" & GateFormatDateTimeValue(GateMetaGet("lastSaveAt"), "yyyy/mm/dd hh:nn") & "  保存者：" & GateMetaGet("lastSaveAuthor")
    GateText ws.Range("B30:J31"), latest, RGB(247, 249, 251), 11
    GateSetButtonEnabled ws, "OpenEditHtml", Not ThisWorkbook.ReadOnly And Len(GateMetaGet("activeSessionId")) = 0 And GateMetaGet("commitState", "NONE") = "NONE", RGB(23, 105, 170)
    GateSetButtonEnabled ws, "SaveAndClose", Not ThisWorkbook.ReadOnly, RGB(20, 122, 85)
    GateSetButtonEnabled ws, "SaveAndContinue", Not ThisWorkbook.ReadOnly, RGB(91, 116, 139)
    ws.Protect Password:=GATE_PROTECT_PASSWORD, DrawingObjects:=False, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
    ThisWorkbook.Saved = wasSaved
    Exit Sub
RefreshFailed:
    On Error Resume Next
    ws.Protect Password:=GATE_PROTECT_PASSWORD, DrawingObjects:=False, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
    ThisWorkbook.Saved = wasSaved
End Sub

Private Sub GateRefreshCsvPanel(ByVal ws As Object)
    ' Rebuild so copied / renamed workbooks never keep edit or save shortcuts.
    GateBuildOperationPanel
    Dim status As String
    status = "「最新CSVで開く」で登録したフォルダから読み込みます。" & vbLf & _
             "CSVは書き換えません。集計結果をブックへ保存する操作は不要です。"
    If ThisWorkbook.ReadOnly Then status = status & vbLf & "読み取り専用のブックでも最新CSVを閲覧できます。"
    GateText ws.Range("B5:J8"), status, RGB(237, 244, 250), 12
    GateText ws.Range("B21:J25"), "CSV読込先：" & vbLf & GateMetaGet("csvSourcePath", "未登録"), RGB(237, 244, 250), 11
    GateText ws.Range("B30:J31"), "CSV更新後は、もう一度「最新CSVで開く」を押してください。", RGB(247, 249, 251), 11
    GateSetButtonEnabled ws, "ConfigureCsvSourceFolder", Not ThisWorkbook.ReadOnly, RGB(91, 116, 139)
    ws.Protect Password:=GATE_PROTECT_PASSWORD, DrawingObjects:=False, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
End Sub

Private Sub GateSetButtonEnabled(ByVal ws As Object, ByVal macroName As String, ByVal enabled As Boolean, ByVal fill As Long)
    Dim button As Object
    Set button = ws.Shapes("gate_" & macroName)
    If enabled Then
        button.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!" & macroName
        button.Fill.ForeColor.RGB = fill
    Else
        button.OnAction = ""
        button.Fill.ForeColor.RGB = RGB(174, 184, 193)
    End If
End Sub
