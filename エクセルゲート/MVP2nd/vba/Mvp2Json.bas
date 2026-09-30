Attribute VB_Name = "Mvp2Json"
Option Explicit

Public Function Mvp2ValidateAndMinifyJson(ByVal jsonText As String) As String
    If Len(jsonText) = 0 Then Mvp2JsonError 1, "JSONが空です。"
    If Len(jsonText) > MVP2_MAX_CHARS Then Err.Raise vbObjectError + 2200, , "JSONの文字数が上限を超えています。"

    Dim compact As String
    compact = Mvp2MinifyJson(jsonText)

    Dim position As Long
    position = 1
    Mvp2SkipJsonValue compact, position, 1
    If position <= Len(compact) Then Mvp2JsonError position, "末尾に余分な文字があります。"
    Mvp2ValidateAndMinifyJson = compact
End Function

Private Function Mvp2MinifyJson(ByVal jsonText As String) As String
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

    If inString Or escaped Then Mvp2JsonError Len(jsonText), "文字列が閉じられていません。"
    parts(partIndex) = buffer
    ReDim Preserve parts(0 To partIndex)
    Mvp2MinifyJson = Join(parts, vbNullString)
End Function

Private Sub Mvp2SkipJsonValue(ByVal jsonText As String, ByRef position As Long, ByVal depth As Long)
    If depth > MVP2_MAX_DEPTH Then Mvp2JsonError position, "入れ子が深すぎます。"
    If position > Len(jsonText) Then Mvp2JsonError position, "値がありません。"

    Select Case Mid$(jsonText, position, 1)
        Case "{": Mvp2SkipJsonObject jsonText, position, depth
        Case "[": Mvp2SkipJsonArray jsonText, position, depth
        Case Chr$(34): Mvp2SkipJsonString jsonText, position
        Case "t": Mvp2ExpectLiteral jsonText, position, "true"
        Case "f": Mvp2ExpectLiteral jsonText, position, "false"
        Case "n": Mvp2ExpectLiteral jsonText, position, "null"
        Case "-", "0" To "9": Mvp2SkipJsonNumber jsonText, position
        Case Else: Mvp2JsonError position, "値を解釈できません。"
    End Select
End Sub

Private Sub Mvp2SkipJsonObject(ByVal jsonText As String, ByRef position As Long, ByVal depth As Long)
    position = position + 1
    If Mvp2CharAt(jsonText, position) = "}" Then
        position = position + 1
        Exit Sub
    End If

    Dim keys As Object
    Set keys = CreateObject("Scripting.Dictionary")
    keys.CompareMode = vbBinaryCompare

    Do
        If Mvp2CharAt(jsonText, position) <> Chr$(34) Then Mvp2JsonError position, "項目名が文字列ではありません。"
        Dim keyTokenStart As Long
        keyTokenStart = position
        Mvp2SkipJsonString jsonText, position
        Dim keyName As String
        keyName = Mvp2DecodeJsonStringToken(Mid$(jsonText, keyTokenStart, position - keyTokenStart))
        If keys.Exists(keyName) Then Mvp2JsonError keyTokenStart, "項目名「" & keyName & "」が重複しています。"
        keys.Add keyName, True

        Mvp2ExpectChar jsonText, position, ":"
        Mvp2SkipJsonValue jsonText, position, depth + 1

        Select Case Mvp2CharAt(jsonText, position)
            Case "}"
                position = position + 1
                Exit Do
            Case ","
                position = position + 1
            Case Else
                Mvp2JsonError position, "',' または '}' が必要です。"
        End Select
    Loop
End Sub

Private Sub Mvp2SkipJsonArray(ByVal jsonText As String, ByRef position As Long, ByVal depth As Long)
    position = position + 1
    If Mvp2CharAt(jsonText, position) = "]" Then
        position = position + 1
        Exit Sub
    End If

    Do
        Mvp2SkipJsonValue jsonText, position, depth + 1
        Select Case Mvp2CharAt(jsonText, position)
            Case "]"
                position = position + 1
                Exit Do
            Case ","
                position = position + 1
            Case Else
                Mvp2JsonError position, "',' または ']' が必要です。"
        End Select
    Loop
End Sub

Private Sub Mvp2SkipJsonString(ByVal jsonText As String, ByRef position As Long)
    Mvp2ExpectChar jsonText, position, Chr$(34)
    Dim ch As String
    Do While position <= Len(jsonText)
        ch = Mid$(jsonText, position, 1)
        position = position + 1
        If ch = Chr$(34) Then Exit Sub
        If ch = "\" Then
            If position > Len(jsonText) Then Mvp2JsonError position, "不正なエスケープです。"
            ch = Mid$(jsonText, position, 1)
            position = position + 1
            Select Case ch
                Case Chr$(34), "\", "/", "b", "f", "n", "r", "t"
                Case "u"
                    If position + 3 > Len(jsonText) Then Mvp2JsonError position, "Unicodeエスケープが途中で終わっています。"
                    If Not Mvp2IsHex4(Mid$(jsonText, position, 4)) Then Mvp2JsonError position, "Unicodeエスケープが不正です。"
                    position = position + 4
                Case Else
                    Mvp2JsonError position - 1, "不正なエスケープです。"
            End Select
        ElseIf AscW(ch) >= 0 And AscW(ch) < 32 Then
            Mvp2JsonError position - 1, "文字列に制御文字があります。"
        End If
    Loop
    Mvp2JsonError position, "文字列が閉じられていません。"
End Sub

Private Sub Mvp2SkipJsonNumber(ByVal jsonText As String, ByRef position As Long)
    If Mvp2CharAt(jsonText, position) = "-" Then position = position + 1
    If Mvp2CharAt(jsonText, position) = "0" Then
        position = position + 1
        If Mvp2CharAt(jsonText, position) >= "0" And Mvp2CharAt(jsonText, position) <= "9" Then Mvp2JsonError position, "数値の先頭に不要な0があります。"
    Else
        If Mvp2CharAt(jsonText, position) < "1" Or Mvp2CharAt(jsonText, position) > "9" Then Mvp2JsonError position, "数値が不正です。"
        Do While Mvp2CharAt(jsonText, position) >= "0" And Mvp2CharAt(jsonText, position) <= "9"
            position = position + 1
        Loop
    End If

    If Mvp2CharAt(jsonText, position) = "." Then
        position = position + 1
        If Mvp2CharAt(jsonText, position) < "0" Or Mvp2CharAt(jsonText, position) > "9" Then Mvp2JsonError position, "小数部に数字が必要です。"
        Do While Mvp2CharAt(jsonText, position) >= "0" And Mvp2CharAt(jsonText, position) <= "9"
            position = position + 1
        Loop
    End If

    If LCase$(Mvp2CharAt(jsonText, position)) = "e" Then
        position = position + 1
        If Mvp2CharAt(jsonText, position) = "+" Or Mvp2CharAt(jsonText, position) = "-" Then position = position + 1
        If Mvp2CharAt(jsonText, position) < "0" Or Mvp2CharAt(jsonText, position) > "9" Then Mvp2JsonError position, "指数部に数字が必要です。"
        Do While Mvp2CharAt(jsonText, position) >= "0" And Mvp2CharAt(jsonText, position) <= "9"
            position = position + 1
        Loop
    End If
End Sub

Private Sub Mvp2ExpectChar(ByVal jsonText As String, ByRef position As Long, ByVal expected As String)
    If Mvp2CharAt(jsonText, position) <> expected Then Mvp2JsonError position, "'" & expected & "' が必要です。"
    position = position + 1
End Sub

Private Sub Mvp2ExpectLiteral(ByVal jsonText As String, ByRef position As Long, ByVal expected As String)
    If Mid$(jsonText, position, Len(expected)) <> expected Then Mvp2JsonError position, "'" & expected & "' が必要です。"
    position = position + Len(expected)
End Sub

Private Function Mvp2CharAt(ByVal jsonText As String, ByVal position As Long) As String
    If position >= 1 And position <= Len(jsonText) Then Mvp2CharAt = Mid$(jsonText, position, 1)
End Function

Private Function Mvp2IsHex4(ByVal text As String) As Boolean
    If Len(text) <> 4 Then Exit Function
    Dim i As Long
    For i = 1 To 4
        If InStr(1, "0123456789abcdef", LCase$(Mid$(text, i, 1)), vbBinaryCompare) = 0 Then Exit Function
    Next i
    Mvp2IsHex4 = True
End Function

Private Sub Mvp2JsonError(ByVal position As Long, ByVal message As String)
    Err.Raise vbObjectError + 2201, , "JSONの" & position & "文字目: " & message
End Sub

Public Function Mvp2JsonTopLevelRaw(ByVal compactJson As String, ByVal keyToFind As String) As String
    If Left$(compactJson, 1) <> "{" Then Err.Raise vbObjectError + 2210, , "保存用JSONの外枠が正しくありません。"
    Dim position As Long
    position = 2
    If Mvp2CharAt(compactJson, position) = "}" Then GoTo Missing

    Do
        Dim keyStart As Long
        keyStart = position
        Mvp2SkipJsonString compactJson, position
        Dim keyName As String
        keyName = Mvp2DecodeJsonStringToken(Mid$(compactJson, keyStart, position - keyStart))
        Mvp2ExpectChar compactJson, position, ":"
        Dim valueStart As Long
        valueStart = position
        Mvp2SkipJsonValue compactJson, position, 2
        If keyName = keyToFind Then
            Mvp2JsonTopLevelRaw = Mid$(compactJson, valueStart, position - valueStart)
            Exit Function
        End If
        If Mvp2CharAt(compactJson, position) = "}" Then Exit Do
        Mvp2ExpectChar compactJson, position, ","
    Loop

Missing:
    Err.Raise vbObjectError + 2211, , "必須項目「" & keyToFind & "」がありません。"
End Function

Public Function Mvp2JsonTopLevelString(ByVal compactJson As String, ByVal keyName As String) As String
    Dim raw As String
    raw = Mvp2JsonTopLevelRaw(compactJson, keyName)
    If Left$(raw, 1) <> Chr$(34) Then Err.Raise vbObjectError + 2212, , "項目「" & keyName & "」は文字列で指定してください。"
    Mvp2JsonTopLevelString = Mvp2DecodeJsonStringToken(raw)
End Function

Public Function Mvp2JsonTopLevelNullableString(ByVal compactJson As String, ByVal keyName As String) As String
    Dim raw As String
    raw = Mvp2JsonTopLevelRaw(compactJson, keyName)
    If raw = "null" Then Exit Function
    If Left$(raw, 1) <> Chr$(34) Then Err.Raise vbObjectError + 2213, , "項目「" & keyName & "」は文字列またはnullで指定してください。"
    Mvp2JsonTopLevelNullableString = Mvp2DecodeJsonStringToken(raw)
End Function

Public Function Mvp2JsonTopLevelLong(ByVal compactJson As String, ByVal keyName As String) As Long
    Dim raw As String
    raw = Mvp2JsonTopLevelRaw(compactJson, keyName)
    If InStr(raw, ".") > 0 Or InStr(1, raw, "e", vbTextCompare) > 0 Then Err.Raise vbObjectError + 2214, , "項目「" & keyName & "」は整数で指定してください。"
    On Error GoTo InvalidLong
    Mvp2JsonTopLevelLong = CLng(raw)
    Exit Function
InvalidLong:
    Err.Raise vbObjectError + 2215, , "項目「" & keyName & "」の整数値が範囲外です。"
End Function

Public Function Mvp2JsonTopLevelBoolean(ByVal compactJson As String, ByVal keyName As String) As Boolean
    Select Case Mvp2JsonTopLevelRaw(compactJson, keyName)
        Case "true": Mvp2JsonTopLevelBoolean = True
        Case "false": Mvp2JsonTopLevelBoolean = False
        Case Else: Err.Raise vbObjectError + 2216, , "項目「" & keyName & "」はtrueまたはfalseで指定してください。"
    End Select
End Function

Public Function Mvp2DecodeJsonStringToken(ByVal token As String) As String
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
                Case Chr$(34), "\", "/": Mvp2DecodeJsonStringToken = Mvp2DecodeJsonStringToken & ch
                Case "b": Mvp2DecodeJsonStringToken = Mvp2DecodeJsonStringToken & Chr$(8)
                Case "f": Mvp2DecodeJsonStringToken = Mvp2DecodeJsonStringToken & Chr$(12)
                Case "n": Mvp2DecodeJsonStringToken = Mvp2DecodeJsonStringToken & vbLf
                Case "r": Mvp2DecodeJsonStringToken = Mvp2DecodeJsonStringToken & vbCr
                Case "t": Mvp2DecodeJsonStringToken = Mvp2DecodeJsonStringToken & vbTab
                Case "u"
                    Mvp2DecodeJsonStringToken = Mvp2DecodeJsonStringToken & ChrW$(CLng("&H" & Mid$(token, i, 4)))
                    i = i + 4
            End Select
        Else
            Mvp2DecodeJsonStringToken = Mvp2DecodeJsonStringToken & ch
        End If
    Loop
End Function

Public Function Mvp2JsonQuote(ByVal value As String) As String
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
    Mvp2JsonQuote = Chr$(34) & result & Chr$(34)
End Function

Public Sub Mvp2ParseEnvelope(ByVal compactJson As String, ByRef envelope As Mvp2Envelope)
    envelope.FormatVersion = Mvp2JsonTopLevelLong(compactJson, "formatVersion")
    envelope.SaveDataId = Mvp2JsonTopLevelString(compactJson, "saveDataId")
    envelope.ParentSaveDataId = Mvp2JsonTopLevelNullableString(compactJson, "parentSaveDataId")
    envelope.SessionId = Mvp2JsonTopLevelString(compactJson, "sessionId")
    envelope.DatabaseId = Mvp2JsonTopLevelString(compactJson, "databaseId")
    envelope.DataType = Mvp2JsonTopLevelString(compactJson, "dataType")
    envelope.SchemaVersion = Mvp2JsonTopLevelLong(compactJson, "schemaVersion")
    envelope.BaseRevision = Mvp2JsonTopLevelLong(compactJson, "baseRevision")
    envelope.ExportSequence = Mvp2JsonTopLevelLong(compactJson, "exportSequence")
    envelope.AuthorName = Mvp2NormalizeAuthorName(Mvp2JsonTopLevelString(compactJson, "authorName"))
    envelope.ExportedAt = Mvp2JsonTopLevelString(compactJson, "exportedAt")
    envelope.SaveKind = Mvp2JsonTopLevelString(compactJson, "saveKind")
    envelope.ReadOnlyFlag = Mvp2JsonTopLevelBoolean(compactJson, "readOnly")
    envelope.PayloadRaw = Mvp2JsonTopLevelRaw(compactJson, "payload")

    If envelope.FormatVersion <> MVP2_FORMAT_VERSION Then Err.Raise vbObjectError + 2230, , "このExcelで扱えない保存用データです。"
    If Len(envelope.SaveDataId) < 8 Or Len(envelope.SaveDataId) > 100 Then Err.Raise vbObjectError + 2231, , "saveDataIdが正しくありません。"
    If Len(envelope.SessionId) < 8 Or Len(envelope.SessionId) > 100 Then Err.Raise vbObjectError + 2232, , "sessionIdが正しくありません。"
    If Len(envelope.DatabaseId) < 8 Or Len(envelope.DatabaseId) > 100 Then Err.Raise vbObjectError + 2233, , "databaseIdが正しくありません。"
    If Len(envelope.DataType) = 0 Or Len(envelope.DataType) > 100 Then Err.Raise vbObjectError + 2234, , "dataTypeが正しくありません。"
    If envelope.SchemaVersion < 1 Then Err.Raise vbObjectError + 2235, , "schemaVersionが正しくありません。"
    If envelope.BaseRevision < 0 Or envelope.ExportSequence < 1 Then Err.Raise vbObjectError + 2236, , "revisionまたは保存番号が正しくありません。"
    If envelope.SaveKind <> "workCopy" And envelope.SaveKind <> "complete" Then Err.Raise vbObjectError + 2237, , "保存方法が正しくありません。"
    If envelope.ReadOnlyFlag Then Err.Raise vbObjectError + 2238, , "閲覧画面から作られたデータは保存できません。"
    If Len(envelope.ExportedAt) < 16 Or Len(envelope.ExportedAt) > 40 Then Err.Raise vbObjectError + 2239, , "出力日時が正しくありません。"
End Sub

Public Function Mvp2NormalizeAuthorName(ByVal value As String) As String
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
    Mvp2NormalizeAuthorName = result
End Function

Public Function Mvp2ReadUtf8File(ByVal filePath As String) As String
    If FileLen(filePath) > MVP2_MAX_UTF8_BYTES Then Err.Raise vbObjectError + 2250, , "JSONファイルが10MiBの上限を超えています。"
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
    Mvp2ReadUtf8File = stream.ReadText(-1)
    stream.Close
    If Len(Mvp2ReadUtf8File) > MVP2_MAX_CHARS Then Err.Raise vbObjectError + 2251, , "JSONの文字数が上限を超えています。"

    Dim encodedBytes As Variant
    encodedBytes = Mvp2Utf8BytesWithoutBom(Mvp2ReadUtf8File)
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

Public Sub Mvp2WriteUtf8File(ByVal filePath As String, ByVal text As String)
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.WriteText text
    stream.SaveToFile filePath, 2
    stream.Close
End Sub

Public Function Mvp2Crc32Utf8(ByVal text As String) As String
    Mvp2Crc32Utf8 = Mvp2Crc32Bytes(Mvp2Utf8BytesWithoutBom(text))
End Function

Private Function Mvp2Utf8BytesWithoutBom(ByVal text As String) As Variant
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
    Mvp2Utf8BytesWithoutBom = bytes
End Function

Public Function Mvp2Crc32File(ByVal filePath As String) As String
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 1
    stream.Open
    stream.LoadFromFile filePath
    Dim bytes As Variant
    bytes = stream.Read
    stream.Close
    Mvp2Crc32File = Mvp2Crc32Bytes(bytes)
End Function

Private Function Mvp2Crc32Bytes(ByVal bytes As Variant) As String
    Dim crc As Long
    crc = &HFFFFFFFF
    Dim i As Long
    Dim bit As Long
    For i = LBound(bytes) To UBound(bytes)
        crc = crc Xor CLng(bytes(i))
        For bit = 1 To 8
            If (crc And 1) <> 0 Then
                crc = Mvp2UnsignedShiftRightOne(crc) Xor &HEDB88320
            Else
                crc = Mvp2UnsignedShiftRightOne(crc)
            End If
        Next bit
    Next i
    Mvp2Crc32Bytes = Right$("00000000" & Hex$(Not crc), 8)
End Function

Private Function Mvp2UnsignedShiftRightOne(ByVal value As Long) As Long
    If value < 0 Then
        Mvp2UnsignedShiftRightOne = ((value And &H7FFFFFFF) \ 2) Or &H40000000
    Else
        Mvp2UnsignedShiftRightOne = value \ 2
    End If
End Function
