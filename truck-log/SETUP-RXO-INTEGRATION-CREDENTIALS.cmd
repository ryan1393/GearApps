@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\rxo-integration\setup-rxo-credentials.ps1"
if errorlevel 1 (
  echo.
  echo RXO CREDENTIAL SETUP FAILED.
  pause
  exit /b 1
)
pause
