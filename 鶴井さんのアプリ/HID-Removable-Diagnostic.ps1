#requires -version 5.1
<#
.SYNOPSIS
  WindowsのHID・USBキーボード・リムーバブルディスク制限を診断します。

.DESCRIPTION
  通常診断は読み取り専用です。任意テストを選択した場合のみ、
  指定したリムーバブルドライブに一時ファイルを作成し、読取後に削除します。
  外部ネットワーク通信、ポリシー変更、デバイス設定変更は行いません。
#>

[CmdletBinding()]
param(
    [switch]$NoPrompt,
    [switch]$SkipGpResult,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
}

function Convert-ToSafeString {
    param($Value)
    if ($null -eq $Value) { return '' }
    if ($Value -is [Array]) { return ($Value -join '; ') }
    return [string]$Value
}

function Get-ExceptionText {
    param([System.Management.Automation.ErrorRecord]$Record)
    if ($null -eq $Record) { return '不明なエラー' }
    return ('{0}: {1}' -f $Record.Exception.GetType().Name, $Record.Exception.Message)
}

function Get-IsAdministrator {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Get-RegistryTree {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $items = New-Object System.Collections.Generic.List[object]
    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{
            Label = $Label
            Path = $Path
            Exists = $false
            Values = @()
            Error = ''
        }
    }

    try {
        $keys = @((Get-Item -LiteralPath $Path)) +
            @(Get-ChildItem -LiteralPath $Path -Recurse -ErrorAction Stop)

        foreach ($key in $keys) {
            $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
            foreach ($property in $properties.PSObject.Properties) {
                if ($property.Name -like 'PS*') { continue }
                $items.Add([pscustomobject]@{
                    Key = $key.Name
                    Name = $property.Name
                    Value = Convert-ToSafeString $property.Value
                    NumericValue = if ($property.Value -is [int] -or $property.Value -is [long]) {
                        [long]$property.Value
                    } else {
                        $null
                    }
                })
            }
        }

        return [pscustomobject]@{
            Label = $Label
            Path = $Path
            Exists = $true
            Values = @($items)
            Error = ''
        }
    } catch {
        return [pscustomobject]@{
            Label = $Label
            Path = $Path
            Exists = $true
            Values = @($items)
            Error = Get-ExceptionText $_
        }
    }
}

function Get-PnpPropertyValue {
    param(
        [string]$InstanceId,
        [string]$KeyName
    )

    if (-not (Get-Command Get-PnpDeviceProperty -ErrorAction SilentlyContinue)) {
        return $null
    }

    try {
        return (Get-PnpDeviceProperty -InstanceId $InstanceId -KeyName $KeyName `
            -ErrorAction Stop).Data
    } catch {
        return $null
    }
}

function Get-PnpInventory {
    $inventory = New-Object System.Collections.Generic.List[object]
    $getPnp = Get-Command Get-PnpDevice -ErrorAction SilentlyContinue

    if (-not $getPnp) {
        return [pscustomobject]@{
            Available = $false
            Devices = @()
            Error = 'Get-PnpDeviceコマンドレットを利用できません。'
        }
    }

    try {
        $devices = Get-PnpDevice -PresentOnly -ErrorAction Stop |
            Where-Object {
                $_.Class -in @('Keyboard', 'Mouse', 'HIDClass', 'DiskDrive', 'USB') -or
                $_.InstanceId -like 'USB*' -or
                $_.InstanceId -like 'HID*' -or
                $_.InstanceId -like 'USBSTOR*'
            }

        foreach ($device in $devices) {
            $classGuid = Get-PnpPropertyValue $device.InstanceId 'DEVPKEY_Device_ClassGuid'
            $bus = Get-PnpPropertyValue $device.InstanceId 'DEVPKEY_Device_BusReportedDeviceDesc'
            $hardwareIds = Get-PnpPropertyValue $device.InstanceId 'DEVPKEY_Device_HardwareIds'
            $problemCode = Get-PnpPropertyValue $device.InstanceId 'DEVPKEY_Device_ProblemCode'
            $service = Get-PnpPropertyValue $device.InstanceId 'DEVPKEY_Device_Service'
            $parent = Get-PnpPropertyValue $device.InstanceId 'DEVPKEY_Device_Parent'

            $category = if ($device.Class -eq 'Keyboard') {
                'Keyboard'
            } elseif ($device.Class -eq 'Mouse') {
                'Mouse'
            } elseif ($device.InstanceId -like 'USBSTOR*' -or $device.Class -eq 'DiskDrive') {
                'Storage'
            } elseif ($device.Class -eq 'HIDClass' -or $device.InstanceId -like 'HID*') {
                'HID'
            } else {
                'USB'
            }

            $inventory.Add([pscustomobject]@{
                Category = $category
                Status = Convert-ToSafeString $device.Status
                Class = Convert-ToSafeString $device.Class
                FriendlyName = Convert-ToSafeString $device.FriendlyName
                InstanceId = Convert-ToSafeString $device.InstanceId
                HardwareIds = Convert-ToSafeString $hardwareIds
                ClassGuid = Convert-ToSafeString $classGuid
                BusDescription = Convert-ToSafeString $bus
                Service = Convert-ToSafeString $service
                ProblemCode = Convert-ToSafeString $problemCode
                Parent = Convert-ToSafeString $parent
            })
        }

        return [pscustomobject]@{
            Available = $true
            Devices = @($inventory)
            Error = ''
        }
    } catch {
        return [pscustomobject]@{
            Available = $true
            Devices = @($inventory)
            Error = Get-ExceptionText $_
        }
    }
}

function Get-RemovableDriveInventory {
    $items = New-Object System.Collections.Generic.List[object]
    try {
        $logicalDisks = Get-CimInstance Win32_LogicalDisk -ErrorAction Stop |
            Where-Object { $_.DriveType -eq 2 }

        foreach ($disk in $logicalDisks) {
            $readable = $false
            $readError = ''
            try {
                Get-ChildItem -LiteralPath ($disk.DeviceID + '\') -Force -ErrorAction Stop |
                    Select-Object -First 1 | Out-Null
                $readable = $true
            } catch {
                $readError = Get-ExceptionText $_
            }

            $items.Add([pscustomobject]@{
                Drive = $disk.DeviceID
                VolumeName = Convert-ToSafeString $disk.VolumeName
                FileSystem = Convert-ToSafeString $disk.FileSystem
                SizeGB = if ($disk.Size) { [math]::Round($disk.Size / 1GB, 2) } else { $null }
                FreeGB = if ($disk.FreeSpace) { [math]::Round($disk.FreeSpace / 1GB, 2) } else { $null }
                Readable = $readable
                ReadError = $readError
            })
        }
    } catch {
        return [pscustomobject]@{
            Drives = @()
            Error = Get-ExceptionText $_
        }
    }

    return [pscustomobject]@{
        Drives = @($items)
        Error = ''
    }
}

function Get-UsbDiskInventory {
    $items = New-Object System.Collections.Generic.List[object]
    if (-not (Get-Command Get-Disk -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{
            Disks = @()
            Error = 'Get-Diskコマンドレットを利用できません。'
        }
    }

    try {
        foreach ($disk in (Get-Disk -ErrorAction Stop | Where-Object { $_.BusType -eq 'USB' })) {
            $items.Add([pscustomobject]@{
                Number = $disk.Number
                FriendlyName = Convert-ToSafeString $disk.FriendlyName
                SerialNumber = Convert-ToSafeString $disk.SerialNumber
                BusType = Convert-ToSafeString $disk.BusType
                OperationalStatus = Convert-ToSafeString $disk.OperationalStatus
                HealthStatus = Convert-ToSafeString $disk.HealthStatus
                IsReadOnly = $disk.IsReadOnly
                IsOffline = $disk.IsOffline
                PartitionStyle = Convert-ToSafeString $disk.PartitionStyle
                SizeGB = [math]::Round($disk.Size / 1GB, 2)
            })
        }
        return [pscustomobject]@{ Disks = @($items); Error = '' }
    } catch {
        return [pscustomobject]@{ Disks = @($items); Error = Get-ExceptionText $_ }
    }
}

function Invoke-KeyboardInputTest {
    $characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
    $random = New-Object System.Random
    $challenge = -join (1..8 | ForEach-Object {
        $characters[$random.Next(0, $characters.Length)]
    })

    Write-Host ""
    Write-Host "外付けUSBキーボードだけを使って次の文字を入力してください。" -ForegroundColor Yellow
    Write-Host "（HTML/PowerShellから、どの物理キーボードが入力したかは識別できません）"
    Write-Host ""
    Write-Host "  $challenge" -ForegroundColor Green
    Write-Host ""
    $typed = Read-Host '入力'

    return [pscustomobject]@{
        Executed = $true
        Challenge = $challenge
        Match = ($typed -ceq $challenge)
        EnteredLength = $typed.Length
        Note = if ($typed -ceq $challenge) {
            '入力文字列が一致しました。外付けキーボードのみを操作したなら実用上入力可能です。'
        } else {
            '入力文字列が一致しません。配列、修飾キー、入力元を確認してください。'
        }
    }
}

function Invoke-DriveWriteTest {
    param([array]$Drives)

    if (-not $Drives -or $Drives.Count -eq 0) {
        return [pscustomobject]@{
            Executed = $false
            Drive = ''
            WriteSucceeded = $false
            ReadBackSucceeded = $false
            DeleteSucceeded = $false
            Error = 'リムーバブルドライブを検出できませんでした。'
        }
    }

    Write-Host ""
    Write-Host "検出したリムーバブルドライブ：" -ForegroundColor Yellow
    foreach ($drive in $Drives) {
        Write-Host ("  {0}  {1}  {2}  空き {3} GB" -f
            $drive.Drive, $drive.VolumeName, $drive.FileSystem, $drive.FreeGB)
    }

    $selected = (Read-Host '書込テストするドライブ文字を入力してください（例 E:、中止は空欄）').Trim()
    if ([string]::IsNullOrWhiteSpace($selected)) {
        return [pscustomobject]@{
            Executed = $false
            Drive = ''
            WriteSucceeded = $false
            ReadBackSucceeded = $false
            DeleteSucceeded = $false
            Error = 'ユーザーが中止しました。'
        }
    }

    if ($selected -notmatch '^[A-Za-z]:$') {
        return [pscustomobject]@{
            Executed = $false
            Drive = $selected
            WriteSucceeded = $false
            ReadBackSucceeded = $false
            DeleteSucceeded = $false
            Error = 'ドライブ文字の形式が正しくありません。'
        }
    }

    $selected = $selected.ToUpperInvariant()
    if (-not ($Drives.Drive -contains $selected)) {
        return [pscustomobject]@{
            Executed = $false
            Drive = $selected
            WriteSucceeded = $false
            ReadBackSucceeded = $false
            DeleteSucceeded = $false
            Error = '検出済みリムーバブルドライブではありません。'
        }
    }

    $filename = '.hid-removable-diagnostic-{0}.tmp' -f ([guid]::NewGuid().ToString('N'))
    $path = Join-Path ($selected + '\') $filename
    $content = 'HID-REMOVABLE-DIAGNOSTIC-{0}' -f ([guid]::NewGuid().ToString('N'))
    $writeSucceeded = $false
    $readSucceeded = $false
    $deleteSucceeded = $false
    $testError = ''

    try {
        [IO.File]::WriteAllText($path, $content, [Text.Encoding]::UTF8)
        $writeSucceeded = $true
        $actual = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
        $readSucceeded = ($actual -eq $content)
    } catch {
        $testError = Get-ExceptionText $_
    } finally {
        if (Test-Path -LiteralPath $path) {
            try {
                Remove-Item -LiteralPath $path -Force -ErrorAction Stop
                $deleteSucceeded = $true
            } catch {
                if ($testError) {
                    $testError += ' / 削除: ' + (Get-ExceptionText $_)
                } else {
                    $testError = '削除: ' + (Get-ExceptionText $_)
                }
            }
        } elseif ($writeSucceeded) {
            $deleteSucceeded = $true
        }
    }

    return [pscustomobject]@{
        Executed = $true
        Drive = $selected
        WriteSucceeded = $writeSucceeded
        ReadBackSucceeded = $readSucceeded
        DeleteSucceeded = $deleteSucceeded
        Error = $testError
    }
}

function Get-GpResultText {
    if ($SkipGpResult) {
        return [pscustomobject]@{
            Executed = $false
            Text = ''
            Error = 'SkipGpResultが指定されました。'
        }
    }

    try {
        $output = & "$env:SystemRoot\System32\gpresult.exe" /z 2>&1 | Out-String
        return [pscustomobject]@{
            Executed = $true
            Text = $output
            Error = if ($LASTEXITCODE -eq 0) { '' } else { "gpresult終了コード: $LASTEXITCODE" }
        }
    } catch {
        return [pscustomobject]@{
            Executed = $true
            Text = ''
            Error = Get-ExceptionText $_
        }
    }
}

function Get-Findings {
    param($Report)

    $findings = New-Object System.Collections.Generic.List[object]

    $problemDevices = @($Report.PnpInventory.Devices | Where-Object {
        $_.ProblemCode -and $_.ProblemCode -notin @('0', 'CM_PROB_NONE')
    })
    if ($problemDevices.Count -gt 0) {
        $findings.Add([pscustomobject]@{
            Level = 'NG'
            Area = 'PnP'
            Message = "問題コードのあるHID/USB機器を$($problemDevices.Count)件検出しました。"
        })
    } else {
        $findings.Add([pscustomobject]@{
            Level = 'OK'
            Area = 'PnP'
            Message = '取得できた範囲では、問題コードのあるHID/USB機器はありません。'
        })
    }

    $keyboardDevices = @($Report.PnpInventory.Devices | Where-Object { $_.Category -eq 'Keyboard' })
    if ($keyboardDevices.Count -gt 0) {
        $findings.Add([pscustomobject]@{
            Level = 'OK'
            Area = 'Keyboard'
            Message = "接続中のKeyboardクラスを$($keyboardDevices.Count)件検出しました。"
        })
    } else {
        $findings.Add([pscustomobject]@{
            Level = 'WARN'
            Area = 'Keyboard'
            Message = 'Keyboardクラスを検出できませんでした。権限不足またはPnP制限も確認してください。'
        })
    }

    foreach ($policy in $Report.RegistryPolicies) {
        foreach ($value in $policy.Values) {
            if ($value.NumericValue -eq 1 -and
                $value.Name -match 'Deny|Disable|Removable|WriteProtect') {
                $findings.Add([pscustomobject]@{
                    Level = 'WARN'
                    Area = $policy.Label
                    Message = "有効値を検出: $($value.Name)=$($value.Value) [$($value.Key)]"
                })
            }
        }
    }

    foreach ($drive in $Report.RemovableDrives.Drives) {
        if (-not $drive.Readable) {
            $findings.Add([pscustomobject]@{
                Level = 'NG'
                Area = 'Removable Storage'
                Message = "$($drive.Drive) を列挙できません: $($drive.ReadError)"
            })
        } else {
            $findings.Add([pscustomobject]@{
                Level = 'OK'
                Area = 'Removable Storage'
                Message = "$($drive.Drive) のディレクトリ読取に成功しました。"
            })
        }
    }

    if ($Report.DriveWriteTest.Executed) {
        $level = if ($Report.DriveWriteTest.WriteSucceeded -and
            $Report.DriveWriteTest.ReadBackSucceeded -and
            $Report.DriveWriteTest.DeleteSucceeded) { 'OK' } else { 'NG' }
        $findings.Add([pscustomobject]@{
            Level = $level
            Area = 'Removable Write Test'
            Message = "Drive=$($Report.DriveWriteTest.Drive) / Write=$($Report.DriveWriteTest.WriteSucceeded) / ReadBack=$($Report.DriveWriteTest.ReadBackSucceeded) / Delete=$($Report.DriveWriteTest.DeleteSucceeded) / $($Report.DriveWriteTest.Error)"
        })
    }

    if ($Report.KeyboardInputTest.Executed) {
        $keyboardLevel = if ($Report.KeyboardInputTest.Match) { 'OK' } else { 'NG' }
        $findings.Add([pscustomobject]@{
            Level = $keyboardLevel
            Area = 'Keyboard Input'
            Message = $Report.KeyboardInputTest.Note
        })
    }

    if (-not $Report.IsAdministrator) {
        $findings.Add([pscustomobject]@{
            Level = 'INFO'
            Area = '権限'
            Message = '非管理者で実行されました。一部のコンピューターポリシーやデバイス情報が取得できない場合があります。'
        })
    }

    return @($findings)
}

function Convert-ObjectsToHtmlTable {
    param(
        [array]$Objects,
        [string[]]$Properties
    )

    if (-not $Objects -or $Objects.Count -eq 0) {
        return '<p class="empty">対象なし、または取得できませんでした。</p>'
    }

    $rows = foreach ($object in $Objects) {
        $cells = foreach ($property in $Properties) {
            $value = Convert-ToSafeString $object.$property
            '<td>{0}</td>' -f [Net.WebUtility]::HtmlEncode($value)
        }
        '<tr>{0}</tr>' -f ($cells -join '')
    }

    $headers = $Properties | ForEach-Object {
        '<th>{0}</th>' -f [Net.WebUtility]::HtmlEncode($_)
    }
    return '<div class="table-wrap"><table><thead><tr>{0}</tr></thead><tbody>{1}</tbody></table></div>' -f
        ($headers -join ''), ($rows -join '')
}

function Export-DiagnosticHtml {
    param(
        $Report,
        [string]$Path
    )

    $findingsHtml = Convert-ObjectsToHtmlTable $Report.Findings @('Level', 'Area', 'Message')
    $pnpHtml = Convert-ObjectsToHtmlTable $Report.PnpInventory.Devices @(
        'Category', 'Status', 'Class', 'FriendlyName', 'ProblemCode',
        'InstanceId', 'HardwareIds', 'Service'
    )
    $removableHtml = Convert-ObjectsToHtmlTable $Report.RemovableDrives.Drives @(
        'Drive', 'VolumeName', 'FileSystem', 'SizeGB', 'FreeGB', 'Readable', 'ReadError'
    )
    $usbDisksHtml = Convert-ObjectsToHtmlTable $Report.UsbDisks.Disks @(
        'Number', 'FriendlyName', 'BusType', 'OperationalStatus', 'HealthStatus',
        'IsReadOnly', 'IsOffline', 'PartitionStyle', 'SizeGB'
    )

    $policyRows = New-Object System.Collections.Generic.List[object]
    foreach ($policy in $Report.RegistryPolicies) {
        if (-not $policy.Exists) {
            $policyRows.Add([pscustomobject]@{
                Policy = $policy.Label
                Key = $policy.Path
                Name = '(キーなし)'
                Value = ''
            })
            continue
        }
        foreach ($value in $policy.Values) {
            $policyRows.Add([pscustomobject]@{
                Policy = $policy.Label
                Key = $value.Key
                Name = $value.Name
                Value = $value.Value
            })
        }
    }
    $policyHtml = Convert-ObjectsToHtmlTable @($policyRows) @('Policy', 'Key', 'Name', 'Value')

    $gpText = if ($Report.GpResult.Text) {
        [Net.WebUtility]::HtmlEncode($Report.GpResult.Text)
    } else {
        [Net.WebUtility]::HtmlEncode($Report.GpResult.Error)
    }

    $html = @"
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HID・リムーバブル診断レポート</title>
<style>
body{font-family:Segoe UI,Yu Gothic,sans-serif;margin:0;background:#f3f6fa;color:#172033}
header{padding:28px;background:#153d72;color:white}main{max-width:1180px;margin:auto;padding:22px}
h1{margin:0 0 8px}h2{margin-top:28px;border-bottom:2px solid #2b68b8;padding-bottom:7px}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.meta div{background:white;border:1px solid #dbe2ec;border-radius:8px;padding:10px}
.table-wrap{overflow:auto;border:1px solid #dbe2ec;border-radius:9px;background:white}
table{border-collapse:collapse;width:100%;min-width:700px}th,td{border-bottom:1px solid #e2e7ef;padding:8px;text-align:left;font-size:12px;vertical-align:top}
th{background:#edf3fa}.empty{padding:12px;background:white;border:1px solid #dbe2ec;border-radius:8px}
pre{max-height:520px;overflow:auto;background:#111827;color:#dce8f8;padding:14px;border-radius:9px;white-space:pre-wrap}
.note{background:#fff5d9;border:1px solid #efd38b;padding:12px;border-radius:8px}
@media(max-width:700px){.meta{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>HID・リムーバブル診断レポート</h1><div>$([Net.WebUtility]::HtmlEncode($Report.GeneratedAt))</div></header>
<main>
<p class="note">このレポートはローカル診断結果です。デバイスID、コンピューター名、ユーザー情報を含むため、共有範囲に注意してください。</p>
<div class="meta">
<div><strong>PC</strong><br>$([Net.WebUtility]::HtmlEncode($Report.ComputerName))</div>
<div><strong>User</strong><br>$([Net.WebUtility]::HtmlEncode($Report.UserName))</div>
<div><strong>管理者実行</strong><br>$($Report.IsAdministrator)</div>
<div><strong>Windows</strong><br>$([Net.WebUtility]::HtmlEncode($Report.Windows.Caption))</div>
<div><strong>Version</strong><br>$([Net.WebUtility]::HtmlEncode($Report.Windows.Version))</div>
<div><strong>Domain</strong><br>$([Net.WebUtility]::HtmlEncode($Report.Domain))</div>
</div>
<h2>総合所見</h2>$findingsHtml
<h2>HID・USB PnPデバイス</h2>$pnpHtml
<h2>リムーバブルドライブ</h2>$removableHtml
<h2>USB物理ディスク</h2>$usbDisksHtml
<h2>関連レジストリポリシー</h2>$policyHtml
<h2>任意テスト</h2>
<pre>$([Net.WebUtility]::HtmlEncode(($Report.KeyboardInputTest | ConvertTo-Json -Depth 5)))
$([Net.WebUtility]::HtmlEncode(($Report.DriveWriteTest | ConvertTo-Json -Depth 5)))</pre>
<h2>gpresult /z</h2><pre>$gpText</pre>
</main>
</body>
</html>
"@

    [IO.File]::WriteAllText($Path, $html, (New-Object Text.UTF8Encoding($false)))
}

try {
    Write-Section 'HID・リムーバブル制限診断'
    Write-Host '外部通信・ポリシー変更・デバイス設定変更は行いません。'
    Write-Host '通常診断を開始します...' -ForegroundColor Green

    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        $OutputDirectory = [Environment]::GetFolderPath('Desktop')
        if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
            $OutputDirectory = $PSScriptRoot
        }
    }
    if (-not (Test-Path -LiteralPath $OutputDirectory)) {
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    }

    $windows = Get-CimInstance Win32_OperatingSystem
    $computerSystem = Get-CimInstance Win32_ComputerSystem

    Write-Host '[1/6] PnPデバイスを確認中...'
    $pnpInventory = Get-PnpInventory

    Write-Host '[2/6] リムーバブルドライブを確認中...'
    $removableDrives = Get-RemovableDriveInventory
    $usbDisks = Get-UsbDiskInventory

    Write-Host '[3/6] ポリシーレジストリを確認中...'
    $registryPolicies = @(
        Get-RegistryTree 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeviceInstall\Restrictions' 'デバイスインストール制限（PC）'
        Get-RegistryTree 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices' 'リムーバブル記憶域（PC）'
        Get-RegistryTree 'HKCU:\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices' 'リムーバブル記憶域（User）'
        Get-RegistryTree 'HKLM:\SYSTEM\CurrentControlSet\Control\StorageDevicePolicies' 'ストレージ書込保護'
        Get-RegistryTree 'HKLM:\SOFTWARE\Policies\Microsoft\FVE' 'BitLockerポリシー'
        Get-RegistryTree 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Device Control' 'Defender Device Control'
        Get-RegistryTree 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\RemovableStorageDevices' 'Defender Removable Storage'
    )

    Write-Host '[4/6] 適用グループポリシーを確認中...'
    $gpResult = Get-GpResultText

    $keyboardInputTest = [pscustomobject]@{
        Executed = $false
        Challenge = ''
        Match = $false
        EnteredLength = 0
        Note = '未実行'
    }
    $driveWriteTest = [pscustomobject]@{
        Executed = $false
        Drive = ''
        WriteSucceeded = $false
        ReadBackSucceeded = $false
        DeleteSucceeded = $false
        Error = '未実行'
    }

    if (-not $NoPrompt) {
        Write-Section '任意テスト'
        $keyboardAnswer = Read-Host '外付けUSBキーボード入力テストを行いますか？ (y/N)'
        if ($keyboardAnswer -match '^[Yy]$') {
            $keyboardInputTest = Invoke-KeyboardInputTest
        }

        $writeAnswer = Read-Host 'リムーバブルドライブ書込テストを行いますか？ 一時ファイルを作成・削除します (y/N)'
        if ($writeAnswer -match '^[Yy]$') {
            $driveWriteTest = Invoke-DriveWriteTest $removableDrives.Drives
        }
    }

    Write-Host '[5/6] 所見を生成中...'
    $report = [pscustomobject]@{
        ReportName = 'HID・リムーバブル制限診断'
        GeneratedAt = (Get-Date).ToString('o')
        ComputerName = $env:COMPUTERNAME
        UserName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        Domain = Convert-ToSafeString $computerSystem.Domain
        IsAdministrator = Get-IsAdministrator
        PowerShellVersion = $PSVersionTable.PSVersion.ToString()
        Windows = [pscustomobject]@{
            Caption = Convert-ToSafeString $windows.Caption
            Version = Convert-ToSafeString $windows.Version
            BuildNumber = Convert-ToSafeString $windows.BuildNumber
            OSArchitecture = Convert-ToSafeString $windows.OSArchitecture
        }
        PnpInventory = $pnpInventory
        RemovableDrives = $removableDrives
        UsbDisks = $usbDisks
        RegistryPolicies = $registryPolicies
        GpResult = $gpResult
        KeyboardInputTest = $keyboardInputTest
        DriveWriteTest = $driveWriteTest
        Findings = @()
    }
    $report.Findings = Get-Findings $report

    Write-Host '[6/6] レポートを保存中...'
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $baseName = "HID-Removable-Diagnostic_$stamp"
    $jsonPath = Join-Path $OutputDirectory ($baseName + '.json')
    $htmlPath = Join-Path $OutputDirectory ($baseName + '.html')
    $textPath = Join-Path $OutputDirectory ($baseName + '.txt')

    $json = $report | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($jsonPath, $json, (New-Object Text.UTF8Encoding($false)))
    Export-DiagnosticHtml $report $htmlPath

    $text = @(
        'HID・リムーバブル制限診断'
        "GeneratedAt: $($report.GeneratedAt)"
        "Computer: $($report.ComputerName)"
        "User: $($report.UserName)"
        "Administrator: $($report.IsAdministrator)"
        ''
        '--- Findings ---'
        ($report.Findings | Format-Table -AutoSize | Out-String -Width 240)
        '--- PnP Devices ---'
        ($report.PnpInventory.Devices | Format-Table -AutoSize | Out-String -Width 300)
        '--- Removable Drives ---'
        ($report.RemovableDrives.Drives | Format-Table -AutoSize | Out-String -Width 240)
        '--- USB Disks ---'
        ($report.UsbDisks.Disks | Format-Table -AutoSize | Out-String -Width 240)
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText($textPath, $text, (New-Object Text.UTF8Encoding($false)))

    Write-Section '診断完了'
    foreach ($finding in $report.Findings) {
        $color = switch ($finding.Level) {
            'OK' { 'Green' }
            'NG' { 'Red' }
            'WARN' { 'Yellow' }
            default { 'Gray' }
        }
        Write-Host ("[{0}] {1}: {2}" -f $finding.Level, $finding.Area, $finding.Message) -ForegroundColor $color
    }
    Write-Host ""
    Write-Host "HTML: $htmlPath" -ForegroundColor Green
    Write-Host "JSON: $jsonPath"
    Write-Host "TEXT: $textPath"
    Write-Host ""
    Write-Host 'HTMLレポートにはPC名、ユーザー名、デバイスIDが含まれます。共有範囲に注意してください。' -ForegroundColor Yellow

    if (-not $NoPrompt) {
        $openAnswer = Read-Host 'HTMLレポートを開きますか？ (Y/n)'
        if ($openAnswer -notmatch '^[Nn]$') {
            Start-Process $htmlPath
        }
    }
} catch {
    Write-Host ""
    Write-Host ("診断に失敗しました: {0}" -f (Get-ExceptionText $_)) -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed
    exit 1
}
