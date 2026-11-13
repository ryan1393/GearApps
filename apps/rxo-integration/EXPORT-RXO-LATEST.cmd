@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0export-latest.ps1"
if errorlevel 1 (
  echo.
  echo COPY FAILED.
  pause
  exit /b 1
)
pause
