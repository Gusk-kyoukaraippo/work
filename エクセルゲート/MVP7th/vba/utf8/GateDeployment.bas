Attribute VB_Name = "GateDeployment"
Option Explicit
#Const GATE_TESTING = False
#If GATE_TESTING Then
Public gGateTestFailStage As String
#End If

Public Const GATE_RUNTIME_VERSION As String = "0.7.1"
Private runtimeFolders As Collection

Public Function GateAppConfig(ByVal key As String) As String
    Dim configJson As String
    configJson = GateValidateAndMinifyJson(GateReadUtf8File(GateProjectPath("gate.config.json")))
    GateAppConfig = GateJsonTopLevelString(configJson, key)
End Function

Public Function GateConfigVersion() As Long
    Dim configJson As String
    configJson = GateValidateAndMinifyJson(GateReadUtf8File(GateProjectPath("gate.config.json")))
    GateConfigVersion = GateJsonTopLevelLong(configJson, "dataVersion")
End Function

Public Function GateAuthorRequired() As Boolean
    Dim configJson As String
    configJson = GateValidateAndMinifyJson(GateReadUtf8File(GateProjectPath("gate.config.json")))
    GateAuthorRequired = GateJsonTopLevelBoolean(configJson, "authorRequired")
End Function

Public Sub GateValidateDeployment()
    If GateAppConfig("runtimeVersion") <> GATE_RUNTIME_VERSION Then Err.Raise vbObjectError + 2700, , "共通部品の版が一致しません。配布一式を確認してください。"
    If GateAppConfig("viewPolicy") <> "view" And GateAppConfig("viewPolicy") <> "block" Then Err.Raise vbObjectError + 2701, , "閲覧設定が不正です。"
    If Len(GateAppConfig("displayName")) = 0 Or Len(GateAppConfig("appId")) = 0 Or GateConfigVersion() < 1 Then Err.Raise vbObjectError + 2702, , "配布設定が不足しています。"
    If GateUsesCsvFolder() And GateAppConfig("viewPolicy") <> "view" Then Err.Raise vbObjectError + 2712, , "CSVフォルダ閲覧型には閲覧許可が必要です。"
    GateRequireRelativePath GateAppConfig("entry")
    If Not GateFileExists(GateProjectPath("runtime/" & GateAppConfig("entry"))) Then Err.Raise vbObjectError + 2703, , "アプリの入口が見つかりません。"
End Sub

Public Sub GateRequireRelativePath(ByVal relative As String)
    Dim part As Variant
    Dim ch As Long
    If Len(relative) = 0 Or InStr(relative, Chr$(92)) > 0 Or InStr(relative, ":") > 0 Or Left$(relative, 1) = "/" Then GoTo InvalidPath
    For ch = 1 To Len(relative)
        If AscW(Mid$(relative, ch, 1)) >= 0 And AscW(Mid$(relative, ch, 1)) < 32 Then GoTo InvalidPath
        If InStr("*?""<>|", Mid$(relative, ch, 1)) > 0 Then GoTo InvalidPath
    Next ch
    For Each part In Split(relative, "/")
        If Len(CStr(part)) = 0 Or part = "." Or part = ".." Then GoTo InvalidPath
        If Right$(CStr(part), 1) = "." Or Right$(CStr(part), 1) = " " Then GoTo InvalidPath
    Next part
    Exit Sub
InvalidPath:
    Err.Raise vbObjectError + 2704, , "配布ファイルの相対パスが不正です。"
End Sub

Public Function GateCanonicalPath(ByVal fullPath As String) As String
    ' Supported aliases: case, separator, mapped drive -> UNC. No DNS/DFS/8.3 aliases.
    Dim normalized As String
    normalized = Replace(fullPath, "/", Chr$(92))
    If Len(normalized) = 0 Then Err.Raise vbObjectError + 2705, , "正本の場所を確認できません。"
    If Mid$(normalized, 2, 1) = ":" Then
        Dim network As Object, drives As Object, i As Long
        Set network = CreateObject("WScript.Network")
        Set drives = network.EnumNetworkDrives
        For i = 0 To drives.Count - 1 Step 2
            If LCase$(Left$(normalized, 2)) = LCase$(CStr(drives.Item(i))) Then
                normalized = CStr(drives.Item(i + 1)) & Mid$(normalized, 3)
                Exit For
            End If
        Next i
    End If
    GateCanonicalPath = LCase$(normalized)
End Function

Public Sub GateAssertCanonical(Optional ByVal requireWritable As Boolean = False)
    If requireWritable And ThisWorkbook.ReadOnly Then Err.Raise vbObjectError + 2706, , "他の利用者が編集中、または読み取り専用です。正式保存はできません。"
    GateValidateDeployment
    If GateMetaGet("canonicalPath") <> GateCanonicalPath(ThisWorkbook.FullName) Or Len(GateMetaGet("canonicalPath")) = 0 Then
        Err.Raise vbObjectError + 2707, , "このブックは登録された正本の場所ではありません。共有の正本を開いてください。"
    End If
    If GateMetaGet("dataSource", "workbook") <> GateDataSource() Then Err.Raise vbObjectError + 2713, , "ブックと配布設定の読込方式が一致しません。読込方式の変更には新しい未初期化ブックを使用してください。"
    If GateMetaGet("dataType") <> GateAppConfig("appId") Or CLng(GateMetaGet("schemaVersion", "0")) <> GateConfigVersion() Then
        Err.Raise vbObjectError + 2708, , "配布設定とブックのアプリ・データ版が一致しません。"
    End If
End Sub

Public Function GateCreateRuntime(ByVal contextJson As String, ByVal childName As String) As String
    On Error GoTo Failed
    GateValidateDeployment
    Dim tempRoot As String, targetFolder As String, fileList As String
    tempRoot = Environ$("TEMP")
    If Len(tempRoot) = 0 Then Err.Raise vbObjectError + 2709, , "Windowsの一時フォルダを確認できません。"
    targetFolder = GateJoinPath(GateJoinPath(tempRoot, "ExcelGate-MVP7th"), GateNewId())
    GateEnsureFolder targetFolder
    If runtimeFolders Is Nothing Then Set runtimeFolders = New Collection
    runtimeFolders.Add targetFolder
    fileList = Replace(GateReadUtf8File(GateProjectPath("runtime-files.txt")), vbCr, "")
    Dim relative As Variant, destination As String, fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    For Each relative In Split(fileList, vbLf)
        If Len(CStr(relative)) > 0 Then
            GateRequireRelativePath CStr(relative)
            destination = GateJoinPath(targetFolder, Replace(CStr(relative), "/", Chr$(92)))
            GateEnsureFolder fso.GetParentFolderName(destination)
            GateCopyRawVerified GateProjectPath("runtime/" & CStr(relative)), destination
        End If
    Next relative
    contextJson = Replace(contextJson, ChrW(&H2028), Chr$(92) & "u2028")
    contextJson = Replace(contextJson, ChrW(&H2029), Chr$(92) & "u2029")
    GateWriteUtf8File GateJoinPath(targetFolder, "excel-gate-boot.js"), "window.__EXCEL_GATE_CONTEXT__=" & contextJson & ";"
    If GateUsesCsvFolder() Then
        GateWriteCsvSourceScript GateMetaGet("csvSourcePath"), GateJoinPath(targetFolder, "excel-gate-source.js")
    Else
        GateWriteUtf8File GateJoinPath(targetFolder, "excel-gate-source.js"), "window.__EXCEL_GATE_SOURCE__=null;"
    End If
    GateCreateRuntime = GateJoinPath(targetFolder, Replace(GateAppConfig("entry"), "/", Chr$(92)))
    Exit Function
Failed:
    Dim errorNumber As Long, errorText As String
    errorNumber = Err.Number
    errorText = Err.Description
    On Error Resume Next
    If Len(targetFolder) > 0 Then
        Set fso = CreateObject("Scripting.FileSystemObject")
        If fso.FolderExists(targetFolder) Then fso.DeleteFolder targetFolder, True
    End If
    On Error GoTo 0
    Err.Raise errorNumber, "GateCreateRuntime", errorText
End Function

Public Sub GateDiscardRuntime(ByVal htmlFile As String)
    On Error Resume Next
    If runtimeFolders Is Nothing Or Len(htmlFile) = 0 Then Exit Sub
    Dim i As Long, folder As String, fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    For i = runtimeFolders.Count To 1 Step -1
        folder = CStr(runtimeFolders(i))
        If StrComp(Left$(htmlFile, Len(folder) + 1), folder & Chr$(92), vbTextCompare) = 0 Then
            fso.DeleteFolder folder, True
            runtimeFolders.Remove i
            Exit Sub
        End If
    Next i
End Sub

Public Sub GateCleanupRuntime()
    On Error Resume Next
    If runtimeFolders Is Nothing Then Exit Sub
    Dim folder As Variant, fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    For Each folder In runtimeFolders
        fso.DeleteFolder CStr(folder), True
    Next folder
    Set runtimeFolders = Nothing
End Sub

Public Sub GateSaveWorkbook(ByVal stage As String)
    GateAssertCanonical True
    GateTestFault stage
    ThisWorkbook.Save
    If Not ThisWorkbook.Saved Then Err.Raise vbObjectError + 2710, , "ブックの保存完了を確認できません（" & stage & "）。"
End Sub

Public Sub GateTestFault(ByVal stage As String)
#If GATE_TESTING Then
    If gGateTestFailStage = stage Then
        gGateTestFailStage = ""
        Err.Raise vbObjectError + 2799, , "Injected test failure: " & stage
    End If
#End If
End Sub
