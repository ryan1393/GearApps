@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\rxo-integration\verify-latest-exports.ps1"
if errorlevel 1 (
  echo.
  echo RXO LATEST VERIFICATION FAILED.
  pause
  exit /b 1
)
pause
