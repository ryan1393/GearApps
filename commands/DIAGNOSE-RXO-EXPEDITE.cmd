@echo off
setlocal
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0DIAGNOSE-RXO-EXPEDITE.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
echo This diagnostic did not restart workers or change RXO state.
pause
exit /b %RC%
