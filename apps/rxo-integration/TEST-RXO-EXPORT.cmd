@echo off
setlocal
cd /d "%~dp0"
call "%~dp0TEST-RXO-PRODUCTION-EXPORT.cmd"
exit /b %errorlevel%
