@echo off
setlocal
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0UPDATE-TRUCKLOG.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo Truck Log update completed.) else (echo Truck Log update stopped. Review the message above.)
echo.
pause
exit /b %RC%
