@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Truck Log Full Live Scan
color 0B

echo ============================================================
echo  TRUCK LOG FULL LIVE SCAN - READ ONLY
echo ============================================================
echo [INFO] This scan does not modify source, containers, images,
echo        volumes, PostgreSQL, RXO data, credentials, or networks.
echo.

if not exist "package.json" (
  echo [FAIL] package.json not found. Run this CMD from the Truck Log project root.
  goto :hold
)

where node >nul 2>&1 || (echo [FAIL] Node.js not found.& goto :hold)
node "tools\truck-log\full-live-scan.mjs"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [PASS] Full live scan completed without blocking failures.
) else (
  echo [FAIL] Full live scan found blocking failures.
)

:hold
echo.
echo [INFO] This terminal will stay open.
echo [INFO] Type EXIT and press Enter when finished.
cmd /k
