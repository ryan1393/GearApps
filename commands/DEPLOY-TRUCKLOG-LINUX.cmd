@echo off
setlocal
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0DEPLOY-TRUCKLOG-LINUX.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo Linux deployment completed.) else (echo Linux deployment stopped. Review the redacted error above.)
echo.
pause
exit /b %RC%
