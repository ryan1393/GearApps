@echo off
setlocal
cd /d "%~dp0"
title Truck Log Development Start
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\tools\truck-log\start-truck-log.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Development start failed.
pause
exit /b %RC%
