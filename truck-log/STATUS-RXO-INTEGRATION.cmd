@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\truck-log\rxo-compose-control.ps1" -Action status
set "RC=%ERRORLEVEL%"
pause
exit /b %RC%
