Option Explicit

' ================================================================
' JUST Calc / Excel 互換マクロ用サンプル
'
' 使い方:
'   1. このモジュール全体を標準モジュールへ貼り付ける。
'   2. ブックと同じフォルダーに html/app.template.html を置く。
'   3. InitializeHtmlAppSample を1回実行する。
'   4. シート上のボタンに OpenHtmlApp / ImportHtmlJson を割り当てる。
'
' 外部参照設定は不要。ADODB.Stream と Scripting.Dictionary は
' CreateObject で遅延バインディングしている。
' ================================================================

Private Const DATA_SHEET As String = "業務データ"
Private Const META_SHEET As String = "_APP_META"
Private Const TEMPLATE_FOLDER_NAME As String = "html"
Private Const TEMPLATE_FILE_NAME As String = "app.template.html"
Private Const TEMPLATE_TOKEN As String = "__APP_CONTEXT_JSON__"

Private Const META_DATABASE_ID As String = "B1"
Private Const META_SCHEMA_VERSION As String = "B2"
Private Const META_REVISION As String = "B3"
Private Const META_UPDATED_AT As String = "B4"
Private Const META_UPDATED_BY As String = "B5"

Private Const CURRENT_SCHEMA_VERSION As Long = 1
Private Const MAX_RECORDS As Long = 10000
Private Const MAX_JSON_CHARS As Long = 10485760
Private Const MAX_CELL_CHARS As Long = 32767

Private Const XL_UP As Long = -4162
Private Const XL_TO_LEFT As Long = -4159

' ----------------------------------------------------------------
' 公開マクロ
' ----------------------------------------------------------------

Public Sub InitializeHtmlAppSample()
    On Error GoTo ErrorHandler

    If IsWorkbookReadOnlySafe() Then
        MsgBox "読み取り専用のブックは初期化できません。編集可能な状態で開き直してください。", _
               vbExclamation, "HTMLアプリ初期化"
        Exit Sub
    End If

    If Len(ThisWorkbook.Path) = 0 Then
        MsgBox "先にブックを .xlsm 形式で保存してください。", _
               vbExclamation, "HTMLアプリ初期化"
        Exit Sub
    End If

    Dim dataWs As Object
    Dim metaWs As Object
    Set dataWs = GetOrCreateSheet(DATA_SHEET)
    Set metaWs = GetOrCreateSheet(META_SHEET)

    If Len(CellString(dataWs.Cells(1, 1))) = 0 Then
        dataWs.Cells(1, 1).Value = "id"
        dataWs.Cells(1, 2).Value = "name"
        dataWs.Cells(1, 3).Value = "department"
        dataWs.Cells(1, 4).Value = "note"

        dataWs.Cells(2, 1).NumberFormat = "@"
        dataWs.Cells(2, 1).Value = "001"
        dataWs.Cells(2, 2).Value = "山田 太郎"
        dataWs.Cells(2, 3).Value = "営業"
        dataWs.Cells(2, 4).Value = "サンプル行"
    End If

    metaWs.Range("A1").Value = "databaseId"
    metaWs.Range("A2").Value = "schemaVersion"
    metaWs.Range("A3").Value = "revision"
    metaWs.Range("A4").Value = "updatedAt"
    metaWs.Range("A5").Value = "updatedBy"

    If Len(CellString(metaWs.Range(META_DATABASE_ID))) = 0 Then
        metaWs.Range(META_DATABASE_ID).Value = NewGuidLikeId()
    End If
    If Len(CellString(metaWs.Range(META_SCHEMA_VERSION))) = 0 Then
        metaWs.Range(META_SCHEMA_VERSION).Value = CURRENT_SCHEMA_VERSION
    End If
    If Len(CellString(metaWs.Range(META_REVISION))) = 0 Then
        metaWs.Range(META_REVISION).Value = 0
    End If
    If Len(CellString(metaWs.Range(META_UPDATED_AT))) = 0 Then
        metaWs.Range(META_UPDATED_AT).Value = Format$(Now, "yyyy-mm-dd HH:nn:ss")
    End If
    If Len(CellString(metaWs.Range(META_UPDATED_BY))) = 0 Then
        metaWs.Range(META_UPDATED_BY).Value = CurrentUserName()
    End If

    metaWs.Visible = False
    ThisWorkbook.Save

    MsgBox "初期化が完了しました。" & vbCrLf & vbCrLf & _
           "次に、ブックと同じフォルダーへ次のファイルを置いてください。" & vbCrLf & _
           TemplateRelativePathForDisplay(), vbInformation, "HTMLアプリ初期化"
    Exit Sub

ErrorHandler:
    MsgBox "初期化に失敗しました。" & vbCrLf & _
           "エラー " & Err.Number & ": " & Err.Description, _
           vbCritical, "HTMLアプリ初期化"
End Sub


Public Sub OpenHtmlApp()
    On Error GoTo ErrorHandler

    ValidateWorkbookLayout

    Dim templatePath As String
    templatePath = TemplateFilePath()
    If Len(Dir$(templatePath)) = 0 Then
        MsgBox "HTMLテンプレートが見つかりません。" & vbCrLf & templatePath, _
               vbExclamation, "HTMLアプリを開く"
        Exit Sub
    End If

    Dim templateText As String
    templateText = ReadUtf8Text(templatePath)
    If InStr(1, templateText, TEMPLATE_TOKEN, vbBinaryCompare) = 0 Then
        Err.Raise vbObjectError + 1000, , _
                  "HTMLテンプレートに " & TEMPLATE_TOKEN & " がありません。"
    End If

    Dim contextJson As String
    contextJson = BuildContextJson(IsWorkbookReadOnlySafe())

    Dim generatedHtml As String
    generatedHtml = Replace(templateText, TEMPLATE_TOKEN, contextJson, 1, 1, vbBinaryCompare)

    Dim sessionFolder As String
    sessionFolder = JoinPath(TemporaryFolderPath(), "justcalc-html-app")
    EnsureFolderExists sessionFolder

    Dim sessionPath As String
    sessionPath = JoinPath(sessionFolder, _
                  "app-session-" & Format$(Now, "yyyymmdd-hhnnss") & _
                  "-" & RandomHex(6) & ".html")
    WriteUtf8Text sessionPath, generatedHtml

    Dim shell As Object
    Set shell = CreateObject("WScript.Shell")
    Call shell.Run(Chr$(34) & sessionPath & Chr$(34), 1, False)

    Exit Sub

ErrorHandler:
    MsgBox "HTMLアプリを開けませんでした。" & vbCrLf & _
           "エラー " & Err.Number & ": " & Err.Description, _
           vbCritical, "HTMLアプリを開く"
End Sub


Public Sub ImportHtmlJson()
    On Error GoTo ErrorHandler

    Dim updateStarted As Boolean
    Dim screenUpdatingChanged As Boolean
    Dim oldScreenUpdating As Boolean

    If IsWorkbookReadOnlySafe() Then
        MsgBox "読み取り専用のブックには取り込めません。", _
               vbExclamation, "JSONを取り込む"
        Exit Sub
    End If

    ValidateWorkbookLayout

    Dim selectedPath As Variant
    selectedPath = Application.GetOpenFilename( _
        "JSON ファイル (*.json),*.json", , "HTMLから出力したJSONを選択")
    If VarType(selectedPath) = vbBoolean Then Exit Sub

    Dim jsonText As String
    jsonText = ReadUtf8Text(CStr(selectedPath))
    If Len(jsonText) > MAX_JSON_CHARS Then
        Err.Raise vbObjectError + 1001, , "JSONファイルが大きすぎます。"
    End If

    Dim root As Object
    Set root = ParseJsonRoot(jsonText)

    Dim records As Collection
    Set records = ValidateImportPayload(root)

    If MsgBox(records.Count & "件のデータで「" & DATA_SHEET & _
              "」を更新します。よろしいですか？", _
              vbQuestion + vbYesNo + vbDefaultButton2, "JSONを取り込む") <> vbYes Then
        Exit Sub
    End If

    ' ファイル選択後にブック状態が変わっていないか、更新直前にも確認する。
    If IsWorkbookReadOnlySafe() Then
        MsgBox "ブックが読み取り専用になったため、取り込みを中止しました。", _
               vbExclamation, "JSONを取り込む"
        Exit Sub
    End If

    oldScreenUpdating = Application.ScreenUpdating
    Application.ScreenUpdating = False
    screenUpdatingChanged = True

    updateStarted = True
    ApplyImportedRecords records
    UpdateMetadataAfterImport
    ThisWorkbook.Save

    Application.ScreenUpdating = oldScreenUpdating
    screenUpdatingChanged = False

    MsgBox "取り込みとブック保存が完了しました。" & vbCrLf & _
           "新しいrevision: " & CurrentRevision(), _
           vbInformation, "JSONを取り込む"
    Exit Sub

ErrorHandler:
    Dim originalErrorNumber As Long
    Dim originalErrorDescription As String
    originalErrorNumber = Err.Number
    originalErrorDescription = Err.Description

    On Error Resume Next
    If screenUpdatingChanged Then Application.ScreenUpdating = oldScreenUpdating
    On Error GoTo 0

    Dim failureMessage As String
    If updateStarted Then
        failureMessage = "取り込み中に失敗しました。ブックに未保存の変更が残っている可能性があります。保存せずに閉じ、元ファイルを開き直してください。"
    Else
        failureMessage = "JSONを取り込めませんでした。データは更新されていません。"
    End If

    MsgBox failureMessage & vbCrLf & _
           "エラー " & originalErrorNumber & ": " & originalErrorDescription, _
           vbCritical, "JSONを取り込む"
End Sub


Public Sub ShowHtmlAppStatus()
    On Error GoTo ErrorHandler

    Dim report As String
    report = "workbook: " & ThisWorkbook.FullName & vbCrLf & _
             "readOnly: " & LCase$(CStr(IsWorkbookReadOnlySafe())) & vbCrLf & _
             "dataSheet: " & SheetPresenceText(DATA_SHEET) & vbCrLf & _
             "metaSheet: " & SheetPresenceText(META_SHEET) & vbCrLf

    If SheetExists(DATA_SHEET) Then
        Dim dataWs As Object
        Set dataWs = ThisWorkbook.Worksheets(DATA_SHEET)
        report = report & _
                 "data.A1: " & CellString(dataWs.Cells(1, 1)) & vbCrLf & _
                 "data.A2: " & CellString(dataWs.Cells(2, 1)) & vbCrLf & _
                 "lastRowByMacro: " & DataLastRowForDiagnostics(dataWs) & vbCrLf & _
                 "usedRangeLastRow: " & UsedRangeLastRowForDiagnostics(dataWs) & vbCrLf & _
                 "recordsForHtml: " & RecordCountForDiagnostics(dataWs) & vbCrLf
    End If

    If SheetExists(META_SHEET) Then
        report = report & _
                 "databaseId: " & CurrentDatabaseId() & vbCrLf & _
                 "schemaVersion: " & CurrentSchemaVersion() & vbCrLf & _
                 "revision: " & CurrentRevision() & vbCrLf & _
                 "updatedAt: " & MetaValue(META_UPDATED_AT) & vbCrLf & _
                 "updatedBy: " & MetaValue(META_UPDATED_BY) & vbCrLf
    End If

    report = report & "template: " & TemplateFilePath()
    MsgBox report, vbInformation, "HTMLアプリ診断"
    Exit Sub

ErrorHandler:
    MsgBox Err.Description, vbCritical, "HTMLアプリ状態"
End Sub


Public Sub ShowAppMetaSheet()
    On Error GoTo ErrorHandler
    If Not SheetExists(META_SHEET) Then
        MsgBox "シート「" & META_SHEET & "」は、このブック内にありません。", _
               vbExclamation, "APP_META表示"
        Exit Sub
    End If

    Dim metaWs As Object
    Set metaWs = ThisWorkbook.Worksheets(META_SHEET)
    metaWs.Visible = True
    metaWs.Activate
    MsgBox "シート「" & META_SHEET & "」を表示しました。" & vbCrLf & _
           "確認後に非表示へ戻す場合は HideAppMetaSheet を実行してください。", _
           vbInformation, "APP_META表示"
    Exit Sub

ErrorHandler:
    MsgBox Err.Description, vbCritical, "APP_META表示"
End Sub


Public Sub HideAppMetaSheet()
    On Error GoTo ErrorHandler
    If SheetExists(META_SHEET) Then
        ThisWorkbook.Worksheets(META_SHEET).Visible = False
    End If
    Exit Sub

ErrorHandler:
    MsgBox Err.Description, vbCritical, "APP_META非表示"
End Sub

' ----------------------------------------------------------------
' ブック / データ処理
' ----------------------------------------------------------------

Private Sub ValidateWorkbookLayout()
    If Len(ThisWorkbook.Path) = 0 Then
        Err.Raise vbObjectError + 1010, , "ブックが保存されていません。"
    End If
    If Not SheetExists(DATA_SHEET) Then
        Err.Raise vbObjectError + 1011, , _
                  "シート「" & DATA_SHEET & "」がありません。"
    End If
    If Not SheetExists(META_SHEET) Then
        Err.Raise vbObjectError + 1012, , _
                  "シート「" & META_SHEET & "」がありません。"
    End If
    If Len(CurrentDatabaseId()) = 0 Then
        Err.Raise vbObjectError + 1013, , "databaseIdが設定されていません。"
    End If
    If CurrentSchemaVersion() < 1 Then
        Err.Raise vbObjectError + 1014, , "schemaVersionが不正です。"
    End If
    If CurrentRevision() < 0 Then
        Err.Raise vbObjectError + 1015, , "revisionが不正です。"
    End If

    Dim headers As Variant
    headers = ReadHeaders(ThisWorkbook.Worksheets(DATA_SHEET))
End Sub


Private Function BuildContextJson(ByVal isReadOnly As Boolean) As String
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(DATA_SHEET)

    Dim headers As Variant
    headers = ReadHeaders(ws)

    Dim lastRow As Long
    lastRow = LastDataRow(ws, UBound(headers))

    Dim json As String
    json = "{" & _
           """databaseId"":" & JsonQuote(CurrentDatabaseId()) & "," & _
           """schemaVersion"":" & CStr(CurrentSchemaVersion()) & "," & _
           """revision"":" & CStr(CurrentRevision()) & "," & _
           """readOnly"":" & LCase$(CStr(isReadOnly)) & "," & _
           """fields"":["

    Dim c As Long
    For c = LBound(headers) To UBound(headers)
        If c > LBound(headers) Then json = json & ","
        json = json & JsonQuote(CStr(headers(c)))
    Next c
    json = json & "],""records"":["

    Dim firstRecord As Boolean
    firstRecord = True

    Dim r As Long
    For r = 2 To lastRow
        If RowHasData(ws, r, UBound(headers)) Then
            If Not firstRecord Then json = json & ","
            firstRecord = False
            json = json & "{"

            For c = LBound(headers) To UBound(headers)
                If c > LBound(headers) Then json = json & ","
                json = json & JsonQuote(CStr(headers(c))) & ":" & _
                              JsonQuote(CellString(ws.Cells(r, c)))
            Next c
            json = json & "}"
        End If
    Next r

    json = json & "]}"
    BuildContextJson = json
End Function


Private Function ValidateImportPayload(ByVal root As Object) As Collection
    RequireKey root, "databaseId"
    RequireKey root, "schemaVersion"
    RequireKey root, "revision"
    RequireKey root, "readOnly"
    RequireKey root, "records"

    If CStr(root("databaseId")) <> CurrentDatabaseId() Then
        Err.Raise vbObjectError + 1020, , _
                  "databaseIdが一致しません。別のブック用JSONです。"
    End If
    If CLng(root("schemaVersion")) <> CurrentSchemaVersion() Then
        Err.Raise vbObjectError + 1021, , _
                  "schemaVersionが一致しません。"
    End If
    If CLng(root("revision")) <> CurrentRevision() Then
        Err.Raise vbObjectError + 1022, , _
                  "revisionが一致しません。HTMLを開き直してください。"
    End If
    If CBool(root("readOnly")) Then
        Err.Raise vbObjectError + 1023, , _
                  "閲覧モードから作成されたJSONは取り込めません。"
    End If
    If Not IsObject(root("records")) Then
        Err.Raise vbObjectError + 1024, , "recordsが配列ではありません。"
    End If

    Dim records As Collection
    Set records = root("records")
    If records.Count > MAX_RECORDS Then
        Err.Raise vbObjectError + 1025, , _
                  "レコード数が上限 " & MAX_RECORDS & " 件を超えています。"
    End If

    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(DATA_SHEET)
    Dim headers As Variant
    headers = ReadHeaders(ws)

    Dim idColumn As Long
    idColumn = FindHeader(headers, "id")
    Dim seenIds As Object
    Set seenIds = CreateObject("Scripting.Dictionary")
    seenIds.CompareMode = vbBinaryCompare

    Dim i As Long
    Dim c As Long
    Dim record As Object
    Dim value As Variant

    For i = 1 To records.Count
        If Not IsObject(records.Item(i)) Then
            Err.Raise vbObjectError + 1026, , _
                      i & "件目のレコードがオブジェクトではありません。"
        End If
        Set record = records.Item(i)

        For c = LBound(headers) To UBound(headers)
            If Not record.Exists(CStr(headers(c))) Then
                Err.Raise vbObjectError + 1027, , _
                          i & "件目に項目「" & headers(c) & "」がありません。"
            End If
            value = record(CStr(headers(c)))
            If IsObject(value) Then
                Err.Raise vbObjectError + 1028, , _
                          "セル値に配列やオブジェクトは使用できません。"
            End If
            If Not IsNull(value) Then
                If Len(CStr(value)) > MAX_CELL_CHARS Then
                    Err.Raise vbObjectError + 1029, , _
                              i & "件目の「" & headers(c) & "」が長すぎます。"
                End If
            End If
        Next c

        If idColumn > 0 Then
            Dim idValue As String
            idValue = Trim$(CStr(record("id")))
            If Len(idValue) = 0 Then
                Err.Raise vbObjectError + 1030, , i & "件目のidが空です。"
            End If
            If seenIds.Exists(idValue) Then
                Err.Raise vbObjectError + 1031, , _
                          "id「" & idValue & "」が重複しています。"
            End If
            seenIds.Add idValue, True
        End If
    Next i

    Set ValidateImportPayload = records
End Function


Private Sub ApplyImportedRecords(ByVal records As Collection)
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(DATA_SHEET)

    Dim headers As Variant
    headers = ReadHeaders(ws)

    Dim lastRow As Long
    lastRow = LastDataRow(ws, UBound(headers))
    If lastRow >= 2 Then
        ws.Range(ws.Cells(2, 1), ws.Cells(lastRow, UBound(headers))).ClearContents
    End If

    If records.Count = 0 Then Exit Sub

    Dim output() As Variant
    ReDim output(1 To records.Count, 1 To UBound(headers))

    Dim r As Long
    Dim c As Long
    Dim record As Object
    Dim value As Variant

    For r = 1 To records.Count
        Set record = records.Item(r)
        For c = LBound(headers) To UBound(headers)
            value = record(CStr(headers(c)))
            If IsNull(value) Or IsEmpty(value) Then
                output(r, c) = vbNullString
            Else
                output(r, c) = CStr(value)
            End If
        Next c
    Next r

    Dim target As Object
    Set target = ws.Range(ws.Cells(2, 1), _
                          ws.Cells(records.Count + 1, UBound(headers)))
    target.NumberFormat = "@"
    target.Value = output
End Sub


Private Sub UpdateMetadataAfterImport()
    Dim metaWs As Object
    Set metaWs = ThisWorkbook.Worksheets(META_SHEET)
    metaWs.Range(META_REVISION).Value = CurrentRevision() + 1
    metaWs.Range(META_UPDATED_AT).Value = Format$(Now, "yyyy-mm-dd HH:nn:ss")
    metaWs.Range(META_UPDATED_BY).Value = CurrentUserName()
End Sub


Private Function ReadHeaders(ByVal ws As Object) As Variant
    Dim lastCol As Long
    lastCol = ws.Cells(1, ws.Columns.Count).End(XL_TO_LEFT).Column
    If lastCol < 1 Or Len(CellString(ws.Cells(1, 1))) = 0 Then
        Err.Raise vbObjectError + 1040, , _
                  "「" & DATA_SHEET & "」の1行目にヘッダーがありません。"
    End If

    Dim headers() As String
    ReDim headers(1 To lastCol)

    Dim seen As Object
    Set seen = CreateObject("Scripting.Dictionary")
    seen.CompareMode = vbBinaryCompare

    Dim c As Long
    Dim header As String
    For c = 1 To lastCol
        header = Trim$(CellString(ws.Cells(1, c)))
        If Len(header) = 0 Then
            Err.Raise vbObjectError + 1041, , _
                      "1行目の" & c & "列目のヘッダーが空です。"
        End If
        If seen.Exists(header) Then
            Err.Raise vbObjectError + 1042, , _
                      "ヘッダー「" & header & "」が重複しています。"
        End If
        seen.Add header, True
        headers(c) = header
    Next c

    ReadHeaders = headers
End Function


Private Function LastDataRow(ByVal ws As Object, ByVal lastCol As Long) As Long
    Dim result As Long
    result = 1

    Dim c As Long
    Dim candidate As Long
    Dim usedRangeLastRow As Long

    On Error GoTo TryUsedRange
    For c = 1 To lastCol
        candidate = ws.Cells(ws.Rows.Count, c).End(XL_UP).Row
        If candidate > result Then result = candidate
    Next c

TryUsedRange:
    ' JUST Calcの環境によってEnd(xlUp)が1を返す場合に備え、
    ' UsedRangeの最終行を安全な上限内でフォールバックに使う。
    Err.Clear
    On Error Resume Next
    usedRangeLastRow = ws.UsedRange.Row + ws.UsedRange.Rows.Count - 1
    On Error GoTo 0
    If usedRangeLastRow > result And _
       usedRangeLastRow <= MAX_RECORDS + 1 Then
        result = usedRangeLastRow
    End If

    LastDataRow = result
End Function


Private Function RowHasData(ByVal ws As Object, ByVal rowNumber As Long, _
                            ByVal lastCol As Long) As Boolean
    Dim c As Long
    For c = 1 To lastCol
        If Len(CellString(ws.Cells(rowNumber, c))) > 0 Then
            RowHasData = True
            Exit Function
        End If
    Next c
End Function


Private Function SheetPresenceText(ByVal sheetName As String) As String
    If SheetExists(sheetName) Then
        SheetPresenceText = "exists"
    Else
        SheetPresenceText = "MISSING"
    End If
End Function


Private Function DataLastRowForDiagnostics(ByVal ws As Object) As Long
    On Error GoTo Failed
    Dim headers As Variant
    headers = ReadHeaders(ws)
    DataLastRowForDiagnostics = LastDataRow(ws, UBound(headers))
    Exit Function

Failed:
    DataLastRowForDiagnostics = -1
End Function


Private Function UsedRangeLastRowForDiagnostics(ByVal ws As Object) As Long
    On Error GoTo Failed
    UsedRangeLastRowForDiagnostics = _
        ws.UsedRange.Row + ws.UsedRange.Rows.Count - 1
    Exit Function

Failed:
    UsedRangeLastRowForDiagnostics = -1
End Function


Private Function RecordCountForDiagnostics(ByVal ws As Object) As Long
    On Error GoTo Failed
    Dim headers As Variant
    headers = ReadHeaders(ws)

    Dim lastRow As Long
    lastRow = LastDataRow(ws, UBound(headers))

    Dim result As Long
    Dim r As Long
    For r = 2 To lastRow
        If RowHasData(ws, r, UBound(headers)) Then result = result + 1
    Next r

    RecordCountForDiagnostics = result
    Exit Function

Failed:
    RecordCountForDiagnostics = -1
End Function


Private Function FindHeader(ByVal headers As Variant, ByVal target As String) As Long
    Dim i As Long
    For i = LBound(headers) To UBound(headers)
        If CStr(headers(i)) = target Then
            FindHeader = i
            Exit Function
        End If
    Next i
End Function


Private Function CellString(ByVal cell As Object) As String
    Dim value As Variant
    value = cell.Value
    If IsError(value) Then
        CellString = "#ERROR"
    ElseIf IsNull(value) Or IsEmpty(value) Then
        CellString = vbNullString
    Else
        CellString = CStr(value)
    End If
End Function

' ----------------------------------------------------------------
' メタデータ / シート
' ----------------------------------------------------------------

Private Function SheetExists(ByVal sheetName As String) As Boolean
    On Error Resume Next
    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets(sheetName)
    SheetExists = Not ws Is Nothing
    On Error GoTo 0
End Function


Private Function GetOrCreateSheet(ByVal sheetName As String) As Object
    If SheetExists(sheetName) Then
        Set GetOrCreateSheet = ThisWorkbook.Worksheets(sheetName)
        Exit Function
    End If

    Dim ws As Object
    Set ws = ThisWorkbook.Worksheets.Add
    ws.Name = sheetName
    Set GetOrCreateSheet = ws
End Function


Private Function MetaValue(ByVal address As String) As String
    MetaValue = CellString(ThisWorkbook.Worksheets(META_SHEET).Range(address))
End Function


Private Function CurrentDatabaseId() As String
    CurrentDatabaseId = MetaValue(META_DATABASE_ID)
End Function


Private Function CurrentSchemaVersion() As Long
    CurrentSchemaVersion = CLng(Val(MetaValue(META_SCHEMA_VERSION)))
End Function


Private Function CurrentRevision() As Long
    CurrentRevision = CLng(Val(MetaValue(META_REVISION)))
End Function


Private Function CurrentUserName() As String
    CurrentUserName = Environ$("USERNAME")
    If Len(CurrentUserName) = 0 Then CurrentUserName = "unknown"
End Function


Private Function IsWorkbookReadOnlySafe() As Boolean
    ' ReadOnlyプロパティが使えない環境では、安全側の閲覧モードに倒す。
    On Error GoTo SafeReadOnly
    IsWorkbookReadOnlySafe = CBool(ThisWorkbook.ReadOnly)
    Exit Function

SafeReadOnly:
    IsWorkbookReadOnlySafe = True
End Function


Private Function NewGuidLikeId() As String
    Randomize Timer
    NewGuidLikeId = RandomHex(8) & "-" & RandomHex(4) & "-4" & RandomHex(3) & _
                    "-" & Mid$("89ab", Int(Rnd() * 4) + 1, 1) & RandomHex(3) & _
                    "-" & RandomHex(12)
End Function


Private Function RandomHex(ByVal length As Long) As String
    Dim chars As String
    chars = "0123456789abcdef"

    Dim i As Long
    For i = 1 To length
        RandomHex = RandomHex & Mid$(chars, Int(Rnd() * 16) + 1, 1)
    Next i
End Function

' ----------------------------------------------------------------
' UTF-8ファイル / パス
' ----------------------------------------------------------------

Private Function TemplateFilePath() As String
    TemplateFilePath = JoinPath( _
        JoinPath(ThisWorkbook.Path, TEMPLATE_FOLDER_NAME), _
        TEMPLATE_FILE_NAME)
End Function


Private Function TemplateRelativePathForDisplay() As String
    TemplateRelativePathForDisplay = TEMPLATE_FOLDER_NAME & _
        PathSeparatorFor(ThisWorkbook.Path) & TEMPLATE_FILE_NAME
End Function


Private Function TemporaryFolderPath() As String
    Dim result As String
    result = Environ$("TEMP")
    If Len(result) = 0 Then result = Environ$("TMPDIR")
    If Len(result) = 0 Then
        Err.Raise vbObjectError + 1070, , _
                  "一時フォルダーを取得できません。"
    End If
    TemporaryFolderPath = result
End Function


Private Function JoinPath(ByVal parentPath As String, _
                          ByVal childPath As String) As String
    Dim separator As String
    separator = PathSeparatorFor(parentPath)

    Do While Len(parentPath) > 0 And _
             IsAnyPathSeparator(Right$(parentPath, 1))
        parentPath = Left$(parentPath, Len(parentPath) - 1)
    Loop

    Do While Len(childPath) > 0 And _
             IsAnyPathSeparator(Left$(childPath, 1))
        childPath = Mid$(childPath, 2)
    Loop

    JoinPath = parentPath & separator & childPath
End Function


Private Function PathSeparatorFor(ByVal pathText As String) As String
    ' Windowsの C:\... と、Macの /Users/... の両方に対応する。
    If InStr(1, pathText, Chr$(92), vbBinaryCompare) > 0 Then
        PathSeparatorFor = Chr$(92)
    ElseIf InStr(1, pathText, "/", vbBinaryCompare) > 0 Then
        PathSeparatorFor = "/"
    ElseIf InStr(1, pathText, ":", vbBinaryCompare) > 0 Then
        PathSeparatorFor = ":"
    Else
        PathSeparatorFor = Application.PathSeparator
    End If
End Function


Private Function IsAnyPathSeparator(ByVal value As String) As Boolean
    IsAnyPathSeparator = (value = Chr$(92) Or value = "/" Or value = ":")
End Function

Private Function ReadUtf8Text(ByVal filePath As String) As String
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")
    With stream
        .Type = 2              ' adTypeText
        .Charset = "utf-8"
        .Open
        .LoadFromFile filePath
        ReadUtf8Text = .ReadText(-1) ' adReadAll
        .Close
    End With
End Function


Private Sub WriteUtf8Text(ByVal filePath As String, ByVal text As String)
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")
    With stream
        .Type = 2              ' adTypeText
        .Charset = "utf-8"
        .Open
        .WriteText text
        .SaveToFile filePath, 2 ' adSaveCreateOverWrite
        .Close
    End With
End Sub


Private Sub EnsureFolderExists(ByVal folderPath As String)
    If Len(Dir$(folderPath, vbDirectory)) = 0 Then MkDir folderPath
End Sub

' ----------------------------------------------------------------
' JSON生成
' ----------------------------------------------------------------

Private Function JsonQuote(ByVal value As String) As String
    JsonQuote = Chr$(34) & JsonEscape(value) & Chr$(34)
End Function


Private Function JsonEscape(ByVal value As String) As String
    Dim result As String
    Dim i As Long
    Dim ch As String
    Dim code As Long

    For i = 1 To Len(value)
        ch = Mid$(value, i, 1)
        code = AscW(ch)
        If code < 0 Then code = code + 65536

        Select Case ch
            Case Chr$(34): result = result & "\"""
            Case "\": result = result & "\\"
            Case vbBack: result = result & "\b"
            Case vbFormFeed: result = result & "\f"
            Case vbLf: result = result & "\n"
            Case vbCr: result = result & "\r"
            Case vbTab: result = result & "\t"
            Case "<": result = result & "\u003c"
            Case ">": result = result & "\u003e"
            Case "&": result = result & "\u0026"
            Case Else
                If code < 32 Or code = &H2028 Or code = &H2029 Then
                    result = result & "\u" & Right$("0000" & Hex$(code), 4)
                Else
                    result = result & ch
                End If
        End Select
    Next i

    JsonEscape = result
End Function

' ----------------------------------------------------------------
' 依存ライブラリ不要の最小JSONパーサー
' object / array / string / number / true / false / null に対応。
' ----------------------------------------------------------------

Private Function ParseJsonRoot(ByVal jsonText As String) As Object
    Dim position As Long
    position = 1
    SkipJsonWhitespace jsonText, position

    If JsonCharAt(jsonText, position) <> "{" Then
        JsonError position, "ルート要素はオブジェクトである必要があります。"
    End If

    Dim root As Object
    Set root = ParseJsonObject(jsonText, position)
    SkipJsonWhitespace jsonText, position
    If position <= Len(jsonText) Then
        JsonError position, "JSONの末尾に余分な文字があります。"
    End If

    Set ParseJsonRoot = root
End Function


Private Function ParseJsonObject(ByVal jsonText As String, _
                                 ByRef position As Long) As Object
    ExpectJsonChar jsonText, position, "{"

    Dim result As Object
    Set result = CreateObject("Scripting.Dictionary")
    result.CompareMode = vbBinaryCompare

    SkipJsonWhitespace jsonText, position
    If JsonCharAt(jsonText, position) = "}" Then
        position = position + 1
        Set ParseJsonObject = result
        Exit Function
    End If

    Do
        SkipJsonWhitespace jsonText, position
        If JsonCharAt(jsonText, position) <> Chr$(34) Then
            JsonError position, "オブジェクトのキーが文字列ではありません。"
        End If

        Dim key As String
        key = ParseJsonString(jsonText, position)
        If result.Exists(key) Then
            JsonError position, "キー「" & key & "」が重複しています。"
        End If

        SkipJsonWhitespace jsonText, position
        ExpectJsonChar jsonText, position, ":"
        SkipJsonWhitespace jsonText, position

        Dim nextChar As String
        nextChar = JsonCharAt(jsonText, position)
        If nextChar = "{" Or nextChar = "[" Then
            Dim objectValue As Object
            Set objectValue = ParseJsonValue(jsonText, position)
            result.Add key, objectValue
        Else
            result.Add key, ParseJsonValue(jsonText, position)
        End If

        SkipJsonWhitespace jsonText, position
        Select Case JsonCharAt(jsonText, position)
            Case "}"
                position = position + 1
                Exit Do
            Case ","
                position = position + 1
            Case Else
                JsonError position, "オブジェクト内に ',' または '}' が必要です。"
        End Select
    Loop

    Set ParseJsonObject = result
End Function


Private Function ParseJsonArray(ByVal jsonText As String, _
                                ByRef position As Long) As Collection
    ExpectJsonChar jsonText, position, "["

    Dim result As New Collection
    SkipJsonWhitespace jsonText, position
    If JsonCharAt(jsonText, position) = "]" Then
        position = position + 1
        Set ParseJsonArray = result
        Exit Function
    End If

    Do
        SkipJsonWhitespace jsonText, position
        Dim nextChar As String
        nextChar = JsonCharAt(jsonText, position)

        If nextChar = "{" Or nextChar = "[" Then
            Dim objectValue As Object
            Set objectValue = ParseJsonValue(jsonText, position)
            result.Add objectValue
        Else
            result.Add ParseJsonValue(jsonText, position)
        End If

        SkipJsonWhitespace jsonText, position
        Select Case JsonCharAt(jsonText, position)
            Case "]"
                position = position + 1
                Exit Do
            Case ","
                position = position + 1
            Case Else
                JsonError position, "配列内に ',' または ']' が必要です。"
        End Select
    Loop

    Set ParseJsonArray = result
End Function


Private Function ParseJsonValue(ByVal jsonText As String, _
                                ByRef position As Long) As Variant
    SkipJsonWhitespace jsonText, position

    Select Case JsonCharAt(jsonText, position)
        Case "{"
            Dim objectValue As Object
            Set objectValue = ParseJsonObject(jsonText, position)
            Set ParseJsonValue = objectValue
        Case "["
            Dim arrayValue As Collection
            Set arrayValue = ParseJsonArray(jsonText, position)
            Set ParseJsonValue = arrayValue
        Case Chr$(34)
            ParseJsonValue = ParseJsonString(jsonText, position)
        Case "t"
            ExpectJsonLiteral jsonText, position, "true"
            ParseJsonValue = True
        Case "f"
            ExpectJsonLiteral jsonText, position, "false"
            ParseJsonValue = False
        Case "n"
            ExpectJsonLiteral jsonText, position, "null"
            ParseJsonValue = Null
        Case "-", "0" To "9"
            ParseJsonValue = ParseJsonNumber(jsonText, position)
        Case Else
            JsonError position, "値を解釈できません。"
    End Select
End Function


Private Function ParseJsonString(ByVal jsonText As String, _
                                 ByRef position As Long) As String
    ExpectJsonChar jsonText, position, Chr$(34)

    Dim result As String
    Dim ch As String

    Do While position <= Len(jsonText)
        ch = JsonCharAt(jsonText, position)
        position = position + 1

        If ch = Chr$(34) Then
            ParseJsonString = result
            Exit Function
        End If

        If ch = "\" Then
            If position > Len(jsonText) Then JsonError position, "不正なエスケープです。"
            ch = JsonCharAt(jsonText, position)
            position = position + 1

            Select Case ch
                Case Chr$(34), "\", "/": result = result & ch
                Case "b": result = result & vbBack
                Case "f": result = result & vbFormFeed
                Case "n": result = result & vbLf
                Case "r": result = result & vbCr
                Case "t": result = result & vbTab
                Case "u": result = result & ParseJsonUnicode(jsonText, position)
                Case Else: JsonError position, "不正なエスケープです。"
            End Select
        Else
            If AscW(ch) >= 0 And AscW(ch) < 32 Then
                JsonError position, "文字列に制御文字があります。"
            End If
            result = result & ch
        End If
    Loop

    JsonError position, "文字列が閉じられていません。"
End Function


Private Function ParseJsonUnicode(ByVal jsonText As String, _
                                  ByRef position As Long) As String
    If position + 3 > Len(jsonText) Then
        JsonError position, "Unicodeエスケープが途中で終わっています。"
    End If

    Dim hexText As String
    hexText = Mid$(jsonText, position, 4)
    If Not IsHex4(hexText) Then
        JsonError position, "Unicodeエスケープが不正です。"
    End If
    position = position + 4
    ParseJsonUnicode = ChrW(CLng("&H" & hexText))
End Function


Private Function ParseJsonNumber(ByVal jsonText As String, _
                                 ByRef position As Long) As Double
    Dim startPosition As Long
    startPosition = position

    Dim ch As String
    Do While position <= Len(jsonText)
        ch = JsonCharAt(jsonText, position)
        If InStr(1, "-+0123456789.eE", ch, vbBinaryCompare) = 0 Then Exit Do
        position = position + 1
    Loop

    Dim token As String
    token = Mid$(jsonText, startPosition, position - startPosition)
    If Len(token) = 0 Then JsonError startPosition, "数値がありません。"
    ParseJsonNumber = Val(token)
End Function


Private Sub SkipJsonWhitespace(ByVal jsonText As String, ByRef position As Long)
    Dim ch As String
    Do While position <= Len(jsonText)
        ch = JsonCharAt(jsonText, position)
        If ch <> " " And ch <> vbTab And ch <> vbCr And ch <> vbLf Then Exit Do
        position = position + 1
    Loop
End Sub


Private Sub ExpectJsonChar(ByVal jsonText As String, ByRef position As Long, _
                           ByVal expected As String)
    If JsonCharAt(jsonText, position) <> expected Then
        JsonError position, "'" & expected & "' が必要です。"
    End If
    position = position + 1
End Sub


Private Sub ExpectJsonLiteral(ByVal jsonText As String, ByRef position As Long, _
                              ByVal expected As String)
    If Mid$(jsonText, position, Len(expected)) <> expected Then
        JsonError position, "'" & expected & "' が必要です。"
    End If
    position = position + Len(expected)
End Sub


Private Function JsonCharAt(ByVal jsonText As String, ByVal position As Long) As String
    If position < 1 Or position > Len(jsonText) Then
        JsonCharAt = vbNullString
    Else
        JsonCharAt = Mid$(jsonText, position, 1)
    End If
End Function


Private Function IsHex4(ByVal value As String) As Boolean
    If Len(value) <> 4 Then Exit Function

    Dim i As Long
    Dim ch As String
    For i = 1 To 4
        ch = LCase$(Mid$(value, i, 1))
        If InStr(1, "0123456789abcdef", ch, vbBinaryCompare) = 0 Then Exit Function
    Next i
    IsHex4 = True
End Function


Private Sub RequireKey(ByVal dictionary As Object, ByVal key As String)
    If Not dictionary.Exists(key) Then
        Err.Raise vbObjectError + 1050, , _
                  "必須項目「" & key & "」がありません。"
    End If
End Sub


Private Sub JsonError(ByVal position As Long, ByVal message As String)
    Err.Raise vbObjectError + 1060, , _
              "JSONの" & position & "文字目: " & message
End Sub
