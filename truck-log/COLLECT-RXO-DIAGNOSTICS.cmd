@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Truck Log RXO Diagnostics
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js 20 or newer must be installed on this workstation.
  pause
  exit /b 1
)
node "tools\truck-log\new-host\collect-diagnostics.mjs" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo [FAIL] Review the error above. No success is claimed.
pause
exit /b %RC%
