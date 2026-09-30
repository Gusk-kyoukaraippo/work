Attribute VB_Name = "GateStorageValidationTests"
Option Explicit

' Run only in a disposable TEST copy with the three internal sheets present.
' No save, file IO or Windows COM is used: all cases stop before CRC conversion.
' Original sheet contents are restored. This is NOT a successful-save/CRC test.
Public Sub GateRunStorageMetadataTests()
    Dim dataSheet As Object, metaSheet As Object
    Set dataSheet = ThisWorkbook.Worksheets(GATE_DATA_SHEET)
    Set metaSheet = ThisWorkbook.Worksheets(GATE_META_SHEET)
    Dim dataBefore As Variant, metaBefore As Variant
    dataBefore = dataSheet.UsedRange.Value2
    metaBefore = metaSheet.UsedRange.Value2
    Dim failure As String, checks As Long
    On Error GoTo Failed
    dataSheet.Rows("2:" & dataSheet.Rows.Count).ClearContents
    GateMetaSet "revision", "0"
    GateMetaSet "chunkCount", "0"
    GateMetaSet "jsonLength", "0"
    GateMetaSet "crc32", ""
    If GateLoadCompactJson() <> "" Then Err.Raise vbObjectError + 2910, , "Initial empty data was rejected"
    checks = checks + 1

    Dim field As Variant, invalid As Variant
    For Each field In Array("chunkCount", "jsonLength", "revision")
        For Each invalid In Array("", "text", "0x", "0.5", "-1", "+1", "01", "1e0", " 0", "2147483648")
            GateMetaSet CStr(field), CStr(invalid)
            StorageExpectError vbObjectError + 2305, CStr(field) & ": " & CStr(invalid), checks
        Next invalid
        GateMetaSet CStr(field), "0"
    Next field
    For Each field In Array("revision", "jsonLength")
        GateMetaSet CStr(field), "1"
        StorageExpectError vbObjectError + 2303, "Zero chunks with " & CStr(field), checks
        GateMetaSet CStr(field), "0"
    Next field
    GateMetaSet "crc32", "00000000"
    StorageExpectError vbObjectError + 2303, "Zero chunks with CRC", checks
    GateMetaSet "crc32", ""
    dataSheet.Cells(2, 2).Value2 = "{}"
    StorageExpectError vbObjectError + 2303, "Zero chunks with stored data", checks

    GateMetaSet "revision", "1"
    GateMetaSet "chunkCount", "1"
    GateMetaSet "jsonLength", "2"
    GateMetaSet "crc32", "00000000"
    dataSheet.Cells(2, 1).NumberFormat = "@"
    For Each invalid In Array("1x", "1.5", "-1", "01", "2")
        dataSheet.Cells(2, 1).Value2 = CStr(invalid)
        StorageExpectError vbObjectError + 2305, "Invalid chunk index: " & CStr(invalid), checks
    Next invalid
    dataSheet.Cells(2, 1).Value2 = "1"
    GateMetaSet "jsonLength", "3"
    StorageExpectError vbObjectError + 2301, "Total length mismatch", checks
    GateMetaSet "jsonLength", "2"
    GateMetaSet "crc32", "INVALID!"
    StorageExpectError vbObjectError + 2302, "Invalid CRC characters", checks
    GateMetaSet "crc32", ""
    StorageExpectError vbObjectError + 2302, "Missing CRC", checks
    GateMetaSet "crc32", "00000000"
    dataSheet.Cells(3, 2).Value2 = "extra"
    StorageExpectError vbObjectError + 2304, "Extra chunk row", checks
    dataSheet.Cells(3, 2).ClearContents
    dataSheet.Cells(2, 2).Value2 = String$(GATE_CHUNK_SIZE + 1, "x")
    StorageExpectError vbObjectError + 2300, "Oversize chunk", checks
    GoTo Restore
Failed:
    failure = Err.Description
Restore:
    On Error GoTo RestoreFailed
    dataSheet.UsedRange.ClearContents
    dataSheet.Range(dataSheet.Cells(1, 1), dataSheet.Cells(UBound(dataBefore, 1), UBound(dataBefore, 2))).Value2 = dataBefore
    metaSheet.UsedRange.ClearContents
    metaSheet.Range(metaSheet.Cells(1, 1), metaSheet.Cells(UBound(metaBefore, 1), UBound(metaBefore, 2))).Value2 = metaBefore
    If Len(failure) > 0 Then
        MsgBox "FAIL: " & failure, vbCritical
    Else
        MsgBox "PASS: " & checks & " storage metadata checks. No file-save or CRC runtime verification."
    End If
    Exit Sub
RestoreFailed:
    MsgBox "FAIL restoring TEST copy. Close without saving. " & failure & " / " & Err.Description, vbCritical
End Sub

Private Sub StorageExpectError(ByVal expected As Long, ByVal label As String, ByRef checks As Long)
    Dim actual As Long, loaded As String
    On Error Resume Next
    loaded = GateLoadCompactJson()
    actual = Err.Number
    Err.Clear
    On Error GoTo 0
    If actual <> expected Then Err.Raise vbObjectError + 2911, , label & ": expected " & expected & ", actual " & actual
    checks = checks + 1
End Sub
