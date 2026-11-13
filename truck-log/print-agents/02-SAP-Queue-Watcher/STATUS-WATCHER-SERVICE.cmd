@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Read-only status of the TruckLogPackingSlipWatcher service. Changes nothing.
net session >nul 2>&1
if errorlevel 1 echo [NOTE] Not elevated: the check cannot read the Truck Log credential. Use "Run as administrator" for the full check.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0STATUS-WATCHER-SERVICE.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
