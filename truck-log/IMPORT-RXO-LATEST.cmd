@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\truck-log\rxo\import-latest.ps1"
if errorlevel 1 (
  echo.
  echo RXO POSTGRES IMPORT FAILED.
  pause
  exit /b 1
)
pause
