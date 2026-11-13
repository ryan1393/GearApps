@echo off
setlocal EnableExtensions
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Right-click REMOVE-OLD-PRINT-AGENT.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0REMOVE-OLD-PRINT-AGENT.ps1" %*
set "RESULT=%ERRORLEVEL%"
echo.
echo Finished with exit code %RESULT%.
pause
exit /b %RESULT%
