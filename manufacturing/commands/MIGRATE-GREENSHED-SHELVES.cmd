@echo off
setlocal
cd /d "%~dp0.."
echo This launcher is retained for compatibility.
echo Green Shed migration is now part of the unified Summary shelf tag migration.
echo.
call "%~dp0MIGRATE-SUMMARY-SHELF-TAGS.cmd"
exit /b %ERRORLEVEL%

