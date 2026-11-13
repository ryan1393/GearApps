@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\rxo-integration\test-production-export.ps1"
if errorlevel 1 (
  echo.
  echo RXO INTEGRATION PRODUCTION TEST FAILED.
  pause
  exit /b 1
)
pause
