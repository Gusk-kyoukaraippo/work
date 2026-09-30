param([string]$ExcelProgId = 'Excel.Application')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root 'workbook/MVP5th.xlsm'
$template = Join-Path $root 'workbook/MVP5th-template.xlsx'
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('ExcelGate-assembly-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
$stageBook = Join-Path $stage 'MVP5th.xlsm'
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
        throw 'VBA project access is unavailable. Ask the build-PC administrator to authorize assembly; this script does not change macro security settings.'
    }
    $expected = @{}
    foreach ($file in Get-ChildItem (Join-Path $root 'vba/utf8') -Filter '*.bas' | Sort-Object Name) {
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
    # This compiles/runs the setup UI without registering any deployment path.
    $excel.Run("'MVP5th.xlsm'!GateShowSetupPanel") | Out-Null
    $book.Save()
    $book.Close($false)
    $book = $excel.Workbooks.Open($stageBook)
    foreach ($name in $expected.Keys) {
        $module = $book.VBProject.VBComponents.Item($name).CodeModule
        $actual = if ($module.CountOfLines -gt 0) { $module.Lines(1, $module.CountOfLines) } else { '' }
        if ((Source-Tokens $actual) -cne (Source-Tokens $expected[$name])) { throw "Embedded source mismatch: $name" }
    }
    if ($book.Worksheets.Count -ne 1) { throw 'Only the uninitialized single-sheet master can be distributed' }
    $button = $book.Worksheets.Item(1).Shapes.Item('gate_InitializeGate')
    if ($button.OnAction -notmatch 'InitializeGate$') { throw 'Setup button is not bound to InitializeGate' }
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
        workbook = 'MVP5th.xlsm'
        sha256 = (Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant()
        validation = @{ embeddedSourceMatches = $true; uninitialized = $true; setupButton = $true; windowsJustCalcExecution = $false }
        sourceHashes = $sourceHashes
    }
    [System.IO.File]::WriteAllText((Join-Path $root 'workbook/MVP5th.build.json'), ($receipt | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
    Write-Output 'Assembled and source-verified MVP5th.xlsm. JUST Calc / Edge two-PC acceptance is still required.'
} finally {
    if ($null -ne $book) { $book.Close($false) }
    if ($null -ne $excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
    Remove-Item $stage -Recurse -Force
}
