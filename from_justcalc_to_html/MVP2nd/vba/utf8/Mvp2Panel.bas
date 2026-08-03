Attribute VB_Name = "Mvp2Panel"
Option Explicit

Public Sub InitializeMvp2()
    On Error GoTo InitializeFailed
    If ThisWorkbook.ReadOnly Then Err.Raise vbObjectError + 2400, , "このExcelは読み取り専用です。"
    If Len(ThisWorkbook.Path) = 0 Then Err.Raise vbObjectError + 2401, , "先にExcelファイルを共有フォルダへ保存してください。"

    If Mvp2WorkbookIsInitialized() Then
        If MsgBox("MVP2はすでに初期化されています。" & vbCrLf & _
                  "もう一度初期化すると、Excel内の保存データと履歴が消えます。" & vbCrLf & vbCrLf & _
                  "初期化し直しますか？", vbExclamation + vbYesNo + vbDefaultButton2, "MVP2") <> vbYes Then Exit Sub
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
    MsgBox "MVP2の操作パネルを作成しました。" & vbCrLf & _
           "利用者に見えるシートは「操作パネル」だけです。", vbInformation, "MVP2"
    Mvp2ScheduleTimer
    Exit Sub

InitializeFailed:
    Application.ScreenUpdating = True
    MsgBox "MVP2を初期化できませんでした。" & vbCrLf & vbCrLf & Err.Description, vbExclamation, "MVP2"
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
    ws.Rows("1:40").RowHeight = 24
    ws.Rows(2).RowHeight = 34
    ws.Rows(3).RowHeight = 25
    ws.Rows("4:7").RowHeight = 31

    ws.Range("B2:N2").Merge
    ws.Range("B2").Value2 = "MVP2  セーブ管理"
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

    ws.Range("B4:N7").Merge
    With ws.Range("B4:N7")
        .WrapText = True
        .Font.Size = 13
        .Font.Bold = True
        .VerticalAlignment = -4108
        .HorizontalAlignment = -4131
        .IndentLevel = 1
        .Borders.LineStyle = 1
        .Borders.Weight = 2
    End With

    Mvp2FormatCard ws.Range("B10:G15"), "最新版"
    Mvp2FormatCard ws.Range("I10:N15"), "1つ前"

    ws.Range("B18:N18").Merge
    ws.Range("B18").Value2 = "操作"
    ws.Range("B18").Font.Bold = True
    ws.Range("B18").Font.Size = 14
    ws.Range("B18").Font.Color = RGB(23, 50, 77)

    Mvp2AddButton ws, "閲覧する", "OpenReadOnlyHtml", ws.Range("B20:D22"), RGB(91, 116, 139)
    Mvp2AddButton ws, "編集する", "OpenEditHtml", ws.Range("E20:G22"), RGB(23, 105, 170)
    Mvp2AddButton ws, "セーブデータをExcelに保存する", "ImportSaveData", ws.Range("H20:K22"), RGB(20, 122, 85)
    Mvp2AddButton ws, "これまでの保存を見る", "OpenSaveHistory", ws.Range("L20:N22"), RGB(91, 116, 139)
    Mvp2AddButton ws, "終了する", "ExitWorkbook", ws.Range("B25:N27"), RGB(74, 86, 99)

    ws.Range("B30:N32").Merge
    ws.Range("B30").Value2 = "数字やデータはこのExcelへ直接入力しません。編集は「編集する」からHTMLで行い、最後に「セーブデータをExcelに保存する」を押してください。"
    With ws.Range("B30:N32")
        .WrapText = True
        .Font.Color = RGB(82, 103, 122)
        .Interior.Color = RGB(242, 246, 249)
        .Borders.LineStyle = 1
        .Borders.Color = RGB(215, 224, 232)
        .VerticalAlignment = -4108
        .IndentLevel = 1
    End With

    ws.Cells.Locked = True
    ws.Activate
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.Zoom = 90
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
    Set button = ws.Shapes.AddShape(5, targetRange.Left, targetRange.Top, targetRange.Width, targetRange.Height)
    button.Name = "mvp2_" & macroName
    button.OnAction = "'" & ThisWorkbook.Name & "'!" & macroName
    button.Fill.ForeColor.RGB = fillColor
    button.Line.Visible = 0
    On Error Resume Next
    button.TextFrame2.TextRange.Text = caption
    button.TextFrame2.TextRange.Font.Name = "Yu Gothic UI"
    button.TextFrame2.TextRange.Font.Size = 11
    button.TextFrame2.TextRange.Font.Bold = True
    button.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = RGB(255, 255, 255)
    button.TextFrame2.VerticalAnchor = 3
    button.TextFrame2.TextRange.ParagraphFormat.Alignment = 2
    If Err.Number <> 0 Then
        Err.Clear
        button.TextFrame.Characters.Text = caption
        button.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
        button.TextFrame.Characters.Font.Bold = True
    End If
    On Error GoTo 0
End Sub

Public Sub Mvp2ApplyProtection()
    If Not Mvp2WorkbookIsInitialized() Then Exit Sub
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

    Dim statusText As String
    Dim statusColor As Long
    Dim activeSession As String
    activeSession = Mvp2MetaGet("activeSessionId")
    Dim nowValue As Date
    nowValue = Now
    Dim lastSaveText As String
    lastSaveText = Mvp2MetaGet("lastSaveAt")

    If Len(activeSession) > 0 Then
        statusColor = RGB(253, 230, 228)
        Dim startedText As String
        Dim activeGuidance As String
        startedText = Mvp2MetaGet("sessionStartedAt")
        If ThisWorkbook.ReadOnly Then
            activeGuidance = "このExcelでは閲覧だけできます。作業中の内容は変更できません。"
        Else
            activeGuidance = "作業を終える場合は、HTMLでデータを作り、この画面の保存ボタンを押してください。"
        End If
        statusText = "HTMLで始めた作業が、Excel側でまだ終了していません" & vbLf & vbLf & _
                     "編集画面を開いた時刻：" & Mvp2DisplayDateTime(startedText) & vbLf & _
                     "最後にExcelへ保存：" & IIf(Len(lastSaveText) > 0, Mvp2DisplayDateTime(lastSaveText), "保存履歴なし") & vbLf & _
                     "現在時刻　　　　　　：" & Format$(nowValue, "yyyy/mm/dd hh:nn") & vbLf & _
                     "経過時間　　　　　　：" & Mvp2ElapsedText(startedText, nowValue) & vbLf & _
                     activeGuidance
    ElseIf Len(lastSaveText) = 0 Then
        statusColor = RGB(255, 245, 204)
        If ThisWorkbook.ReadOnly Then
            statusText = "保存履歴はありません" & vbLf & vbLf & "このExcelでは閲覧だけできます。"
        Else
            statusText = "保存履歴はありません" & vbLf & vbLf & "「編集する」から作業を始めてください。"
        End If
    ElseIf IsDate(lastSaveText) And nowValue < CDate(lastSaveText) Then
        statusColor = RGB(255, 245, 204)
        statusText = "PCの時刻が、最後に保存した時刻より前になっています" & vbLf & vbLf & _
                     "最終保存：" & Mvp2DisplayDateTime(lastSaveText) & vbLf & _
                     "保存者　：" & Mvp2MetaGet("lastSaveAuthor") & "さん" & vbLf & _
                     "PCの日時設定を確認してください。"
    ElseIf IsDate(lastSaveText) And DateDiff("n", CDate(lastSaveText), nowValue) >= MVP2_STALE_HOURS * 60 Then
        statusColor = RGB(255, 245, 204)
        statusText = "最後の保存から24時間以上経過しています" & vbLf & vbLf & _
                     "最終保存：" & Mvp2DisplayDateTime(lastSaveText) & vbLf & _
                     "保存者　：" & Mvp2MetaGet("lastSaveAuthor") & "さん" & vbLf & _
                     "経過時間：" & Mvp2ElapsedText(lastSaveText, nowValue)
    Else
        statusColor = RGB(224, 245, 234)
        statusText = "保存は完了しています" & vbLf & vbLf & _
                     "最終保存：" & Mvp2DisplayDateTime(lastSaveText) & vbLf & _
                     "保存者　：" & Mvp2MetaGet("lastSaveAuthor") & "さん"
    End If

    ws.Range("B4").Value2 = statusText
    ws.Range("B4:N7").Interior.Color = statusColor
    ws.Range("B4:N7").Font.Color = IIf(statusColor = RGB(253, 230, 228), RGB(145, 36, 27), RGB(23, 50, 77))

    Mvp2UpdateCard ws.Range("B11"), 1
    Mvp2UpdateCard ws.Range("I11"), 2
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

Private Sub Mvp2UpdateReadOnlyControls(ByVal ws As Object)
    Dim readOnlyMode As Boolean
    readOnlyMode = ThisWorkbook.ReadOnly

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

    If readOnlyMode Then
        ws.Range("B30").Value2 = "このExcelではデータの入力・編集・保存はできません。「閲覧する」または「これまでの保存を見る」を利用してください。"
    Else
        ws.Range("B30").Value2 = "数字やデータはこのExcelへ直接入力しません。編集は「編集する」からHTMLで行い、最後に「セーブデータをExcelに保存する」を押してください。"
    End If

    Mvp2SetButtonEnabled ws, "OpenReadOnlyHtml", True, RGB(91, 116, 139)
    Mvp2SetButtonEnabled ws, "OpenEditHtml", Not readOnlyMode, RGB(23, 105, 170)
    Mvp2SetButtonEnabled ws, "ImportSaveData", Not readOnlyMode, RGB(20, 122, 85)
    Mvp2SetButtonEnabled ws, "OpenSaveHistory", True, RGB(91, 116, 139)
    Mvp2SetButtonEnabled ws, "ExitWorkbook", True, RGB(74, 86, 99)
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

Private Sub Mvp2UpdateCard(ByVal target As Object, ByVal successNumber As Long)
    Dim revision As Long
    Dim savedAt As Variant
    Dim author As String
    If Mvp2GetSuccessHistory(successNumber, revision, savedAt, author) Then
        target.Value2 = "revision " & revision & vbLf & vbLf & _
                        "保存日時：" & Format$(savedAt, "yyyy/mm/dd hh:nn") & vbLf & _
                        "保存者　：" & author
    ElseIf successNumber = 1 Then
        target.Value2 = "保存履歴はありません"
    Else
        target.Value2 = "1つ前の保存はありません"
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
    If IsDate(storedText) Then
        Mvp2DisplayDateTime = Format$(CDate(storedText), "yyyy/mm/dd hh:nn")
    Else
        Mvp2DisplayDateTime = storedText
    End If
End Function

Private Function Mvp2ElapsedText(ByVal startText As String, ByVal endValue As Date) As String
    If Not IsDate(startText) Then
        Mvp2ElapsedText = "不明"
        Exit Function
    End If
    Dim minutes As Long
    minutes = DateDiff("n", CDate(startText), endValue)
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
