@echo off
setlocal EnableExtensions
set "HOST=%COMPUTERNAME%"
echo Truck Log Two Print Components - READ ONLY
if /I not "%HOST%"=="USFTWLDAPP" (
  echo [REVIEW] This diagnostic was designed for USFTWLDAPP, not %HOST%.
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnostics\CHECK-BOTH-READ-ONLY.ps1"
echo.
pause
exit /b %ERRORLEVEL%
