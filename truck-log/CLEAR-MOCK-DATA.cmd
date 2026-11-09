@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ==================================================
echo   TRUCK LOG - CLEAR MOCK DATA
echo ==================================================
echo.
echo This deletes ONLY MOCK-VISIT-* visits, mock docks,
echo and their mock paperwork folders. Real records are not targeted.
echo.

call "%~dp0tools\truck-log\run-mock-data-in-docker.cmd" clear
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo MOCK DATA CLEAR FAILED.
  echo.
  pause
  exit /b %RC%
)

echo.
echo Mock data cleared.
echo.
pause
exit /b 0
