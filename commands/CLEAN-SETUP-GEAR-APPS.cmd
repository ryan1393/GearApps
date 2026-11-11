@echo off
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\manufacturing\setup-gear-apps.ps1" -CleanInstall
if errorlevel 1 (
    echo.
    echo MeshForge clean setup failed.
    pause
    exit /b 1
)
echo.
echo MeshForge clean setup completed successfully.
pause

