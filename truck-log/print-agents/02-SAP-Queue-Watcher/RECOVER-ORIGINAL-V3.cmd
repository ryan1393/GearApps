@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Recover installed original V3 source from the existing USFTWLDAPP folder.
echo READ ONLY: creates a new local archive; does NOT alter the installed watcher.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0RECOVER-ORIGINAL-V3.ps1"
set "RESULT=%ERRORLEVEL%"
if "%RESULT%"=="0" (echo [PASS] Original V3 archive created beside this file.) else (echo [FAIL] Original V3 files were not recovered.)
pause
exit /b %RESULT%
