Attribute VB_Name = "DXNativeTests"
Option Explicit
Private oldFull As Boolean, oldRibbon As Boolean, oldFormula As Boolean, oldStatus As Boolean
Private reviewData As Variant

Public Sub DXProbeRibbon()
    DXNormal
    oldFull = Application.DisplayFullScreen
    oldRibbon = Application.CommandBars("Ribbon").Visible
    oldFormula = Application.DisplayFormulaBar
    oldStatus = Application.DisplayStatusBar
    Application.DisplayFullScreen = True
    Dim result As Variant, f As Integer
    result = Application.ExecuteExcel4Macro("SHOW.TOOLBAR(""Ribbon"",False)")
    Application.DisplayFormulaBar = False
    Application.DisplayStatusBar = False
    f = FreeFile
    Open ThisWorkbook.Path & Application.PathSeparator & "ribbon-probe.txt" For Output As #f
    Print #f, "SHOW.TOOLBAR return=" & CStr(result)
    Print #f, "Visible property=" & CStr(Application.CommandBars("Ribbon").Visible)
    Print #f, "Fullscreen property=" & CStr(Application.DisplayFullScreen)
    Close #f
End Sub

Public Sub DXProbeRestore()
    Application.DisplayFullScreen = oldFull
    If oldRibbon Then
        Application.ExecuteExcel4Macro "SHOW.TOOLBAR(""Ribbon"",True)"
    Else
        Application.ExecuteExcel4Macro "SHOW.TOOLBAR(""Ribbon"",False)"
    End If
    Application.DisplayFormulaBar = oldFormula
    Application.DisplayStatusBar = oldStatus
End Sub

Public Sub DXRunNativeTests()
    Dim admin As Object, home As Object, original As Variant, message As Variant, saved As Boolean
    Dim i As Long, p As Long, f As Integer, oldEvents As Boolean, before As String, other As Object, entered As Boolean
    Dim shapeCount As Long, titleId As Long, sixthId As Long
    On Error GoTo Failed
    DXNormal
    Set admin = ThisWorkbook.Worksheets(2): Set home = ThisWorkbook.Worksheets(1)
    original = admin.Range("B13:F36").Value2
    message = admin.Range("C5").Value2
    saved = ThisWorkbook.Saved
    f = FreeFile
    Open ThisWorkbook.Path & Application.PathSeparator & "native-tests.txt" For Output As #f
    Print #f, "Engine=" & Application.Name & " " & Application.Version
    Print #f, "OS=" & Application.OperatingSystem
    shapeCount = home.Shapes.Count
    titleId = home.Shapes("dx_title").ID
    sixthId = home.Shapes("dx_name6").ID
    Check home.Shapes("dx_card3").Visible = 0, "unused saved slots are hidden", f
    Check DXCount() = 2, "initial 2 apps", f
    Check home.EnableSelection = -4142, "home blocks cell selection in normal mode", f
    Check DXPages() = 1 And DXRow(1) = 13 And DXRow(2) = 14 And DXRow(3) = 0, "initial mapping", f
    Check home.Shapes("dx_name2").TextFrame2.TextRange.Text = admin.Range("B14").Value2, "Japanese multiline title preserved", f
    CheckLengthRule admin.Range("B13"), 28, f
    CheckLengthRule admin.Range("C13"), 50, f
    CheckLengthRule admin.Range("F13"), 1, f
    CheckLengthRule admin.Range("C5"), 100, f
    Check home.Shapes("dx_name1").TextFrame2.TextRange.Font.NameFarEast = "Meiryo UI", "explicit Japanese UI font", f
    Check home.Shapes("dx_name1").TextFrame2.TextRange.Font.Size = 21, "app title enlarged from 16 to 21 pt", f
    Check home.Shapes("dx_desc1").TextFrame2.TextRange.Font.Size = 13, "description enlarged from 10 to 13 pt", f
    admin.Range("B15").Value2 = U("8FFD52A030A230D730EA")
    admin.Range("C15").Value2 = U("00334EF676EE306E767B933230FB8868793A78BA8A8D")
    admin.Range("D15").Value2 = U("696D52D9652F63F4")
    admin.Range("E15").Value2 = "registered-third-app.xlsm"
    admin.Range("F15").Value2 = U("8FFD")
    Check DXRender(), "third app update completes", f
    Check DXCount() = 3 And home.Shapes("dx_count").TextFrame.Characters.Text = "3 " & U("30A230D730EA"), "third app count matches", f
    For Each other In home.Shapes
        If other.Name = "dx_card3" Or other.Name = "dx_name3" Or other.Name = "dx_icon3" Or other.Name = "dx_category3" Or other.Name = "dx_desc3" Or other.Name = "dx_open3" Then
            Check other.Visible = -1 And InStr(other.OnAction, "DXOpen3") > 0, "third app visible and bound " & other.Name, f
        End If
    Next other
    Set other = Nothing
    Check home.Shapes("dx_name3").TextFrame.Characters.Text = admin.Range("B15").Value2, "third app Japanese title", f
    Check home.Shapes("dx_name3").TextFrame2.TextRange.Font.Size = 21, "third app keeps saved title font", f
    admin.Range("B13:F36").Value2 = original
    DXRender
    admin.Range("B13").Value2 = Replace(String$(28, "A"), "A", U("754C"))
    admin.Range("C13").Value2 = Replace(String$(50, "A"), "A", U("754C"))
    DXRender
    Print #f, "Title bounds=" & home.Shapes("dx_name1").TextFrame2.TextRange.BoundHeight & " frame=" & home.Shapes("dx_name1").Height & " spacing=" & home.Shapes("dx_name1").TextFrame2.TextRange.ParagraphFormat.SpaceWithin
    Print #f, "Description bounds=" & home.Shapes("dx_desc1").TextFrame2.TextRange.BoundHeight & " frame=" & home.Shapes("dx_desc1").Height
    Check home.Shapes("dx_name1").TextFrame2.TextRange.BoundHeight <= home.Shapes("dx_name1").Height, "28 Japanese characters fit title", f
    Check home.Shapes("dx_desc1").TextFrame2.TextRange.BoundHeight <= home.Shapes("dx_desc1").Height, "50 Japanese characters fit description", f
    admin.Range("B13:F36").Value2 = original
    DXRender
    admin.Range("E13").Value2 = "registered-file.xlsm"
    DXRender
    For Each other In home.Shapes
        If other.Name = "dx_card1" Or other.Name = "dx_name1" Or other.Name = "dx_icon1" Or other.Name = "dx_desc1" Or other.Name = "dx_open1" Then Check InStr(other.OnAction, "DXOpen1") > 0, "whole card binding " & other.Name, f
    Next other
    Set other = Nothing
    admin.Range("E13").Value2 = original(1, 4)
    DXRender
    Check Len(home.Shapes("dx_card1").OnAction) = 0 And Len(home.Shapes("dx_name1").OnAction) = 0, "clearing target removes old actions", f
    DXOpen1
    Check Workbooks.Count >= 1 And Not DXIsFullscreen(), "pending app does not launch", f
    For i = 13 To 36
        admin.Cells(i, 2).Value2 = "Test app " & CStr(i - 12)
        admin.Cells(i, 3).Value2 = U("8868793A306B5FC58981306A8AAC660E6587306E95773055309230533053306778BA8A8D3057307E305930023053306E65875357306F691C8A3C7528306730593002")
        admin.Cells(i, 4).Value2 = U("696D52D9652F63F4")
        admin.Cells(i, 5).Value2 = ""
        admin.Cells(i, 6).Value2 = "T"
    Next i
    admin.Range("C5").Value2 = "Notice test"
    DXRender
    Check DXCount() = 24 And DXPages() = 4, "24 apps / 4 pages", f
    For p = 1 To 4
        Check DXPage() = p And DXRow(1) = 13 + (p - 1) * 6 And DXRow(6) = 18 + (p - 1) * 6, "page " & CStr(p) & " mapping", f
        Check home.Shapes("dx_name6").TextFrame2.TextRange.Text = "Test app " & CStr(p * 6), "page " & CStr(p) & " label", f
        Check home.Shapes("dx_name6").TextFrame2.TextRange.Font.Size = 21, "page " & CStr(p) & " saved font survives legacy text update", f
        DXNext
    Next p
    Check DXPage() = 4, "next boundary", f
    For i = 1 To 5: DXPrevious: Next i
    Check DXPage() = 1, "previous boundary", f
    admin.Range("B14").ClearContents
    DXRender
    Check DXCount() = 23 And DXRow(2) = 15, "blank name compacts cards", f
    admin.Range("B13:B36").ClearContents
    DXRender
    Check DXCount() = 0 And DXPages() = 1 And DXRow(1) = 0, "zero apps", f
    Check home.Shapes("dx_empty").Visible = -1 And home.Shapes("dx_card1").Visible = 0, "empty state hides old cards", f
    admin.Range("B13:F36").Value2 = original
    admin.Range("C5").Value2 = message
    DXRender
    before = StateText()
    DXHomeForTest
    entered = DXIsFullscreen()
    If entered Then
        Check Application.DisplayFullScreen And Not Application.DisplayFormulaBar And Not Application.DisplayStatusBar, "fullscreen chrome", f
        Check home.EnableSelection = -4142, "no cell selection", f
        Set other = Workbooks.Add
        Check Not DXIsFullscreen(), "other workbook restores display", f
        Check StateText() = before, "application settings restored on deactivate", f
        other.Close SaveChanges:=False
        Set other = Nothing
        ThisWorkbook.Activate
        Check DXIsFullscreen(), "home reactivates fullscreen", f
    Else
        Print #f, "UNSUPPORTED fullscreen: " & DXError()
        Check StateText() = before, "unsupported display changes rolled back", f
    End If
    DXNormal
    Check home.Shapes.Count = shapeCount And home.Shapes("dx_title").ID = titleId And home.Shapes("dx_name6").ID = sixthId, "runtime retains original shape identities", f
    Check home.Shapes("dx_empty").Visible = 0 And home.Shapes("dx_card3").Visible = 0, "restoring two apps hides stale content", f
    Check Not DXIsFullscreen(), "normal mode exits", f
    Check StateText() = before, "normal mode preserves original application settings", f
    Check Not DXLaunch(ThisWorkbook.Path & Application.PathSeparator & "missing-launcher-test.xlsm", "Missing test", True), "missing file reports failure", f
    Check Not DXIsFullscreen() And InStr(DXError(), "Missing test") > 0, "launch error restores and identifies app", f
    admin.Range("B13:F36").Value2 = original
    admin.Range("C5").Value2 = message
    DXNormal
    ThisWorkbook.Saved = saved
    Print #f, "PASS: native functional suite complete; unsupported capabilities are recorded separately"
    Close #f
    MsgBox "Native tests completed. See native-tests.txt.", vbInformation
    Exit Sub
Failed:
    Dim detail As String
    detail = Err.Description
    On Error Resume Next
    DXNormal
    If Not other Is Nothing Then other.Close SaveChanges:=False
    If Not admin Is Nothing Then
        admin.Range("B13:F36").Value2 = original
        admin.Range("C5").Value2 = message
    End If
    DXRender
    ThisWorkbook.Saved = saved
    Print #f, "FAIL: " & detail
    Close #f
    MsgBox "Native test failed: " & detail, vbCritical
End Sub

Private Sub CheckLengthRule(ByVal cell As Object, ByVal limit As Long, ByVal f As Integer)
    Dim originalValue As Variant, n As Variant
    originalValue = cell.Value2
    Check cell.Validation.Operator = xlLessEqual, cell.Address & " uses maximum length", f
    Check Not cell.Validation.ShowInput, cell.Address & " no persistent input message", f
    For Each n In Array(0, 1, limit - 1, limit, limit + 1)
        cell.Value2 = Replace(String$(CLng(n), "A"), "A", U("754C"))
        Check cell.Validation.Value = (CLng(n) <= limit), cell.Address & " length " & CStr(n), f
    Next n
    cell.Value2 = originalValue
End Sub

Private Sub DXHomeForTest()
    ' Reset the paused flag without displaying a compatibility dialog.
    DXTestEnterQuiet
End Sub

Private Sub Check(ByVal condition As Boolean, ByVal label As String, ByVal f As Integer)
    If Not condition Then Err.Raise vbObjectError + 4900, , label
    Print #f, "PASS: " & label
End Sub

Private Function StateText() As String
    StateText = CStr(Application.DisplayFullScreen) & "," & CStr(Application.CommandBars("Ribbon").Visible) & "," & CStr(Application.DisplayFormulaBar) & "," & CStr(Application.DisplayStatusBar)
End Function

Public Sub DXShowSixForReview()
    Dim i As Long, admin As Object
    DXNormal
    Set admin = ThisWorkbook.Worksheets(2)
    reviewData = admin.Range("B13:F36").Value2
    For i = 15 To 18
        admin.Cells(i, 2).Value2 = U("8FFD52A030A230D730EA306E8868793A78BA8A8D") & " " & CStr(i - 12)
        admin.Cells(i, 3).Value2 = U("3053306E30AB30FC30C9306F30EC30A430A230A630C8306E78BA8A8D7528306730593002")
        admin.Cells(i, 4).Value2 = U("696D52D9652F63F4")
        admin.Cells(i, 5).Value2 = ""
        admin.Cells(i, 6).Value2 = U("691C")
    Next i
    admin.Range("B15").Value2 = Replace(String$(28, "A"), "A", U("754C"))
    admin.Range("C15").Value2 = Replace(String$(50, "A"), "A", U("754C"))
    DXRender
End Sub

Public Sub DXRestoreReview()
    ThisWorkbook.Worksheets(2).Range("B13:F36").Value2 = reviewData
    DXNormal
End Sub

Public Sub DXShowThirdForReview()
    DXNormal
    Dim admin As Object
    Set admin = ThisWorkbook.Worksheets(2)
    reviewData = admin.Range("B13:F36").Value2
    admin.Range("B15").Value2 = U("8FFD52A030A230D730EA")
    admin.Range("C15").Value2 = U("00334EF676EE306E767B933230FB8868793A78BA8A8D")
    admin.Range("D15").Value2 = U("696D52D9652F63F4")
    admin.Range("E15").Value2 = ""
    admin.Range("F15").Value2 = U("8FFD")
    DXRender
End Sub
