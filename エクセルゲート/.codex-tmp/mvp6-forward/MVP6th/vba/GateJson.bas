Attribute VB_Name = "GateJson"
Option Explicit

Public Function GateValidateAndMinifyJson(ByVal jsonText As String) As String
    If Len(jsonText) = 0 Then GateJsonError 1, "JSONが空です。"
    If Len(jsonText) > GATE_MAX_CHARS Then Err.Raise vbObjectError + 2200, , "JSONの文字数が上限を超えています。"

    Dim compact As String
    compact = GateMinifyJson(jsonText)

    Dim position As Long
    position = 1
    GateSkipJsonValue compact, position, 1
    If position <= Len(compact) Then GateJsonError position, "末尾に余分な文字があります。"
    GateValidateAndMinifyJson = compact
End Function

Private Function GateMinifyJson(ByVal jsonText As String) As String
    Const PART_SIZE As Long = 4096
    Dim parts() As String
    ReDim parts(0 To (Len(jsonText) \ PART_SIZE) + 2)

    Dim partIndex As Long
    Dim buffer As String
    Dim inString As Boolean
    Dim escaped As Boolean
    Dim i As Long
    Dim ch As String

    For i = 1 To Len(jsonText)
        ch = Mid$(jsonText, i, 1)
        If inString Then
            buffer = buffer & ch
            If escaped Then
                escaped = False
            ElseIf ch = "\" Then
                escaped = True
            ElseIf ch = Chr$(34) Then
                inString = False
            End If
        Else
            If ch = Chr$(34) Then
                inString = True
                buffer = buffer & ch
            ElseIf ch <> " " And ch <> vbTab And ch <> vbCr And ch <> vbLf Then
                buffer = buffer & ch
            End If
        End If

        If Len(buffer) >= PART_SIZE Then
            parts(partIndex) = buffer
            partIndex = partIndex + 1
            buffer = vbNullString
        End If
    Next i

    If inString Or escaped Then GateJsonError Len(jsonText), "文字列が閉じられていません。"
    parts(partIndex) = buffer
    ReDim Preserve parts(0 To partIndex)
    GateMinifyJson = Join(parts, vbNullString)
End Function

Private Sub GateSkipJsonValue(ByVal jsonText As String, ByRef position As Long, ByVal depth As Long)
    If depth > GATE_MAX_DEPTH Then GateJsonError position, "入れ子が深すぎます。"
    If position > Len(jsonText) Then GateJsonError position, "値がありません。"

    Select Case Mid$(jsonText, position, 1)
        Case "{": GateSkipJsonObject jsonText, position, depth
        Case "[": GateSkipJsonArray jsonText, position, depth
        Case Chr$(34): GateSkipJsonString jsonText, position
        Case "t": GateExpectLiteral jsonText, position, "true"
        Case "f": GateExpectLiteral jsonText, position, "false"
        Case "n": GateExpectLiteral jsonText, position, "null"
        Case "-", "0" To "9": GateSkipJsonNumber jsonText, position
        Case Else: GateJsonError position, "値を解釈できません。"
    End Select
End Sub

Private Sub GateSkipJsonObject(ByVal jsonText As String, ByRef position As Long, ByVal depth As Long)
    position = position + 1
    If GateCharAt(jsonText, position) = "}" Then
        position = position + 1
        Exit Sub
    End If

    Dim keys As Object
    Set keys = CreateObject("Scripting.Dictionary")
    keys.CompareMode = vbBinaryCompare

    Do
        If GateCharAt(jsonText, position) <> Chr$(34) Then GateJsonError position, "項目名が文字列ではありません。"
        Dim keyTokenStart As Long
        keyTokenStart = position
        GateSkipJsonString jsonText, position
        Dim keyName As String
        keyName = GateDecodeJsonStringToken(Mid$(jsonText, keyTokenStart, position - keyTokenStart))
        If keys.Exists(keyName) Then GateJsonError keyTokenStart, "項目名「" & keyName & "」が重複しています。"
        keys.Add keyName, True

        GateExpectChar jsonText, position, ":"
        GateSkipJsonValue jsonText, position, depth + 1

        Select Case GateCharAt(jsonText, position)
            Case "}"
                position = position + 1
                Exit Do
            Case ","
                position = position + 1
            Case Else
                GateJsonError position, "',' または '}' が必要です。"
        End Select
    Loop
End Sub

Private Sub GateSkipJsonArray(ByVal jsonText As String, ByRef position As Long, ByVal depth As Long)
    position = position + 1
    If GateCharAt(jsonText, position) = "]" Then
        position = position + 1
        Exit Sub
    End If

    Do
        GateSkipJsonValue jsonText, position, depth + 1
        Select Case GateCharAt(jsonText, position)
            Case "]"
                position = position + 1
                Exit Do
            Case ","
                position = position + 1
            Case Else
                GateJsonError position, "',' または ']' が必要です。"
        End Select
    Loop
End Sub

Private Sub GateSkipJsonString(ByVal jsonText As String, ByRef position As Long)
    GateExpectChar jsonText, position, Chr$(34)
    Dim ch As String
    Do While position <= Len(jsonText)
        ch = Mid$(jsonText, position, 1)
        position = position + 1
        If ch = Chr$(34) Then Exit Sub
        If ch = "\" Then
            If position > Len(jsonText) Then GateJsonError position, "不正なエスケープです。"
            ch = Mid$(jsonText, position, 1)
            position = position + 1
            Select Case ch
                Case Chr$(34), "\", "/", "b", "f", "n", "r", "t"
                Case "u"
                    If position + 3 > Len(jsonText) Then GateJsonError position, "Unicodeエスケープが途中で終わっています。"
                    If Not GateIsHex4(Mid$(jsonText, position, 4)) Then GateJsonError position, "Unicodeエスケープが不正です。"
                    position = position + 4
                Case Else
                    GateJsonError position - 1, "不正なエスケープです。"
            End Select
        ElseIf AscW(ch) >= 0 And AscW(ch) < 32 Then
            GateJsonError position - 1, "文字列に制御文字があります。"
        End If
    Loop
    GateJsonError position, "文字列が閉じられていません。"
End Sub

Private Sub GateSkipJsonNumber(ByVal jsonText As String, ByRef position As Long)
    If GateCharAt(jsonText, position) = "-" Then position = position + 1
    If GateCharAt(jsonText, position) = "0" Then
        position = position + 1
        If GateCharAt(jsonText, position) >= "0" And GateCharAt(jsonText, position) <= "9" Then GateJsonError position, "数値の先頭に不要な0があります。"
    Else
        If GateCharAt(jsonText, position) < "1" Or GateCharAt(jsonText, position) > "9" Then GateJsonError position, "数値が不正です。"
        Do While GateCharAt(jsonText, position) >= "0" And GateCharAt(jsonText, position) <= "9"
            position = position + 1
        Loop
    End If

    If GateCharAt(jsonText, position) = "." Then
        position = position + 1
        If GateCharAt(jsonText, position) < "0" Or GateCharAt(jsonText, position) > "9" Then GateJsonError position, "小数部に数字が必要です。"
        Do While GateCharAt(jsonText, position) >= "0" And GateCharAt(jsonText, position) <= "9"
            position = position + 1
        Loop
    End If

    If LCase$(GateCharAt(jsonText, position)) = "e" Then
        position = position + 1
        If GateCharAt(jsonText, position) = "+" Or GateCharAt(jsonText, position) = "-" Then position = position + 1
        If GateCharAt(jsonText, position) < "0" Or GateCharAt(jsonText, position) > "9" Then GateJsonError position, "指数部に数字が必要です。"
        Do While GateCharAt(jsonText, position) >= "0" And GateCharAt(jsonText, position) <= "9"
            position = position + 1
        Loop
    End If
End Sub

Private Sub GateExpectChar(ByVal jsonText As String, ByRef position As Long, ByVal expected As String)
    If GateCharAt(jsonText, position) <> expected Then GateJsonError position, "'" & expected & "' が必要です。"
    position = position + 1
End Sub

Private Sub GateExpectLiteral(ByVal jsonText As String, ByRef position As Long, ByVal expected As String)
    If Mid$(jsonText, position, Len(expected)) <> expected Then GateJsonError position, "'" & expected & "' が必要です。"
    position = position + Len(expected)
End Sub

Private Function GateCharAt(ByVal jsonText As String, ByVal position As Long) As String
    If position >= 1 And position <= Len(jsonText) Then GateCharAt = Mid$(jsonText, position, 1)
End Function

Private Function GateIsHex4(ByVal text As String) As Boolean
    If Len(text) <> 4 Then Exit Function
    Dim i As Long
    For i = 1 To 4
        If InStr(1, "0123456789abcdef", LCase$(Mid$(text, i, 1)), vbBinaryCompare) = 0 Then Exit Function
    Next i
    GateIsHex4 = True
End Function

Private Sub GateJsonError(ByVal position As Long, ByVal message As String)
    Err.Raise vbObjectError + 2201, , "JSONの" & position & "文字目: " & message
End Sub

Public Function GateJsonTopLevelRaw(ByVal compactJson As String, ByVal keyToFind As String) As String
    If Left$(compactJson, 1) <> "{" Then Err.Raise vbObjectError + 2210, , "保存用JSONの外枠が正しくありません。"
    Dim position As Long
    position = 2
    If GateCharAt(compactJson, position) = "}" Then GoTo Missing

    Do
        Dim keyStart As Long
        keyStart = position
        GateSkipJsonString compactJson, position
        Dim keyName As String
        keyName = GateDecodeJsonStringToken(Mid$(compactJson, keyStart, position - keyStart))
        GateExpectChar compactJson, position, ":"
        Dim valueStart As Long
        valueStart = position
        GateSkipJsonValue compactJson, position, 2
        If keyName = keyToFind Then
            GateJsonTopLevelRaw = Mid$(compactJson, valueStart, position - valueStart)
            Exit Function
        End If
        If GateCharAt(compactJson, position) = "}" Then Exit Do
        GateExpectChar compactJson, position, ","
    Loop

Missing:
    Err.Raise vbObjectError + 2211, , "必須項目「" & keyToFind & "」がありません。"
End Function

Public Function GateJsonTopLevelString(ByVal compactJson As String, ByVal keyName As String) As String
    Dim raw As String
    raw = GateJsonTopLevelRaw(compactJson, keyName)
    If Left$(raw, 1) <> Chr$(34) Then Err.Raise vbObjectError + 2212, , "項目「" & keyName & "」は文字列で指定してください。"
    GateJsonTopLevelString = GateDecodeJsonStringToken(raw)
End Function

Public Function GateJsonTopLevelNullableString(ByVal compactJson As String, ByVal keyName As String) As String
    Dim raw As String
    raw = GateJsonTopLevelRaw(compactJson, keyName)
    If raw = "null" Then Exit Function
    If Left$(raw, 1) <> Chr$(34) Then Err.Raise vbObjectError + 2213, , "項目「" & keyName & "」は文字列またはnullで指定してください。"
    GateJsonTopLevelNullableString = GateDecodeJsonStringToken(raw)
End Function

Public Function GateJsonTopLevelLong(ByVal compactJson As String, ByVal keyName As String) As Long
    Dim raw As String
    raw = GateJsonTopLevelRaw(compactJson, keyName)
    If InStr(raw, ".") > 0 Or InStr(1, raw, "e", vbTextCompare) > 0 Then Err.Raise vbObjectError + 2214, , "項目「" & keyName & "」は整数で指定してください。"
    On Error GoTo InvalidLong
    GateJsonTopLevelLong = CLng(raw)
    Exit Function
InvalidLong:
    Err.Raise vbObjectError + 2215, , "項目「" & keyName & "」の整数値が範囲外です。"
End Function

Public Function GateJsonTopLevelBoolean(ByVal compactJson As String, ByVal keyName As String) As Boolean
    Select Case GateJsonTopLevelRaw(compactJson, keyName)
        Case "true": GateJsonTopLevelBoolean = True
        Case "false": GateJsonTopLevelBoolean = False
        Case Else: Err.Raise vbObjectError + 2216, , "項目「" & keyName & "」はtrueまたはfalseで指定してください。"
    End Select
End Function

Public Function GateDecodeJsonStringToken(ByVal token As String) As String
    If Len(token) < 2 Or Left$(token, 1) <> Chr$(34) Or Right$(token, 1) <> Chr$(34) Then Err.Raise vbObjectError + 2220, , "JSON文字列が正しくありません。"
    Dim i As Long
    i = 2
    Do While i < Len(token)
        Dim ch As String
        ch = Mid$(token, i, 1)
        i = i + 1
        If ch = "\" Then
            ch = Mid$(token, i, 1)
            i = i + 1
            Select Case ch
                Case Chr$(34), "\", "/": GateDecodeJsonStringToken = GateDecodeJsonStringToken & ch
                Case "b": GateDecodeJsonStringToken = GateDecodeJsonStringToken & Chr$(8)
                Case "f": GateDecodeJsonStringToken = GateDecodeJsonStringToken & Chr$(12)
                Case "n": GateDecodeJsonStringToken = GateDecodeJsonStringToken & vbLf
                Case "r": GateDecodeJsonStringToken = GateDecodeJsonStringToken & vbCr
                Case "t": GateDecodeJsonStringToken = GateDecodeJsonStringToken & vbTab
                Case "u"
                    GateDecodeJsonStringToken = GateDecodeJsonStringToken & ChrW$(CLng("&H" & Mid$(token, i, 4)))
                    i = i + 4
            End Select
        Else
            GateDecodeJsonStringToken = GateDecodeJsonStringToken & ch
        End If
    Loop
End Function

Public Function GateJsonQuote(ByVal value As String) As String
    Dim result As String
    Dim i As Long
    Dim ch As String
    Dim code As Long
    For i = 1 To Len(value)
        ch = Mid$(value, i, 1)
        code = AscW(ch)
        Select Case ch
            Case Chr$(34): result = result & "\" & Chr$(34)
            Case "\": result = result & "\\"
            Case vbBack: result = result & "\b"
            Case vbFormFeed: result = result & "\f"
            Case vbLf: result = result & "\n"
            Case vbCr: result = result & "\r"
            Case vbTab: result = result & "\t"
            Case Else
                If code >= 0 And code < 32 Then
                    result = result & "\u" & Right$("0000" & Hex$(code), 4)
                Else
                    result = result & ch
                End If
        End Select
    Next i
    GateJsonQuote = Chr$(34) & result & Chr$(34)
End Function

Public Sub GateParseEnvelope(ByVal compactJson As String, ByRef envelope As GateEnvelope)
    envelope.FormatVersion = GateJsonTopLevelLong(compactJson, "formatVersion")
    envelope.SaveDataId = GateJsonTopLevelString(compactJson, "saveDataId")
    envelope.ParentSaveDataId = GateJsonTopLevelNullableString(compactJson, "parentSaveDataId")
    envelope.SessionId = GateJsonTopLevelString(compactJson, "sessionId")
    envelope.DatabaseId = GateJsonTopLevelString(compactJson, "databaseId")
    envelope.DataType = GateJsonTopLevelString(compactJson, "dataType")
    envelope.SchemaVersion = GateJsonTopLevelLong(compactJson, "schemaVersion")
    envelope.BaseRevision = GateJsonTopLevelLong(compactJson, "baseRevision")
    envelope.ExportSequence = GateJsonTopLevelLong(compactJson, "exportSequence")
    envelope.AuthorName = GateNormalizeAuthorName(GateJsonTopLevelString(compactJson, "authorName"))
    envelope.ExportedAt = GateJsonTopLevelString(compactJson, "exportedAt")
    envelope.SaveKind = GateJsonTopLevelString(compactJson, "saveKind")
    envelope.ReadOnlyFlag = GateJsonTopLevelBoolean(compactJson, "readOnly")
    envelope.PayloadRaw = GateJsonTopLevelRaw(compactJson, "payload")

    If envelope.FormatVersion <> GATE_FORMAT_VERSION Then Err.Raise vbObjectError + 2230, , "このExcelで扱えない受け渡しファイルです。"
    If Len(envelope.SaveDataId) < 8 Or Len(envelope.SaveDataId) > 100 Then Err.Raise vbObjectError + 2231, , "saveDataIdが正しくありません。"
    Dim idIndex As Long
    For idIndex = 1 To Len(envelope.SaveDataId)
        If Not Mid$(envelope.SaveDataId, idIndex, 1) Like "[A-Za-z0-9_-]" Then Err.Raise vbObjectError + 2241, , "saveDataIdに使用できない文字があります。"
    Next idIndex
    If Len(envelope.SessionId) < 8 Or Len(envelope.SessionId) > 100 Then Err.Raise vbObjectError + 2232, , "sessionIdが正しくありません。"
    If Len(envelope.DatabaseId) < 8 Or Len(envelope.DatabaseId) > 100 Then Err.Raise vbObjectError + 2233, , "databaseIdが正しくありません。"
    If Len(envelope.DataType) = 0 Or Len(envelope.DataType) > 100 Then Err.Raise vbObjectError + 2234, , "dataTypeが正しくありません。"
    If envelope.SchemaVersion < 1 Then Err.Raise vbObjectError + 2235, , "schemaVersionが正しくありません。"
    If envelope.BaseRevision < 0 Or envelope.ExportSequence < 1 Then Err.Raise vbObjectError + 2236, , "revisionまたは保存番号が正しくありません。"
    If envelope.SaveKind <> "workCopy" And envelope.SaveKind <> "complete" Then Err.Raise vbObjectError + 2237, , "保存方法が正しくありません。"
    If envelope.ReadOnlyFlag Then Err.Raise vbObjectError + 2238, , "閲覧画面から作られたデータは保存できません。"
    If Len(envelope.ExportedAt) < 16 Or Len(envelope.ExportedAt) > 40 Then Err.Raise vbObjectError + 2239, , "出力日時が正しくありません。"
End Sub

Public Function GateNormalizeAuthorName(ByVal value As String) As String
    Dim result As String
    result = Trim$(value)
    If Len(result) = 0 Then Err.Raise vbObjectError + 2240, , "保存者の名前がありません。"
    If Len(result) > 50 Then Err.Raise vbObjectError + 2241, , "保存者の名前は50文字以内で入力してください。"
    Dim i As Long
    Dim code As Long
    For i = 1 To Len(result)
        code = AscW(Mid$(result, i, 1))
        If (code >= 0 And code < 32) Or code = 127 Then Err.Raise vbObjectError + 2242, , "保存者の名前に使用できない文字があります。"
    Next i
    GateNormalizeAuthorName = result
End Function

Public Function GateReadUtf8File(ByVal filePath As String) As String
    If FileLen(filePath) > GATE_MAX_UTF8_BYTES Then Err.Raise vbObjectError + 2250, , "JSONファイルが10MiBの上限を超えています。"
    Dim binaryStream As Object
    Set binaryStream = CreateObject("ADODB.Stream")
    binaryStream.Type = 1
    binaryStream.Open
    binaryStream.LoadFromFile filePath
    Dim originalBytes As Variant
    originalBytes = binaryStream.Read
    binaryStream.Close

    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.LoadFromFile filePath
    GateReadUtf8File = stream.ReadText(-1)
    stream.Close
    If Len(GateReadUtf8File) > GATE_MAX_CHARS Then Err.Raise vbObjectError + 2251, , "JSONの文字数が上限を超えています。"

    Dim encodedBytes As Variant
    encodedBytes = GateUtf8BytesWithoutBom(GateReadUtf8File)
    Dim originalOffset As Long
    originalOffset = 0
    If UBound(originalBytes) >= 2 Then
        If originalBytes(0) = &HEF And originalBytes(1) = &HBB And originalBytes(2) = &HBF Then originalOffset = 3
    End If
    If (UBound(originalBytes) - LBound(originalBytes) + 1 - originalOffset) <> _
       (UBound(encodedBytes) - LBound(encodedBytes) + 1) Then
        Err.Raise vbObjectError + 2252, , "UTF-8として正しく読み取れないファイルです。"
    End If
    Dim byteIndex As Long
    For byteIndex = LBound(encodedBytes) To UBound(encodedBytes)
        If encodedBytes(byteIndex) <> originalBytes(byteIndex + originalOffset) Then
            Err.Raise vbObjectError + 2253, , "UTF-8として正しく読み取れないファイルです。"
        End If
    Next byteIndex
End Function

Public Sub GateWriteUtf8File(ByVal filePath As String, ByVal text As String)
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.WriteText text
    stream.SaveToFile filePath, 2
    stream.Close
End Sub

Public Function GateCrc32Utf8(ByVal text As String) As String
    GateCrc32Utf8 = GateCrc32Bytes(GateUtf8BytesWithoutBom(text))
End Function

Private Function GateUtf8BytesWithoutBom(ByVal text As String) As Variant
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.WriteText text
    stream.Position = 0
    stream.Type = 1
    stream.Position = 3
    Dim bytes As Variant
    bytes = stream.Read
    stream.Close
    GateUtf8BytesWithoutBom = bytes
End Function

Public Function GateCrc32File(ByVal filePath As String) As String
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 1
    stream.Open
    stream.LoadFromFile filePath
    Dim bytes As Variant
    bytes = stream.Read
    stream.Close
    GateCrc32File = GateCrc32Bytes(bytes)
End Function

Private Function GateCrc32Bytes(ByVal bytes As Variant) As String
    Dim crc As Long
    crc = &HFFFFFFFF
    Dim i As Long
    Dim bit As Long
    For i = LBound(bytes) To UBound(bytes)
        crc = crc Xor CLng(bytes(i))
        For bit = 1 To 8
            If (crc And 1) <> 0 Then
                crc = GateUnsignedShiftRightOne(crc) Xor &HEDB88320
            Else
                crc = GateUnsignedShiftRightOne(crc)
            End If
        Next bit
    Next i
    GateCrc32Bytes = Right$("00000000" & Hex$(Not crc), 8)
End Function

Private Function GateUnsignedShiftRightOne(ByVal value As Long) As Long
    If value < 0 Then
        GateUnsignedShiftRightOne = ((value And &H7FFFFFFF) \ 2) Or &H40000000
    Else
        GateUnsignedShiftRightOne = value \ 2
    End If
End Function
