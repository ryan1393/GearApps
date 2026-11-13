@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ==================================================
echo   TRUCK LOG - MOCK DATA STATUS
echo ==================================================
echo.
echo This reads mock-data counts from the running Truck Log database.
echo.

call "%~dp0tools\truck-log\run-mock-data-in-docker.cmd" status
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo MOCK DATA STATUS FAILED.
  echo.
  pause
  exit /b %RC%
)

echo.
echo Mock data status complete.
echo.
pause
exit /b 0
