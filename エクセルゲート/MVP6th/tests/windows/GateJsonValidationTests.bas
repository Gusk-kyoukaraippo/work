Attribute VB_Name = "GateJsonValidationTests"
Option Explicit

' Native VBA checks; scalar/array/empty-object cases need no Windows COM.
Public Sub GateRunJsonValidationTests()
    On Error GoTo Failed
    Dim value As Variant, checks As Long
    For Each value In Array("1 2", "[1 2]", "tr ue", "fal se", "nu ll", "1 e2", "- 1", "1 .2", "1e +2", "1e+ 2", "[false true]", "[null null]", "[1,]", "[", "01", "1.", "1e", "", "   ", "[" & vbTab & "1" & vbLf & "2]")
        JsonExpectRejected CStr(value), checks
    Next value
    JsonExpectAccepted " 12 ", "12", checks
    JsonExpectAccepted " [ 1, 2 ] ", "[1,2]", checks
    JsonExpectAccepted vbCrLf & "[ true, false, null, -1.25e+2 ]" & vbTab, "[true,false,null,-1.25e+2]", checks
    JsonExpectAccepted " [ ] ", "[]", checks
    JsonExpectAccepted " { } ", "{}", checks
    JsonExpectAccepted "[ " & Chr$(34) & "1 2" & Chr$(34) & " ]", "[" & Chr$(34) & "1 2" & Chr$(34) & "]", checks
    JsonExpectAccepted "[ " & Chr$(34) & "a" & Chr$(92) & "n b" & Chr$(34) & " ]", "[" & Chr$(34) & "a" & Chr$(92) & "n b" & Chr$(34) & "]", checks
    JsonExpectAccepted " [ [ 0 ], [ -0, 0.1, 1e-2 ] ] ", "[[0],[-0,0.1,1e-2]]", checks
    Dim level As Long, nested As String
    nested = "0"
    For level = 1 To 63
        nested = "[" & nested & "]"
    Next level
    JsonExpectAccepted nested, nested, checks
    JsonExpectRejected "[" & nested & "]", checks
    MsgBox "PASS: " & checks & " native JSON checks. No Windows file-save verification."
    Exit Sub
Failed:
    MsgBox "FAIL: " & checks & " passed; " & Err.Description, vbCritical
End Sub

Private Sub JsonExpectRejected(ByVal value As String, ByRef checks As Long)
    Dim actual As Long, result As String
    On Error Resume Next
    result = GateValidateAndMinifyJson(value)
    actual = Err.Number
    Err.Clear
    On Error GoTo 0
    If actual <> vbObjectError + 2201 Then Err.Raise vbObjectError + 2920, , "Expected JSON rejection: " & value & " / error " & actual
    checks = checks + 1
End Sub

Private Sub JsonExpectAccepted(ByVal value As String, ByVal expected As String, ByRef checks As Long)
    If GateValidateAndMinifyJson(value) <> expected Then Err.Raise vbObjectError + 2921, , "Changed valid JSON: " & value
    checks = checks + 1
End Sub
