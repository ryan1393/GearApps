@echo off
setlocal EnableExtensions
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Right-click INSTALL-WATCHER-SERVICE.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL-WATCHER-SERVICE.ps1" %*
set "RESULT=%ERRORLEVEL%"
echo.
echo Finished with exit code %RESULT%.
pause
exit /b %RESULT%
