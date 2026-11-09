@echo off
setlocal
cd /d "%~dp0"
title Truck Log Setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\tools\truck-log\setup-docker.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo Setup completed successfully.) else (echo Setup failed with exit code %RC%.)
echo.
pause
exit /b %RC%
