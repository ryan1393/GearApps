@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ==================================================
echo   TRUCK LOG - LOAD MOCK DATA
echo ==================================================
echo.
echo This adds fake docks, active trucks, history, events,
echo and fake PDF paperwork. Existing real records are kept.
echo.

call "%~dp0tools\truck-log\run-mock-data-in-docker.cmd" seed
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo MOCK DATA LOAD FAILED.
  echo If mock data already exists, use RESET-MOCK-DATA.cmd.
  echo.
  pause
  exit /b %RC%
)

echo.
echo Mock data loaded.
echo Open Truck Log at your configured Truck Log web address.
echo.
pause
exit /b 0
