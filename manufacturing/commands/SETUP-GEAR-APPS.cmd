@echo off
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\setup-gear-apps.ps1"
if errorlevel 1 (
    echo.
    echo Gear Apps setup failed.
    pause
    exit /b 1
)
echo.
echo Gear Apps setup completed successfully.
pause

