@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Gear Apps - Package For Dana Apps
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\package-gear-for-dana-apps.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo ============================================================
  echo   GEAR APPS DANA HANDOFF PACKAGE FAILED
  echo ============================================================
  pause
  exit /b %RC%
)
echo ============================================================
echo   GEAR APPS DANA HANDOFF PACKAGE COMPLETE
echo ============================================================
pause
exit /b 0
