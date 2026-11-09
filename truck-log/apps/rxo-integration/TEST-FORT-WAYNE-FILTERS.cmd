@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-fort-wayne-filters.ps1"

if errorlevel 1 (
    echo.
    echo FILTER TEST FAILED.
    pause
    exit /b 1
)

pause
