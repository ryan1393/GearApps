@echo off
setlocal
cd /d "%~dp0"
title Truck Log Development Workstation Setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\tools\truck-log\setup-truck-log.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Development setup failed.
pause
exit /b %RC%
