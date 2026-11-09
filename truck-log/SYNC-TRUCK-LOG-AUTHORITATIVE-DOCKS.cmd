@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title Truck Log - Restore Fort Wayne Dock Master

echo.
echo ============================================================
echo  TRUCK LOG - RESTORE AUTHORITATIVE DOCK MASTER
echo ============================================================
echo.
echo This makes public.docks match exactly the Fort Wayne 9-dock master:
echo   7, 25, 28, 41, 49, 52, 61, 62, 68
echo A rollback-only database preflight runs before the real transaction.
echo.
call "%~dp0tools\truck-log\run-reference-tool-in-docker.cmd" sync-docks
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [FAIL] Authoritative dock sync did not complete.
  echo        Any failed database transaction was rolled back.
  pause
  exit /b %RC%
)
echo.
echo [PASS] Authoritative Fort Wayne dock master is installed.
pause
exit /b 0
