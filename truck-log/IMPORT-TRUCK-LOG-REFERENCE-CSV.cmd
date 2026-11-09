@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title Truck Log - Import Reference Data

echo.
echo ============================================================
echo  TRUCK LOG - IMPORT REFERENCE DATA CSV
echo ============================================================
echo.
echo Source: reference-data-import\reference-data.csv
echo The import is additive and runs a rollback-only database preflight.
echo.
call "%~dp0tools\truck-log\run-reference-tool-in-docker.cmd" import
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [FAIL] Reference-data import did not complete.
  echo        Any failed database transaction was rolled back.
  pause
  exit /b %RC%
)
echo.
echo [PASS] Reference-data import completed.
pause
exit /b 0
