@echo off
setlocal
cd /d "%~dp0"
title Start Truck Log
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\tools\truck-log\compose-control.ps1" -Action start
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
