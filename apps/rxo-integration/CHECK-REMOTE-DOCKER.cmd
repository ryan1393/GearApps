@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-remote-docker.ps1"

if errorlevel 1 (
    echo.
    echo REMOTE DOCKER CHECK FAILED.
    pause
    exit /b 1
)

pause
