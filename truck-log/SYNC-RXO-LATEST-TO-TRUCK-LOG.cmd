@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\rxo-integration\sync-latest-to-truck-log.ps1"
if errorlevel 1 (
  echo.
  echo RXO TO TRUCK LOG SYNC FAILED.
  pause
  exit /b 1
)
pause
