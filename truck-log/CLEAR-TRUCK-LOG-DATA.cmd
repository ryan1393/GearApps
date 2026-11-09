@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title Truck Log - Clear Operational Data

echo.
echo ============================================================
echo  TRUCK LOG - CLEAR OPERATIONAL / RXO / REFERENCE DATA
echo ============================================================
echo.
echo WARNING: This can permanently clear visits, scheduled loads,
echo          standard/Expedite RXO rows, reusable reference data,
echo          and docks from the Truck Log PostgreSQL database.
echo.
echo It preserves app/plant settings, users/auth, and schema metadata.
echo The database tool first runs the complete clear as a rollback-only
echo safety preflight. Only after that passes will it ask you to type CLEAR.
echo.
call "%~dp0tools\truck-log\run-reference-tool-in-docker.cmd" clear
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [FAIL] Clear operation did not complete.
  echo        Any failed database transaction was rolled back.
  pause
  exit /b %RC%
)
echo.
echo Clear operation finished. Review the output above to confirm whether it was committed or cancelled.
echo Run SYNC-TRUCK-LOG-AUTHORITATIVE-DOCKS.cmd if you intentionally cleared docks and want the Fort Wayne dock master restored.
pause
exit /b 0
