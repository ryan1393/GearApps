@echo off
setlocal
cd /d "%~dp0"
title Truck Log Status
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\tools\truck-log\compose-control.ps1" -Action status
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
