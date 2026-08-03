Attribute VB_Name = "Mvp2Panel"
Option Explicit

Public Sub InitializeMvp2()
    On Error GoTo InitializeFailed
    If ThisWorkbook.ReadOnly Then Err.Raise vbObjectError + 2400, , "このExcelは読み取り専用です。"
    If Len(ThisWorkbook.Path) = 0 Then Err.Raise vbObjectError + 2401, , "先にExcelファイルを共有フォルダへ保存してください。"

    If Mvp2WorkbookIsInitialized() Then
        If MsgBox("MVP3はすでに初期化されています。" & vbCrLf & _
                  "もう一度初期化すると、Excelへ正式保存したデータと保存ログが消えます。" & vbCrLf & vbCrLf & _
                  "初期化し直しますか？", vbExclamation + vbYesNo + vbDefaultButton2, "MVP3") <> vbYes Then Exit Sub
    End If

    Application.ScreenUpdating = False
    On Error Resume Next
    ThisWorkbook.Unprotect MVP2_PROTECT_PASSWORD
    Dim existingSheet As Object
    For Each existingSheet In ThisWorkbook.Worksheets
        existingSheet.Unprotect MVP2_PROTECT_PASSWORD
    Next existingSheet
    On Error GoTo InitializeFailed
    Mvp2EnsureInternalSheets
    Mvp2BuildOperationPanel
    Mvp2EnsureFolder Mvp2ProjectPath(MVP2_ACCEPTED_RELATIVE)
    Mvp2EnsureFolder Mvp2ProjectPath(MVP2_REJECTED_RELATIVE)
    Mvp2EnsureFolder Mvp2ProjectPath(MVP2_PENDING_RELATIVE)
    Mvp2EnsureFolder Mvp2ProjectPath(MVP2_SESSIONS_RELATIVE)

    If Len(gWorkbookRunId) = 0 Then gWorkbookRunId = Mvp2NewId()
    Mvp2ApplyProtection
    RefreshOperationPanel
    ThisWorkbook.Save
    Application.ScreenUpdating = True
    MsgBox "MVP3の操作パネルを作成しました。" & vbCrLf & _
           "利用者に見えるシートは「操作パネル」だけです。", vbInformation, "MVP3"
    Mvp2ScheduleTimer
    Exit Sub

InitializeFailed:
    Application.ScreenUpdating = True
    MsgBox "MVP3を初期化できませんでした。" & vbCrLf & vbCrLf & Err.Description, vbExclamation, "MVP3"
End Sub

Private Sub Mvp2BuildOperationPanel()
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_PANEL_SHEET)
    ws.Visible = -1
    On Error Resume Next
    ws.Unprotect MVP2_PROTECT_PASSWORD
    ws.Cells.UnMerge
    ws.Cells.Clear
    Dim shape As Object
    For Each shape In ws.Shapes
        shape.Delete
    Next shape
    On Error GoTo 0

    ws.Cells.Font.Name = "Yu Gothic UI"
    ws.Cells.Font.Size = 11
    ws.Columns("A").ColumnWidth = 3
    ws.Columns("B:N").ColumnWidth = 10
    ws.Columns("O").ColumnWidth = 3
    ws.Rows("1:46").RowHeight = 24
    ws.Rows(2).RowHeight = 34
    ws.Rows(3).RowHeight = 25
    ws.Rows("4:6").RowHeight = 31
    ws.Rows(7).RowHeight = 22

    ws.Range("B2:N2").Merge
    ws.Range("B2").Value2 = "MVP3  一時保存・正式保存"
    With ws.Range("B2:N2")
        .Font.Size = 22
        .Font.Bold = True
        .Font.Color = RGB(23, 50, 77)
        .HorizontalAlignment = -4131
        .VerticalAlignment = -4108
    End With

    ws.Range("B3:N3").Merge
    With ws.Range("B3:N3")
        .Value2 = ""
        .Font.Size = 11
        .Font.Bold = True
        .HorizontalAlignment = -4108
        .VerticalAlignment = -4108
        .Interior.Color = RGB(247, 249, 251)
    End With

    Mvp2FormatStatusAreas ws

    Mvp2FormatCard ws.Range("B10:N15"), "正式保存：最新版"

    ws.Range("B18:N18").Merge
    ws.Range("B18").Value2 = "通常の操作（上から順に進みます）"
    ws.Range("B18").Font.Bold = True
    ws.Range("B18").Font.Size = 14
    ws.Range("B18").Font.Color = RGB(23, 50, 77)

    Mvp2AddButton ws, "閲覧する", "OpenReadOnlyHtml", ws.Range("B20:G22"), RGB(91, 116, 139)
    Mvp2AddButton ws, "編集する", "OpenEditHtml", ws.Range("H20:N22"), RGB(23, 105, 170)
    Mvp2AddButton ws, "一時保存ファイルをExcelに正式保存する", "ImportSaveData", ws.Range("B24:N26"), RGB(20, 122, 85)
    Mvp2AddButton ws, "終了する", "ExitWorkbook", ws.Range("B28:N30"), RGB(74, 86, 99)

    Mvp2FormatGuidanceArea ws

    Mvp2FormatAdminArea ws
    Mvp2AddButton ws, "ログチェック（管理者向け）", "OpenSaveHistory", ws.Range("B42:F44"), RGB(91, 116, 139)

    ws.Cells.Locked = True
    ws.Activate
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.Zoom = 90
End Sub

Private Sub Mvp2FormatStatusAreas(ByVal ws As Object)
    On Error Resume Next
    ws.Range("B4:N7").UnMerge
    On Error GoTo 0
    ws.Range("B4:N6").Merge
    ws.Range("B7:N7").Merge

    With ws.Range("B4:N6")
        .WrapText = True
        .Font.Size = 13
        .Font.Bold = True
        .VerticalAlignment = -4108
        .HorizontalAlignment = -4131
        .IndentLevel = 1
        .Borders.LineStyle = 1
        .Borders.Weight = 2
    End With

    With ws.Range("B7:N7")
        .WrapText = False
        .Font.Size = 9
        .Font.Bold = False
        .Font.Color = RGB(82, 103, 122)
        .Interior.Color = RGB(247, 249, 251)
        .HorizontalAlignment = -4131
        .VerticalAlignment = -4108
        .IndentLevel = 1
        .Borders.LineStyle = 0
    End With
End Sub

Private Sub Mvp2FormatGuidanceArea(ByVal ws As Object)
    On Error Resume Next
    ws.Range("B33").MergeArea.UnMerge
    On Error GoTo 0
    ws.Range("B33:N37").Merge

    Dim usageText As String
    If ThisWorkbook.ReadOnly Then
        usageText = "このExcelではデータの入力・編集・正式保存はできません。通常の利用者は「閲覧する」を利用してください。「ログチェック（管理者向け）」の操作は不要です。"
    Else
        usageText = "数字やデータはこのExcelへ直接入力しません。編集は「編集する」からHTMLで行い、最後に「一時保存ファイルをExcelに正式保存する」を押してください。"
    End If
    ws.Range("B33").Value2 = usageText & vbLf & vbLf & _
                              "PCの「ダウンロード」には一時保存ファイル（JSON）が残ります。Excelに「正式保存は完了しています」と表示された後、ファイル名の「削除目安」を過ぎた「DX推進委員会アプリ一時保存_～.json」だけを整理してください。"
    With ws.Range("B33:N37")
        .WrapText = True
        .Font.Size = 10
        .Font.Color = RGB(82, 103, 122)
        .Interior.Color = RGB(242, 246, 249)
        .Borders.LineStyle = 1
        .Borders.Color = RGB(215, 224, 232)
        .VerticalAlignment = -4108
        .IndentLevel = 1
    End With
End Sub

Private Sub Mvp2FormatAdminArea(ByVal ws As Object)
    On Error Resume Next
    ws.Range("B40").MergeArea.UnMerge
    On Error GoTo 0
    ws.Range("B40:N40").Merge
    ws.Range("B40").Value2 = "管理者用（通常の利用者は操作不要）"
    With ws.Range("B40:N40")
        .Font.Size = 10
        .Font.Bold = True
        .Font.Color = RGB(91, 116, 139)
        .HorizontalAlignment = -4131
        .VerticalAlignment = -4108
    End With
End Sub

Private Sub Mvp2FormatCard(ByVal cardRange As Object, ByVal title As String)
    Dim firstColumn As Long
    Dim lastColumn As Long
    firstColumn = cardRange.Column
    lastColumn = cardRange.Column + cardRange.Columns.Count - 1
    Dim ws As Object
    Set ws = cardRange.Worksheet
    ws.Range(ws.Cells(cardRange.Row, firstColumn), ws.Cells(cardRange.Row, lastColumn)).Merge
    ws.Cells(cardRange.Row, firstColumn).Value2 = title
    ws.Range(ws.Cells(cardRange.Row + 1, firstColumn), ws.Cells(cardRange.Row + 5, lastColumn)).Merge
    With cardRange
        .Borders.LineStyle = 1
        .Borders.Color = RGB(204, 215, 224)
        .Interior.Color = RGB(255, 255, 255)
    End With
    With ws.Cells(cardRange.Row, firstColumn)
        .Font.Bold = True
        .Font.Size = 13
        .Font.Color = RGB(23, 50, 77)
        .Interior.Color = RGB(237, 244, 250)
        .HorizontalAlignment = -4108
        .VerticalAlignment = -4108
    End With
    With ws.Cells(cardRange.Row + 1, firstColumn)
        .WrapText = True
        .Font.Size = 12
        .VerticalAlignment = -4108
        .HorizontalAlignment = -4131
        .IndentLevel = 1
    End With
End Sub

Private Sub Mvp2AddButton(ByVal ws As Object, ByVal caption As String, ByVal macroName As String, ByVal targetRange As Object, ByVal fillColor As Long)
    Dim button As Object
    Dim captionFontSize As Long
    captionFontSize = IIf(Len(caption) > 14, 10, 11)
    Set button = ws.Shapes.AddShape(5, targetRange.Left, targetRange.Top, targetRange.Width, targetRange.Height)
    button.Name = "mvp2_" & macroName
    button.OnAction = "'" & ThisWorkbook.Name & "'!" & macroName
    button.Fill.ForeColor.RGB = fillColor
    button.Line.Visible = 0
    On Error Resume Next
    button.TextFrame2.TextRange.Text = caption
    button.TextFrame2.TextRange.Font.Name = "Yu Gothic UI"
    button.TextFrame2.TextRange.Font.Size = captionFontSize
    button.TextFrame2.TextRange.Font.Bold = True
    button.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(255, 255, 255)
    button.TextFrame2.VerticalAnchor = 3
    button.TextFrame2.TextRange.ParagraphFormat.Alignment = 2
    If Err.Number <> 0 Then
        Err.Clear
        button.TextFrame.Characters.Text = caption
        button.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
        button.TextFrame.Characters.Font.Bold = True
        button.TextFrame.Characters.Font.Size = captionFontSize
    End If
    On Error GoTo 0
End Sub

Public Sub Mvp2ApplyProtection()
    If Not Mvp2WorkbookIsInitialized() Then Exit Sub
    Dim wasSaved As Boolean
    wasSaved = ThisWorkbook.Saved
    On Error Resume Next
    ThisWorkbook.Unprotect MVP2_PROTECT_PASSWORD
    Dim ws As Object
    For Each ws In ThisWorkbook.Worksheets
        ws.Unprotect MVP2_PROTECT_PASSWORD
        If ws.Name = MVP2_PANEL_SHEET Then
            ws.Visible = -1
            ws.Protect Password:=MVP2_PROTECT_PASSWORD, DrawingObjects:=False, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
        Else
            ws.Visible = 2
            ws.Protect Password:=MVP2_PROTECT_PASSWORD, DrawingObjects:=True, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
        End If
    Next ws
    ThisWorkbook.Protect Password:=MVP2_PROTECT_PASSWORD, Structure:=True, Windows:=False
    ThisWorkbook.Saved = wasSaved
    On Error GoTo 0
End Sub

Public Sub RefreshOperationPanel()
    If Not Mvp2WorkbookIsInitialized() Then Exit Sub
    Dim wasSaved As Boolean
    wasSaved = ThisWorkbook.Saved
    On Error GoTo RefreshFailed
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_PANEL_SHEET)
    ws.Unprotect MVP2_PROTECT_PASSWORD
    Mvp2EnsureOperationPanelLayout ws

    Dim statusText As String
    Dim statusDetail As String
    Dim statusColor As Long
    Dim activeSession As String
    activeSession = Mvp2MetaGet("activeSessionId")
    Dim nowValue As Date
    nowValue = Now
    Dim lastSaveText As String
    lastSaveText = Mvp2MetaGet("lastSaveAt")
    Dim lastSaveValue As Date
    Dim hasLastSaveValue As Boolean
    hasLastSaveValue = Mvp2TryDateTime(lastSaveText, lastSaveValue)

    If Len(activeSession) > 0 Then
        statusColor = RGB(237, 244, 250)
        Dim startedText As String
        Dim activeGuidance As String
        startedText = Mvp2MetaGet("sessionStartedAt")
        If ThisWorkbook.ReadOnly Then
            activeGuidance = "このExcelでは閲覧だけできます。作業中の内容は変更できません。"
        Else
            activeGuidance = "作業を終える場合は、HTMLで作業終了用の一時保存ファイルを作り、「一時保存ファイルをExcelに正式保存する」を押してください。"
        End If
        statusText = "HTMLでの編集作業があります" & vbLf & _
                     "編集画面を開いた時刻：" & Mvp2DisplayDateTime(startedText) & vbLf & _
                     activeGuidance
        statusDetail = "参考：編集開始から " & Mvp2ElapsedText(startedText, nowValue)
        If Len(lastSaveText) > 0 Then
            statusDetail = statusDetail & " ／ 前回の正式保存から " & Mvp2ElapsedText(lastSaveText, nowValue)
        Else
            statusDetail = statusDetail & " ／ 正式保存の記録なし"
        End If
    ElseIf Len(lastSaveText) = 0 Then
        statusColor = RGB(255, 245, 204)
        If ThisWorkbook.ReadOnly Then
            statusText = "正式保存の記録はありません" & vbLf & vbLf & "このExcelでは閲覧だけできます。"
        Else
            statusText = "正式保存の記録はありません" & vbLf & vbLf & "「編集する」から作業を始めてください。"
        End If
    ElseIf hasLastSaveValue And nowValue < lastSaveValue Then
        statusColor = RGB(255, 245, 204)
        statusText = "PCの時刻が、最後の正式保存より前になっています" & vbLf & _
                     "最終正式保存：" & Mvp2DisplayDateTime(lastSaveText) & " ／ 保存者：" & Mvp2MetaGet("lastSaveAuthor") & "さん" & vbLf & _
                     "PCの日時設定を確認してください。"
    Else
        statusColor = RGB(224, 245, 234)
        statusText = "正式保存は完了しています" & vbLf & vbLf & _
                     "最終正式保存：" & Mvp2DisplayDateTime(lastSaveText) & vbLf & _
                     "保存者　：" & Mvp2MetaGet("lastSaveAuthor") & "さん"
        If hasLastSaveValue Then statusDetail = "参考：前回の正式保存から " & Mvp2ElapsedText(lastSaveText, nowValue)
    End If

    ws.Range("B4").Value2 = statusText
    ws.Range("B7").Value2 = statusDetail
    ws.Range("B4:N6").Interior.Color = statusColor
    ws.Range("B4:N6").Font.Color = RGB(23, 50, 77)
    ws.Range("B4:N6").Borders.Color = RGB(204, 215, 224)

    Mvp2UpdateLatestCard ws.Range("B11")
    Mvp2UpdateReadOnlyControls ws
    ws.Protect Password:=MVP2_PROTECT_PASSWORD, DrawingObjects:=False, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
    ThisWorkbook.Saved = wasSaved
    Exit Sub

RefreshFailed:
    On Error Resume Next
    ws.Protect Password:=MVP2_PROTECT_PASSWORD, DrawingObjects:=False, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
    ThisWorkbook.Saved = wasSaved
    On Error GoTo 0
End Sub

Private Sub Mvp2EnsureOperationPanelLayout(ByVal ws As Object)
    Dim needsCellLayout As Boolean
    needsCellLayout = (ws.Range("B4").MergeArea.Rows.Count <> 3 Or _
                       ws.Range("B10").MergeArea.Columns.Count <> 13 Or _
                       ws.Range("B33").MergeArea.Rows.Count <> 5)

    If needsCellLayout Then
        On Error Resume Next
        ws.Range("B4:N7").UnMerge
        ws.Range("B10:N15").UnMerge
        ws.Range("B18:N45").UnMerge
        ws.Range("B4:N7").ClearContents
        ws.Range("B10:N15").ClearContents
        ws.Range("B18:N45").ClearContents
        ws.Range("B18:N45").Interior.Color = RGB(247, 249, 251)
        ws.Range("B18:N45").Borders.LineStyle = 0
        On Error GoTo 0

        ws.Rows("1:46").RowHeight = 24
        ws.Rows(2).RowHeight = 34
        ws.Rows(3).RowHeight = 25
        ws.Rows("4:6").RowHeight = 31
        ws.Rows(7).RowHeight = 22

        Mvp2FormatStatusAreas ws
        Mvp2FormatCard ws.Range("B10:N15"), "正式保存：最新版"

        ws.Range("B18:N18").Merge
        ws.Range("B18").Font.Bold = True
        ws.Range("B18").Font.Size = 14
        ws.Range("B18").Font.Color = RGB(23, 50, 77)

        Mvp2FormatGuidanceArea ws
        Mvp2FormatAdminArea ws
    End If

    ws.Range("B2").Value2 = "MVP3  一時保存・正式保存"
    ws.Range("B10").Value2 = "正式保存：最新版"
    ws.Range("B18").Value2 = "通常の操作（上から順に進みます）"
    ws.Range("B40").Value2 = "管理者用（通常の利用者は操作不要）"

    Mvp2MoveButton ws, "OpenReadOnlyHtml", ws.Range("B20:G22")
    Mvp2MoveButton ws, "OpenEditHtml", ws.Range("H20:N22")
    Mvp2MoveButton ws, "ImportSaveData", ws.Range("B24:N26")
    Mvp2MoveButton ws, "ExitWorkbook", ws.Range("B28:N30")
    Mvp2MoveButton ws, "OpenSaveHistory", ws.Range("B42:F44")
End Sub

Private Sub Mvp2UpdateReadOnlyControls(ByVal ws As Object)
    Dim readOnlyMode As Boolean
    readOnlyMode = ThisWorkbook.ReadOnly

    Mvp2SetButtonCaption ws, "ImportSaveData", "一時保存ファイルをExcelに正式保存する"
    Mvp2SetButtonCaption ws, "OpenSaveHistory", "ログチェック（管理者向け）"

    With ws.Range("B3:N3")
        If readOnlyMode Then
            .Value2 = "このExcelは読み取り専用で開いています。閲覧のみ利用できます。"
            .Interior.Color = RGB(91, 116, 139)
            .Font.Color = RGB(255, 255, 255)
            .Borders.LineStyle = 1
            .Borders.Color = RGB(72, 92, 110)
        Else
            .Value2 = ""
            .Interior.Color = RGB(247, 249, 251)
            .Font.Color = RGB(23, 50, 77)
            .Borders.LineStyle = 0
        End If
    End With

    Mvp2FormatGuidanceArea ws

    Mvp2SetButtonEnabled ws, "OpenReadOnlyHtml", True, RGB(91, 116, 139)
    Mvp2SetButtonEnabled ws, "OpenEditHtml", Not readOnlyMode, RGB(23, 105, 170)
    Mvp2SetButtonEnabled ws, "ImportSaveData", Not readOnlyMode, RGB(20, 122, 85)
    Mvp2SetButtonEnabled ws, "OpenSaveHistory", True, RGB(91, 116, 139)
    Mvp2SetButtonEnabled ws, "ExitWorkbook", True, RGB(74, 86, 99)
End Sub

Private Sub Mvp2MoveButton(ByVal ws As Object, ByVal macroName As String, ByVal targetRange As Object)
    On Error Resume Next
    Dim button As Object
    Set button = ws.Shapes("mvp2_" & macroName)
    If button Is Nothing Then Exit Sub

    button.Left = targetRange.Left
    button.Top = targetRange.Top
    button.Width = targetRange.Width
    button.Height = targetRange.Height
    On Error GoTo 0
End Sub

Private Sub Mvp2SetButtonCaption(ByVal ws As Object, ByVal macroName As String, ByVal caption As String)
    On Error Resume Next
    Dim button As Object
    Dim captionFontSize As Long
    captionFontSize = IIf(Len(caption) > 14, 10, 11)
    Set button = ws.Shapes("mvp2_" & macroName)
    If button Is Nothing Then Exit Sub

    button.TextFrame2.TextRange.Text = caption
    button.TextFrame2.TextRange.Font.Size = captionFontSize
    If Err.Number <> 0 Then
        Err.Clear
        button.TextFrame.Characters.Text = caption
        button.TextFrame.Characters.Font.Size = captionFontSize
    End If
    On Error GoTo 0
End Sub

Private Sub Mvp2SetButtonEnabled(ByVal ws As Object, ByVal macroName As String, ByVal isEnabled As Boolean, ByVal enabledColor As Long)
    On Error Resume Next
    Dim button As Object
    Set button = ws.Shapes("mvp2_" & macroName)
    If button Is Nothing Then Exit Sub

    If isEnabled Then
        button.OnAction = "'" & ThisWorkbook.Name & "'!" & macroName
        button.Fill.ForeColor.RGB = enabledColor
        button.AlternativeText = ""
    Else
        button.OnAction = ""
        button.Fill.ForeColor.RGB = RGB(174, 184, 193)
        button.AlternativeText = "読み取り専用のため、この操作は利用できません。"
    End If
    button.Line.Visible = 0
    button.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(255, 255, 255)
    On Error GoTo 0
End Sub

Private Sub Mvp2UpdateLatestCard(ByVal target As Object)
    Dim revision As Long
    Dim savedAt As Variant
    Dim author As String
    If Mvp2GetSuccessHistory(1, revision, savedAt, author) Then
        target.Value2 = "revision " & revision & vbLf & vbLf & _
                        "正式保存日時：" & Format$(savedAt, "yyyy/mm/dd hh:nn") & vbLf & _
                        "保存者　：" & author
    Else
        target.Value2 = "正式保存の記録はありません"
    End If
End Sub

Private Function Mvp2GetSuccessHistory(ByVal successNumber As Long, ByRef revision As Long, ByRef savedAt As Variant, ByRef author As String) As Boolean
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(MVP2_HISTORY_SHEET)
    Dim found As Long
    Dim rowNumber As Long
    For rowNumber = ws.Cells(ws.Rows.Count, 1).End(-4162).Row To 2 Step -1
        If CStr(ws.Cells(rowNumber, 7).Value2) = "SUCCESS" Then
            found = found + 1
            If found = successNumber Then
                revision = CLng(Val(CStr(ws.Cells(rowNumber, 1).Value2)))
                savedAt = ws.Cells(rowNumber, 2).Value
                author = CStr(ws.Cells(rowNumber, 3).Value2)
                Mvp2GetSuccessHistory = True
                Exit Function
            End If
        End If
    Next rowNumber
End Function

Private Function Mvp2DisplayDateTime(ByVal storedText As String) As String
    Mvp2DisplayDateTime = Mvp2FormatDateTimeValue(storedText, "yyyy/mm/dd hh:nn")
End Function

Private Function Mvp2ElapsedText(ByVal startText As String, ByVal endValue As Date) As String
    Dim startValue As Date
    If Not Mvp2TryDateTime(startText, startValue) Then
        Mvp2ElapsedText = "不明"
        Exit Function
    End If
    Dim minutes As Long
    minutes = DateDiff("n", startValue, endValue)
    If minutes < 0 Then
        Mvp2ElapsedText = "PC時刻を確認してください"
    ElseIf minutes < 60 Then
        Mvp2ElapsedText = minutes & "分"
    ElseIf minutes < 1440 Then
        Mvp2ElapsedText = (minutes \ 60) & "時間" & (minutes Mod 60) & "分"
    Else
        Mvp2ElapsedText = (minutes \ 1440) & "日" & ((minutes Mod 1440) \ 60) & "時間"
    End If
End Function

Public Sub Mvp2ScheduleTimer()
    If gImportInProgress Or gTimerScheduled Or Not gTimerSupported Then Exit Sub
    On Error GoTo TimerUnavailable
    gNextTimerAt = Now + TimeSerial(0, 1, 0)
    Application.OnTime EarliestTime:=gNextTimerAt, Procedure:="'" & ThisWorkbook.Name & "'!Mvp2TimerTick", Schedule:=True
    gTimerScheduled = True
    Exit Sub
TimerUnavailable:
    gTimerSupported = False
    gTimerScheduled = False
End Sub

Public Sub Mvp2CancelTimer()
    If Not gTimerScheduled Then Exit Sub
    On Error Resume Next
    Application.OnTime EarliestTime:=gNextTimerAt, Procedure:="'" & ThisWorkbook.Name & "'!Mvp2TimerTick", Schedule:=False
    On Error GoTo 0
    gTimerScheduled = False
End Sub

Public Sub Mvp2TimerTick()
    gTimerScheduled = False
    If gImportInProgress Or gClosingApproved Then Exit Sub
    RefreshOperationPanel
    Mvp2ScheduleTimer
End Sub
