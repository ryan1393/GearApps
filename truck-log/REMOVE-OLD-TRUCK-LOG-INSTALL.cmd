@echo off
setlocal
cd /d "%~dp0"
title Truck Log - Remove an old install
rem Removes containers and volumes left by an older Truck Log install (asks you to type REMOVE first).
rem   REMOVE-OLD-TRUCK-LOG-INSTALL.cmd        only another install's containers and volumes
rem   REMOVE-OLD-TRUCK-LOG-INSTALL.cmd -All   every Truck Log container and volume (test hosts only)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\tools\truck-log\remove-old-install.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
