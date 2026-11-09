@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0export-shipment-link-diagnostic.ps1"

if errorlevel 1 (
    echo.
    echo DIAGNOSTIC EXPORT FAILED.
    pause
    exit /b 1
)

pause
