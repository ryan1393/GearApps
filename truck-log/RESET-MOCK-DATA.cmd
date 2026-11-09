@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ==================================================
echo   TRUCK LOG - RESET MOCK DATA
echo ==================================================
echo.
echo This deletes ONLY records tagged as Truck Log mock data,
echo then recreates the full mock dataset.
echo.

call "%~dp0tools\truck-log\run-mock-data-in-docker.cmd" reset
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo MOCK DATA RESET FAILED.
  echo.
  pause
  exit /b %RC%
)

echo.
echo Mock data reset complete.
echo.
pause
exit /b 0
