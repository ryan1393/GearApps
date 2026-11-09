@echo off
setlocal
rem Same as the root LOGS-RXO-EXPORT.cmd: the root docker-compose.yml, Compose v2.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\tools\truck-log\rxo-compose-control.ps1" -Action logs
exit /b %ERRORLEVEL%
