param([string]$ExcelProgId = 'Excel.Application')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root 'workbook/MVP8th.xlsm'
$template = Join-Path $root 'workbook/MVP8th-template.xlsx'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Native workbook assembly requires Windows and Excel COM. A source template is not a completed macro workbook.'
}
if (-not (Test-Path $template -PathType Leaf)) { throw 'Build the workbook template before native assembly.' }
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$cp932 = [System.Text.Encoding]::GetEncoding(932, [System.Text.EncoderFallback]::ExceptionFallback, [System.Text.DecoderFallback]::ExceptionFallback)
$sourceFiles = @(Get-ChildItem (Join-Path $root 'vba/utf8') -Filter '*.bas' | Sort-Object Name)
$importFiles = @(Get-ChildItem (Join-Path $root 'vba') -Filter '*.bas' | Sort-Object Name)
$requiredModules = @('GateConfig.bas', 'GateDeployment.bas', 'GateJson.bas', 'GateMain.bas', 'GatePanel.bas', 'GateRecovery.bas', 'GateSources.bas', 'GateStorage.bas')
if (($sourceFiles.Name -join '|') -cne ($requiredModules -join '|')) {
    throw 'MVP8th requires all eight reviewed standard modules, including GateSources.'
}
if ($sourceFiles.Count -eq 0 -or (($sourceFiles.Name -join '|') -cne ($importFiles.Name -join '|'))) {
    throw 'UTF-8 and CP932 module sets differ. Run encode-vba.py before assembly.'
}
foreach ($file in $sourceFiles) {
    $edited = [System.IO.File]::ReadAllText($file.FullName, $utf8).Replace("`r`n", "`n")
    $imported = [System.IO.File]::ReadAllText((Join-Path $root ('vba/' + $file.Name)), $cp932).Replace("`r`n", "`n")
    if ($edited -cne $imported) { throw "Run encode-vba.py before assembly: $($file.Name)" }
}
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('ExcelGate-assembly-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
$stageBook = Join-Path $stage 'MVP8th.xlsm'
$excel = $null
$book = $null
function Source-Tokens([string]$source) {
    $source = [regex]::Replace($source, '(?m)^Attribute [^\r\n]*\r?\n?', '')
    $tokens = [regex]::Matches($source, '"(?:[^"\r\n]|"")*"|''[^\r\n]*|[A-Za-z_][A-Za-z_0-9]*|[^\s]')
    $items = foreach ($token in $tokens) {
        if ($token.Value.StartsWith("'")) { continue }
        if ($token.Value.StartsWith('"')) { $token.Value } else { $token.Value.ToLowerInvariant() }
    }
    return ($items | ConvertTo-Json -Compress)
}
try {
    # A separate developer-only Excel instance; never attaches to a user's workbook.
    $excel = New-Object -ComObject $ExcelProgId
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $book = $excel.Workbooks.Open($template)
    try { $components = $book.VBProject.VBComponents } catch {
        throw 'VBA project access is unavailable. Use an approved build environment or the VBE UI workflow in docs/maintainers/build-workbook-mac.md; this script does not change macro security settings.'
    }
    $expected = @{}
    foreach ($file in $sourceFiles) {
        $source = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
        $component = $components.Add(1)
        $component.Name = $file.BaseName
        $component.CodeModule.AddFromString([regex]::Replace($source, '(?m)^Attribute [^\r\n]*\r?\n?', ''))
        $expected[$file.BaseName] = $source
    }
    $events = [System.IO.File]::ReadAllText((Join-Path $root 'vba/ThisWorkbook.txt'), [System.Text.Encoding]::UTF8)
    $module = $components.Item($book.CodeName).CodeModule
    if ($module.CountOfLines -gt 0) { $module.DeleteLines(1, $module.CountOfLines) }
    $module.AddFromString($events)
    $expected[$book.CodeName] = $events
    $book.SaveAs($stageBook, 52)
    # Run the setup UI without registering a deployment path. Full VBE project compilation is a separate maintainer check.
    $excel.Run("'MVP8th.xlsm'!GateShowSetupPanel") | Out-Null
    $book.Save()
    $book.Close($false)
    $book = $excel.Workbooks.Open($stageBook)
    foreach ($name in $expected.Keys) {
        $module = $book.VBProject.VBComponents.Item($name).CodeModule
        $actual = if ($module.CountOfLines -gt 0) { $module.Lines(1, $module.CountOfLines) } else { '' }
        if ((Source-Tokens $actual) -cne (Source-Tokens $expected[$name])) { throw "Embedded source mismatch: $name" }
    }
    if ($book.Worksheets.Count -ne 1 -or $book.Worksheets.Item(1).Name -cne '操作パネル') {
        throw 'Only the uninitialized single-panel master can be distributed'
    }
    $sheetCodeName = $book.Worksheets.Item(1).CodeName
    foreach ($component in $book.VBProject.VBComponents) {
        if ($expected.ContainsKey($component.Name)) { continue }
        if ($component.Name -cne $sheetCodeName -or $component.Type -ne 100) {
            throw "Unexpected embedded VBA module: $($component.Name)"
        }
        $module = $component.CodeModule
        $actual = if ($module.CountOfLines -gt 0) { $module.Lines(1, $module.CountOfLines) } else { '' }
        if ((Source-Tokens $actual) -cne (Source-Tokens '')) { throw 'Unexpected worksheet code' }
    }
    $button = $book.Worksheets.Item(1).Shapes.Item('gate_InitializeGate')
    if ($button.OnAction -notmatch 'InitializeGate$') { throw 'Setup button is not bound to InitializeGate' }
    if ($book.Worksheets.Item(1).Range('B2').Value2 -cne 'Excelゲート' -or $book.Worksheets.Item(1).Range('B4').Value2 -cne 'DX推進委員会 Excelゲート') { throw 'MVP8th master presentation mismatch' }
    $book.Close($false)
    $book = $null
    $sourceHashes = @{}
    foreach ($folder in @('vba/utf8', 'vba')) {
        foreach ($file in Get-ChildItem (Join-Path $root $folder) -Filter '*.bas') {
            $sourceHashes[$folder + '/' + $file.Name] = (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $sourceHashes['vba/ThisWorkbook.txt'] = (Get-FileHash (Join-Path $root 'vba/ThisWorkbook.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
    if (Test-Path $target) { Copy-Item $target ($target + '.previous-' + (Get-Date -Format 'yyyyMMddHHmmss')) }
    Copy-Item $stageBook $target -Force
    $receipt = @{
        workbook = 'MVP8th.xlsm'
        sha256 = (Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant()
        validation = @{ embeddedSourceMatches = $true; uninitialized = $true; setupButton = $true; presentationTemplate = $true; windowsJustCalcExecution = $false }
        sourceHashes = $sourceHashes
    }
    [System.IO.File]::WriteAllText((Join-Path $root 'workbook/MVP8th.build.json'), ($receipt | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
    Write-Output 'Assembled and source-verified MVP8th.xlsm. JUST Calc / Edge two-PC acceptance is still required.'
} finally {
    if ($null -ne $book) { $book.Close($false) }
    if ($null -ne $excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
    Remove-Item $stage -Recurse -Force
}
