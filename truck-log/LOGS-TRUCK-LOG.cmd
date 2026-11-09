@echo off
setlocal
cd /d "%~dp0"
title Truck Log Logs
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\tools\truck-log\compose-control.ps1" -Action logs
set "RC=%ERRORLEVEL%"
echo.
exit /b %RC%
