Attribute VB_Name = "GateHandoff"
Option Explicit

#If Mac Then
    ' Native compilation is checked on Mac. Operational receivers target Windows.
#ElseIf VBA7 Then
    Private Declare PtrSafe Sub GateShortSleep Lib "kernel32" Alias "Sleep" (ByVal milliseconds As Long)
#Else
    Private Declare Sub GateShortSleep Lib "kernel32" Alias "Sleep" (ByVal milliseconds As Long)
#End If

Public gGateHandoffReady As Boolean
Public gGateHandoffBusy As Boolean
Public gGateWaitLoopRunning As Boolean
Public gGateHandoffStage As String
Public gGateHandoffFinalFile As String
Public gGateHandoffProblem As String
Private receiverActive As Boolean, stopRequested As Boolean
Private workCopyRequested As Boolean
Private receiptPath As String, receiptToken As String, receiverSession As String
Private nextTick As Date, tickScheduled As Boolean, tickProcedure As String

Public Function GateExitMode() As String
    Dim value As String
    On Error GoTo MissingMode
    value = GateAppConfig("exitMode")
    On Error GoTo 0
    If value <> "manual" And value <> "onTime" And value <> "waitLoop" Then Err.Raise vbObjectError + 2922, , "終了方式の設定が不正です。"
    GateExitMode = value
    Exit Function
MissingMode:
    If Err.Number <> vbObjectError + 2211 Then
        Dim number As Long, description As String
        number = Err.Number: description = Err.Description
        Err.Raise number, "GateExitMode", description
    End If
    GateExitMode = "manual"
End Function

Public Sub GateHandoffReset()
    GateHandoffStop
    gGateHandoffReady = False
    gGateHandoffBusy = False
    gGateWaitLoopRunning = False
    gGateHandoffStage = ""
    gGateHandoffFinalFile = ""
    gGateHandoffProblem = ""
    receiptPath = "": receiptToken = "": receiverSession = ""
    workCopyRequested = False
End Sub

Public Sub GateHandoffPrepare(ByVal path As String, ByVal token As String, ByVal session As String)
    GateHandoffReset
    receiptPath = path: receiptToken = token: receiverSession = session
    GatePublishReceipt "{""state"":""waiting""}"
End Sub

Public Sub GateHandoffStart()
    If GateExitMode() = "manual" Then Exit Sub
    If Len(receiptPath) = 0 Or receiverSession <> GateMetaGet("activeSessionId") Then Err.Raise vbObjectError + 2923, , "終了の準備を開始できません。ブックから開き直してください。"
    If receiverActive Or gGateWaitLoopRunning Then Exit Sub
    stopRequested = False
    receiverActive = True
    RefreshOperationPanel
    If GateExitMode() = "onTime" Then
        GateScheduleTick
    Else
        Do
            GateRunWaitLoop
            If Not workCopyRequested Then Exit Do
            workCopyRequested = False
            ' The event handler has returned and the loop is stopped before saving.
            SaveAndContinue
            If Len(GateMetaGet("activeSessionId")) = 0 Or gGateHandoffReady Then Exit Do
            receiverActive = True
            stopRequested = False
            RefreshOperationPanel
        Loop
    End If
End Sub

Private Sub GateScheduleTick()
    If Not receiverActive Then Exit Sub
    nextTick = DateAdd("s", 1, Now)
    tickProcedure = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!GateHandoffTick"
    Application.OnTime EarliestTime:=nextTick, Procedure:=tickProcedure, Schedule:=True
    tickScheduled = True
End Sub

Public Sub GateHandoffTick()
    tickScheduled = False
    If Not receiverActive Or gGateWaitLoopRunning Or gGateHandoffBusy Then Exit Sub
    GateHandoffCheck
    If receiverActive Then
        On Error GoTo TimerFailed
        GateScheduleTick
    End If
    Exit Sub
TimerFailed:
    gGateHandoffProblem = Err.Description
    GateHandoffStop
    RefreshOperationPanel
End Sub

Private Sub GateRunWaitLoop()
    Dim oldCancelKey As Long, nextCheck As Date
    oldCancelKey = Application.EnableCancelKey
    On Error GoTo WaitFailed
    Application.EnableCancelKey = 2
    gGateWaitLoopRunning = True
    nextCheck = Now
    Do While receiverActive And Not stopRequested
        If Now >= nextCheck Then
            GateHandoffCheck
            nextCheck = DateAdd("s", 1, Now)
        End If
        If Not receiverActive Then Exit Do
        DoEvents
        #If Mac Then
            Application.Wait DateAdd("s", 1, Now)
        #Else
            GateShortSleep 20
        #End If
    Loop
WaitDone:
    gGateWaitLoopRunning = False
    Application.EnableCancelKey = oldCancelKey
    If stopRequested Then GateHandoffStop
    RefreshOperationPanel
    Exit Sub
WaitFailed:
    gGateHandoffProblem = "終了の準備が中断されました。"
    GateHandoffStop
    Resume WaitDone
End Sub

Public Sub GateHandoffCheck()
    If Not receiverActive Or gGateHandoffBusy Or gImportInProgress Then Exit Sub
    gGateHandoffBusy = True
    On Error GoTo CheckFailed
    GateAssertCanonical True
    If receiverSession <> GateMetaGet("activeSessionId") Or GateMetaGet("sessionRunId") <> gWorkbookRunId Then
        GateHandoffStop
        GoTo CheckDone
    End If
    Dim envelope As GateEnvelope, finalFile As String, stageFolder As String
    stageFolder = GateJoinPath(GateProjectPath(GATE_SESSIONS_RELATIVE), receiverSession & "-handoff")
    finalFile = GateStageCompleteHandoff(stageFolder, envelope)
    If Len(finalFile) = 0 Then GoTo CheckDone
    gGateHandoffStage = stageFolder
    gGateHandoffFinalFile = finalFile
    ' These fields describe a copied, reread and validated complete chain only.
    Dim receipt As String
    receipt = "{""state"":""ready"",""token"":" & GateJsonQuote(receiptToken) & _
        ",""databaseId"":" & GateJsonQuote(envelope.DatabaseId) & ",""sessionId"":" & GateJsonQuote(envelope.SessionId) & _
        ",""dataType"":" & GateJsonQuote(envelope.DataType) & ",""schemaVersion"":" & CStr(envelope.SchemaVersion) & _
        ",""baseRevision"":" & CStr(envelope.BaseRevision) & ",""saveDataId"":" & GateJsonQuote(envelope.SaveDataId) & _
        ",""exportSequence"":" & CStr(envelope.ExportSequence) & "}"
    GatePublishReceipt receipt
    gGateHandoffReady = True
    gGateHandoffProblem = ""
    GateHandoffStop
    RefreshOperationPanel
CheckDone:
    gGateHandoffBusy = False
    Exit Sub
CheckFailed:
    ' Retry incomplete downloads/connections. Never publish readiness on error.
    gGateHandoffProblem = Err.Description
    Resume CheckDone
End Sub

Private Sub GatePublishReceipt(ByVal json As String)
    Dim temporary As String, text As String, fso As Object
    On Error GoTo PublishFailed
    temporary = receiptPath & ".new-" & GateNewId()
    text = "window.__EXCEL_GATE_HANDOFF__=" & json & ";"
    GateWriteUtf8File temporary, text
    If GateReadUtf8File(temporary) <> text Then Err.Raise vbObjectError + 2924, , "終了の準備結果を確認できません。"
    Set fso = CreateObject("Scripting.FileSystemObject")
    If fso.FileExists(receiptPath) Then fso.DeleteFile receiptPath, True
    fso.MoveFile temporary, receiptPath
    Exit Sub
PublishFailed:
    Dim number As Long, description As String
    number = Err.Number: description = Err.Description
    On Error Resume Next
    If Not fso Is Nothing Then
        If fso.FileExists(temporary) Then fso.DeleteFile temporary, True
    End If
    On Error GoTo 0
    Err.Raise number, "GatePublishReceipt", description
End Sub

Public Sub GateHandoffStop()
    receiverActive = False
    stopRequested = True
    If tickScheduled Then
        On Error Resume Next
        Application.OnTime EarliestTime:=nextTick, Procedure:=tickProcedure, Schedule:=False
        On Error GoTo 0
    End If
    tickScheduled = False
End Sub

Public Sub GateHandoffRequestStop()
    stopRequested = True
End Sub

Public Sub GateHandoffDeferWorkCopy()
    If Not gGateWaitLoopRunning Or gGateHandoffBusy Or gImportInProgress Then Exit Sub
    workCopyRequested = True
    stopRequested = True
End Sub

Public Sub ResumeExitPreparation()
    If gImportInProgress Or gGateHandoffBusy Or gGateWaitLoopRunning Then Exit Sub
    On Error GoTo ResumeFailed
    GateHandoffStart
    RefreshOperationPanel
    Exit Sub
ResumeFailed:
    GateHandoffStop
    RefreshOperationPanel
    MsgBox "終了の準備を再開できませんでした。Edgeとブックを開いたまま、管理担当に連絡してください。" & vbCrLf & Err.Description, vbExclamation, GateDialogTitle()
End Sub

Public Function GateHandoffStopped() As Boolean
    GateHandoffStopped = GateExitMode() <> "manual" And Not receiverActive And Not gGateHandoffReady And Len(receiverSession) > 0
End Function

Public Sub GateHandoffCommitted()
    GateHandoffStop
    gGateHandoffReady = False
    ' Durable formal save has succeeded. Failed saves keep all staged files.
    If Len(gGateHandoffStage) = 0 Then Exit Sub
    On Error Resume Next
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    fso.DeleteFolder gGateHandoffStage, True
    On Error GoTo 0
End Sub
