Attribute VB_Name = "GateCsvSourceTests"
Option Explicit

' Import into a disposable test workbook only. These helper tests do not save
' workbook data, select folders, launch a browser, or alter any source CSV.
' Record the actual application / OS used; source-contract tests are not a substitute.
Public Sub GateRunCsvSourceHelperTests()
    On Error GoTo Failed
    Dim slash As String, path As String
    slash = Chr$(92)
    path = slash & slash & "server" & slash & "share" & slash & "CSV"
    Require GateNormalizeCsvSourcePath(" " & path & slash & " ") = path, "UNC trim / trailing separator"
    Require GateNormalizeCsvSourcePath(slash & slash & "server" & slash & "share") = slash & slash & "server" & slash & "share", "UNC share root"
    Require GateNormalizeCsvSourcePath("C:" & slash & "CSV") = "C:" & slash & "CSV", "Local path rejected"
    Require GateNormalizeCsvSourcePath("Z:" & slash & "CSV") = "Z:" & slash & "CSV", "Mapped drive rejected"
    Require PathError(slash & slash) = vbObjectError + 2812, "Empty UNC accepted"
    Require PathError(slash & slash & "server") = vbObjectError + 2812, "UNC share missing"
    Require PathError(path & slash & "..") = vbObjectError + 2812, "Parent traversal accepted"
    Require PathError(path & slash & slash & "child") = vbObjectError + 2812, "Empty UNC component accepted"
    Require PathError(path & "*") = vbObjectError + 2812, "Wildcard accepted"
    Require PathError(path & vbCr) = vbObjectError + 2812, "Control character accepted"
    Require PathError(slash & slash & "?" & slash & "UNC" & slash & "server" & slash & "share") = vbObjectError + 2812, "Device namespace accepted"

    Dim bytes() As Byte
    ReDim bytes(0 To 0)
    bytes(0) = 77
    Require GateSourceBase64(bytes) = "TQ==", "One-byte padding"
    ReDim Preserve bytes(0 To 1)
    bytes(1) = 97
    Require GateSourceBase64(bytes) = "TWE=", "Two-byte padding"
    ReDim Preserve bytes(0 To 2)
    bytes(2) = 110
    Require GateSourceBase64(bytes) = "TWFu", "Three-byte encoding"
    ReDim bytes(4 To 6)
    bytes(4) = 0
    bytes(5) = 128
    bytes(6) = 255
    Require GateSourceBase64(bytes) = "AID/", "Binary / nonzero array base"
    bytes(4) = 255
    bytes(5) = 255
    Require GateSourceBase64(bytes) = "////", "All high bits"
    ReDim bytes(0 To 49151)
    Dim encoded As String
    encoded = GateSourceBase64(bytes)
    Require Len(encoded) = 65536, "Block output size"
    Require encoded = String$(65536, "A"), "Block encoding or unexpected padding"

    Dim original As Object, same As Object, changed As Object
    Set original = CreateObject("Scripting.Dictionary")
    Set same = CreateObject("Scripting.Dictionary")
    GateAssertCsvSnapshotUnchanged original, same
    original.Add "A.csv", Array(1, CDbl(DateSerial(2026, 9, 21)))
    original.Add "日本語.csv", Array(2, CDbl(DateSerial(2026, 9, 20)))
    same.Add "日本語.csv", Array(2, CDbl(DateSerial(2026, 9, 20)))
    same.Add "A.csv", Array(1, CDbl(DateSerial(2026, 9, 21)))
    GateAssertCsvSnapshotUnchanged original, same
    same("A.csv") = Array(3, CDbl(DateSerial(2026, 9, 21)))
    Require SnapshotError(original, same) = vbObjectError + 2817, "Size change accepted"
    same("A.csv") = Array(1, CDbl(DateSerial(2026, 9, 22)))
    Require SnapshotError(original, same) = vbObjectError + 2817, "Timestamp change accepted"
    same.Remove "A.csv"
    Require SnapshotError(original, same) = vbObjectError + 2817, "Removal accepted"
    same.Add "B.csv", Array(1, CDbl(DateSerial(2026, 9, 21)))
    Require SnapshotError(original, same) = vbObjectError + 2817, "Rename accepted"
    same.Add "A.csv", Array(1, CDbl(DateSerial(2026, 9, 21)))
    Require SnapshotError(original, same) = vbObjectError + 2817, "Addition accepted"
    MsgBox "PASS: UNC validation, binary base64 and source snapshot comparisons. No SMB / Edge / JUST Calc execution is established by this helper suite."
    Exit Sub
Failed:
    MsgBox "FAIL: " & Err.Description, vbCritical
End Sub

Private Function PathError(ByVal path As String) As Long
    On Error GoTo Failed
    Dim normalized As String
    normalized = GateNormalizeCsvSourcePath(path)
    Exit Function
Failed:
    PathError = Err.Number
End Function

Private Function SnapshotError(ByVal original As Object, ByVal current As Object) As Long
    On Error GoTo Failed
    GateAssertCsvSnapshotUnchanged original, current
    Exit Function
Failed:
    SnapshotError = Err.Number
End Function

Private Sub Require(ByVal condition As Boolean, ByVal detail As String)
    If Not condition Then Err.Raise vbObjectError + 2980, , detail
End Sub
