@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\configure-label-printer.ps1"
if errorlevel 1 (
  echo.
  echo LABEL PRINTER CONFIGURATION FAILED.
  pause
  exit /b 1
)
echo.
pause

