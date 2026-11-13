@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-latest-exports.ps1"

if errorlevel 1 (
    echo.
    echo RXO LATEST OUTPUT VERIFICATION FAILED.
    pause
    exit /b 1
)

pause
