Attribute VB_Name = "GateCsvPathTests"
Option Explicit

Private checked As Long

Public Sub GateRunCsvPathTests()
    On Error GoTo Failed
    checked = 0
    GateCheckPath Chr$(92) & Chr$(92) & "server" & Chr$(92) & "share" & Chr$(92) & "CSV", Chr$(92) & Chr$(92) & "server" & Chr$(92) & "share" & Chr$(92) & "CSV"
    GateCheckPath Chr$(92) & Chr$(92) & "server" & Chr$(92) & "share" & Chr$(92), Chr$(92) & Chr$(92) & "server" & Chr$(92) & "share"
    GateCheckPath "C:" & Chr$(92) & "業務データ" & Chr$(92) & "CSV", "C:" & Chr$(92) & "業務データ" & Chr$(92) & "CSV"
    GateCheckPath "d:" & Chr$(92) & "Data Folder" & Chr$(92) & "日本語", "D:" & Chr$(92) & "Data Folder" & Chr$(92) & "日本語"
    GateCheckPath "Z:" & Chr$(92) & "CSV", "Z:" & Chr$(92) & "CSV"
    GateCheckPath "C:" & Chr$(92), "C:" & Chr$(92)
    GateCheckPath "C:" & Chr$(92) & Chr$(92) & Chr$(92), "C:" & Chr$(92)
    GateCheckPath "  C:" & Chr$(92) & "CSV" & Chr$(92) & "  ", "C:" & Chr$(92) & "CSV"
    GateCheckPath Chr$(34) & "C:" & Chr$(92) & "Data Folder" & Chr$(92) & "CSV" & Chr$(92) & Chr$(34), "C:" & Chr$(92) & "Data Folder" & Chr$(92) & "CSV"
    GateCheckPath " c:/Data/CSV/ ", "C:" & Chr$(92) & "Data" & Chr$(92) & "CSV"
    GateCheckPath "//server/share/日本語/", Chr$(92) & Chr$(92) & "server" & Chr$(92) & "share" & Chr$(92) & "日本語"
    GateCheckPath Chr$(34) & Chr$(92) & Chr$(92) & "server" & Chr$(92) & "share" & Chr$(92) & "CSV" & Chr$(34), Chr$(92) & Chr$(92) & "server" & Chr$(92) & "share" & Chr$(92) & "CSV"
    GateCheckPath "  " & Chr$(34) & " C:" & Chr$(92) & "CSV " & Chr$(34) & "  ", "C:" & Chr$(92) & "CSV"
    GateCheckPath "", ""
    GateCheckPath "CSV", ""
    GateCheckPath "." & Chr$(92) & "CSV", ""
    GateCheckPath ".." & Chr$(92) & "CSV", ""
    GateCheckPath Chr$(92) & "CSV", ""
    GateCheckPath "C:CSV", ""
    GateCheckPath "C:", ""
    GateCheckPath "1:" & Chr$(92) & "CSV", ""
    GateCheckPath "/Users/name/CSV", ""
    GateCheckPath "file:///C:/CSV", ""
    GateCheckPath "%USERPROFILE%" & Chr$(92) & "CSV", ""
    GateCheckPath Chr$(92) & Chr$(92), ""
    GateCheckPath Chr$(92) & Chr$(92) & "server", ""
    GateCheckPath Chr$(92) & Chr$(92) & "?" & Chr$(92) & "UNC" & Chr$(92) & "server" & Chr$(92) & "share", ""
    GateCheckPath Chr$(92) & Chr$(92) & "." & Chr$(92) & "C:" & Chr$(92) & "CSV", ""
    GateCheckPath "C:" & Chr$(92) & "CSV" & Chr$(92) & "..", ""
    GateCheckPath "C:" & Chr$(92) & Chr$(92) & "CSV", ""
    GateCheckPath "C:" & Chr$(92) & "CSV.", ""
    GateCheckPath "C:" & Chr$(92) & "bad " & Chr$(92) & "CSV", ""
    GateCheckPath "C:" & Chr$(92) & "bad*", ""
    GateCheckPath "C:" & Chr$(92) & "bad?", ""
    GateCheckPath "C:" & Chr$(92) & "bad:name", ""
    GateCheckPath "C:" & Chr$(92) & "bad" & Chr$(34), ""
    GateCheckPath "C:" & Chr$(92) & "bad" & Chr$(10), ""
    GateCheckPath Chr$(92) & Chr$(92) & "server" & Chr$(92) & Chr$(92) & "share", ""
    GateCheckPath Chr$(34) & "C:" & Chr$(92) & "CSV", ""
    MsgBox "PASS: " & CStr(checked) & " CSV path cases (local, mapped drive, UNC, pasted quotes, invalid paths)."
    Exit Sub
Failed:
    MsgBox "FAIL: " & Err.Description, vbCritical
End Sub

Private Sub GateCheckPath(ByVal rawPath As String, ByVal expected As String)
    Dim actual As String, failure As Long
    On Error Resume Next
    Err.Clear
    actual = GateNormalizeCsvSourcePath(rawPath)
    failure = Err.Number
    On Error GoTo 0
    If Len(expected) = 0 Then
        If failure <> vbObjectError + 2812 Then Err.Raise vbObjectError + 2981, , "Expected rejection: " & rawPath
    Else
        If failure <> 0 Or actual <> expected Then Err.Raise vbObjectError + 2982, , "Wrong result: " & rawPath & " => " & actual
    End If
    checked = checked + 1
End Sub
