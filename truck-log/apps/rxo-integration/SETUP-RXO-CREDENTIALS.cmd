@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-rxo-credentials.ps1"

if errorlevel 1 (
    echo.
    echo COMMAND FAILED.
    pause
    exit /b 1
)

pause
