@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-production-export.ps1"
if errorlevel 1 (
    echo.
    echo RXO PRODUCTION EXPORT TEST FAILED.
    pause
    exit /b 1
)
pause
