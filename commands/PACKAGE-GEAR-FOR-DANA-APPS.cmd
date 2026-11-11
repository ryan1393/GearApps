@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
title MeshForge - Package For Dana Apps
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\tools\manufacturing\package-gear-for-dana-apps.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo ============================================================
  echo   MESHFORGE DANA HANDOFF PACKAGE FAILED
  echo ============================================================
  pause
  exit /b %RC%
)
echo ============================================================
echo   MESHFORGE DANA HANDOFF PACKAGE COMPLETE
echo ============================================================
pause
exit /b 0
