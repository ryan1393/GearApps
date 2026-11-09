@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Dana Apps - Safe Source Package
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\package-gear-for-dana-apps.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo ============================================================
  echo   DANA APPS SOURCE PACKAGE FAILED
  echo ============================================================
  pause
  exit /b %RC%
)
echo ============================================================
echo   DANA APPS SOURCE PACKAGE COMPLETE
echo ============================================================
pause
exit /b 0
