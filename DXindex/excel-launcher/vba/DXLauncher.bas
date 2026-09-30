Attribute VB_Name = "DXLauncher"
Option Explicit

Private Const HOME_INDEX As Long = 1
Private Const ADMIN_INDEX As Long = 2
Private Const UI_FONT As String = "Meiryo UI"
Private mPage As Long, mCount As Long, mRows(1 To 24) As Long
Private mBusy As Boolean, mPaused As Boolean, mSnapshot As Boolean
Private mFull As Boolean, mFormula As Boolean, mStatus As Boolean, mRibbon As Boolean
Private mHead As Boolean, mGrid As Boolean, mTabs As Boolean, mHScroll As Boolean, mVScroll As Boolean
Private mZoom As Variant, mTop As Long, mLeft As Long, mScrollArea As String, mSelect As Long
Private mWin As Object
Private mLastError As String, mStage As String
Private mResumeAfterSave As Boolean
Private mAssembling As Boolean, mInitialized As Boolean

Public Function U(ByVal hex As String) As String
    Dim i As Long, n As Long
    For i = 1 To Len(hex) Step 4
        n = Val("&H" & Mid$(hex, i, 4))
        If n > 32767 Then n = n - 65536
        U = U & ChrW(n)
    Next i
End Function

Public Sub DXStart()
    On Error GoTo Failed
    If mBusy Then Exit Sub
    mPage = 1: mPaused = False
    mInitialized = True: mBusy = True
    ThisWorkbook.Worksheets(HOME_INDEX).Activate
    mBusy = False
    If DXRender() Then DXEnter
    Exit Sub
Failed:
    DXFailure "ホームの表示", Err.Description
End Sub

Public Sub DXActivated()
    If mBusy Or Not mInitialized Then Exit Sub
    If ActiveSheet Is ThisWorkbook.Worksheets(HOME_INDEX) Then
        If DXRender() Then
            If Not mPaused Then DXEnter
        End If
    End If
End Sub

Public Sub DXSheetActivated(ByVal sh As Object)
    If mBusy Or Not mInitialized Then Exit Sub
    If sh Is ThisWorkbook.Worksheets(HOME_INDEX) Then
        mPaused = False
        DXActivated
    Else
        DXRestore
    End If
End Sub

Public Sub DXDeactivated()
    If Not mBusy Then DXRestore
End Sub

Public Sub DXBeforeSave()
    mResumeAfterSave = mSnapshot
    DXRestore
End Sub

Public Sub DXAfterSave()
    If mResumeAfterSave Then
        mResumeAfterSave = False
        If ActiveWorkbook Is ThisWorkbook Then DXActivated
    End If
End Sub

Private Function RibbonVisible() As Boolean
    RibbonVisible = Application.CommandBars("Ribbon").Visible
End Function

Private Sub SetRibbon(ByVal visible As Boolean)
    On Error Resume Next
    Application.CommandBars("Ribbon").Visible = visible
    If Err.Number = 0 Then
        If RibbonVisible() = visible Then Exit Sub
    End If
    Err.Clear
    If visible Then
        Application.ExecuteExcel4Macro "SHOW.TOOLBAR(""Ribbon"",True)"
    Else
        Application.ExecuteExcel4Macro "SHOW.TOOLBAR(""Ribbon"",False)"
    End If
    Dim failure As String
    If Err.Number <> 0 Then failure = Err.Description
    On Error GoTo 0
    If Len(failure) > 0 Then Err.Raise vbObjectError + 4101, , failure
    If RibbonVisible() <> visible Then Err.Raise vbObjectError + 4102, , "リボンの表示状態を変更できません。"
End Sub

Public Function DXEnter(Optional ByVal quiet As Boolean = False) As Boolean
    If mBusy Or mPaused Then Exit Function
    If mSnapshot Then DXEnter = True: Exit Function
    Dim ws As Object, wasSaved As Boolean
    On Error GoTo Failed
    mBusy = True: mLastError = ""
    Set ws = ThisWorkbook.Worksheets(HOME_INDEX)
    Set mWin = ActiveWindow
    wasSaved = ThisWorkbook.Saved
    mStage = "表示設定の記録"
    mFull = Application.DisplayFullScreen
    mFormula = Application.DisplayFormulaBar
    mStatus = Application.DisplayStatusBar
    mRibbon = RibbonVisible()
    mHead = mWin.DisplayHeadings: mGrid = mWin.DisplayGridlines
    mTabs = mWin.DisplayWorkbookTabs
    mHScroll = mWin.DisplayHorizontalScrollBar: mVScroll = mWin.DisplayVerticalScrollBar
    mZoom = mWin.Zoom: mTop = mWin.ScrollRow: mLeft = mWin.ScrollColumn
    mScrollArea = ws.ScrollArea: mSelect = ws.EnableSelection
    mSnapshot = True
    mStage = "全画面表示"
    Application.DisplayFullScreen = True
    If Not Application.DisplayFullScreen Then Err.Raise vbObjectError + 4104, , "全画面表示に切り替えられません。"
    mStage = "リボン非表示"
    SetRibbon False
    Application.DisplayFormulaBar = False: Application.DisplayStatusBar = False
    mWin.DisplayHeadings = False: mWin.DisplayGridlines = False
    mWin.DisplayWorkbookTabs = False
    mWin.DisplayHorizontalScrollBar = False: mWin.DisplayVerticalScrollBar = False
    mWin.ScrollRow = 1: mWin.ScrollColumn = 1
    mStage = "セル選択の禁止"
    ws.Protect DrawingObjects:=True, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
    ws.EnableSelection = -4142
    ws.ScrollArea = "A1:AF38"
    If ws.EnableSelection <> -4142 Then Err.Raise vbObjectError + 4103, , "セル選択を禁止できません。"
    mStage = "表示倍率"
    FitHome
    ThisWorkbook.Saved = wasSaved
    mBusy = False
    DXEnter = True
    Exit Function
Failed:
    mLastError = mStage & ": " & Err.Description
    mBusy = False
    DXRestore
    mPaused = True
    UpdateMode
    If Not quiet Then MsgBox "この環境では全画面表示を完了できませんでした。通常表示へ戻しました。" & vbCrLf & mLastError & vbCrLf & "カードは通常表示でも利用できます。", vbExclamation, "DX アプリホーム"
End Function

Private Sub FitHome()
    Dim pct As Double, h As Double
    pct = (mWin.UsableWidth - 12) / 960 * 100
    h = (mWin.UsableHeight - 12) / 570 * 100
    If h < pct Then pct = h
    If pct > 180 Then pct = 180
    If pct < 50 Then pct = 50
    mWin.Zoom = Int(pct)
End Sub

Public Sub DXResize()
    If mBusy Or Not mSnapshot Then Exit Sub
    On Error GoTo Failed
    mBusy = True: FitHome: mBusy = False
    Exit Sub
Failed:
    mBusy = False
    DXFailure "画面サイズの調整", Err.Description
End Sub

Public Sub DXRestore()
    If Not mSnapshot Then Exit Sub
    Dim ws As Object, wasSaved As Boolean, failures As String
    mBusy = True
    Set ws = ThisWorkbook.Worksheets(HOME_INDEX)
    wasSaved = ThisWorkbook.Saved
    On Error Resume Next
    Application.DisplayFullScreen = mFull
    If Err.Number <> 0 Then failures = failures & "全画面 ": Err.Clear
    SetRibbon mRibbon
    If Err.Number <> 0 Then failures = failures & "リボン ": Err.Clear
    Application.DisplayFormulaBar = mFormula
    If Err.Number <> 0 Then failures = failures & "数式バー ": Err.Clear
    Application.DisplayStatusBar = mStatus
    If Err.Number <> 0 Then failures = failures & "ステータスバー ": Err.Clear
    mWin.DisplayHeadings = mHead: mWin.DisplayGridlines = mGrid
    mWin.DisplayWorkbookTabs = mTabs
    mWin.DisplayHorizontalScrollBar = mHScroll: mWin.DisplayVerticalScrollBar = mVScroll
    mWin.Zoom = mZoom: mWin.ScrollRow = mTop: mWin.ScrollColumn = mLeft
    ws.ScrollArea = mScrollArea: ws.EnableSelection = mSelect
    If Err.Number <> 0 Then failures = failures & "ウィンドウ設定 ": Err.Clear
    ThisWorkbook.Saved = wasSaved
    On Error GoTo 0
    mSnapshot = False: mBusy = False
    If Len(failures) > 0 Then
        mLastError = mLastError & " 復元未完了: " & failures
        MsgBox "次の表示設定を元に戻せませんでした。Excel／JUST Calcの表示メニューから確認してください。" & vbCrLf & failures, vbExclamation, "DX アプリホーム"
    End If
End Sub

Public Sub DXNormal()
    mPaused = True
    DXRestore
    DXRender
End Sub

Public Sub DXResume()
    mPaused = False
    If DXRender() Then DXEnter
End Sub

Public Sub DXHome()
    mPaused = False
    mBusy = True
    ThisWorkbook.Worksheets(HOME_INDEX).Activate
    mBusy = False
    DXActivated
End Sub

Public Sub DXManage()
    mPaused = True
    DXRestore
    ThisWorkbook.Worksheets(ADMIN_INDEX).Activate
End Sub

Public Sub DXClose()
    DXNormal
    ThisWorkbook.Close
End Sub

Private Sub ReadApps()
    Dim r As Long
    mCount = 0
    For r = 13 To 36
        If Len(Trim$(CStr(ThisWorkbook.Worksheets(ADMIN_INDEX).Cells(r, 2).Value2))) > 0 Then
            mCount = mCount + 1
            mRows(mCount) = r
        End If
    Next r
    If mPage < 1 Then mPage = 1
    If mPage > DXPages() Then mPage = DXPages()
End Sub

Public Function DXPages() As Long
    DXPages = Fix((mCount + 5) / 6)
    If DXPages < 1 Then DXPages = 1
End Function

Public Function DXPage() As Long
    DXPage = mPage
End Function

Public Function DXCount() As Long
    DXCount = mCount
End Function

Public Function DXIsFullscreen() As Boolean
    DXIsFullscreen = mSnapshot
End Function

Public Function DXError() As String
    DXError = mLastError
End Function

Public Sub DXTestEnterQuiet()
    mPaused = False
    DXEnter True
End Sub

Public Function DXRow(ByVal slot As Long) As Long
    Dim i As Long
    i = (mPage - 1) * 6 + slot
    If slot >= 1 And slot <= 6 And i <= mCount Then DXRow = mRows(i)
End Function

Public Sub DXNext()
    ReadApps
    If mPage < DXPages() Then mPage = mPage + 1
    DXRender
End Sub

Public Sub DXPrevious()
    If mPage > 1 Then mPage = mPage - 1
    DXRender
End Sub

Public Sub DXOpen1()
    DXOpenSlot 1
End Sub
Public Sub DXOpen2()
    DXOpenSlot 2
End Sub
Public Sub DXOpen3()
    DXOpenSlot 3
End Sub
Public Sub DXOpen4()
    DXOpenSlot 4
End Sub
Public Sub DXOpen5()
    DXOpenSlot 5
End Sub
Public Sub DXOpen6()
    DXOpenSlot 6
End Sub

Public Sub DXOpenSlot(ByVal slot As Long)
    Dim r As Long, target As String, caption As String
    r = DXRow(slot)
    If r = 0 Then Exit Sub
    target = Trim$(CStr(ThisWorkbook.Worksheets(ADMIN_INDEX).Cells(r, 5).Value2))
    If Len(target) = 0 Then Exit Sub
    caption = CStr(ThisWorkbook.Worksheets(ADMIN_INDEX).Cells(r, 2).Value2)
    DXLaunch target, caption
End Sub

Public Sub DXGuide()
    DXLaunch CStr(ThisWorkbook.Worksheets(ADMIN_INDEX).Range("C8").Value2), "活動ガイド"
End Sub

Public Function DXLaunch(ByVal target As String, ByVal caption As String, Optional ByVal quiet As Boolean = False) As Boolean
    On Error GoTo Failed
    DXRestore
    target = Trim$(target)
    If Len(target) = 0 Then Err.Raise vbObjectError + 4110, , "起動先が登録されていません。"
    If Left$(target, 1) = Chr$(34) And Right$(target, 1) = Chr$(34) Then target = Mid$(target, 2, Len(target) - 2)
    If InStr(1, target, "://", vbTextCompare) = 0 Then
        If Left$(target, 1) <> "/" And Left$(target, 2) <> String$(2, Chr$(92)) And Mid$(target, 2, 1) <> ":" Then target = ThisWorkbook.Path & Application.PathSeparator & target
        If Len(Dir$(target)) = 0 Then Err.Raise vbObjectError + 4111, , "ファイルが見つかりません。共有先への接続と登録したパスを確認してください。"
    ElseIf LCase$(Left$(target, 7)) <> "http://" And LCase$(Left$(target, 8)) <> "https://" Then
        Err.Raise vbObjectError + 4112, , "起動先にはファイルのパス、またはhttp／httpsのURLを登録してください。"
    End If
    mBusy = True
    If InStr(1, Application.OperatingSystem, "Mac", vbTextCompare) > 0 And Left$(target, 1) = "/" Then
        target = "file://" & Replace(Replace(Replace(target, "%", "%25"), " ", "%20"), "#", "%23")
    End If
    ThisWorkbook.FollowHyperlink Address:=target, NewWindow:=True
    mBusy = False
    DXLaunch = True
    Exit Function
Failed:
    mBusy = False: mPaused = True
    mLastError = caption & ": " & Err.Description
    DXRestore
    DXRender
    If Not quiet Then MsgBox "アプリを開けませんでした。" & vbCrLf & mLastError, vbExclamation, "DX アプリホーム"
End Function

Private Sub DXFailure(ByVal action As String, ByVal detail As String)
    mBusy = False: mPaused = True
    mLastError = action & ": " & detail
    DXRestore
    MsgBox mLastError, vbExclamation, "DX アプリホーム"
End Sub

Public Function DXRender() As Boolean
    If mBusy Then Exit Function
    Dim ws As Object, admin As Object, saved As Boolean, screen As Boolean, i As Long
    On Error GoTo Failed
    mBusy = True: saved = ThisWorkbook.Saved: screen = Application.ScreenUpdating
    If mAssembling Then Application.ScreenUpdating = False
    Set ws = ThisWorkbook.Worksheets(HOME_INDEX)
    Set admin = ThisWorkbook.Worksheets(ADMIN_INDEX)
    For i = 1 To admin.Shapes.Count
        If admin.Shapes(i).Name = "dx_home" Then Bind admin.Shapes(i), "DXHome"
    Next i
    ws.Unprotect
    ReadApps
    AddText ws, "brand", "DX推進委員会", 20, 10, 320, 20, 12, RGB(104, 121, 136)
    AddText ws, "title", "DX アプリホーム", 20, 32, 490, 44, 30, RGB(38, 59, 75), True
    AddButton ws, "guide", "活動ガイド", "DXGuide", 590, 28, 112, 40, RGB(228, 245, 238), RGB(23, 107, 83)
    AddButton ws, "admin", "管理", "DXManage", 710, 28, 64, 40, RGB(234, 239, 243), RGB(70, 89, 105)
    If mPaused Then
        AddButton ws, "mode", "全画面にする", "DXResume", 782, 28, 100, 40, RGB(234, 239, 243), RGB(70, 89, 105)
    Else
        AddButton ws, "mode", "通常表示", "DXNormal", 782, 28, 100, 40, RGB(234, 239, 243), RGB(70, 89, 105)
    End If
    AddButton ws, "close", "閉じる", "DXClose", 890, 28, 60, 40, RGB(234, 239, 243), RGB(70, 89, 105)
    Dim message As String
    message = CStr(admin.Range("C5").Value2)
    If Len(message) > 0 Then
        AddText ws, "notice_label", "委員会から一言", 20, 84, 112, 26, 11, RGB(104, 121, 136)
        AddText ws, "notice", message, 144, 78, 804, 34, 12, RGB(82, 100, 116)
        HideShape ws, "section"
    Else
        AddText ws, "section", "使いたいアプリを選んでください", 20, 84, 720, 28, 14, RGB(70, 89, 105)
        HideShape ws, "notice_label"
        HideShape ws, "notice"
    End If
    For i = 1 To 6
        If DXRow(i) > 0 Then
            DrawCard ws, admin, i, DXRow(i)
        Else
            HideCard ws, i
        End If
    Next i
    If mCount = 0 Then
        AddText ws, "empty", "右上の「管理」からアプリを登録してください。", 100, 230, 780, 80, 19, RGB(104, 121, 136)
    Else
        HideShape ws, "empty"
    End If
    ' Show the new count only after the cards have been updated successfully.
    AddText ws, "count", CStr(mCount) & " アプリ", 848, 536, 102, 26, 13, RGB(104, 121, 136)
    Dim previous As String, following As String
    If mPage > 1 Then previous = "DXPrevious"
    If mPage < DXPages() Then following = "DXNext"
    AddButton ws, "previous", "前へ", previous, 344, 534, 92, 30, RGB(234, 239, 243), RGB(70, 89, 105)
    AddText ws, "page", CStr(mPage) & " / " & CStr(DXPages()), 462, 536, 72, 26, 14, RGB(70, 89, 105)
    AddButton ws, "next", "次へ", following, 554, 534, 92, 30, RGB(234, 239, 243), RGB(70, 89, 105)
    AddText ws, "version", "全画面版  r4", 20, 540, 260, 22, 10, RGB(104, 121, 136)
    mStage = "ホームの保護"
    ws.Protect DrawingObjects:=True, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
    ws.EnableSelection = -4142
    Application.ScreenUpdating = screen
    ThisWorkbook.Saved = saved
    mBusy = False
    DXRender = True
    Exit Function
Failed:
    Dim detail As String
    detail = mStage & ": " & Err.Description
    Application.ScreenUpdating = screen
    mBusy = False
    DXFailure "カードの表示", detail
End Function

Private Sub DrawCard(ByVal ws As Object, ByVal admin As Object, ByVal slot As Long, ByVal row As Long)
    Dim x As Single, y As Single, accent As Long, light As Long, a As Variant, b As Variant
    Dim name As String, description As String, category As String, icon As String, action As String, state As String
    a = Array(RGB(34, 122, 96), RGB(79, 100, 172), RGB(172, 99, 41), RGB(128, 96, 171), RGB(169, 83, 114), RGB(50, 126, 137))
    b = Array(RGB(228, 245, 238), RGB(232, 238, 255), RGB(253, 237, 220), RGB(240, 233, 252), RGB(251, 231, 236), RGB(224, 242, 245))
    ' Each saved slot owns its palette, so runtime never needs to recolor fonts.
    accent = a((slot - 1) Mod 6): light = b((slot - 1) Mod 6)
    x = 20 + ((slot - 1) Mod 3) * 312: y = 114 + Fix((slot - 1) / 3) * 212
    name = CStr(admin.Cells(row, 2).Value2): description = CStr(admin.Cells(row, 3).Value2)
    category = CStr(admin.Cells(row, 4).Value2): icon = CStr(admin.Cells(row, 6).Value2)
    If Len(icon) = 0 Then icon = Left$(name, 1)
    action = "DXOpen" & CStr(slot)
    state = "開く"
    If Len(Trim$(CStr(admin.Cells(row, 5).Value2))) = 0 Then action = "": state = "準備中"
    AddButton ws, "card" & slot, "", action, x, y, 296, 202, RGB(255, 255, 255), accent
    AddButton ws, "icon" & slot, icon, action, x + 16, y + 10, 34, 32, light, accent, 22
    AddText ws, "category" & slot, category, x + 62, y + 14, 218, 26, 12, accent, False, action
    AddText ws, "name" & slot, name, x + 16, y + 44, 264, 80, 21, RGB(38, 59, 75), True, action
    AddText ws, "desc" & slot, description, x + 16, y + 126, 264, 50, 13, RGB(82, 100, 116), False, action
    AddText ws, "open" & slot, state, x + 206, y + 178, 74, 22, 13, accent, True, action
End Sub

Private Sub AddText(ByVal ws As Object, ByVal name As String, ByVal caption As String, ByVal x As Single, ByVal y As Single, ByVal width As Single, ByVal height As Single, ByVal size As Single, ByVal color As Long, Optional ByVal bold As Boolean = False, Optional ByVal action As String = "")
    Dim s As Object
    Set s = ExistingShape(ws, name)
    If s Is Nothing Then
        Set s = ws.Shapes.AddTextbox(1, x, y, width, height)
        s.Name = "dx_" & name: s.Line.Visible = 0: s.Fill.Visible = 0
    End If
    Bind s, action
    SetText s, caption, size, color, bold, False
    s.Visible = -1
End Sub

Private Sub AddButton(ByVal ws As Object, ByVal name As String, ByVal caption As String, ByVal action As String, ByVal x As Single, ByVal y As Single, ByVal width As Single, ByVal height As Single, ByVal fill As Long, ByVal color As Long, Optional ByVal size As Single = 13)
    Dim s As Object
    Set s = ExistingShape(ws, name)
    If s Is Nothing Then
        Set s = ws.Shapes.AddShape(5, x, y, width, height)
        s.Name = "dx_" & name: s.Line.Visible = 0
        On Error Resume Next
        s.Adjustments.Item(1) = 0.12
        On Error GoTo 0
    End If
    If s.Fill.ForeColor.RGB <> fill Then s.Fill.ForeColor.RGB = fill
    Bind s, action
    ' Card backgrounds contain no text. Do not touch their text/font objects.
    If Left$(name, 4) <> "card" Then SetText s, caption, size, color, True, True
    s.Visible = -1
End Sub

Private Sub Bind(ByVal shape As Object, ByVal action As String)
    Dim expected As String, current As String
    mStage = shape.Name & " のクリック設定"
    If mAssembling Then shape.Locked = True: shape.Placement = 3
    current = shape.OnAction
    If Len(action) > 0 Then expected = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!" & action
    If current = expected Then Exit Sub
    If Len(action) > 0 Then
        If current = "[0]!" & action Or current = action Then Exit Sub
    End If
    shape.OnAction = expected
End Sub

Private Sub SetText(ByVal shape As Object, ByVal caption As String, ByVal size As Single, ByVal color As Long, ByVal bold As Boolean, ByVal center As Boolean)
    ' Runtime uses the legacy text API; keep the saved layout and glyph settings.
    mStage = shape.Name & " の文字更新"
    With shape.TextFrame
        If .Characters.Text <> caption Then .Characters.Text = caption
    End With
    If Not mAssembling Then Exit Sub
    ' Advanced typography is applied only in the development Excel build.
    With shape.TextFrame2
        .TextRange.Text = caption
        .MarginLeft = 0: .MarginRight = 0: .MarginTop = 0: .MarginBottom = 0
        .WordWrap = -1
        .TextRange.Font.Name = UI_FONT
        SetAsianFont .TextRange.Font
        .TextRange.Font.Size = size
        .TextRange.Font.Bold = bold
        .TextRange.Font.Fill.ForeColor.RGB = color
        .TextRange.ParagraphFormat.SpaceBefore = 0
        .TextRange.ParagraphFormat.SpaceAfter = 0
        SetLineSpacing .TextRange.ParagraphFormat, size
        If center Then .VerticalAnchor = 3: .TextRange.ParagraphFormat.Alignment = 2
    End With
End Sub

Private Function ExistingShape(ByVal ws As Object, ByVal name As String) As Object
    mStage = "保存済み図形 dx_" & name & " の確認"
    On Error Resume Next
    Set ExistingShape = ws.Shapes("dx_" & name)
    On Error GoTo 0
    If ExistingShape Is Nothing And Not mAssembling Then
        Err.Raise vbObjectError + 4120, , "図形が見つかりません。配布ブックを開き直してください。"
    End If
End Function

Private Sub HideShape(ByVal ws As Object, ByVal name As String)
    Dim s As Object
    Set s = ExistingShape(ws, name)
    If Not s Is Nothing Then s.Visible = 0
End Sub

Private Sub HideCard(ByVal ws As Object, ByVal slot As Long)
    Dim part As Variant, s As Object
    For Each part In Array("card", "icon", "category", "name", "desc", "open")
        Set s = ExistingShape(ws, CStr(part) & CStr(slot))
        If Not s Is Nothing Then
            Bind s, ""
            s.Visible = 0
        End If
    Next part
End Sub

Private Sub UpdateMode()
    ' Called after a display rollback; never rebuild the home or recurse into DXRender.
    Dim ws As Object, s As Object, saved As Boolean
    On Error Resume Next
    saved = ThisWorkbook.Saved
    Set ws = ThisWorkbook.Worksheets(HOME_INDEX)
    ws.Unprotect
    Set s = ws.Shapes("dx_mode")
    s.TextFrame.Characters.Text = "全画面にする"
    Bind s, "DXResume"
    ws.Protect DrawingObjects:=True, Contents:=True, Scenarios:=True, UserInterfaceOnly:=True
    ws.EnableSelection = -4142
    ThisWorkbook.Saved = saved
    On Error GoTo 0
End Sub

Public Sub DXDiagnostics()
    Dim report As String, ws As Object
    On Error Resume Next
    report = "DX アプリホーム r4" & vbCrLf & Application.Name & " " & Application.Version & vbCrLf & Application.OperatingSystem
    report = report & vbCrLf & "最終処理: " & mStage & vbCrLf & "エラー: " & mLastError
    Set ws = ThisWorkbook.Worksheets(HOME_INDEX)
    report = report & vbCrLf & "図形数: " & CStr(ws.Shapes.Count) & vbCrLf & "タイトル: " & ws.Shapes("dx_title").TextFrame.Characters.Text
    report = report & vbCrLf & "管理ボタン: " & ws.Shapes("dx_admin").OnAction
    report = report & vbCrLf & "全画面: " & CStr(Application.DisplayFullScreen) & " / 選択制限: " & CStr(ws.EnableSelection)
    DXNormal
    MsgBox report, vbInformation, "DX 動作情報"
End Sub

Private Sub SetAsianFont(ByVal font As Object)
    ' Some compatible engines expose Name but not NameFarEast.
    On Error Resume Next
    font.NameFarEast = UI_FONT
    On Error GoTo 0
End Sub

Private Sub SetLineSpacing(ByVal paragraph As Object, ByVal size As Single)
    On Error Resume Next
    paragraph.LineRuleWithin = 0
    paragraph.SpaceWithin = size * 1.18
    On Error GoTo 0
End Sub

' Assembly only. Call once after importing the modules into the artifact template.
Public Sub DXAssemble()
    Dim ws As Object, i As Long
    On Error GoTo Failed
    mAssembling = True: mInitialized = True
    Set ws = ThisWorkbook.Worksheets(HOME_INDEX)
    ws.Unprotect
    ws.Cells.UnMerge
    ws.Range("A1:AF38").ClearContents
    ws.Range("A1:AF38").Interior.Color = RGB(244, 246, 248)
    ws.Columns("A:AF").ColumnWidth = 5
    ws.Columns("A:AF").ColumnWidth = 5 * 960 / ws.Range("A1:AF1").Width
    ws.Rows("1:38").RowHeight = 15
    ' Save all six slots and optional labels. Runtime never adds or deletes shapes.
    For i = 1 To 6
        DrawCard ws, ThisWorkbook.Worksheets(ADMIN_INDEX), i, 12 + i
    Next i
    AddText ws, "notice_label", "委員会から一言", 20, 84, 112, 26, 11, RGB(104, 121, 136)
    AddText ws, "notice", "", 144, 78, 804, 34, 12, RGB(82, 100, 116)
    AddText ws, "empty", "右上の「管理」からアプリを登録してください。", 100, 230, 780, 80, 19, RGB(104, 121, 136)
    mPage = 1: mPaused = True
    DXRender
    Set ws = ThisWorkbook.Worksheets(ADMIN_INDEX)
    For i = ws.Shapes.Count To 1 Step -1
        If Left$(ws.Shapes(i).Name, 3) = "dx_" Then ws.Shapes(i).Delete
    Next i
    AddButton ws, "home", "ホームに戻る", "DXHome", ws.Range("F1").Left, 5, 175, 38, RGB(34, 122, 96), RGB(255, 255, 255)
    ws.Range("F2:G2").ClearContents
    ws.Range("A1:G43").Font.Name = UI_FONT
    ws.Range("A1:G43").Font.Size = 12
    ws.Range("B2:E2").Font.Size = 24
    ws.Rows("2:2").RowHeight = 36
    ws.Rows("3:12").RowHeight = 25
    ws.Range("B13:G36").Font.Size = 13
    ws.Rows("13:36").RowHeight = 58
    ws.Range("B11").Value2 = "アプリは上から順に表示されます。名前が空欄の行は表示しません。"
    ws.Range("F12").Value2 = "アイコン"
    AddLengthValidation ws.Range("B13:B36"), 28
    AddLengthValidation ws.Range("C13:C36"), 50
    AddLengthValidation ws.Range("F13:F36"), 1
    AddLengthValidation ws.Range("C5"), 100
    ThisWorkbook.Worksheets(HOME_INDEX).Activate
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.DisplayHeadings = False
    ActiveWindow.Zoom = 90
    mAssembling = False
    Exit Sub
Failed:
    mAssembling = False
    DXFailure "配布用画面の作成", Err.Description
End Sub

Private Sub AddLengthValidation(ByVal area As Object, ByVal maximum As Long)
    area.Validation.Delete
    area.Validation.Add Type:=6, AlertStyle:=1, Operator:=xlLessEqual, Formula1:=CStr(maximum)
    area.Validation.IgnoreBlank = True
    area.Validation.ShowInput = False
    area.Validation.ShowError = True
    area.Validation.ErrorTitle = "文字数を確認してください"
    area.Validation.ErrorMessage = CStr(maximum) & "文字以内で入力してください。"
End Sub
