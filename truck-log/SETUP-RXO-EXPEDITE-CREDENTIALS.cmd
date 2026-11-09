@echo off
setlocal
cd /d "%~dp0"
title Truck Log - RXO Expedite Credentials
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\truck-log\setup-rxo-expedite-credentials.ps1"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo RXO Expedite credential setup completed.
) else (
  echo RXO Expedite credential setup FAILED with exit code %RC%.
)
echo.
pause
exit /b %RC%
