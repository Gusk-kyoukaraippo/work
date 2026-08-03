@echo off
setlocal
title HID and Removable Storage Diagnostic

echo Starting HID and removable storage diagnostics.
echo This tool does not change policies or use the network.
echo.

powershell.exe -NoLogo -NoProfile -File "%~dp0HID-Removable-Diagnostic.ps1"
set "DIAG_EXIT=%ERRORLEVEL%"

echo.
if not "%DIAG_EXIT%"=="0" (
  echo The diagnostic tool could not complete.
  echo Exit code: %DIAG_EXIT%
  echo If PowerShell scripts are restricted, contact your system administrator.
)
pause
exit /b %DIAG_EXIT%
